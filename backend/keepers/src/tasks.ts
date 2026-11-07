import { deployment, safeError, type getNetwork } from "@hm/shared";
import { decodeErrorResult, encodeFunctionData, formatUnits, parseEventLogs, type Account, type Hex, type WalletClient } from "viem";

import { harvestDue, heartbeatPlan, stakerFeesPlan } from "./decide.js";

type Client = ReturnType<typeof getNetwork>["client"];

const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const executor = { address: deployment.contracts.BatchExecutor.address, abi: deployment.contracts.BatchExecutor.abi } as const;

export type KeeperOptions = {
  client: Client;
  wallet: WalletClient & { account: Account };
  heartbeatMargin: bigint; // segundos antes del vencimiento del escape hatch
  heartbeatGas: bigint;
  harvestMaxEntries: bigint; // entradas de la fila por transacción
  harvestMinPay: bigint; // USDG (6 decimales)
  harvestGasBase: bigint;
  harvestGasPerEntry: bigint;
  stakerFeesMin: bigint; // USDG: se manda pushStakerFees al llegar a esto…
  stakerFeesEveryMs: number; // …o, si hay algo acumulado, una vez cada este tiempo
  stakerFeesGas: bigint;
  /** `GET /live` del relayer. Si no responde 200, no se manda heartbeat: el escape hatch es la salida de los usuarios. */
  relayerLiveUrl?: string;
  receiptTimeoutMs: number;
  log: (msg: string) => void;
};

/** Lo que leen los keepers de la cadena en cada vuelta. También lo muestra /health. */
export type KeeperState = {
  now: bigint;
  lastActivity: bigint;
  escapeDelay: bigint;
  isRelayer: boolean;
  head: bigint;
  tail: bigint;
  sideBucket: bigint;
  lpCash: bigint;
  totalQueued: bigint;
  nextOwed: bigint;
  stakerFeeAccrued: bigint;
  trackedLp: bigint;
  stakerRewardCap: bigint;
};

/**
 * Tres tareas de mantenimiento del Exchange:
 * - `heartbeat`: el contrato abre los cierres directos (`closePosition`) si el executor no hace nada en `escapeDelay`
 *   (24 h). Ahí el que cierra elige qué precio fresco de Pyth empuja: flujo tóxico contra la casa. Cada operación
 *   del relayer ya renueva el plazo; el keeper solo manda el latido cuando no hubo actividad. Es `onlyExecutor`,
 *   así que va por `BatchExecutor.execute([], [heartbeat()])` y la wallet tiene que estar en `isRelayer`.
 * - `harvest`: mientras hay fila, las pérdidas se juntan en `sideBucket` y solo `harvest` las reparte a los ganadores
 *   en espera. Sin esto la fila no baja, `lpBankrollAvailable` queda en 0 y no se cobran fees. Lo puede llamar cualquiera.
 * - `pushStakerFees`: las fees para stakers se acumulan en el Exchange (`stakerFeeAccrued`) y solo llegan al contrato
 *   de staking con esta llamada. También manda la caja de la casa que pase `stakerRewardCap`. Lo puede llamar cualquiera.
 * Las tres se simulan antes de mandar, con el mismo gas. Una transacción por vez.
 */
