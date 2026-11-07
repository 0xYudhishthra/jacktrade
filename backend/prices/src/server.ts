/**
 * Websocket de precios para el front. La clave de Hermes queda en el servidor; el navegador solo ve precios.
 *
 *   pnpm prices:server
 *
 * - ws://localhost:8090      al conectar manda un "snapshot" y después un "price" por cada precio nuevo
 * - GET /prices              los últimos precios en JSON
 * - GET /history             velas (1m…1d, de Pyth) o ticks de los últimos 300 s; ver docs/precios-front.md
 * - GET /health              200 si todos los precios están frescos, 503 si alguno está atrasado
 * - GET /                    página de prueba que muestra los precios en vivo
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { clientIp, createAlertTracker, installProcessHandlers, RateLimiter, safeError, startDeadManPing } from "@hm/shared";
import { WebSocket, WebSocketServer } from "ws";

import { createCandleSource, MAX_TICK_SECONDS, parseHistoryQuery, UpstreamBusy } from "./history.js";
import { streamHermes } from "./hermes.js";
import { createPriceFeed, isEquityFeed, markets as allMarkets, previewMarkets, PriceStore, toUsd, type PreviewMarket, type PriceUpdate } from "./index.js";
import { checkEntitlement, previewQuote, previousCloseFrom } from "./preview.js";

const port = Number(process.env.PRICES_PORT ?? process.env.PORT ?? 8090);
const staleSeconds = Number(process.env.PRICE_STALE_SECONDS ?? 5);
const maxClients = Number(process.env.PRICES_MAX_CLIENTS ?? 2000);
const maxClientsPerIp = Number(process.env.PRICES_MAX_CLIENTS_PER_IP ?? 20);
const MAX_BUFFERED = 1_000_000; // bytes pendientes de mandar a un cliente antes de cortarlo (no está leyendo)
// Cripto por el feed común; las acciones (listadas o preview) por el stream de abajo, con horario y cierre anterior.
const markets = allMarkets.filter((m) => !isEquityFeed(m.feedId));
const marketByFeed = new Map(markets.map((m) => [m.feedId, m]));

/** Lo que recibe el front. Precio y confianza como string (enteros con `expo`); `usd` es solo para mostrar. */
function toMessage(u: PriceUpdate) {
  const m = marketByFeed.get(u.feedId)!;
  return {
    market: m.id,
    name: m.name,
    price: u.price.toString(),
    conf: u.conf.toString(),
    expo: u.expo,
    publishTime: u.publishTime,
    usd: toUsd(u.price, u.expo),
    preview: false,
  };
}

// ---------------------------------------------------------------- acciones (SPY, TSLA)
// Precio solo de Pyth y solo si la clave tiene acceso al feed; si no, no hay precio. Ver preview.ts.
// Mismo formato que BTC/ETH más `preview` (true mientras el Exchange no las liste), `marketOpen`, `previousClose` y
// `source: "pyth"`.
const hermesUrl = process.env.HERMES_URL ?? "https://pyth.dourolabs.app/hermes";
const hermesKey = process.env.HERMES_API_KEY;
const previewStore = new PriceStore(MAX_TICK_SECONDS);
const previewByFeed = new Map<string, PreviewMarket>(previewMarkets.map((m) => [m.pyth.feedId.toLowerCase(), m]));
const previousClose = new Map<number, number | null>();
// Feeds de acciones que la clave puede leer. Se vuelve a probar cada tanto: si Pyth da acceso, se pasa solo.
let entitled = new Set<number>();
let previewStream: { stop: () => Promise<void> } | undefined;
let previewHermesStatus = "not started";

function previewMessage(m: PreviewMarket) {
  const q = entitled.has(m.id) ? previewQuote(previewStore.latest(m.pyth.feedId), previousClose.get(m.id) ?? null) : null;
  return q ? { market: m.id, name: m.name, ...q, preview: !m.listed } : null;
}

