import { redact } from "./errors.js";

/**
 * Alertas a Telegram. Sin TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID no manda nada (solo queda el log, como antes).
 * Texto plano, sin formato: así ningún mensaje de error puede romper el envío por caracteres especiales.
 */
/** Devuelve si Telegram lo recibió: lo que no salió se reintenta en el próximo chequeo. */
export type AlertSender = (text: string) => Promise<boolean>;

const MAX_LENGTH = 3500; // Telegram corta en 4096

export function telegramSender({
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  apiUrl = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org",
  fetchImpl = fetch,
}: { token?: string; chatId?: string; apiUrl?: string; fetchImpl?: typeof fetch } = {}): AlertSender | undefined {
  if (!token || !chatId) return undefined;
  return async (text) => {
    try {
      const res = await fetchImpl(`${apiUrl}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_LENGTH), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) console.error(`[alertas] Telegram respondió ${res.status}`);
      return res.ok;
    } catch (e) {
      // El token va en la URL: nunca loguear el error entero.
      console.error(`[alertas] no se pudo mandar a Telegram: ${redact((e as Error).message ?? String(e))}`);
      return false;
    }
  };
}

const network = () => process.env.NETWORK ?? "mainnet";
const label = (service: string) => `[${service} · ${network()}]`;

/** Aviso suelto e inmediato (caída, error al arrancar). Espera como mucho 5 s: se usa justo antes de salir. */
export async function alertNow(service: string, text: string, send = telegramSender()) {
  if (send) await send(`🔴 ${label(service)} ${redact(text)}`);
}

export type AlertTrackerOptions = {
  send?: AlertSender;
  /** Un problema avisa recién si sigue después de estos ms (evita ruido por cosas de segundos). */
  afterMs?: number;
  /** Mientras siga, se recuerda cada estos ms. */
  repeatMs?: number;
  now?: () => number;
};

/**
 * Sigue la lista de problemas de /health entre chequeos y avisa solo los cambios:
 * nuevo (si dura `afterMs`), recordatorio cada `repeatMs` y resuelto. Junta todo lo de un chequeo en un mensaje.
 * Los problemas se reconocen por su texto sin números, así "44.3 h sin actividad" y "44.4 h…" son el mismo.
 */
export function createAlertTracker(
  service: string,
  {
    send = telegramSender(),
    afterMs = Number(process.env.ALERT_AFTER_SECONDS ?? 60) * 1000,
    repeatMs = Number(process.env.ALERT_REPEAT_MINUTES ?? 60) * 60_000,
    now = Date.now,
  }: AlertTrackerOptions = {},
) {
  const active = new Map<string, { since: number; text: string; sentAt?: number }>();
  let unsentResolved: string[] = []; // "resuelto" que no llegaron: van en el próximo mensaje
  // Mismo problema aunque cambien números o hashes ("0.003 ETH", "tx 0xab12…"): se tapan antes de comparar.
  const key = (problem: string) => problem.replace(/0x[0-9a-fA-F]+/g, "0x#").replace(/[\d.,]+/g, "#");

  async function report(problems: string[]) {
    const t = now();
    const current = new Map(problems.map((p) => [key(p), p]));
    const lines: string[] = unsentResolved.map((t) => `🟢 resuelto: ${t}`);
    const resolvedNow: string[] = [];
    const marked: { a: { sentAt?: number }; prev?: number }[] = [];

    for (const [k, text] of current) {
      const a = active.get(k) ?? { since: t, text };
      a.text = text;
      active.set(k, a);
      if (t - a.since < afterMs) continue;
      if (a.sentAt === undefined) {
        lines.push(`🔴 ${text}`);
        marked.push({ a, prev: a.sentAt });
        a.sentAt = t;
      } else if (t - a.sentAt >= repeatMs) {
        lines.push(`🟠 sigue: ${text}`);
        marked.push({ a, prev: a.sentAt });
        a.sentAt = t;
      }
    }
    for (const [k, a] of active) {
      if (current.has(k)) continue;
      active.delete(k);
      if (a.sentAt !== undefined) {
        lines.push(`🟢 resuelto: ${a.text}`);
        resolvedNow.push(a.text);
      }
    }

    if (lines.length && send) {
      const ok = await send(`${label(service)}\n${lines.map(redact).join("\n")}`);
      if (ok) unsentResolved = [];
      else {
        // No llegó: se vuelve atrás para reintentarlo en el próximo chequeo (no esperar una hora al recordatorio).
        for (const m of marked) m.a.sentAt = m.prev;
        unsentResolved = [...unsentResolved, ...resolvedNow];
      }
    }
    return lines;
  }

  return { report, active: () => [...active.values()].filter((a) => a.sentAt !== undefined).map((a) => a.text) };
}
