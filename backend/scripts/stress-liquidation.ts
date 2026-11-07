/**
 * Prueba de estrés del liquidador: abre muchas posiciones a 1000x (mitad longs, mitad shorts) y espera a que BTC
 * se mueva lo suficiente (~0,05%) para que cruce un lado entero de golpe. Verifica que el liquidador las liquide
 * todas y que no quede ninguna cruzada sin liquidar. Solo contra el fork.
 *
 *   pnpm fork
 *   FORK_MAX_CONF_BPS=25 FORK_OI_CAP=1000000 pnpm setup:fork
 *   NETWORK=fork pnpm liquidator          # el relayer no hace falta: los opens van directo al BatchExecutor
 *   pnpm stress:liquidation
 *
 * Opciones: STRESS_POSITIONS (500), STRESS_WAIT_SECONDS (600).
 */
import { createPriceFeed, markets } from "@hm/prices";
import { deployment, getNetwork, intentTypedData, type Intent } from "@hm/shared";
import { createWalletClient, encodeFunctionData, erc20Abi, http, parseAbiItem, parseEventLogs, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const total = Number(process.env.STRESS_POSITIONS ?? 500);
const waitSeconds = Number(process.env.STRESS_WAIT_SECONDS ?? 600);
const liquidatorUrl = process.env.LIQUIDATOR_URL ?? `http://localhost:${process.env.LIQUIDATOR_PORT ?? 8094}`;
const BATCH = 50;
const MARGIN = 10_000_000n; // 10 USDG (el mínimo)
const LEVERAGE = 1000n;

const { chain, rpcUrl, client } = getNetwork("fork");
const accounts = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
const [, relayer, user] = accounts as [Address, Address, Address];
const wallet = (a: Address) => createWalletClient({ account: a, chain, transport: http(rpcUrl) });

// Firmar 500 intents pidiéndoselos a anvil uno por uno tarda minutos. Las cuentas de anvil salen de un mnemónico de
// prueba público: se firma localmente con la misma clave (solo sirve en el fork).
const userKey = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 2 });
if (userKey.address !== user) throw new Error("La cuenta 2 del fork no es la del mnemónico de prueba de anvil");
const c = deployment.contracts;
const exchange = { address: c.Exchange.address, abi: c.Exchange.abi } as const;

// ---------------------------------------------------------------- saldo
const needed = MARGIN * BigInt(total) + 10_000_000n;
const balance = await client.readContract({ ...exchange, functionName: "balances", args: [user] });
if (balance < needed) {
  const amount = needed - balance;
  const usdg = deployment.collateral.address as Address;
  await client.waitForTransactionReceipt({ hash: await wallet(user).writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [exchange.address, amount] }) });
  await client.waitForTransactionReceipt({ hash: await wallet(user).writeContract({ ...exchange, functionName: "deposit", args: [amount] }) });
  console.log(`Depositados ${Number(amount) / 1e6} USDG para tener margen`);
}

// ---------------------------------------------------------------- abrir
const feed = createPriceFeed();
const btc = markets[0]!.feedId;
const fromBlock = await client.getBlockNumber();
const ids: bigint[] = [];
let nonce = BigInt(Date.now()) * 1000n;
const t0 = Date.now();

