import { liquidationPrice, type Position } from "@hm/shared";

export type TrackedPosition = Position & {
  liquidationPrice: bigint; // WAD, con el liqBufferBps actual del mercado
  openedBlock: bigint;
};

/**
 * Posiciones abiertas, armadas desde los eventos del Exchange. El precio de liquidación es fijo mientras no cambie
 * el `liqBufferBps` del mercado; si cambia (MarketConfigSet), se recalcula con `setBuffer`.
 *
 * Para encontrar rápido las que cruzaron, se ordenan por mercado y lado:
 * - longs de mayor a menor precio de liquidación (se liquidan si precio <= ese valor: las primeras caen antes),
 * - shorts de menor a mayor (se liquidan si precio >= ese valor).
 * Con cada precio, las liquidables son un prefijo de cada lista: se encuentra con búsqueda binaria.
 */
export class PositionBook {
  private readonly positions = new Map<bigint, TrackedPosition>();
  private readonly buffers = new Map<number, number>(); // instrumentId → liqBufferBps
  private readonly sorted = new Map<string, TrackedPosition[]>(); // "mercado:long|short" → ordenadas
  private readonly dirty = new Set<string>(); // listas a reordenar en la próxima consulta

  private key(instrumentId: number, isLong: boolean) {
    return `${instrumentId}:${isLong ? "long" : "short"}`;
  }

  private touch(p: { instrumentId: number; isLong: boolean }) {
    this.dirty.add(this.key(p.instrumentId, p.isLong));
  }

  private list(instrumentId: number, isLong: boolean) {
    const key = this.key(instrumentId, isLong);
    if (this.dirty.has(key) || !this.sorted.has(key)) {
      const list = this.all().filter((p) => p.instrumentId === instrumentId && p.isLong === isLong);
      list.sort((a, b) => {
        const d = isLong ? b.liquidationPrice - a.liquidationPrice : a.liquidationPrice - b.liquidationPrice;
        return d > 0n ? 1 : d < 0n ? -1 : 0;
      });
      this.sorted.set(key, list);
      this.dirty.delete(key);
    }
    return this.sorted.get(key)!;
  }

  /** Posiciones del mercado que son liquidables a este precio (WAD), las que están más pasadas primero. */
  crossed(instrumentId: number, price: bigint): TrackedPosition[] {
    const longs = this.list(instrumentId, true);
    const shorts = this.list(instrumentId, false);
    return [
      ...longs.slice(0, prefix(longs, (p) => p.liquidationPrice >= price)),
      ...shorts.slice(0, prefix(shorts, (p) => p.liquidationPrice <= price)),
    ];
  }

  setBuffer(instrumentId: number, liqBufferBps: number) {
    this.buffers.set(instrumentId, liqBufferBps);
    for (const p of this.positions.values()) {
      if (p.instrumentId === instrumentId) p.liquidationPrice = liquidationPrice(p, liqBufferBps);
    }
    this.dirty.add(this.key(instrumentId, true)).add(this.key(instrumentId, false));
  }

  hasBuffer(instrumentId: number) {
    return this.buffers.has(instrumentId);
  }

  /** Mercados que tienen posiciones abiertas. */
  markets() {
    return [...new Set(this.all().map((p) => p.instrumentId))];
  }

  open(p: Position, openedBlock: bigint) {
    const buffer = this.buffers.get(p.instrumentId);
    if (buffer === undefined) throw new Error(`Sin liqBufferBps para el mercado ${p.instrumentId}`);
    this.positions.set(p.id, { ...p, openedBlock, liquidationPrice: liquidationPrice(p, buffer) });
    this.touch(p);
  }

  /** Cerrada o liquidada. Devuelve false si no estaba (por ejemplo, abierta antes de donde se empezó a leer). */
  remove(id: bigint) {
    const p = this.positions.get(id);
    if (!p) return false;
    this.positions.delete(id);
    this.touch(p);
    return true;
  }

  get(id: bigint) {
    return this.positions.get(id);
  }

  all() {
    return [...this.positions.values()];
  }

  get size() {
    return this.positions.size;
  }
}

/** Cuántos elementos del principio cumplen `ok` (la lista está ordenada: cumplen todos hasta que uno no). */
function prefix<T>(list: T[], ok: (x: T) => boolean) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(list[mid]!)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
