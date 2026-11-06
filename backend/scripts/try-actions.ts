/**
 * Prueba de las acciones firmadas con la wallet (POST /action) contra el fork: depósito con permit, retiro,
 * registrar session key, stake, unstake y claim. Más los rechazos importantes. Solo contra el fork.
 *
 *   pnpm fork · FORK_MAX_CONF_BPS=25 pnpm setup:fork · NETWORK=fork pnpm relayer
 *   pnpm try:actions
 *
 * Para tener JACKTRADE y recompensas sin esperar pérdidas, se hace pasar por Tokenomics (minter) y por el Exchange
 * (notifyReward) con anvil.
 */
import { actionId, actionToJson, actionTypedData, deployment, getNetwork, type Action, type ActionStatus } from "@hm/shared";
import { createTestClient, createWalletClient, erc20Abi, formatUnits, http, parseAbi, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const relayerUrl = process.env.RELAYER_URL ?? `http://localhost:${process.env.RELAYER_PORT ?? 8091}`;
const { chain, rpcUrl, client } = getNetwork("fork");
const test = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });
const [, , user] = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
const wallet = createWalletClient({ account: user!, chain, transport: http(rpcUrl) });
const c = deployment.contracts;
const exchange = { address: c.Exchange.address, abi: c.Exchange.abi } as const;
const staking = { address: c.JackTradeStaking.address, abi: c.JackTradeStaking.abi } as const;
const usdg = deployment.collateral.address as Address;
const token = deployment.token.address as Address;
const USD = 1_000_000n;

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};
const usd = (v: bigint) => `${formatUnits(v, 6)} USDG`;
const now = async () => (await client.getBlock()).timestamp;
let nonce = BigInt(Date.now()) * 1000n;

/** Firma con la wallet (o con otra cuenta, para probar rechazos), manda y espera a que el relayer termine. */
async function send(a: Action, signWith?: ReturnType<typeof privateKeyToAccount>): Promise<ActionStatus | { status: "rejected"; code: string; message: string }> {
  const signature = signWith ? await signWith.signTypedData(actionTypedData(a) as never) : await wallet.signTypedData(actionTypedData(a) as never);
  const res = (await (await fetch(`${relayerUrl}/action`, { method: "POST", body: JSON.stringify({ ...actionToJson(a), signature }) })).json()) as { id?: string; status: string; code?: string; message?: string };
  if (res.status === "rejected") return res as { status: "rejected"; code: string; message: string };
  for (let t = 0; t < 360; t++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = (await (await fetch(`${relayerUrl}/action/${encodeURIComponent(actionId(a))}`)).json()) as ActionStatus;
    if (s.status === "executed" || s.status === "failed") return s;
  }
  return { id: actionId(a), status: "failed", code: "Unknown", message: "no terminó en 90 s" };
}
const describe = (r: Awaited<ReturnType<typeof send>>) => ("code" in r ? `${r.status} ${r.code}: ${r.message}` : r.status);

const deadline = async () => (await now()) + 600n;
const balance = () => client.readContract({ ...exchange, functionName: "balances", args: [user!] });

// 1. Depósito con permit (sin approve previo)
const usdgNonce = await client.readContract({ address: usdg, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [user!] });
const before = await balance();
const dep = await send({ kind: "depositPermit", action: { user: user!, amount: 20n * USD, nonce: usdgNonce, deadline: await deadline() } });
check(dep.status === "executed" && (await balance()) === before + 20n * USD, `depositPermit 20 USDG: ${describe(dep)} · balance ${usd(before)} → ${usd(await balance())}`);

// 2. Retiro
const walletBefore = await client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [user!] });
const wdNonce = nonce++;
const wd = await send({ kind: "withdraw", action: { user: user!, to: user!, amount: 10n * USD, nonce: wdNonce, deadline: await deadline() } });
const walletAfter = await client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [user!] });
check(wd.status === "executed" && walletAfter === walletBefore + 10n * USD, `withdraw 10 USDG a la wallet: ${describe(wd)}`);

