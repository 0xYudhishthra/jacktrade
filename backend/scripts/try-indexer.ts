/**
 * Compara lo indexado con la cadena: OI de cada mercado, posiciones abiertas y cerradas, la fila y los totales.
 * Correrlo después de generar actividad (try:cycle, try:liquidation, stress…). Sirve en el fork y en mainnet.
 *
 *   NETWORK=fork pnpm indexer      # terminal aparte
 *   pnpm try:indexer
 */
import { deployment, getNetwork } from "@hm/shared";
import { formatUnits, type Hex } from "viem";

const indexerUrl = process.env.INDEXER_URL ?? `http://localhost:${process.env.INDEXER_PORT ?? 8096}`;
const { client } = getNetwork();
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const ZERO = "0x0000000000000000000000000000000000000000";

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};
const usd = (v: bigint) => `${formatUnits(v, 6)} USDG`;

async function gql<T>(query: string): Promise<T> {
  const res = (await (await fetch(`${indexerUrl}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as { data?: T; errors?: { message: string }[] };
  if (!res.data) throw new Error(`GraphQL: ${res.errors?.map((e) => e.message).join(" · ")}`);
  return res.data;
}
const all = <T>(table: string, fields: string) => gql<Record<string, { items: T[] }>>(`{ ${table}(limit: 1000) { items { ${fields} } } }`).then((d) => d[table]!.items);

// 1. Al día con la cadena
const head = await client.getBlockNumber();
const status = (await (await fetch(`${indexerUrl}/status`)).json()) as { robinhood?: { block: { number: number } } };
const indexed = BigInt(status.robinhood?.block.number ?? 0);
check(head - indexed <= 50n, `indexer al día: bloque ${indexed} (cadena ${head})`);

type P = { id: string; user: Hex; instrumentId: number; isLong: boolean; margin: string; leverage: string; entryPrice: string; status: string; pnl: string | null };
const positions = await all<P>("positions", "id user instrumentId isLong margin leverage entryPrice status pnl");
const markets = await all<{ id: number; longOi: string; shortOi: string; open: number; retired: boolean }>("markets", "id longOi shortOi open retired");
const queue = await all<{ index: string; user: Hex; remaining: string }>("queueEntrys", "index user remaining");
const traders = await all<{ address: Hex; open: number; trades: number; realizedPnl: string }>("traders", "address open trades realizedPnl");
const [protocol] = await all<{ open: number; trades: number; totalQueued: string; traderPnl: string }>("protocols", "open trades totalQueued traderPnl");
const open = positions.filter((p) => p.status === "open");
console.log(`  ${positions.length} posiciones (${open.length} abiertas), ${traders.length} traders, ${queue.length} entradas en la fila`);

// 2. Cada posición contra positions(id): las abiertas existen con los mismos datos; las terminadas ya no.
let mismatched = 0;
for (const p of positions) {
  const [owner, instrumentId, isLong, leverage, , margin, entryPrice] = await client.readContract({ ...exchange, functionName: "positions", args: [BigInt(p.id)] });
  const ok =
    p.status === "open"
      ? owner.toLowerCase() === p.user && instrumentId === p.instrumentId && isLong === p.isLong && BigInt(leverage) === BigInt(p.leverage) && margin === BigInt(p.margin) && entryPrice === BigInt(p.entryPrice)
      : owner === ZERO;
  if (!ok) {
    mismatched++;
    console.log(`  ✖ posición ${p.id} (${p.status}) no coincide con la cadena`);
  }
}
check(mismatched === 0, `las ${positions.length} posiciones coinciden con la cadena (abiertas con los mismos datos, terminadas borradas)`);

// 3. OI de cada mercado
for (const m of markets) {
  const [, retired, , longOi, shortOi] = await client.readContract({ ...exchange, functionName: "marketState", args: [m.id] });
  check(longOi === BigInt(m.longOi) && shortOi === BigInt(m.shortOi) && retired === m.retired, `mercado ${m.id}: OI long ${usd(longOi)} · short ${usd(shortOi)}${retired ? " · retirado" : ""}`);
  check(m.open === open.filter((p) => p.instrumentId === m.id).length, `mercado ${m.id}: ${m.open} abiertas`);
}

// 4. La fila: total y lo que espera cada usuario
const totalQueued = await client.readContract({ ...exchange, functionName: "totalQueued" });
check(BigInt(protocol?.totalQueued ?? 0) === totalQueued, `fila total ${usd(totalQueued)}`);
const users = [...new Set(queue.map((e) => e.user))];
let queueOk = true;
for (const u of users) {
  const waiting = queue.filter((e) => e.user === u).reduce((a, e) => a + BigInt(e.remaining), 0n);
  if (waiting !== (await client.readContract({ ...exchange, functionName: "queuedOf", args: [u] }))) queueOk = false;
}
check(queueOk, `lo que espera cada usuario en la fila coincide con queuedOf (${users.length} usuarios)`);

// 5. Totales consistentes entre tablas
const pnl = positions.reduce((a, p) => a + BigInt(p.pnl ?? 0), 0n);
check((protocol?.open ?? 0) === open.length && (protocol?.trades ?? 0) === positions.length, `protocolo: ${protocol?.trades ?? 0} trades, ${protocol?.open ?? 0} abiertas`);
check(BigInt(protocol?.traderPnl ?? 0) === pnl && traders.reduce((a, t) => a + BigInt(t.realizedPnl), 0n) === pnl, `PnL realizado de los traders: ${usd(pnl)} (igual en posiciones, traders y protocolo)`);
check(traders.every((t) => t.open === open.filter((p) => p.user === t.address).length), "abiertas por trader coinciden");

process.exit(failures ? 1 : 0);
