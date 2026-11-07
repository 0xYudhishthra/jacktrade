/**
 * Abre un long y un short de BTC a 1000x por el relayer, espera a que el liquidador detecte que alguno cruzó
 * y a que lo liquide en la cadena.
 * A 1000x se liquidan con un movimiento de ~0,05% (~$40 en BTC): con el precio real alguno cruza en uno o dos minutos.
 * Solo contra el fork.
 *
 *   pnpm fork · pnpm setup:fork · NETWORK=fork pnpm relayer · NETWORK=fork pnpm liquidator
 *   pnpm try:liquidation
 */
import { deployment, getNetwork, intentToJson, intentTypedData, type Intent, type IntentStatus } from "@hm/shared";
import { createWalletClient, formatUnits, http, parseAbiItem, type Address } from "viem";

const relayerUrl = process.env.RELAYER_URL ?? `http://localhost:${process.env.RELAYER_PORT ?? 8091}`;
const liquidatorUrl = process.env.LIQUIDATOR_URL ?? `http://localhost:${process.env.LIQUIDATOR_PORT ?? 8094}`;
const waitSeconds = Number(process.env.DETECT_WAIT_SECONDS ?? 180);
const { chain, rpcUrl, client } = getNetwork("fork");
const [, , user] = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
const wallet = createWalletClient({ account: user!, chain, transport: http(rpcUrl) });

let nonce = BigInt(Date.now()) * 1000n;
async function open(isLong: boolean) {
  const i: Intent = {
    kind: "open",
    intent: { user: user!, instrumentId: 0, isLong, margin: 10_000_000n, leverage: 1000n, priceLimit: 0n, signedAt: (await client.getBlock()).timestamp, nonce: nonce++ },
  };
  const signature = await wallet.signTypedData(intentTypedData(i) as never);
  const { id } = (await (await fetch(`${relayerUrl}/intent`, { method: "POST", body: JSON.stringify({ ...intentToJson(i), signature }) })).json()) as { id: string };
  for (let t = 0; t < 80; t++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = (await (await fetch(`${relayerUrl}/intent/${id}`)).json()) as IntentStatus;
    if (s.status === "executed") return s.positionId!;
    if (s.status === "failed") throw new Error(`${isLong ? "long" : "short"} falló: ${s.code} · ${s.message}`);
  }
  throw new Error("el relayer no terminó en 20 s");
}

const ids = [await open(true), await open(false)];
console.log(`Abiertas a 1000x: long ${ids[0]} y short ${ids[1]} (10 USDG de margen cada una)`);

type Row = { id: string; side: string; entry: number; liquidation: number; distancePct: number | null };
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const lastSeen = new Map<string, Row>();
const from = await client.getBlockNumber();
for (let t = 0; t < waitSeconds; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  for (const r of (await (await fetch(`${liquidatorUrl}/positions`)).json()) as Row[]) if (ids.includes(r.id)) lastSeen.set(r.id, r);

  // El liquidador puede detectarla y liquidarla en menos de un segundo: se mira directo en la cadena si alguna ya no existe.
  for (const id of ids) {
    const [owner] = await client.readContract({ ...exchange, functionName: "positions", args: [BigInt(id)] });
    if (owner !== "0x0000000000000000000000000000000000000000") continue;
    const p = lastSeen.get(id);
    console.log(`✔ a los ${t + 1} s la ${id}${p ? ` (${p.side}, liquidación ${p.liquidation.toFixed(2)}, entrada ${p.entry.toFixed(2)})` : ""} ya no está abierta`);
    await showLiquidation(BigInt(id), from);
    process.exit(0);
  }
  if (t % 10 === 9) {
    const rows = [...lastSeen.values()];
    console.log(`  ${t + 1} s · distancia a la liquidación: ${rows.map((r) => `${r.side} ${r.distancePct?.toFixed(4)}%`).join(" · ")}`);
  }
}
console.log(`✖ ninguna cruzó en ${waitSeconds} s (el precio se movió poco): volvé a correrlo o subí DETECT_WAIT_SECONDS`);
process.exit(1);

/** Muestra el PositionLiquidated de la posición. Si no hay, es que se cerró por otro lado. */
async function showLiquidation(id: bigint, fromBlock: bigint) {
  const [ev] = await client.getLogs({
    address: deployment.contracts.Exchange.address,
    event: parseAbiItem("event PositionLiquidated(uint256 indexed positionId, address indexed user, uint256 price, uint256 margin, uint256 fee)"),
    args: { positionId: id },
    fromBlock,
  });
  if (!ev) {
    console.log(`✖ la ${id} ya no existe, pero no fue liquidada (¿se cerró?)`);
    process.exit(1);
  }
  const detected = ((await (await fetch(`${liquidatorUrl}/health`)).json()) as { open: number }).open;
  console.log(`✔ liquidada por el liquidador: precio ${(Number(ev.args.price) / 1e18).toFixed(2)} · margen perdido ${formatUnits(ev.args.margin!, 6)} USDG · fee ${formatUnits(ev.args.fee!, 6)} USDG · bloque ${ev.blockNumber} · quedan ${detected} abiertas en su lista`);
}
