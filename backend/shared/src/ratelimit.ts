import type { IncomingMessage } from "node:http";

/**
 * Límite tipo "balde de fichas" por clave (IP, firmante…): `burst` fichas de entrada y `perSecond` que se reponen.
 * Las claves que vuelven a tener el balde lleno se borran solas, así el mapa no crece sin límite.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref();
  }

  allow(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  private prune() {
    const now = Date.now();
    for (const [key, b] of this.buckets) {
      if (b.tokens + ((now - b.at) / 1000) * this.perSecond >= this.burst) this.buckets.delete(key);
    }
  }

  get size() {
    return this.buckets.size;
  }
}

/**
 * IP del cliente. Detrás de un proxy (Railway), solo si TRUST_PROXY=1 se toma el primer valor de x-forwarded-for;
 * si no, alguien podría mandar ese header para hacerse pasar por otras IPs.
 */
export function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "desconocida";
}
