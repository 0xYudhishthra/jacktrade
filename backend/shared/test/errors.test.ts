import assert from "node:assert/strict";
import { test } from "node:test";

import { redact, safeError } from "../src/errors.js";

test("safeError deja solo la primera línea y tapa la clave del RPC", () => {
  const e = new Error("HTTP request failed.\n\nURL: https://robinhood-mainnet.g.alchemy.com/v2/alch_SECRETO123456\nRequest body: {}");
  assert.equal(safeError(e), "HTTP request failed.");
  assert.equal(safeError({ shortMessage: "falló https://x.g.alchemy.com/v2/alch_SECRETO123456" }), "falló https://x.g.alchemy.com/v2/<redactado>");
});

test("redact tapa api keys en query y tokens Bearer", () => {
  assert.equal(redact("https://a.com/x?apiKey=abc123&y=1"), "https://a.com/x?apiKey=<redactado>&y=1");
  assert.equal(redact("Authorization: Bearer FuCJXoAbCdEf"), "Authorization: Bearer <redactado>");
});
