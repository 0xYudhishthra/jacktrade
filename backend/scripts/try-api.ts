/**
 * Compara las respuestas de la API con la cadena. Correrlo con actividad hecha (try:cycle, try:open, try:liquidation).
 *
 *   NETWORK=fork pnpm indexer      # terminal aparte (la API va en el mismo servidor)
 *   NETWORK=fork pnpm try:api
 */
import { deployment, getNetwork, settle } from "@hm/shared";
import { createWalletClient, formatUnits, http, parseUnits, type Address } from "viem";

const api = process.env.INDEXER_URL ?? `http://localhost:${process.env.INDEXER_PORT ?? 8096}`;
const { client, chain, rpcUrl, name } = getNetwork();
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const tokenomics = { address: deployment.contracts.JackTradeTokenomics.address, abi: deployment.contracts.JackTradeTokenomics.abi } as const;
const user = (process.env.API_USER as Address | undefined) ?? (name === "fork" ? ((await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses())[2] as Address) : undefined);
if (!user) throw new Error("Falta API_USER (en mainnet no hay usuario de prueba)");

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};
const get = async <T>(path: string, status = 200): Promise<T> => {
  const res = await fetch(`${api}${path}`);
  if (res.status !== status) throw new Error(`${path} respondió ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const units = (s: string) => parseUnits(s, 6);
const wad = (s: string) => parseUnits(s, 18);

// cuenta
type Account = { balance: string; queue: { waiting: string; position: number; ahead: string } | null; stats: { trades: number; open: number } };
const account = await get<Account>(`/api/account/${user}`);
const [balance, queued] = await Promise.all([
  client.readContract({ ...exchange, functionName: "balances", args: [user] }),
  client.readContract({ ...exchange, functionName: "queuedOf", args: [user] }),
]);
check(units(account.balance) === balance, `account: balance ${account.balance} USDG igual a balances()`);
check(units(account.queue?.waiting ?? "0") === queued, `account: en la fila ${account.queue?.waiting ?? "0"} USDG igual a queuedOf()${account.queue ? ` · lugar ${account.queue.position}, ${account.queue.ahead} adelante` : ""}`);

// posiciones abiertas y vista previa
type Pos = { id: string; instrumentId: number; side: string; margin: string; leverage: number; entryPrice: string; markPrice: string | null; liquidationPrice: string; pnl: string | null };
const positions = await get<Pos[]>(`/api/positions/${user}`);
check(positions.length === account.stats.open, `positions: ${positions.length} abiertas, igual que account.stats.open`);
const [deadband] = await client.readContract({ ...exchange, functionName: "limits" });
for (const p of positions.slice(0, 3)) {
  const [owner, , isLong, leverage, , margin, entry] = await client.readContract({ ...exchange, functionName: "positions", args: [BigInt(p.id)] });
  const same = owner.toLowerCase() === user.toLowerCase() && units(p.margin) === margin && wad(p.entryPrice) === entry && p.leverage === Number(leverage) && (p.side === "long") === isLong;
  check(same, `posición ${p.id}: datos iguales a positions()${owner === "0x0000000000000000000000000000000000000000" ? " (en la cadena ya no existe: ¿el indexer va atrasado?)" : ""}`);
  if (!same) continue;
  const pre = await get<{ price: string; gain: string; loss: string; pnl: string }>(`/api/preview/${p.id}`);
  const cfg = await client.readContract({ ...exchange, functionName: "marketConfig", args: [p.instrumentId] });
  const local = await settle(client, { margin, leverage: BigInt(leverage), entryPrice: entry, exitPrice: wad(pre.price), isLong, deadbandDivisor: BigInt(deadband), impact: cfg.impact });
  check(units(pre.gain) === local.gain && units(pre.loss) === local.loss, `preview ${p.id} a ${pre.price}: ganancia ${pre.gain} · pérdida ${pre.loss} · neto ${pre.pnl} (igual a PnLMath.settle)`);
}

// historial
type History = { items: { type: string; at: number }[]; next: string | null };
const history = await get<History>(`/api/history/${user}`);
const closes = history.items.filter((i) => i.type === "close" || i.type === "liquidation").length;
check(history.items.every((i, k) => k === 0 || history.items[k - 1]!.at >= i.at), `history: ${history.items.length} items ordenados del más nuevo al más viejo`);
check(history.next !== null || closes === account.stats.trades - account.stats.open, `history: ${closes} cierres = trades − abiertas`);

// mercados, stats, ranking y tasa
type Market = { instrumentId: number; longOi: string; shortOi: string; retired: boolean };
for (const m of await get<Market[]>("/api/markets")) {
  const [, retired, , longOi, shortOi] = await client.readContract({ ...exchange, functionName: "marketState", args: [m.instrumentId] });
  check(units(m.longOi) === longOi && units(m.shortOi) === shortOi && m.retired === retired, `markets ${m.instrumentId}: OI ${m.longOi} / ${m.shortOi} igual a marketState()`);
}
const stats = await get<{ bankroll: string; queue: { total: string } }>("/api/stats");
const [bankroll, totalQueued] = await Promise.all([client.readContract({ ...exchange, functionName: "lpBankrollAvailable" }), client.readContract({ ...exchange, functionName: "totalQueued" })]);
check(units(stats.bankroll) === bankroll && units(stats.queue.total) === totalQueued, `stats: caja libre ${stats.bankroll} · fila ${stats.queue.total} iguales a la cadena`);
const board = await get<{ realizedPnl: string }[]>("/api/leaderboard?by=pnl");
check(board.every((r, k) => k === 0 || units(board[k - 1]!.realizedPnl) >= units(r.realizedPnl)), `leaderboard: ${board.length} ordenados por PnL`);
// leaderboard v2: en la ventana "all", el PnL de cada cuenta es su PnL realizado de siempre
type Accounts = { count: number; accounts: { rank: number | null; user: string; pnl: string; realizedPnl: string }[]; pageInfo: { totalPages: number } };
const accounts = await get<Accounts>("/api/leaderboard/accounts?window=all");
check(accounts.accounts.every((a) => a.pnl === a.realizedPnl), `accounts (all): ${accounts.count} cuentas, PnL de la ventana = PnL realizado`);
const ranked = accounts.accounts.filter((a) => a.rank !== null);
check(ranked.every((a, k) => a.rank === k + 1 && (k === 0 || units(ranked[k - 1]!.pnl) >= units(a.pnl))), `accounts: ${ranked.length} con rank, ordenados por PnL`);
const byVolume = await get<Accounts>("/api/leaderboard/accounts?sortKey=volume&window=all");
check(byVolume.count === accounts.count && byVolume.accounts.every((a) => accounts.accounts.find((b) => b.user === a.user)?.rank === a.rank), "accounts: ordenar por volumen no cambia el rank");
type Top = { positions: { rank: number; pnl: string }[] };
const top = await get<Top>("/api/leaderboard/positions?window=all");
check(top.positions.length <= 15 && top.positions.every((p, k) => k === 0 || units(top.positions[k - 1]!.pnl) >= units(p.pnl)), `positions: top ${top.positions.length} ordenado por PnL`);
const first = await fetch(`${api}/api/leaderboard/positions?window=7d`);
const again = await fetch(`${api}/api/leaderboard/positions?window=7d`, { headers: { "if-none-match": first.headers.get("etag") ?? "" } });
check(first.headers.get("cache-control")?.includes("max-age=1") === true && again.status === 304, "positions: Cache-Control y 304 con el mismo ETag");
const rate = await get<{ rate: string }>("/api/rate");
const onchainRate = await client.readContract({ ...tokenomics, functionName: "currentRate", args: [await client.readContract({ ...exchange, functionName: "trackedLp" })] });
check(wad(rate.rate) === onchainRate, `rate: ${rate.rate} JACKTRADE por USDG igual a currentRate()`);

// feeds y gráficos: tienen que cuadrar con lo de arriba y con la cadena
type Activity = { items: { kind: string; at: number }[]; next: string | null };
let opens = 0;
let cursor: string | null = null;
do {
  const page: Activity = await get<Activity>(`/api/activity?kind=open&user=${user}&limit=100${cursor ? `&cursor=${cursor}` : ""}`);
  opens += page.items.length;
  cursor = page.next;
} while (cursor);
check(opens === account.stats.trades, `activity: ${opens} aperturas del usuario = account.stats.trades (paginando)`);
type Pnl = { points: { realizedPnl: string; netDeposits: string }[] };
const pnl = await get<Pnl>(`/api/pnl/${user}?window=all`);
const lastPnl = pnl.points.at(-1);
const full = await get<{ stats: { realizedPnl: string; deposited: string; withdrawn: string } }>(`/api/account/${user}`);
check(
  !lastPnl || (units(lastPnl.realizedPnl) === units(full.stats.realizedPnl) && units(lastPnl.netDeposits) === units(full.stats.deposited) - units(full.stats.withdrawn)),
  `pnl: último punto ${lastPnl?.realizedPnl ?? "-"} USDG = realizedPnl de la cuenta, depósitos netos iguales`,
);
type House = { markets: { instrumentId: number; longOi: string; shortOi: string }[]; queue: string };
const houseNow = await get<House>("/api/house");
for (const m of houseNow.markets) {
  const [, , , longOi, shortOi] = await client.readContract({ ...exchange, functionName: "marketState", args: [m.instrumentId] });
  check(units(m.longOi) === longOi && units(m.shortOi) === shortOi, `house ${m.instrumentId}: OI de las posiciones abiertas ${m.longOi} / ${m.shortOi} = marketState()`);
}
type Series = { points: { housePnl: string; queue: string }[] };
const series = await get<Series>("/api/stats/history?window=all&interval=1d");
const statsNow = await get<{ housePnl: string; queue: { total: string } }>("/api/stats");
check(series.points.at(-1)?.housePnl === statsNow.housePnl && series.points.at(-1)?.queue === statsNow.queue.total, `stats/history: último punto = /api/stats (PnL de la casa ${statsNow.housePnl}, fila ${statsNow.queue.total})`);
const tokenNow = await get<{ staking: { totalStaked: string } }>("/api/token");
const totalStaked = await client.readContract({ address: deployment.contracts.JackTradeStaking.address, abi: deployment.contracts.JackTradeStaking.abi, functionName: "totalStaked" });
check(wad(tokenNow.staking.totalStaked) === totalStaked, `token: ${tokenNow.staking.totalStaked} JACKTRADE stakeados = totalStaked()`);
const firstAt = (await get<Activity>("/api/activity?limit=1")).items[0]?.at ?? Math.floor(Date.now() / 1000);
const vol = await get<{ candles: { volume: string }[] }>(`/api/volume?market=0&interval=1d&from=${firstAt - 86_400}`);
const btc = (await get<{ instrumentId: number; volume: string }[]>("/api/markets")).find((m) => m.instrumentId === 0)!;
check(vol.candles.reduce((s, c) => s + units(c.volume), 0n) <= units(btc.volume), `volume: velas diarias de BTC suman ≤ volumen total ${btc.volume} (lo anterior al primer evento queda afuera)`);

// errores
await get(`/api/account/0x123`, 400);
await get(`/api/activity?kind=foo`, 400);
await get(`/api/stats/history?window=30d&interval=5m`, 400);
await get(`/api/volume?market=9&interval=1h&from=0`, 400);
await get(`/api/preview/abc`, 400);
await get(`/api/leaderboard?by=foo`, 400);
await get(`/api/leaderboard/accounts?limit=500`, 400);
await get(`/api/leaderboard/positions?window=1y`, 400);
check(true, "pedidos inválidos devuelven 400");
console.log(`  (usuario ${user} · ${formatUnits(balance, 6)} USDG)`);
process.exit(failures ? 1 : 0);
