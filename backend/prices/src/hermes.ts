import type { Hex } from "viem";

import type { PriceUpdate } from "./store.js";

type HermesEvent = {
  binary: { encoding: "hex"; data: string[] };
  parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[];
};

/** Una fuente de Hermes. Los precios vienen firmados por Pyth y el contrato verifica la firma: cualquier fuente sirve. */
export type HermesSource = { url: string; apiKey?: string; name: string };

export type HermesOptions = {
  /** La primera es la principal; si falla `failoverAfter` veces seguidas se pasa a la siguiente. */
  sources: HermesSource[];
  feedIds: readonly Hex[];
  onUpdate: (update: PriceUpdate) => void;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
  /** Si pasan estos ms sin recibir nada, se corta y se reconecta (un stream "abierto" pero muerto no avisa). */
  idleMs?: number;
  failoverAfter?: number;
  /** Estando en una fuente de respaldo, cada cuánto se vuelve a probar la principal. */
  retryPrimaryMs?: number;
};

const MAX_BUFFER = 1_000_000; // un mensaje de Hermes son unos pocos KB
const MAX_FUTURE_SECONDS = 5;

/**
 * Se suscribe al stream SSE de Hermes y reconecta solo, con espera creciente hasta 10 s.
 * Hermes corta el stream cada 24 h; eso también se resuelve reconectando.
 * Lo que llega se valida antes de usarlo: es un dato externo que decide liquidaciones.
 */
export async function streamHermes({
  sources,
  feedIds,
  onUpdate,
  onStatus = () => {},
  signal,
  idleMs = 15_000,
  failoverAfter = 3,
  retryPrimaryMs = 5 * 60_000,
}: HermesOptions) {
  if (sources.length === 0) throw new Error("no hay fuentes de Hermes");
  const query = feedIds.map((id) => `ids[]=${id}`).join("&");
  const allowed = new Set(feedIds.map((id) => id.toLowerCase()));
  let retryMs = 500;
  let current = 0;
  let failures = 0;
  let onBackupSince = 0;

  while (!signal?.aborted) {
    const source = sources[current]!;
    const streamUrl = `${source.url}/v2/updates/price/stream?${query}&encoding=hex&parsed=true`;
    let gotData = false;
    // Un controlador por conexión: lo corta el stop general o el timeout de inactividad.
    const connection = new AbortController();
    const onAbort = () => connection.abort();
    signal?.addEventListener("abort", onAbort);
    let idle: NodeJS.Timeout | undefined;
    // En respaldo: pasado retryPrimaryMs se corta esta conexión para volver a probar la principal.
    const backToPrimary = current > 0 ? setTimeout(() => connection.abort(new Error("retrying the primary source")), Math.max(0, onBackupSince + retryPrimaryMs - Date.now())) : undefined;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => connection.abort(new Error(`sin datos de Hermes en ${idleMs} ms`)), idleMs);
    };

    try {
      touch();
      const res = await fetch(streamUrl, { headers: source.apiKey ? { authorization: `Bearer ${source.apiKey}` } : {}, signal: connection.signal });
      // Solo el código: el cuerpo de la respuesta es texto externo y termina en /health.
      if (!res.ok || !res.body) throw new Error(`Hermes (${source.name}) respondió ${res.status}`);
      onStatus(`connected to ${source.name}`);
      retryMs = 500;

      let buffer = "";
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        touch();
        if (!gotData) {
          gotData = true;
          failures = 0;
        }
        buffer += chunk;
        if (buffer.length > MAX_BUFFER) throw new Error("mensaje de Hermes demasiado grande");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = message
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (!data) continue;
          try {
            handleEvent(JSON.parse(data) as HermesEvent, allowed, onUpdate);
          } catch {
            onStatus("invalid Hermes message, ignored");
          }
        }
      }
      onStatus("stream closed by Hermes");
    } catch (error) {
      if (signal?.aborted) return;
      const reason = connection.signal.reason instanceof Error ? connection.signal.reason.message : (error as Error).message;
      onStatus(`error: ${reason}`);
    } finally {
      clearTimeout(idle);
      clearTimeout(backToPrimary);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) return;

    // Cambio de fuente: la principal falló varias veces seguidas → respaldo; en respaldo, pasado el tiempo → principal.
    if (current > 0 && Date.now() - onBackupSince >= retryPrimaryMs) {
      current = 0;
      failures = 0;
      onStatus(`back to the primary source (${sources[0]!.name})`);
      continue;
    }
    if (!gotData) failures++;
    if (failures >= failoverAfter && sources.length > 1) {
      const next = (current + 1) % sources.length;
      onStatus(`⚠ ${source.name} failed ${failures} times in a row: switching to ${sources[next]!.name}`);
      current = next;
      failures = 0;
      onBackupSince = next > 0 ? Date.now() : 0;
      retryMs = 500;
      continue;
    }
    await new Promise((r) => setTimeout(r, retryMs));
    retryMs = Math.min(retryMs * 2, 10_000);
  }
}

/**
 * Último precio de cada feed por REST. Un stream de acciones fuera de horario no manda nada al conectarse: sin esto,
 * un proceso que arranca de noche no tendría precio de SPY/TSLA hasta la apertura.
 */
export async function fetchLatest({ source, feedIds, onUpdate }: { source: HermesSource; feedIds: readonly Hex[]; onUpdate: (update: PriceUpdate) => void }) {
  const query = feedIds.map((id) => `ids[]=${id}`).join("&");
  const res = await fetch(`${source.url}/v2/updates/price/latest?${query}&encoding=hex&parsed=true`, {
    headers: source.apiKey ? { authorization: `Bearer ${source.apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Hermes (${source.name}) respondió ${res.status}`);
  handleEvent((await res.json()) as HermesEvent, new Set(feedIds.map((id) => id.toLowerCase())), onUpdate);
}

/** Valida cada feed del evento y descarta los que no tienen sentido; los demás siguen. */
function handleEvent(event: HermesEvent, allowed: Set<string>, onUpdate: (update: PriceUpdate) => void) {
  if (!Array.isArray(event?.binary?.data) || !Array.isArray(event.parsed)) throw new Error("formato inesperado");
  const hex = event.binary.data.join("");
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error("binario inválido");
  const updateData = `0x${hex}` as Hex;
  const now = Date.now() / 1000;

  for (const feed of event.parsed) {
    const feedId = `0x${feed?.id}`.toLowerCase() as Hex;
    const p = feed?.price;
    if (!allowed.has(feedId) || !p) continue;
    if (typeof p.price !== "string" || typeof p.conf !== "string" || !/^-?\d+$/.test(p.price) || !/^\d+$/.test(p.conf)) continue;
    const price = BigInt(p.price);
    if (price <= 0n) continue; // el contrato también lo rechaza (InvalidPrice)
    if (!Number.isInteger(p.expo) || p.expo > 0 || p.expo < -18) continue;
    if (!Number.isInteger(p.publish_time) || p.publish_time <= 0 || p.publish_time > now + MAX_FUTURE_SECONDS) continue;
    onUpdate({ feedId, price, conf: BigInt(p.conf), expo: p.expo, publishTime: p.publish_time, updateData });
  }
}
