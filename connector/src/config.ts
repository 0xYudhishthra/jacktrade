const env = process.env;

function trim(url: string): string {
  return url.replace(/\/+$/, "");
}

const publicUrl = trim(env.PUBLIC_URL ?? "http://localhost:8787");

export const config = {
  port: Number(env.PORT ?? 8787),
  publicUrl,
  /** Where the web app lives. Defaults to this server, which serves the built app from WEB_DIST. */
  webUrl: trim(env.WEB_URL ?? publicUrl),
  webDist: env.WEB_DIST ?? "../web/dist",
  serverSecret: env.SERVER_SECRET ?? "",
  dbPath: env.DB_PATH ?? "./data/connector.db",
  relayerUrl: trim(env.RELAYER_URL ?? "https://hmrelayer-production.up.railway.app"),
  pricesUrl: trim(env.PRICES_URL ?? "https://hmprices-production.up.railway.app"),
  indexerUrl: trim(env.INDEXER_URL ?? "https://hmindexer-production.up.railway.app"),
  rpcUrl: env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  /** Block explorer base URL. Empty means tx links are returned as bare hashes. */
  explorerUrl: trim(env.EXPLORER_URL ?? ""),
  flashApiKey: env.FLASH_API_KEY ?? "",
  flashUrl: trim(env.FLASH_URL ?? "https://flash.definitive.fi/v1"),
  /** JackTradePoints contract on Robinhood Chain (optional). */
  pointsAddress: env.POINTS_ADDRESS ?? "",
  /** Private key allowed to call JackTradePoints.sync (optional; enables the sync job). */
  pointsSyncerKey: env.POINTS_SYNCER_KEY ?? "",
};

export function txLink(hash: string | null | undefined): string | null {
  if (!hash) return null;
  return config.explorerUrl ? `${config.explorerUrl}/tx/${hash}` : hash;
}

export function assertConfig(): void {
  if (!/^[0-9a-f]{64,}$/i.test(config.serverSecret)) {
    throw new Error("SERVER_SECRET must be at least 32 bytes of hex (openssl rand -hex 32)");
  }
}
