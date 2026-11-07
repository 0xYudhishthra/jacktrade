import { redact } from "./errors.js";

/**
 * "Dead-man switch": cada minuto avisa a un monitor externo (healthchecks.io u otro que reciba un GET) que el servicio
 * está vivo, solo si `isAlive()` da true. Si el proceso se cae, se cuelga o se cae Railway entero, los avisos dejan de
 * llegar y el monitor alerta desde afuera. Sin `HEALTHCHECK_PING_URL` no hace nada.
 */
export function startDeadManPing(service: string, isAlive: () => boolean | Promise<boolean>, url = process.env.HEALTHCHECK_PING_URL, everyMs = 60_000) {
  if (!url) return;
  const ping = async () => {
    let alive = false;
    try {
      alive = await isAlive();
    } catch {
      alive = false;
    }
    if (!alive) return; // no avisar = el monitor alerta si sigue así
    try {
      await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      console.error(`[${service}] no se pudo avisar al monitor externo: ${redact((e as Error).message ?? String(e))}`);
    }
  };
  void ping();
  setInterval(() => void ping(), everyMs).unref();
}