function broadcastPreview(m: PreviewMarket) {
  const msg = previewMessage(m);
  if (msg) broadcast(JSON.stringify({ type: "price", ...msg }));
}

// Cierre anterior de las velas diarias de Pyth; cambia una vez por día, alcanza con mirarlo cada 10 minutos.
async function refreshPreviousCloses() {
  const now = Math.floor(Date.now() / 1000);
  for (const m of previewMarkets) {
    if (!entitled.has(m.id)) continue;
    try {
      const close = previousCloseFrom(await candles(m.pyth.symbol, "1d", now - 10 * 86_400, now), now);
      if (close !== (previousClose.get(m.id) ?? null)) {
        previousClose.set(m.id, close);
        broadcastPreview(m);
      }
    } catch (e) {
      console.error(`[preview] ${m.name} previous close: ${safeError(e)}`);
    }
  }
}

async function refreshEntitlements() {
  const next = new Set(entitled);
  for (const m of previewMarkets) {
    const ok = await checkEntitlement(hermesUrl, hermesKey, m.pyth.feedId);
    if (ok === true) next.add(m.id);
    if (ok === false) next.delete(m.id); // null: no se sabe (red), queda como estaba
  }
  if ([...next].sort().join() === [...entitled].sort().join() && (previewStream || next.size === 0)) return;
  const names = previewMarkets.filter((m) => next.has(m.id)).map((m) => m.name);
  console.log(`[preview] Pyth: ${names.length ? names.join(", ") : "no equity feed entitled"}; the rest have no price`);
  await previewStream?.stop();
  previewStream = undefined;
  entitled = next;
  void refreshPreviousCloses();
  if (next.size === 0) return;
  const controller = new AbortController();
  const done = streamHermes({
    sources: [{ url: hermesUrl, apiKey: hermesKey, name: "primary" }],
    feedIds: previewMarkets.filter((m) => next.has(m.id)).map((m) => m.pyth.feedId),
    onUpdate: (u) => {
      const m = previewByFeed.get(u.feedId);
      if (!m || !previewStore.add(u)) return;
      broadcastPreview(m);
    },
    onStatus: (status) => {
      previewHermesStatus = status;
      console.log(`[hermes preview] ${status}`);
    },
    signal: controller.signal,
  });
  previewStream = { stop: () => (controller.abort(), done) };
}
setInterval(() => void refreshEntitlements().then(refreshPreviousCloses), Number(process.env.PREVIEW_ENTITLEMENT_MS ?? 10 * 60_000)).unref();
void refreshEntitlements();

function snapshot() {
  return [
    ...markets.flatMap((m) => {
      const u = feed.store.latest(m.feedId);
      return u ? [toMessage(u)] : [];
    }),
    ...previewMarkets.flatMap((m) => {
      const msg = previewMessage(m);
      return msg ? [msg] : [];
    }),
  ];
}

function health() {
  const now = Date.now() / 1000;
  const prices = markets.map((m) => {
    const u = feed.store.latest(m.feedId);
    const age = u ? now - u.publishTime : null;
    return { name: m.name, ageSeconds: age === null ? null : Number(age.toFixed(1)), stale: age === null || age > staleSeconds };
  });
  // Las acciones no cuentan para ok: fuera de horario no cambian. Su precio para la cadena lo vigilan relayer y liquidador.
  const previews = previewMarkets.map((m) => {
    const q = previewMessage(m);
    return { name: m.name, source: q?.source ?? null, ageSeconds: q ? Number((now - q.publishTime).toFixed(1)) : null, marketOpen: q?.marketOpen ?? null };
  });
  return { ok: prices.every((p) => !p.stale), clients: wss.clients.size, hermes: hermesStatus, previewHermes: previewHermesStatus, prices, previews };
}

let hermesStatus = "connecting";
const candles = createCandleSource();