// Rechazos del retiro: más que el balance, firma de una session key, nonce repetido
const tooMuch = await send({ kind: "withdraw", action: { user: user!, to: user!, amount: (await balance()) + 1n, nonce: nonce++, deadline: await deadline() } });
check("code" in tooMuch && tooMuch.code === "InsufficientBalance", `retiro mayor al balance → ${describe(tooMuch)}`);
const sessionKey = privateKeyToAccount(generatePrivateKey());
const bySessionKey = await send({ kind: "withdraw", action: { user: user!, to: sessionKey.address, amount: 10n * USD, nonce: nonce++, deadline: await deadline() } }, sessionKey);
check("code" in bySessionKey && bySessionKey.code === "InvalidSignature", `retiro firmado por otra cuenta → ${describe(bySessionKey)}`);
const used = await send({ kind: "withdraw", action: { user: user!, to: user!, amount: 10n * USD, nonce: wdNonce, deadline: await deadline() } });
check("code" in used && used.code === "NonceAlreadyUsed", `nonce repetido → ${describe(used)}`);

// 3. Registrar session key con una firma (sin transacción del usuario)
const epoch = await client.readContract({ address: c.SessionKeyManager.address, abi: c.SessionKeyManager.abi, functionName: "epochOf", args: [user!] });
const reg = await send({ kind: "registerSessionKey", action: { user: user!, key: sessionKey.address, expiry: (await now()) + 86_400n, epoch, nonce: nonce++, deadline: await deadline() } });
const valid = await client.readContract({ address: c.SessionKeyManager.address, abi: c.SessionKeyManager.abi, functionName: "isValidSessionKey", args: [user!, sessionKey.address] });
check(reg.status === "executed" && valid, `registerSessionKey ${sessionKey.address.slice(0, 10)}… por 24 h: ${describe(reg)} · válida: ${valid}`);

// 4. Staking: JACKTRADE minteado haciéndose pasar por Tokenomics (el minter)
const minter = await client.readContract({ address: token, abi: parseAbi(["function minter() view returns (address)"]), functionName: "minter" });
await test.impersonateAccount({ address: minter });
await test.setBalance({ address: minter, value: parseEther("1") });
await client.waitForTransactionReceipt({
  hash: await createWalletClient({ account: minter, chain, transport: http(rpcUrl) }).writeContract({ address: token, abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [user!, parseEther("1000")] }),
});
await test.stopImpersonatingAccount({ address: minter });

const noReward = await send({ kind: "claim", action: { user: user!, nonce: nonce++, deadline: await deadline() } });
check("code" in noReward && noReward.code === "NothingToClaim", `claim sin recompensas → ${describe(noReward)}`);

const stakedBefore = await client.readContract({ ...staking, functionName: "stakeOf", args: [user!] });
const st = await send({ kind: "stake", action: { user: user!, amount: parseEther("600"), nonce: nonce++, deadline: await deadline() } });
const stakedMid = await client.readContract({ ...staking, functionName: "stakeOf", args: [user!] });
check(st.status === "executed" && stakedMid === stakedBefore + parseEther("600"), `stake 600 JACKTRADE (sin approve): ${describe(st)}`);

const un = await send({ kind: "unstake", action: { user: user!, amount: parseEther("100"), nonce: nonce++, deadline: await deadline() } });
const stakedAfter = await client.readContract({ ...staking, functionName: "stakeOf", args: [user!] });
check(un.status === "executed" && stakedAfter === stakedMid - parseEther("100"), `unstake 100: ${describe(un)} · stakeado ${formatUnits(stakedAfter, 18)}`);

const tooMuchUnstake = await send({ kind: "unstake", action: { user: user!, amount: stakedAfter + 1n, nonce: nonce++, deadline: await deadline() } });
check("code" in tooMuchUnstake && tooMuchUnstake.code === "InsufficientStake", `unstake mayor a lo stakeado → ${describe(tooMuchUnstake)}`);

// 5. Claim: recompensa notificada haciéndose pasar por el Exchange (como haría pushStakerFees)
await test.impersonateAccount({ address: exchange.address });
await test.setBalance({ address: exchange.address, value: parseEther("1") });
await client.waitForTransactionReceipt({
  hash: await createWalletClient({ account: exchange.address, chain, transport: http(rpcUrl) }).writeContract({ ...staking, functionName: "notifyReward", args: [5n * USD] }),
});
await test.stopImpersonatingAccount({ address: exchange.address });
const pending = await client.readContract({ ...staking, functionName: "pendingReward", args: [user!] });
const cl = await send({ kind: "claim", action: { user: user!, nonce: nonce++, deadline: await deadline() } });
const pendingAfter = await client.readContract({ ...staking, functionName: "pendingReward", args: [user!] });
check(cl.status === "executed" && pending > 0n && pendingAfter === 0n, `claim de ${usd(pending)} pendientes: ${describe(cl)} · quedan ${usd(pendingAfter)}`);

process.exit(failures ? 1 : 0);
