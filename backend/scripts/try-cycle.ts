/**
 * Ciclo completo con session key: el usuario registra una key nueva (única transacción con su wallet), y después
 * abre y cierra una posición firmando solo con la key, sin popup. Verifica el PnL y el balance contra la cadena.
 * Solo contra el fork.
 *
 *   pnpm fork                      # terminal 1
 *   pnpm setup:fork                # una vez por fork
 *   NETWORK=fork pnpm relayer      # terminal 2
 *   pnpm try:cycle                 # terminal 3
 *
 * Opciones: CYCLE_HOLD_SECONDS (cuánto tiempo queda abierta, 10), CYCLE_LEVERAGE (100).
 */

import { deployment, getNetwork, intentToJson, intentTypedData, PNLMATH_ADDRESS, type Intent, type IntentStatus } from "@hm/shared";
import {
  concat,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  formatUnits,
  http,
  parseAbiParameters,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const relayerUrl = process.env.RELAYER_URL ?? `http://localhost:${process.env.RELAYER_PORT ?? 8091}`;
const holdSeconds = Number(process.env.CYCLE_HOLD_SECONDS ?? 10);
const leverage = BigInt(process.env.CYCLE_LEVERAGE ?? 100);
const margin = 20_000_000n; // 20 USDG

const { chain, rpcUrl, client } = getNetwork("fork");
const [, , user] = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
const userWallet = createWalletClient({ account: user!, chain, transport: http(rpcUrl) });
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const sk = { address: deployment.contracts.SessionKeyManager.address, abi: deployment.contracts.SessionKeyManager.abi } as const;
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};
const usd = (v: bigint) => `${formatUnits(v, 6)} USDG`;
const px = (v: bigint) => (Number(v) / 1e18).toFixed(2);

// 1. Session key nueva, creada acá (como la crearía el front) y registrada con una transacción de la wallet.
const sessionKey = privateKeyToAccount(generatePrivateKey());
const expiry = (await client.getBlock()).timestamp + 86_400n;
await client.waitForTransactionReceipt({
  hash: await userWallet.writeContract({ ...sk, functionName: "registerSessionKey", args: [sessionKey.address, expiry] }),
});
check(await client.readContract({ ...sk, functionName: "isValidSessionKey", args: [user!, sessionKey.address] }), `session key ${sessionKey.address} registrada por 24 h (única firma de la wallet)`);

// Firma con la session key (local, sin wallet) y espera a que el relayer termine.
let nonce = BigInt(Date.now()) * 1000n;
async function send(i: Intent): Promise<IntentStatus> {
  const signature = await sessionKey.signTypedData(intentTypedData(i) as never);
  const res = (await (await fetch(`${relayerUrl}/intent`, { method: "POST", body: JSON.stringify({ ...intentToJson(i), signature }) })).json()) as { id?: string; status: string; code?: string; message?: string };
  if (!res.id) return { id: "", status: "failed", code: (res.code ?? "Unknown") as never, message: res.message ?? "" };
  for (let t = 0; t < 60; t++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = (await (await fetch(`${relayerUrl}/intent/${res.id}`)).json()) as IntentStatus;
    if (s.status === "executed" || s.status === "failed") return s;
  }
  return { id: res.id, status: "failed", code: "Unknown", message: "no terminó en 15 s" };
}
const state = async () => ({
  balance: await client.readContract({ ...exchange, functionName: "balances", args: [user!] }),
  queued: await client.readContract({ ...exchange, functionName: "queuedOf", args: [user!] }),
});

// 2. Abrir: long de BTC firmado por la session key.
const before = await state();
const now = async () => (await client.getBlock()).timestamp;
const opened = await send({ kind: "open", intent: { user: user!, instrumentId: 0, isLong: true, margin, leverage, priceLimit: 0n, signedAt: await now(), nonce: nonce++ } });
if (opened.status !== "executed" || !opened.positionId) {
  check(false, `open: ${opened.status} ${"message" in opened ? opened.message : ""}`);
  process.exit(1);
}
const positionId = BigInt(opened.positionId);
const afterOpen = await state();
check(afterOpen.balance === before.balance - margin, `open ejecutado: posición ${positionId} · long BTC ${usd(margin)} × ${leverage} · entrada ${px(BigInt(opened.price))} · balance ${usd(before.balance)} → ${usd(afterOpen.balance)}`);

