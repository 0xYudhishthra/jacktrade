import { config } from "./config.ts";

// Thin clients for JackTrade's public APIs. Shapes are the live responses.

export type TypedField = { name: string; type: string };
export type Domain = { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };

export type Market = {
  id: number;
  name: string; // "BTC/USD"
  maxLeverage: number;
  maxConfBps: number;
  minMargin: string; // 6-decimal raw
  minNotional: string;
  maxNotional: string;
  listed: boolean;
};

export type RelayerConfig = {
  chainId: number;
  contracts: { Exchange: `0x${string}`; SessionKeyManager: `0x${string}` };
  collateral: { address: `0x${string}`; symbol: string; decimals: number };
  eip712: { domain: Domain; types: { Open: TypedField[]; Close: TypedField[] } };
  markets: Market[];
  limits: { intentTtl: number; maxIntentAge: number; sessionKeyMaxDuration: number };
  chainTime: number;
  tradingPaused: boolean;
};

export type Price = {
  market: number;
  name: string;
  price: string;
  expo: number;
  usd: number;
  publishTime: number;
  marketOpen?: boolean;
};

export type IntentStatus =
  | { status: "queued" }
  | { status: "submitted"; txHash: string }
  | { status: "executed"; txHash: string; positionId?: string; price: string; publishTime: number }
  | { status: "failed"; txHash?: string; code: string; message: string };

export type IndexerPosition = {
  id: string;
  market: string;
  instrumentId: number;
  side: "long" | "short";
  margin: string;
  leverage: number;
  entryPrice: string;
  markPrice: string | null;
  liquidationPrice: string | null;
  liquidatable: boolean | null;
  pnl: string | null;
  openedAt: number;
};

export type HistoryItem = {
  type: string;
  id?: string;
  market?: string;
  side?: string;
  exitPrice?: string;
  pnl?: string;
  at: number;
  tx: string;
};

export class UpstreamError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new UpstreamError(`Bad JSON from ${url}`, res.status);
  }
  if (!res.ok && !(res.status === 503 && url.endsWith("/health"))) {
    throw new UpstreamError(body?.message ?? `HTTP ${res.status} from ${url}`, res.status, body?.code);
  }
  return body as T;
}

let cachedConfig: { at: number; value: RelayerConfig; offset: number } | null = null;

/** Relayer config, cached for 60 s. Also tracks the chain-time offset used for `signedAt`. */
export async function relayerConfig(): Promise<RelayerConfig> {
  if (cachedConfig && Date.now() - cachedConfig.at < 60_000) return cachedConfig.value;
  const value = await getJson<RelayerConfig>(`${config.relayerUrl}/config`);
  cachedConfig = { at: Date.now(), value, offset: value.chainTime - Math.floor(Date.now() / 1000) };
  return value;
}

/** Current chain time in seconds, from the relayer's view of the chain. */
export async function chainNow(): Promise<number> {
  await relayerConfig();
  return Math.floor(Date.now() / 1000) + (cachedConfig?.offset ?? 0);
}

export async function relayerHealth(): Promise<{
  lpBankrollAvailable: string;
  totalQueued: string;
  tradingPaused: boolean;
  chainTime: number;
}> {
  return getJson(`${config.relayerUrl}/health`);
}

export async function prices(): Promise<Price[]> {
  return getJson<Price[]>(`${config.pricesUrl}/prices`);
}

export async function submitIntent(kind: "open" | "close", intent: Record<string, unknown>, signature: string) {
  return getJson<{ id: string; status: string }>(`${config.relayerUrl}/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, intent, signature }),
  });
}

export async function intentStatus(id: string): Promise<IntentStatus> {
  return getJson<IntentStatus>(`${config.relayerUrl}/intent/${encodeURIComponent(id)}`);
}

export async function positions(wallet: string): Promise<IndexerPosition[]> {
  return getJson<IndexerPosition[]>(`${config.indexerUrl}/api/positions/${wallet}`);
}

export async function history(wallet: string): Promise<{ items: HistoryItem[] }> {
  return getJson(`${config.indexerUrl}/api/history/${wallet}`);
}

export async function account(wallet: string): Promise<{ balance: string }> {
  return getJson(`${config.indexerUrl}/api/account/${wallet}`);
}

export async function closePreview(positionId: string): Promise<{
  price: string;
  gain: string;
  loss: string;
  fee: string;
  payout: string;
  pnl: string;
  paidNow: string;
  queued: string;
}> {
  return getJson(`${config.indexerUrl}/api/preview/${positionId}`);
}

export async function house(): Promise<{
  bankroll: string;
  queue: string;
  positions: number;
  housePnl: string;
  paused: boolean;
  markets: { name: string; longOi: string; shortOi: string }[];
}> {
  return getJson(`${config.indexerUrl}/api/house`);
}
