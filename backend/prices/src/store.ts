import type { Hex } from "viem";

/** Un precio de Pyth tal como llega de Hermes, con los bytes para `updatePrices`. */
export type PriceUpdate = {
  feedId: Hex;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number; // segundos
  updateData: Hex; // update firmado; puede cubrir varios feeds
};

/**
 * Últimos precios por feed, en memoria. Guarda unos segundos de historia para poder elegir
 * el update más fresco publicado después de un `signedAt`.
 */
export class PriceStore {
  private readonly byFeed = new Map<Hex, PriceUpdate[]>();

  constructor(private readonly historySeconds = 60) {}

  /** Devuelve false si el update llegó desordenado y se descartó. */
  add(update: PriceUpdate): boolean {
    const list = this.byFeed.get(update.feedId) ?? [];
    const last = list.at(-1);
    if (last && update.publishTime < last.publishTime) return false; // llegó desordenado: ya hay uno más nuevo
    list.push(update);
    const cutoff = update.publishTime - this.historySeconds;
    while (list.length > 1 && list[0]!.publishTime < cutoff) list.shift();
    this.byFeed.set(update.feedId, list);
    return true;
  }

  /** Precios guardados de un feed con `publishTime >= from` (segundos), del más viejo al más nuevo. */
  since(feedId: Hex, from: number): PriceUpdate[] {
    return (this.byFeed.get(feedId) ?? []).filter((u) => u.publishTime >= from);
  }

  latest(feedId: Hex): PriceUpdate | undefined {
    return this.byFeed.get(feedId)?.at(-1);
  }

  /**
   * El update más fresco de cada feed con `publishTime >= after`. Devuelve null si a algún feed
   * todavía no le llegó un precio posterior a `after`.
   */
  getUpdateAfter(feedIds: readonly Hex[], after: number): { updateData: Hex[]; updates: PriceUpdate[] } | null {
    const updates: PriceUpdate[] = [];
    for (const id of feedIds) {
      const latest = this.latest(id);
      if (!latest || latest.publishTime < after) return null;
      updates.push(latest);
    }
    // Un mismo update de Hermes puede traer varios feeds; se manda una sola vez.
    return { updateData: [...new Set(updates.map((u) => u.updateData))], updates };
  }
}
