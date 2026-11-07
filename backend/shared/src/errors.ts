import { alertNow } from "./alerts.js";

/**
 * Errores para logs: nunca el objeto entero. Los errores de viem incluyen `URL: …` con la clave del RPC en el path
 * (Alchemy: /v2/<clave>) y el body del pedido; acá queda solo un resumen de una línea, con las URLs tapadas.
 */
export function safeError(e: unknown): string {
  const err = e as { shortMessage?: unknown; message?: unknown } | undefined;
  const text =
    typeof err?.shortMessage === "string" ? err.shortMessage : typeof err?.message === "string" ? err.message : String(e);
  return redact(text.split("\n")[0]!);
}

/** Tapa claves en URLs (`/v2/<clave>`, `?apiKey=`), tokens Bearer y el token de un bot de Telegram (`bot123:abc`). */
export function redact(text: string): string {
  return text
    .replace(/(\/v\d+\/)[A-Za-z0-9_\-]{8,}/g, "$1<redactado>")
    .replace(/([?&](?:api[-_]?key|key|token)=)[^&\s"']+/gi, "$1<redactado>")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1<redactado>")
    .replace(/bot\d{5,}:[A-Za-z0-9_\-]{20,}/g, "bot<redactado>");
}

/**
 * Handlers de proceso para un servicio: una promesa sin manejar se loguea y el servicio sigue; una excepción sin manejar
 * se loguea y el proceso sale con error (el supervisor lo reinicia). SIGINT y SIGTERM (Railway manda SIGTERM) cierran limpio.
 */
export function installProcessHandlers(name: string, shutdown: () => Promise<void> | void) {
  // Una promesa sin manejar puede ser un loop que murió con el proceso vivo: se avisa, como mucho una vez cada 10 min.
  let lastRejectionAlert = 0;
  process.on("unhandledRejection", (e) => {
    console.error(`⚠ [${name}] promesa sin manejar: ${safeError(e)}`);
    if (Date.now() - lastRejectionAlert > 10 * 60_000) {
      lastRejectionAlert = Date.now();
      void alertNow(name, `promesa sin manejar (el proceso sigue, puede haber un loop muerto): ${safeError(e)}`);
    }
  });
  process.on("uncaughtException", async (e) => {
    console.error(`⚠ [${name}] excepción sin manejar: ${safeError(e)}`);
    await alertNow(name, `se cayó: ${safeError(e)} (Railway lo reinicia)`);
    process.exit(1);
  });
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      try {
        await shutdown();
      } finally {
        process.exit(0);
      }
    });
  }
}

/** Para los `await` del arranque: si fallan, log limpio y salida con error, sin volcar el objeto de viem. */
export async function startup<T>(name: string, step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`✖ [${name}] falló al arrancar (${step}): ${safeError(e)}`);
    await alertNow(name, `no arranca (${step}): ${safeError(e)}`);
    process.exit(1);
  }
}
