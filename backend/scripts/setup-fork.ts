/**
 * Deja el fork listo para operar, como lo dejaría `contracts/scripts/configure.ts` en mainnet:
 * feeds de Pyth en el oráculo, mercados BTC y ETH listados, un relayer de prueba autorizado
 * y un usuario de prueba con USDG depositado en el Exchange.
 *
 *   pnpm fork          # en otra terminal
 *   pnpm setup:fork
 *
 * Se hace pasar por el owner con anvil (no hace falta su clave). Solo corre contra el fork. Se puede correr varias veces.
 */
import { createPriceFeed, markets } from "@hm/prices";
import { deployment, getNetwork, intentTypedData, type Intent } from "@hm/shared";
import {
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
} from "viem";

const { chain, rpcUrl, client } = getNetwork("fork");
const test = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });
const walletFor = (account: Address) => createWalletClient({ account, chain, transport: http(rpcUrl) });
const c = deployment.contracts;
const usdg = deployment.collateral.address as Address;

const USD = 1_000_000n;
// Cuentas con mucho USDG en mainnet (contratos de liquidez). En el fork se las simula para transferir.
// USDG (Paxos) no guarda los balances en un slot estándar, así que anvil_dealERC20 no funciona.
const USDG_WHALES: Address[] = ["0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d", "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010"];
const WAD = 10n ** 18n;

// Copiado de contracts/scripts/config.ts en main. Si cambia allá, actualizar acá.
const impact = (positionMultiplier: bigint) => ({
  baseRate: WAD / 10n,
  rateMultiplier: 15_000n * WAD,
  positionMultiplier,
  referenceNotional: 100_000n * WAD,
});
// OI de 250k por lado en main. FORK_OI_CAP (en USD) permite subirlo en el fork para la prueba de estrés.
const oiCap = BigInt(process.env.FORK_OI_CAP ?? 250_000) * USD;
// Mínimos: margen 10 USDG, notional 1000 USDG (decisión 2026-10-21).
const betaRisk = { minMargin: 10n * USD, minNotional: 1_000n * USD, longOiCap: oiCap, shortOiCap: oiCap };
const MARKETS = [
  { id: 0, name: "BTC/USD", maxAge: 15, positionMultiplier: (814_598n * WAD) / 1000n },
  { id: 1, name: "ETH/USD", maxAge: 15, positionMultiplier: (483_979n * WAD) / 1000n },
].map((m) => ({
  ...m,
  pythId: deployment.markets.find((x) => x.id === m.id)!.pythId,
  config: {
    maxLeverage: 1000,
    liqBufferBps: 5,
    // 10 en main. FORK_MAX_CONF_BPS permite subirlo en el fork para probar sin rechazos por confianza.
    maxConfBps: Number(process.env.FORK_MAX_CONF_BPS ?? 10),
    maxPriceJumpBps: 0,
    maxNotional: 100_000n * USD,
    impact: impact(m.positionMultiplier),
  },
  risk: betaRisk,
}));

async function send(label: string, hash: Promise<`0x${string}`>) {
  const receipt = await client.waitForTransactionReceipt({ hash: await hash });
  if (receipt.status !== "success") throw new Error(`${label} revirtió`);
  console.log(`  ✓ ${label}`);
}

// Cuentas de prueba de anvil: [0] paga gas en otros scripts, [1] relayer, [2] usuario, [3] otra cuenta, [4] session key,
// [5] liquidador, [6] keepers.
const accounts = await walletFor("0x0000000000000000000000000000000000000000").getAddresses();
const [, relayer, user, , sessionKey, , keeper] = accounts as Address[] as [Address, Address, Address, Address, Address, Address, Address];

// Las claves de anvil son públicas y en mainnet esas direcciones tienen una delegación EIP-7702 (código 0xef0100…).
// Con código, el Exchange valida la firma por ERC-1271 y la rechaza. En el fork se lo borramos para que firmen como EOA.
for (const a of accounts.slice(0, 7)) {
  if ((await client.getCode({ address: a })) && (await client.getCode({ address: a })) !== "0x") {
    await test.setCode({ address: a, bytecode: "0x" });
    console.log(`  ✓ código EIP-7702 borrado de ${a}`);
  }
}