export function createKeepers(o: KeeperOptions) {
  let running = false;
  const startedAt = Date.now(); // el primer envío por tiempo espera un intervalo desde el arranque
  let state: KeeperState | undefined;
  let stateAt = 0; // ms de la última lectura buena
  let lastError: { at: number; message: string } | undefined;
  let lastHeartbeat: { at: number; hash: Hex } | undefined;
  let lastHarvest: { at: number; hash: Hex; paid: bigint } | undefined;
  let harvestableSince: number | undefined; // desde cuándo hay fila con caja para pagar
  let relayerAlive: boolean | undefined; // última respuesta del relayer, cuando tocó heartbeat
  let lastStakerPush: { at: number; hash: Hex; fees: bigint; lpExcess: bigint } | undefined;

  async function read(): Promise<KeeperState> {
    const read = <T>(functionName: string, args: unknown[] = []) => o.client.readContract({ ...exchange, functionName, args } as never) as Promise<T>;
    const [block, lastActivity, limits, isRelayer, head, tail, sideBucket, lpCash, totalQueued, stakerFeeAccrued, trackedLp] = await Promise.all([
      o.client.getBlock(),
      read<bigint>("lastExecutorActivity"),
      read<readonly [number, number, number, ...unknown[]]>("limits"),
      o.client.readContract({ ...executor, functionName: "isRelayer", args: [o.wallet.account.address] }),
      read<bigint>("queueHead"),
      read<bigint>("queueTail"),
      read<bigint>("sideBucket"),
      read<bigint>("lpCash"),
      read<bigint>("totalQueued"),
      read<bigint>("stakerFeeAccrued"),
      read<bigint>("trackedLp"),
    ]);
    const nextOwed = head < tail ? (await read<readonly [Hex, bigint]>("queue", [head]))[1] : 0n;
    return {
      now: block.timestamp,
      lastActivity,
      escapeDelay: BigInt(limits[2]),
      isRelayer,
      head,
      tail,
      sideBucket,
      lpCash,
      totalQueued,
      nextOwed,
      stakerFeeAccrued,
      trackedLp,
      stakerRewardCap: BigInt(limits[7] as bigint),
    };
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      state = await read();
      stateAt = Date.now();
      const plan = heartbeatPlan({ now: state.now, lastActivity: state.lastActivity, escapeDelay: state.escapeDelay, margin: o.heartbeatMargin });
      // Sin el rol no se puede: lo avisa /health (y la alerta del log), no se reintenta acá.
      if (plan.due && state.isRelayer) {
        // Si el relayer está caído, el heartbeat dejaría a los usuarios sin poder cerrar: no se manda.
        const alive = await isRelayerAlive();
        if (!alive && relayerAlive !== false) o.log(`⚠ el relayer no responde en ${o.relayerLiveUrl}: no mando heartbeat (el escape hatch se abre a las ${Number(state.escapeDelay) / 3600} h sin actividad)`);
        if (alive && relayerAlive === false) o.log("el relayer volvió: retomo el heartbeat");
        relayerAlive = alive;
        if (alive) await heartbeat();
      }
      const due = harvestDue({ ...state, minPay: o.harvestMinPay });
      harvestableSince = due ? (harvestableSince ?? Date.now()) : undefined;
      if (due) await harvest();
      if (stakerPlan(state).due) await pushStakerFees();
    } catch (e) {
      lastError = { at: Date.now(), message: safeError(e) };
      o.log(`error: ${lastError.message}`);
    } finally {
      running = false;
    }
  }

  async function isRelayerAlive() {
    if (!o.relayerLiveUrl) return true;
    try {
      return (await fetch(o.relayerLiveUrl, { signal: AbortSignal.timeout(5_000) })).ok;
    } catch {
      return false;
    }
  }

  async function heartbeat() {
    const call = {
      to: executor.address,
      data: encodeFunctionData({
        abi: executor.abi,
        functionName: "execute",
        args: [[], [{ target: exchange.address, data: encodeFunctionData({ abi: exchange.abi, functionName: "heartbeat" }) }]],
      }),
      gas: o.heartbeatGas,
    };
    // execute no revierte si falla una llamada interna (emite CallFailed): se mira el evento, no solo el estado.
    const [block] = await o.client.simulateBlocks({ blocks: [{ calls: [{ account: o.wallet.account, ...call }] }] });
    const sim = block!.calls[0]!;
    if (sim.status !== "success") throw new Error(`la simulación de heartbeat revirtió: ${errorName(sim.data)}`);
    const failed = parseEventLogs({ abi: executor.abi, logs: sim.logs ?? [], eventName: "CallFailed" });
    if (failed.length) throw new Error(`la simulación de heartbeat falló adentro: ${errorName(failed[0]!.args.reason)}`);

    const hash = await o.wallet.sendTransaction({ account: o.wallet.account, chain: o.wallet.chain, ...call });
    o.log(`mandado heartbeat · tx ${hash}`);
    const receipt = await o.client.waitForTransactionReceipt({ hash, timeout: o.receiptTimeoutMs });
    const failedOnChain = parseEventLogs({ abi: executor.abi, logs: receipt.logs, eventName: "CallFailed" });
    if (receipt.status !== "success" || failedOnChain.length) throw new Error(`heartbeat no se aplicó (tx ${hash})`);
    lastHeartbeat = { at: Date.now(), hash };
    o.log(`✔ heartbeat en el bloque ${receipt.blockNumber} · gas ${receipt.gasUsed}`);
  }

  async function harvest() {
    const call = {
      to: exchange.address,
      data: encodeFunctionData({ abi: exchange.abi, functionName: "harvest", args: [o.harvestMaxEntries] }),
      gas: o.harvestGasBase + o.harvestGasPerEntry * o.harvestMaxEntries,
    };
    const [block] = await o.client.simulateBlocks({ blocks: [{ calls: [{ account: o.wallet.account, ...call }] }] });
    const sim = block!.calls[0]!;
    if (sim.status !== "success") throw new Error(`la simulación de harvest revirtió: ${errorName(sim.data)}`);
    const willPay = parseEventLogs({ abi: exchange.abi, logs: sim.logs ?? [], eventName: "QueuePaid" });
    if (willPay.length === 0) return; // otro lo cobró antes o cambió la caja

    const hash = await o.wallet.sendTransaction({ account: o.wallet.account, chain: o.wallet.chain, ...call });
    o.log(`mandado harvest(${o.harvestMaxEntries}) · tx ${hash}`);
    const receipt = await o.client.waitForTransactionReceipt({ hash, timeout: o.receiptTimeoutMs });
    if (receipt.status !== "success") throw new Error(`harvest revirtió (tx ${hash})`);
    const paid = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "QueuePaid" });
    const total = paid.reduce((a, l) => a + l.args.amount, 0n);
    lastHarvest = { at: Date.now(), hash, paid: total };
    harvestableSince = undefined;
    o.log(`✔ harvest: ${paid.length} pago(s) de la fila, ${formatUnits(total, 6)} USDG · bloque ${receipt.blockNumber} · gas ${receipt.gasUsed}`);
  }

  function stakerPlan(s: KeeperState) {
    return stakerFeesPlan({
      accrued: s.stakerFeeAccrued,
      queueEmpty: s.head === s.tail,
      trackedLp: s.trackedLp,
      cap: s.stakerRewardCap,
      lpCash: s.lpCash,
      minPush: o.stakerFeesMin,
      lastPushAt: lastStakerPush?.at ?? startedAt,
      maxIntervalMs: o.stakerFeesEveryMs,
      nowMs: Date.now(),
    });
  }

  async function pushStakerFees() {
    // Desde el fix de auditoría, pushStakerFees solo acepta al executor (o a staking): va por execute, como el heartbeat.
    const call = {
      to: executor.address,
      data: encodeFunctionData({
        abi: executor.abi,
        functionName: "execute",
        args: [[], [{ target: exchange.address, data: encodeFunctionData({ abi: exchange.abi, functionName: "pushStakerFees" }) }]],
      }),
      gas: o.stakerFeesGas,
    };
    const [block] = await o.client.simulateBlocks({ blocks: [{ calls: [{ account: o.wallet.account, ...call }] }] });
    const sim = block!.calls[0]!;
    if (sim.status !== "success") throw new Error(`la simulación de pushStakerFees revirtió: ${errorName(sim.data)}`);
    const failed = parseEventLogs({ abi: executor.abi, logs: sim.logs ?? [], eventName: "CallFailed" });
    if (failed.length) throw new Error(`la simulación de pushStakerFees falló adentro: ${errorName(failed[0]!.args.reason)}`);
    if (parseEventLogs({ abi: exchange.abi, logs: sim.logs ?? [], eventName: "StakerFeesPushed" }).length === 0) return; // otro lo mandó antes

    const hash = await o.wallet.sendTransaction({ account: o.wallet.account, chain: o.wallet.chain, ...call });
    o.log(`mandado pushStakerFees · tx ${hash}`);
    const receipt = await o.client.waitForTransactionReceipt({ hash, timeout: o.receiptTimeoutMs });
    const failedOnChain = parseEventLogs({ abi: executor.abi, logs: receipt.logs, eventName: "CallFailed" });
    if (receipt.status !== "success" || failedOnChain.length) throw new Error(`pushStakerFees no se aplicó (tx ${hash})`);
    const ev = parseEventLogs({ abi: exchange.abi, logs: receipt.logs, eventName: "StakerFeesPushed" })[0];
    lastStakerPush = { at: Date.now(), hash, fees: ev?.args.fees ?? 0n, lpExcess: ev?.args.lpExcess ?? 0n };
    o.log(`✔ pushStakerFees: ${formatUnits(lastStakerPush.fees, 6)} USDG de fees + ${formatUnits(lastStakerPush.lpExcess, 6)} de caja excedente a staking · bloque ${receipt.blockNumber} · gas ${receipt.gasUsed}`);
  }

  return {
    tick,
    stakerPlan: () => (state ? stakerPlan(state) : undefined),
    status: () => ({ state, stateAt, lastError, lastStakerPush, relayerAlive, lastHeartbeat, lastHarvest, harvestableSince }),
  };
}

const ERRORS = [...deployment.contracts.Exchange.abi, ...deployment.contracts.BatchExecutor.abi] as const;

function errorName(data: Hex | undefined) {
  if (!data || data === "0x") return "sin motivo (¿sin gas?)";
  try {
    return decodeErrorResult({ abi: ERRORS, data }).errorName;
  } catch {
    return `desconocido (${data.slice(0, 10)})`;
  }
}
