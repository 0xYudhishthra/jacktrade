import { intentId, type Intent, type IntentStatus } from "@hm/shared";
import type { Hex } from "viem";

import type { Pending } from "./validate.js";

export type QueuedIntent = {
  id: string;
  intent: Intent;
  signature: Hex;
  signer: Hex;
  instrumentId: number; // mercado (en un close, el de la posición)
  walletHasCode: boolean; // wallet de contrato o con delegación EIP-7702: va en un batch propio (ver batcher)
  receivedAt: number; // ms
};

/**
 * Intents aceptados que esperan el próximo batch, y el estado de cada uno para `GET /intent/:id`.
 * En memoria: si el relayer se reinicia, los que estaban en la fila se pierden y el usuario tiene que reenviarlos.
 */
export class IntentQueue implements Pending {
  private readonly waiting = new Map<string, QueuedIntent>();
  private readonly statuses = new Map<string, IntentStatus>();

  add(q: Omit<QueuedIntent, "id" | "receivedAt">): QueuedIntent {
    const id = intentId(q.intent.intent.user, q.intent.intent.nonce);
    const queued = { ...q, id, receivedAt: Date.now() };
    this.waiting.set(id, queued);
    this.statuses.set(id, { id, status: "queued" });
    return queued;
  }

  /**
   * Saca, en orden de llegada, hasta `max` intents firmados en o antes de `upTo` (segundos).
   * Los firmados después quedan esperando un precio de Pyth más nuevo.
   */
  takeReady(upTo: number, max: number): QueuedIntent[] {
    return this.takeWhere((q) => Number(q.intent.intent.signedAt) <= upTo, max);
  }

  /** Saca, en orden de llegada, hasta `max` intents que cumplen `ready` (por ejemplo, ya hay precio de su mercado). */
  takeWhere(ready: (q: QueuedIntent) => boolean, max: number): QueuedIntent[] {
    const batch = [...this.waiting.values()].filter(ready).slice(0, max);
    for (const q of batch) this.waiting.delete(q.id);
    return batch;
  }

  /** Saca los que esperan hace más de `maxWaitMs` (no llegó un precio a tiempo). */
  takeExpired(maxWaitMs: number): QueuedIntent[] {
    const cutoff = Date.now() - maxWaitMs;
    const expired = [...this.waiting.values()].filter((q) => q.receivedAt < cutoff);
    for (const q of expired) this.waiting.delete(q.id);
    return expired;
  }

  /** Vuelve a poner intents al principio de la fila (por ejemplo, si el envío del batch falló antes de minarse). */
  putBack(items: QueuedIntent[]) {
    const rest = [...this.waiting.entries()];
    this.waiting.clear();
    for (const q of items) this.waiting.set(q.id, q);
    for (const [id, q] of rest) this.waiting.set(id, q);
  }

  setStatus(status: IntentStatus) {
    this.statuses.set(status.id, status);
  }

  status(id: string) {
    return this.statuses.get(id);
  }

  get size() {
    return this.waiting.size;
  }

  hasNonce(user: Hex, nonce: bigint) {
    return this.statuses.has(intentId(user, nonce));
  }

  reservedMargin(user: Hex) {
    let total = 0n;
    for (const q of this.waiting.values()) {
      if (q.intent.kind === "open" && q.intent.intent.user.toLowerCase() === user.toLowerCase()) total += q.intent.intent.margin;
    }
    return total;
  }

  reservedOi(instrumentId: number, isLong: boolean) {
    let total = 0n;
    for (const q of this.waiting.values()) {
      const it = q.intent;
      if (it.kind === "open" && it.intent.instrumentId === instrumentId && it.intent.isLong === isLong) {
        total += it.intent.margin * it.intent.leverage;
      }
    }
    return total;
  }
}