for (let start = 0; start < total; start += BATCH) {
  const signedAt = (await client.getBlock()).timestamp;
  let update = feed.store.getUpdateAfter([btc], Number(signedAt));
  for (let i = 0; !update && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    update = feed.store.getUpdateAfter([btc], Number(signedAt));
  }
  if (!update) throw new Error("Hermes no mandó un precio a tiempo");

  const calls = [];
  for (let i = start; i < Math.min(start + BATCH, total); i++) {
    const intent: Intent = { kind: "open", intent: { user, instrumentId: 0, isLong: i % 2 === 0, margin: MARGIN, leverage: LEVERAGE, priceLimit: 0n, signedAt, nonce: nonce++ } };
    const signature = await userKey.signTypedData(intentTypedData(intent) as never);
    calls.push({ target: exchange.address, data: encodeFunctionData({ abi: exchange.abi, functionName: "openPositionBySig", args: [intent.intent as never, signature] }) });
  }
  const fee = await client.readContract({ address: c.PriceOracle.address, abi: c.PriceOracle.abi, functionName: "getUpdateFee", args: [update.updateData] });
  const hash = await wallet(relayer).writeContract({
    address: c.BatchExecutor.address,
    abi: c.BatchExecutor.abi,
    functionName: "execute",
    args: [update.updateData, calls],
    value: fee,
    gas: 300_000n + 800_000n * BigInt(calls.length),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const opened = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PositionOpened" }).map((l) => l.args.positionId);
  const failed = parseEventLogs({ abi: c.BatchExecutor.abi, logs: receipt.logs, eventName: "CallFailed" }).length;
  ids.push(...opened);
  console.log(`  tanda ${start / BATCH + 1}: ${opened.length} abiertas${failed ? ` · ${failed} fallaron` : ""} · gas ${receipt.gasUsed}`);
}
await feed.stop();
console.log(`Abiertas ${ids.length} de ${total} en ${((Date.now() - t0) / 1000).toFixed(1)} s (1 USDG × 1000 cada una, mitad longs y mitad shorts)`);
const openedUntil = await client.getBlockNumber();
if (ids.length < total * 0.9) throw new Error("Se abrieron muy pocas: revisar el OI (FORK_OI_CAP) o el saldo");

// ---------------------------------------------------------------- esperar el cruce
const mine = new Set(ids);
const liquidatedEvent = parseAbiItem("event PositionLiquidated(uint256 indexed positionId, address indexed user, uint256 price, uint256 margin, uint256 fee)");
const liquidatedAt = new Map<bigint, bigint>(); // id → bloque
let firstAt = 0;
let lastAt = 0;
let lastBlock = fromBlock;

console.log(`Esperando que BTC se mueva ~0,05% (hasta ${waitSeconds} s)…`);
for (let t = 0; t < waitSeconds; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const head = await client.getBlockNumber();
  const logs = await client.getLogs({ address: exchange.address, event: liquidatedEvent, fromBlock: lastBlock + 1n, toBlock: head });
  lastBlock = head;
  const before = liquidatedAt.size;
  for (const l of logs) if (mine.has(l.args.positionId!)) liquidatedAt.set(l.args.positionId!, l.blockNumber);
  if (liquidatedAt.size > before) {
    if (!firstAt) firstAt = Date.now();
    lastAt = Date.now();
    console.log(`  ${t + 1} s · liquidadas ${liquidatedAt.size} de ${ids.length}`);
  }

  // Terminar cuando haya habido liquidaciones y lleven 10 s sin cambios, o cuando estén todas.
  const settled = firstAt && Date.now() - lastAt > 10_000;
  if (liquidatedAt.size === ids.length || settled) break;
  if (t % 30 === 29 && !firstAt) {
    const rows = ((await (await fetch(`${liquidatorUrl}/positions`)).json()) as { id: string; side: string; distancePct: number | null }[]).filter((r) => mine.has(BigInt(r.id)));
    const closest = Math.min(...rows.map((r) => r.distancePct ?? Infinity));
    console.log(`  ${t + 1} s · ninguna cruzó todavía · la más cercana está a ${closest.toFixed(4)}%`);
  }
}

// ---------------------------------------------------------------- verificar
if (liquidatedAt.size === 0) {
  console.log(`✖ BTC no se movió lo suficiente en ${waitSeconds} s: volvé a correrlo o subí STRESS_WAIT_SECONDS`);
  process.exit(1);
}
const crossedLeft = (await (await fetch(`${liquidatorUrl}/liquidatable`)).json()) as { id: string }[];
const stillCrossed = crossedLeft.filter((x) => mine.has(BigInt(x.id)));
const blocks = new Set(liquidatedAt.values());
const duringOpen = [...liquidatedAt.values()].filter((b) => b <= openedUntil).length;
console.log(`✔ liquidadas ${liquidatedAt.size} de ${ids.length}, en ${blocks.size} transacciones${duringOpen ? ` (${duringOpen} ya mientras se abrían las demás)` : ""}`);
if (liquidatedAt.size > duringOpen) console.log(`  después de abrir: ${liquidatedAt.size - duringOpen} en ${((lastAt - firstAt) / 1000).toFixed(1)} s desde que se vio la primera`);
console.log(`${stillCrossed.length === 0 ? "✔" : "✖"} ninguna posición cruzada quedó sin liquidar${stillCrossed.length ? `: quedan ${stillCrossed.map((x) => x.id).join(", ")}` : ""}`);

// Las que siguen abiertas tienen que estar del lado que no cruzó.
const open = ((await (await fetch(`${liquidatorUrl}/positions`)).json()) as { id: string; side: string; distancePct: number | null }[]).filter((r) => mine.has(BigInt(r.id)));
const negative = open.filter((r) => (r.distancePct ?? 0) < 0);
console.log(`${negative.length === 0 ? "✔" : "✖"} siguen abiertas ${open.length} (${[...new Set(open.map((r) => r.side))].join(" y ") || "ninguna"}), todas fuera de liquidación`);
process.exit(stillCrossed.length || negative.length ? 1 : 0);