// ---------------------------------------------------------------- owner
const owner = await client.readContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "owner" });
await test.impersonateAccount({ address: owner });
await test.setBalance({ address: owner, value: 10n * WAD });
const asOwner = walletFor(owner);
console.log(`Owner ${owner} (simulado)`);

console.log("Mercados");
for (const m of MARKETS) {
  const [pythId, maxAge] = await client.readContract({ address: c.PriceOracle.address, abi: c.PriceOracle.abi, functionName: "feeds", args: [m.id] });
  if (pythId !== m.pythId || maxAge !== m.maxAge) {
    await send(`oracle.setFeed(${m.name})`, asOwner.writeContract({ address: c.PriceOracle.address, abi: c.PriceOracle.abi, functionName: "setFeed", args: [m.id, m.pythId, m.maxAge] }));
  }
  const [listed] = await client.readContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "marketState", args: [m.id] });
  if (!listed) {
    await send(`exchange.listMarket(${m.name})`, asOwner.writeContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "listMarket", args: [m.id, m.config, m.risk] }));
  } else {
    const current = await client.readContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "marketConfig", args: [m.id] });
    if (current.maxConfBps !== m.config.maxConfBps) {
      await send(`exchange.setMarketConfig(${m.name}, maxConfBps ${m.config.maxConfBps})`, asOwner.writeContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "setMarketConfig", args: [m.id, m.config] }));
    }
    const [, , longOiCap] = await client.readContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "marketRisk", args: [m.id] });
    if (longOiCap !== m.risk.longOiCap) {
      await send(`exchange.setMarketRisk(${m.name}, OI ${formatUnits(m.risk.longOiCap, 6)})`, asOwner.writeContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "setMarketRisk", args: [m.id, m.risk] }));
    }
  }
}

console.log("Relayer");
const executor = { address: c.BatchExecutor.address, abi: c.BatchExecutor.abi } as const;
if (!(await client.readContract({ ...executor, functionName: "isRelayer", args: [relayer] }))) {
  await send(`executor.setRelayer(${relayer})`, asOwner.writeContract({ ...executor, functionName: "setRelayer", args: [relayer, true] }));
}
// Los keepers mandan heartbeat por el BatchExecutor: también son relayer, con su propia wallet.
if (!(await client.readContract({ ...executor, functionName: "isRelayer", args: [keeper] }))) {
  await send(`executor.setRelayer(${keeper}, keepers)`, asOwner.writeContract({ ...executor, functionName: "setRelayer", args: [keeper, true] }));
}
if (!(await client.readContract({ ...executor, functionName: "isTarget", args: [c.Exchange.address] }))) {
  await send("executor.setTarget(Exchange)", asOwner.writeContract({ ...executor, functionName: "setTarget", args: [c.Exchange.address, true] }));
}
await test.stopImpersonatingAccount({ address: owner });

// ---------------------------------------------------------------- usuario de prueba
console.log("Usuario");
const deposit = 1_000n * USD;
const balance = await client.readContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "balances", args: [user] });
if (balance < deposit / 2n) {
  const amount = 10_000n * USD;
  let whale: Address | undefined;
  for (const w of USDG_WHALES) {
    if ((await client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [w] })) >= amount) whale = w;
    if (whale) break;
  }
  if (!whale) throw new Error("Ninguna cuenta de USDG_WHALES tiene saldo: buscar otra con mucho USDG");
  await test.impersonateAccount({ address: whale });
  await test.setBalance({ address: whale, value: WAD });
  await send(`usdg.transfer(usuario, ${formatUnits(amount, 6)})`, walletFor(whale).writeContract({ address: usdg, abi: erc20Abi, functionName: "transfer", args: [user, amount] }));
  await test.stopImpersonatingAccount({ address: whale });
  const asUser = walletFor(user);
  await send("usdg.approve(Exchange)", asUser.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [c.Exchange.address, deposit] }));
  await send(`exchange.deposit(${formatUnits(deposit, 6)} USDG)`, asUser.writeContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "deposit", args: [deposit] }));
}

