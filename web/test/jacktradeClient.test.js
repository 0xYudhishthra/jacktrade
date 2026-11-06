import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chainNow, normalizeConfig, priceLimit, RelayerError } from "../src/lib/jacktradeClient.js";
import { orderMinimumIssue } from "../src/lib/orderMinimums.js";

describe("Jacktrade protocol client", () => {
  const quote = { price: "8191581", expo: -2 };

  it("builds conservative 18 decimal limits from raw Pyth quotes", () => {
    assert.equal(priceLimit(quote, { isLong: true, slippageBps: 50 }), 82325389050000000000000n);
    assert.equal(priceLimit(quote, { isLong: false, slippageBps: 50 }), 81506230950000000000000n);
  });

  it("reverses the tolerance direction when closing", () => {
    assert.equal(priceLimit(quote, { isLong: true, closing: true, slippageBps: 50 }), 81506230950000000000000n);
    assert.equal(priceLimit(quote, { isLong: false, closing: true, slippageBps: 50 }), 82325389050000000000000n);
  });

  it("uses the relayer clock offset and exposes readable protocol errors", () => {
    const before = BigInt(Math.floor(Date.now() / 1000) + 30);
    assert.ok(chainNow({ clockOffset: 30 }) >= before);
    assert.equal(new RelayerError("MarketNotListed").message, "This market is not available yet.");
  });

  it("reads /config market amounts as raw 6 decimal USDG", () => {
    const config = normalizeConfig({
      collateral: { decimals: 6 },
      markets: [{ id: 0, minMargin: "10000000", minNotional: "1000000000", maxNotional: "100000000000" }],
    });
    assert.deepEqual(config.markets[0], { id: 0, minMargin: "10", minNotional: "1000", maxNotional: "100000" });
    assert.equal(orderMinimumIssue(20, 50, config.markets[0]), null);
    assert.equal(orderMinimumIssue(5, 50, config.markets[0]).kind, "margin");
  });
});