async function history(params: URLSearchParams, res: ServerResponse) {
  let q;
  try {
    q = parseHistoryQuery(params, [...markets.map((m) => m.id), ...previewMarkets.map((m) => m.id)]);
  } catch (e) {
    return fail(res, 400, "INVALID_REQUEST", (e as Error).message);
  }
  const pm = previewMarkets.find((x) => x.id === q.market);
  if (pm) {
    if (!entitled.has(pm.id)) return fail(res, 503, "FEED_UNAVAILABLE", `${pm.name} has no price feed yet`);
    if (q.kind === "ticks") {
      const ticks = previewStore.since(pm.pyth.feedId, q.from).map((u) => ({ t: u.publishTime * 1000, usd: toUsd(u.price, u.expo) }));
      return json(res, 200, { market: pm.id, name: pm.name, preview: !pm.listed, ticks });
    }
    try {
      const list = await candles(pm.pyth.symbol, q.interval, q.from, q.to);
      return json(res, 200, { market: pm.id, name: pm.name, interval: q.interval, preview: !pm.listed, source: "pyth", candles: list });
    } catch (e) {
      if (e instanceof UpstreamBusy) return fail(res, 503, "BUSY", "history is busy right now, try again in a few seconds");
      console.error(`[history] ${pm.name}: ${safeError(e)}`);
      return fail(res, 502, "UPSTREAM_ERROR", "could not fetch history from Pyth");
    }
  }
  const m = markets.find((x) => x.id === q.market)!;
  if (q.kind === "ticks") {
    const ticks = feed.store.since(m.feedId, q.from).map((u) => ({ t: u.publishTime * 1000, usd: toUsd(u.price, u.expo) }));
    return json(res, 200, { market: m.id, name: m.name, ticks });
  }
  try {
    const list = await candles(`Crypto.${m.name}`, q.interval, q.from, q.to);
    return json(res, 200, { market: m.id, name: m.name, interval: q.interval, candles: list });
  } catch (e) {
    if (e instanceof UpstreamBusy) return fail(res, 503, "BUSY", "history is busy right now, try again in a few seconds");
    console.error(`[history] ${safeError(e)}`);
    return fail(res, 502, "UPSTREAM_ERROR", "could not fetch history from Pyth");
  }
}

const feed = createPriceFeed({
  historySeconds: MAX_TICK_SECONDS,
  withEquities: false,
  onStatus: (s) => {
    hermesStatus = s;
    console.log(`[hermes] ${s}`);
  },
  onUpdate: (u) => {
    if (!marketByFeed.has(u.feedId)) return;
    broadcast(JSON.stringify({ type: "price", ...toMessage(u) }));
  },
});

function broadcast(data: string) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    // Un cliente que no lee acumula datos en memoria del servidor: se corta.
    if (client.bufferedAmount > MAX_BUFFERED) client.terminate();
    else client.send(data);
  }
}

// Errores: { code, message } como el resto de la API (error queda por compatibilidad).
const fail = (res: ServerResponse, status: number, code: string, message: string) => json(res, status, { code, message, error: message });

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

// /history cuesta un pedido a Pyth si no está en caché: cuenta más que el resto.
const ipLimiter = new RateLimiter(Number(process.env.PRICES_IP_BURST ?? 30), Number(process.env.PRICES_IP_PER_SECOND ?? 10));

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (!ipLimiter.allow(clientIp(req), path === "/history" ? 3 : 1)) return fail(res, 429, "RATE_LIMITED", "too many requests");
  if (path === "/prices") return json(res, 200, snapshot());
  if (path === "/history") return history(url.searchParams, res);
  if (path === "/health") {
    const h = health();
    return json(res, h.ok ? 200 : 503, h);
  }
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(TEST_PAGE);
  }
  fail(res, 404, "NOT_FOUND", "not found");
}

const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(`[http] ${safeError(e)}`);
    if (!res.headersSent) fail(res, 400, "INVALID_REQUEST", "invalid request");
    else res.end();
  });
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