const [userBalance, usdgLeft] = await Promise.all([
  client.readContract({ address: c.Exchange.address, abi: c.Exchange.abi, functionName: "balances", args: [user] }),
  client.readContract({ address: usdg, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [user] }),
]);
console.log(`\nRelayer: ${relayer} (cuenta 1 de anvil)`);
console.log(`Usuario: ${user} (cuenta 2 de anvil) · en el Exchange ${formatUnits(userBalance, 6)} USDG · en la wallet ${formatUnits(usdgLeft, 6)} USDG`);

// ---------------------------------------------------------------- precalentamiento
// La primera vez que el fork toca un contrato, anvil lo baja de Alchemy y mientras tanto no genera bloques: el reloj
// se atrasa y los intents fallan por tiempo. Acá se registra la session key y se simula un batch real (open con la wallet
// y con la session key, con precio de Pyth), así queda todo en caché antes de las pruebas.
console.log("Precalentamiento");
const sk = { address: c.SessionKeyManager.address, abi: c.SessionKeyManager.abi } as const;
if (!(await client.readContract({ ...sk, functionName: "isValidSessionKey", args: [user, sessionKey] }))) {
  const expiry = (await client.getBlock()).timestamp + 7n * 86_400n;
  await send(`sessionKeys.registerSessionKey(${sessionKey})`, walletFor(user).writeContract({ ...sk, functionName: "registerSessionKey", args: [sessionKey, expiry] }));
}

const feed = createPriceFeed();
const signedAt = (await client.getBlock()).timestamp;
let update = feed.store.getUpdateAfter(markets.map((m) => m.feedId), Number(signedAt));
for (let i = 0; !update && i < 50; i++) {
  await new Promise((r) => setTimeout(r, 200));
  update = feed.store.getUpdateAfter(markets.map((m) => m.feedId), Number(signedAt));
}
await feed.stop();
if (!update) throw new Error("Hermes no mandó precios en 10 s");

const calls = [];
for (const [signer, instrumentId, isLong] of [[user, 0, true], [sessionKey, 1, false]] as const) {
  const i: Intent = { kind: "open", intent: { user, instrumentId, isLong, margin: 10n * USD, leverage: 100n, priceLimit: 0n, signedAt, nonce: BigInt(Date.now()) + BigInt(instrumentId) } };
  const signature = await walletFor(signer).signTypedData(intentTypedData(i) as never);
  calls.push({ target: c.Exchange.address, data: encodeFunctionData({ abi: c.Exchange.abi, functionName: "openPositionBySig", args: [i.intent as never, signature] }) });
}
const fee = await client.readContract({ address: c.PriceOracle.address, abi: c.PriceOracle.abi, functionName: "getUpdateFee", args: [update.updateData] });
const [simulated] = await client.simulateBlocks({
  blocks: [{ calls: [{ account: relayer, to: c.BatchExecutor.address, value: fee, gas: 3_000_000n, data: encodeFunctionData({ abi: c.BatchExecutor.abi, functionName: "execute", args: [update.updateData, calls] }) }] }],
});
const opened = parseEventLogs({ abi: c.Exchange.abi, logs: simulated!.calls[0]!.logs ?? [], eventName: "PositionOpened" }).length;
// Solo importa que anvil cargue el estado. Si el reloj todavía estaba atrasado, la simulación da 0 de 2 (StalePrice).
console.log(`  ✓ batch simulado para cargar el estado (no se manda nada): ${opened} de 2 opens pasarían${opened < 2 ? ", normal si el reloj todavía se estaba realineando" : ""}`);

// Esperar a que el fork vuelva a generar bloques con la hora real (el vigilante de pnpm fork lo realinea).
for (let stable = 0, i = 0; stable < 3 && i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const behind = Date.now() / 1000 - Number((await client.getBlock()).timestamp);
  stable = behind < 1.5 ? stable + 1 : 0;
}
console.log("  ✓ reloj del fork estable: listo para probar");
process.exit(0);
