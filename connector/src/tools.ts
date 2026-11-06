import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPublicClient, http, parseAbi } from "viem";
import { z } from "zod";
import { config } from "./config.ts";
import type { Store, User } from "./db.ts";
import { pointsLeaderboard, pointsOf } from "./points.ts";
import * as trading from "./trading.ts";
import * as up from "./upstream.ts";

const attestationAbi = parseAbi([
  "function latest() view returns (uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions, uint64 observedAt)",
]);

/** Latest Chainlink CRE "Proof of House" attestation, if the consumer contract is configured. */
export async function readAttestation() {
  if (!config.attestationAddress) return null;
  try {
    const client = createPublicClient({ transport: http(config.attestationRpcUrl) });
    const [bankroll, queued, openInterest, positions, observedAt] = await client.readContract({
      address: config.attestationAddress as `0x${string}`,
      abi: attestationAbi,
      functionName: "latest",
    });
    if (observedAt === 0n) return null;
    return {
      bankrollUsd: Number(bankroll) / 1e6,
      queuedUsd: Number(queued) / 1e6,
      openInterestUsd: Number(openInterest) / 1e6,
      positions: Number(positions),
      observedAt: new Date(Number(observedAt) * 1000).toISOString(),
      contract: `${config.attestationExplorerUrl}/address/${config.attestationAddress}`,
      attestedBy: "Chainlink CRE workflow (Proof of House)",
    };
  } catch {
    return null;
  }
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof trading.BetError || err instanceof up.UpstreamError ? err.message : `Something went wrong: ${String(err)}`;
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const side = z.enum(["long", "short"]).describe("long = bet the price goes up, short = bet it goes down");
const market = z.string().describe('Ticker, e.g. "TSLA", "BTC", "ETH"');
const marginUsd = z.number().positive().describe("How many dollars to put on the bet (margin, in USDG)");
const leverage = z.number().int().min(2).describe("Leverage multiplier, e.g. 50 for 50x");

export function buildServer(user: User, agentKey: () => `0x${string}`, store: Store): McpServer {
  const server = new McpServer(
    { name: "jacktrade", version: "0.1.0" },
    {
      instructions:
        "JackTrade lets the user bet against the house with leverage on stocks and crypto. " +
        "Before placing a bet, call quote_bet and show the user the entry, liquidation price and house bankroll, " +
        "then ask them to confirm. Never place a bet the user did not explicitly ask for. " +
        "Grok's key can open and close bets but can never withdraw funds. " +
        "Every bet earns JackTrade Points: 10 points per $100 of notional, win or lose.",
    },
  );

  server.registerTool(
    "my_points",
    {
      title: "My JackTrade Points",
      description: "The user's JackTrade Points (10 per $100 of notional traded, win or lose) and the top of the leaderboard.",
      inputSchema: {},
    },
    async () => {
      try {
        const [mine, top] = await Promise.all([pointsOf(user.wallet), pointsLeaderboard(5)]);
        return ok({ ...mine, leaderboard: top });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_markets",
    {
      title: "List markets",
      description: "Markets the user can bet on right now, with live prices and max leverage.",
      inputSchema: {},
    },
    async () => {
      try {
        const [cfg, ps] = await Promise.all([up.relayerConfig(), up.prices()]);
        return ok(
          cfg.markets
            .filter((m) => m.listed)
            .map((m) => {
              const p = ps.find((x) => x.market === m.id);
              return {
                market: m.name,
                price: p?.usd ?? null,
                open: p?.marketOpen ?? true,
                maxLeverage: m.maxLeverage,
                minBetUsd: Number(BigInt(m.minMargin)) / 1e6,
              };
            }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "house_status",
    {
      title: "House status",
      description:
        "How much the house can pay out right now, its payout queue and open interest, plus the latest " +
        "Chainlink-attested Proof of House. Check this before big bets.",
      inputSchema: {},
    },
    async () => {
      try {
        const [health, h, attestation] = await Promise.all([up.relayerHealth(), up.house(), readAttestation()]);
        const openInterestUsd = h.markets.reduce((s, m) => s + Number(m.longOi) + Number(m.shortOi), 0);
        return ok({
          bankrollUsd: Number(health.lpBankrollAvailable),
          payoutQueueUsd: Number(health.totalQueued),
          openInterestUsd,
          openPositions: h.positions,
          houseLifetimePnlUsd: Number(h.housePnl),
          tradingPaused: health.tradingPaused,
          proofOfHouse: attestation ?? "No Chainlink attestation published yet.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "quote_bet",
    {
      title: "Quote a bet",
      description: "Preview a bet without placing it: entry price, position size, liquidation price and limits.",
      inputSchema: { market, side, margin_usd: marginUsd, leverage },
    },
    async (a) => {
      try {
        return ok(await trading.quote({ market: a.market, side: a.side, marginUsd: a.margin_usd, leverage: a.leverage }, user.caps, store, user.wallet));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "place_bet",
    {
      title: "Place a bet",
      description:
        "Place a leveraged bet against the house on JackTrade (Robinhood Chain). Only call after the user " +
        "confirmed the quote. Returns the position id and the onchain transaction.",
      inputSchema: {
        market,
        side,
        margin_usd: marginUsd,
        leverage,
        max_slippage_pct: z.number().min(0.01).max(5).optional().describe("Max price slippage in percent (default 0.5)"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (a) => {
      try {
        const r = await trading.placeBet(
          { market: a.market, side: a.side, marginUsd: a.margin_usd, leverage: a.leverage, maxSlippagePct: a.max_slippage_pct },
          user,
          agentKey(),
          store,
        );
        return ok({
          message: r.message,
          betId: r.bet.id,
          positionId: r.bet.positionId,
          market: r.bet.market,
          side: r.bet.side,
          leverage: r.bet.leverage,
          marginUsd: r.bet.marginUsd,
          entryPrice: r.bet.entryPrice,
          liquidationPrice: r.bet.liquidationPrice,
          transaction: r.txUrl,
          makeItReal: `${config.webUrl}/real/${r.bet.id}`,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "my_bets",
    {
      title: "My open bets",
      description: "The user's open bets with live profit and loss and liquidation prices.",
      inputSchema: {},
    },
    async () => {
      try {
        const open = await up.positions(user.wallet);
        return ok(
          open.map((p) => ({
            positionId: p.id,
            market: p.market,
            side: p.side,
            leverage: p.leverage,
            marginUsd: Number(p.margin),
            entryPrice: Number(p.entryPrice),
            markPrice: p.markPrice ? Number(p.markPrice) : null,
            liquidationPrice: p.liquidationPrice ? Number(p.liquidationPrice) : null,
            pnlUsd: p.pnl ? Number(p.pnl) : null,
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "cash_out",
    {
      title: "Cash out a bet",
      description: "Close an open bet at the current price. Only call when the user asks to close it.",
      inputSchema: { position_id: z.string().describe("Position id from my_bets or place_bet") },
    },
    async (a) => {
      try {
        return ok(await trading.cashOut(a.position_id, user, agentKey(), store));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "make_it_real",
    {
      title: "Make it real",
      description:
        "Get a link where the user (or anyone following this bet) can buy the real stock token with a " +
        "Definitive Flash order, with take-profit and stop-loss set from the bet.",
      inputSchema: { bet_id: z.string().describe("betId returned by place_bet") },
    },
    async (a) => {
      const bet = store.bet(a.bet_id);
      if (!bet) return fail(new trading.BetError("Unknown bet id."));
      return ok({ link: `${config.webUrl}/real/${bet.id}`, note: "Opens JackTrade to sign a Flash order in your wallet." });
    },
  );

  return server;
}