// 3. Esperar a que se mueva el precio y cerrar con la session key.
console.log(`  … abierta ${holdSeconds} s`);
await new Promise((r) => setTimeout(r, holdSeconds * 1000));
const closed = await send({ kind: "close", intent: { user: user!, positionId, priceLimit: 0n, signedAt: await now(), nonce: nonce++ } });
if (closed.status !== "executed") {
  check(false, `close: ${closed.status} ${"message" in closed ? `${closed.code} · ${closed.message}` : ""}`);
  process.exit(1);
}
const after = await state();

// 4. Lo que dice la cadena del cierre.
const receipt = await client.getTransactionReceipt({ hash: closed.txHash });
const ev = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PositionClosed" }).find((e) => e.args.positionId === positionId)!.args;
const queuedNow = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "PayoutQueued" }).filter((e) => e.args.user.toLowerCase() === user!.toLowerCase()).reduce((a, e) => a + e.args.amount, 0n);
const minted = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "TokensMinted" }).filter((e) => e.args.user.toLowerCase() === user!.toLowerCase());
const entry = BigInt(opened.price);
const move = ((Number(ev.exitPrice) - Number(entry)) / Number(entry)) * 100;
console.log(`  cierre: salida ${px(ev.exitPrice)} (${move >= 0 ? "+" : ""}${move.toFixed(4)}%) · ganancia neta ${usd(ev.payout)} · pérdida ${usd(ev.loss)} · fee ${usd(ev.fee)}`);
check(closed.positionId === positionId.toString() && closed.price === ev.exitPrice.toString(), "el relayer devuelve la misma posición y precio de salida que PositionClosed");

// 5. PnL contra PnLMath desplegado (lo mismo que calcula el Exchange), con los parámetros del mercado.
// En una librería, el selector de una función con struct no sale de la firma con tupla: `settle` está en 0x422443f3
// (sacado del bytecode desplegado). Por eso se llama a mano.
const SETTLE_SELECTOR = "0x422443f3";
const cfg = await client.readContract({ ...exchange, functionName: "marketConfig", args: [0] });
const [deadband] = await client.readContract({ ...exchange, functionName: "limits" });
const [winFeeBps] = await client.readContract({ ...exchange, functionName: "fees" });
const { baseRate, rateMultiplier, positionMultiplier, referenceNotional } = cfg.impact;
const { data: settled } = await client.call({
  to: PNLMATH_ADDRESS,
  data: concat([
    SETTLE_SELECTOR,
    encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256, uint256, bool, uint256, (uint256, uint256, uint256, uint256)"), [
      margin, leverage, entry, ev.exitPrice, true, BigInt(deadband), [baseRate, rateMultiplier, positionMultiplier, referenceNotional],
    ]),
  ]),
});
const [gain, loss] = decodeAbiParameters(parseAbiParameters("uint256 gain, uint256 loss"), settled!);
const winFee = (gain * BigInt(winFeeBps)) / 10_000n;
check(ev.loss === loss && (gain === 0n ? ev.payout === 0n : ev.payout === gain - winFee), `PnL igual a PnLMath.settle: ganancia bruta ${usd(gain)} − fee ${usd(winFee)} · pérdida ${usd(loss)}`);

// 6. Balance: el margen vuelve siempre; la ganancia se paga con la caja de la casa y lo que no alcanza va a la fila.
const paid = ev.payout - queuedNow;
check(after.balance === afterOpen.balance + margin - ev.loss + paid, `balance ${usd(afterOpen.balance)} → ${usd(after.balance)} (margen ${usd(margin)} − pérdida ${usd(ev.loss)} + pagado ${usd(paid)})`);
check(after.queued === afterOpen.queued + queuedNow, `en la fila: ${usd(afterOpen.queued)} → ${usd(after.queued)}${queuedNow > 0n ? " (la casa no tenía caja para pagar la ganancia)" : ""}`);
if (ev.loss > 0n) check(minted.length === 1, `pérdida → se mintearon ${minted[0] ? formatUnits(minted[0].args.amount, 18) : 0} JACKTRADE`);

const lost = (await client.readContract({ ...exchange, functionName: "positions", args: [positionId] }))[0];
check(lost === "0x0000000000000000000000000000000000000000", `la posición ${positionId} ya no existe en el Exchange`);
process.exit(failures ? 1 : 0);
