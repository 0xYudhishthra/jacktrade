/**
 * Abre dos posiciones de punta a punta a través del relayer y las verifica en la cadena. Solo contra el fork.
 *
 *   pnpm fork                      # terminal 1
 *   pnpm setup:fork                # una vez por fork
 *   NETWORK=fork pnpm relayer      # terminal 2
 *   pnpm try:open                  # terminal 3
 *
 * Long de BTC firmado por la wallet del usuario y short de ETH firmado por su session key, sin popup de wallet.
 */
import { deployment, getNetwork, intentToJson, intentTypedData, type Intent, type IntentStatus } from "@hm/shared";
import { createWalletClient, formatUnits, http, parseEventLogs, type Address } from "viem";

const relayerUrl = process.env.RELAYER_URL ?? `http://localhost:${process.env.RELAYER_PORT ?? 8091}`;
const { chain, rpcUrl, client } = getNetwork("fork");
const wallet = (account: Address) => createWalletClient({ account, chain, transport: http(rpcUrl) });
const [, , user, , sessionKey] = (await wallet("0x0000000000000000000000000000000000000000").getAddresses()) as Address[];
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const sk = { address: deployment.contracts.SessionKeyManager.address, abi: deployment.contracts.SessionKeyManager.abi } as const;
const USD = 1_000_000n;

if (!(await client.readContract({ ...sk, functionName: "isValidSessionKey", args: [user!, sessionKey!] }))) {
  const expiry = (await client.getBlock()).timestamp + 7n * 86_400n;
  await client.waitForTransactionReceipt({ hash: await wallet(user!).writeContract({ ...sk, functionName: "registerSessionKey", args: [sessionKey!, expiry] }) });
  console.log("Session key registrada");
}

const balanceBefore = await client.readContract({ ...exchange, functionName: "balances", args: [user!] });
const signedAt = (await client.getBlock()).timestamp;
let nonce = BigInt(Date.now()) * 1000n;
const orders: [string, Address, Intent][] = [
  ["long BTC 10 USDG × 100 (wallet)", user!, { kind: "open", intent: { user: user!, instrumentId: 0, isLong: true, margin: 10n * USD, leverage: 100n, priceLimit: 0n, signedAt, nonce: nonce++ } }],
  ["short ETH 10 USDG × 100 (session key)", sessionKey!, { kind: "open", intent: { user: user!, instrumentId: 1, isLong: false, margin: 10n * USD, leverage: 100n, priceLimit: 0n, signedAt, nonce: nonce++ } }],
];

const ids: string[] = [];
for (const [label, signer, i] of orders) {
  const signature = await wallet(signer).signTypedData(intentTypedData(i) as never);
  const res = (await (await fetch(`${relayerUrl}/intent`, { method: "POST", body: JSON.stringify({ ...intentToJson(i), signature }) })).json()) as { id?: string; status: string; code?: string };
  console.log(`→ ${label}: ${res.status}${res.code ? ` (${res.code})` : ""}`);
  if (res.id) ids.push(res.id);
}

// Esperar a que cada intent termine (executed o failed).
const final = new Map<string, IntentStatus>();
for (let t = 0; t < 60 && final.size < ids.length; t++) {
  await new Promise((r) => setTimeout(r, 250));
  for (const id of ids) {
    const s = (await (await fetch(`${relayerUrl}/intent/${id}`)).json()) as IntentStatus;
    if (s.status === "executed" || s.status === "failed") final.set(id, s);
  }
}

let failures = 0;
const txs = new Set<`0x${string}`>();
const reported = new Map<string, string>(); // positionId según el relayer → precio
for (const id of ids) {
  const s = final.get(id);
  if (s?.status === "executed") {
    txs.add(s.txHash);
    if (s.positionId) reported.set(s.positionId, s.price);
    else failures++;
    console.log(`${s.positionId ? "✔" : "✖"} ${id.split(":")[1]} ejecutado · posición ${s.positionId ?? "SIN ID"} · precio ${(Number(s.price) / 1e18).toFixed(2)} · tx ${s.txHash.slice(0, 10)}…`);
  } else {
    failures++;
    console.log(`✖ ${id.split(":")[1]} ${s ? `${s.status}: ${"message" in s ? s.message : ""}` : "no terminó en 15 s"}`);
  }
}

// Verificar en la cadena: eventos PositionOpened y balance.
for (const hash of txs) {
  const receipt = await client.getTransactionReceipt({ hash });
  for (const e of parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PositionOpened" })) {
    const { positionId, instrumentId, isLong, margin, leverage, entryPrice } = e.args;
    const match = reported.get(positionId.toString()) === entryPrice.toString();
    if (!match) failures++;
    console.log(`  ${match ? "✔" : "✖"} en la cadena: posición ${positionId} · mercado ${instrumentId} · ${isLong ? "long" : "short"} · ${formatUnits(margin, 6)} USDG × ${leverage} · entrada ${(Number(entryPrice) / 1e18).toFixed(2)}${match ? " · coincide con el relayer" : " · NO coincide con el relayer"}`);
  }
}
const balanceAfter = await client.readContract({ ...exchange, functionName: "balances", args: [user!] });
console.log(`Balance en el Exchange: ${formatUnits(balanceBefore, 6)} → ${formatUnits(balanceAfter, 6)} USDG`);
process.exit(failures ? 1 : 0);
