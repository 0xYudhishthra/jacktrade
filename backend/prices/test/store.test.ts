import assert from "node:assert/strict";
import { test } from "node:test";

import type { Hex } from "viem";

import { PriceStore, type PriceUpdate } from "../src/store.js";

const BTC = "0xbtc" as Hex;
const ETH = "0xeth" as Hex;
const update = (feedId: Hex, publishTime: number, updateData = `0x${publishTime}` as Hex): PriceUpdate => ({
  feedId,
  price: 100n,
  conf: 1n,
  expo: -8,
  publishTime,
  updateData,
});

test("devuelve el update más fresco posterior a signedAt", () => {
  const store = new PriceStore();
  store.add(update(BTC, 10));
  store.add(update(BTC, 12));
  assert.deepEqual(store.getUpdateAfter([BTC], 11)?.updateData, ["0x12"]);
});

test("null si todavía no hay precio posterior a signedAt", () => {
  const store = new PriceStore();
  store.add(update(BTC, 10));
  assert.equal(store.getUpdateAfter([BTC], 11), null);
});

test("ignora updates que llegan desordenados", () => {
  const store = new PriceStore();
  store.add(update(BTC, 12));
  store.add(update(BTC, 11));
  assert.equal(store.latest(BTC)?.publishTime, 12);
});

test("no repite bytes cuando un update cubre varios feeds", () => {
  const store = new PriceStore();
  store.add(update(BTC, 12, "0xab"));
  store.add(update(ETH, 12, "0xab"));
  assert.deepEqual(store.getUpdateAfter([BTC, ETH], 12)?.updateData, ["0xab"]);
});

test("borra la historia más vieja que la ventana", () => {
  const store = new PriceStore(5);
  store.add(update(BTC, 1));
  store.add(update(BTC, 10));
  store.add(update(BTC, 20));
  assert.equal(store.latest(BTC)?.publishTime, 20);
  assert.equal(store.getUpdateAfter([BTC], 0)?.updates[0]?.publishTime, 20);
});