// WebSocket: el cliente solo escucha. Mensajes entrantes chicos, tope de conexiones global y por IP.
// Corta las conexiones que dejan de responder al ping (pestañas cerradas sin aviso, redes caídas): el pong solo cuenta
// si antes hubo un ping, así no alcanza con mandar pongs sueltos para quedarse.
const awaitingPong = new WeakMap<WebSocket, boolean>();
const perIp = new Map<string, number>();
const wss = new WebSocketServer({ server, maxPayload: 1024 });
wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  if (wss.clients.size > maxClients || (perIp.get(ip) ?? 0) >= maxClientsPerIp) {
    ws.close(1013, "demasiadas conexiones");
    return;
  }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  ws.on("close", () => {
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  });
  ws.on("error", () => ws.terminate());
  ws.on("message", () => {}); // el cliente no tiene nada que mandar; se ignora
  ws.on("pong", () => awaitingPong.set(ws, false));
  ws.send(JSON.stringify({ type: "snapshot", prices: snapshot() }));
});
const pinger = setInterval(() => {
  for (const ws of wss.clients) {
    if (awaitingPong.get(ws)) ws.terminate();
    else {
      awaitingPong.set(ws, true);
      ws.ping();
    }
  }
}, 30_000);

// Monitor externo: vivo si algún mercado tiene precio de menos de 60 s.
startDeadManPing("precios", () => health().prices.some((p) => p.ageSeconds !== null && p.ageSeconds < 60));

// Aviso si un precio se atrasa: en consola y, si dura, en Telegram.
const alerts = createAlertTracker("precios");
const watcher = setInterval(() => {
  const stale = health().prices.filter((p) => p.stale);
  for (const p of stale) console.warn(`⚠ ${p.name} atrasado: ${p.ageSeconds ?? "sin precio"} s`);
  // El estado de Hermes cambia seguido ("conectado" / "error…"): no va en el texto, o el problema nunca duraría 1 minuto.
  void alerts.report(stale.map((p) => `${p.name} price is stale`));
}, staleSeconds * 1000);

server.listen(port, () => console.log(`Precios en ws://localhost:${port} · página de prueba en http://localhost:${port}`));

installProcessHandlers("precios", async () => {
  clearInterval(pinger);
  clearInterval(watcher);
  wss.close();
  server.close();
  await Promise.all([feed.stop(), previewStream?.stop()]);
});

const TEST_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>JackTrade prices</title>
<style>
  body { font: 16px ui-monospace, monospace; background: #0b0b10; color: #ddd; padding: 24px; }
  td { padding: 4px 16px 4px 0; } .old { color: #f66; }
</style>
<h1>Live prices</h1>
<p id="status">connecting…</p>
<table><thead><tr><td>Market</td><td>Price</td><td>Confidence</td><td>Age</td></tr></thead><tbody id="rows"></tbody></table>
<script>
  const prices = {};
  const rows = document.getElementById("rows");
  const status = document.getElementById("status");
  function render() {
    const now = Date.now() / 1000;
    rows.innerHTML = Object.values(prices).map((p) => {
      const age = now - p.publishTime;
      const confBps = (Number(p.conf) / Number(p.price)) * 10000;
      return "<tr class=" + (age > ${staleSeconds} ? "old" : "") + "><td>" + p.name + "</td><td>$" + p.usd.toFixed(2) +
        "</td><td>" + confBps.toFixed(2) + " bps</td><td>" + age.toFixed(1) + " s</td></tr>";
    }).join("");
  }
  function connect() {
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
    ws.onopen = () => (status.textContent = "connected");
    ws.onclose = () => { status.textContent = "disconnected, retrying…"; setTimeout(connect, 1000); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      for (const p of msg.type === "snapshot" ? msg.prices : [msg]) prices[p.market] = p;
      render();
    };
  }
  connect();
  setInterval(render, 500);
</script>`;
