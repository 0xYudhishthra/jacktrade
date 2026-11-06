/**
 * Prueba el cliente de ejemplo del front (docs/examples/jacktrade-client.js) contra el relayer, en el fork.
 * Hace lo mismo que haría el front: config, session key nueva, registro con la wallet, abrir y cerrar con priceLimit.
 *
 *   pnpm fork · pnpm setup:fork · NETWORK=fork pnpm relayer
 *   pnpm try:front-client
 */
import { createPriceFeed, markets } from "@hm/prices";
import { getNetwork } from "@hm/shared";
import { createWalletClient, http, type Address } from "viem";

// @ts-expect-error: el cliente es JavaScript a propósito (es lo que copia el front)
import * as hm from "../docs/examples/jacktrade-client.js";

const relayerUrl = process.env.RELAYER_URL ?? `http://localhost:${process.env.RELAYER_PORT ?? 8091}`;
const { chain, rpcUrl, client } = getNetwork("fork");
const [, , user] = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
// En el navegador sería createWalletClient({ transport: custom(window.ethereum) }). En el fork, la cuenta 2 de anvil.
const wallet = createWalletClient({ account: user!, chain, transport: http(rpcUrl) });
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};

// Precio como lo da el websocket ({ price, expo }), para el priceLimit.
const feed = createPriceFeed();
let quote;
for (let i = 0; !quote && i < 50; i++) {
  await new Promise((r) => setTimeout(r, 200));
  quote = feed.store.latest(markets[0]!.feedId);
}
await feed.stop();
const q = { price: quote!.price.toString(), expo: quote!.expo };

const config = await hm.loadConfig(relayerUrl);
check(config.chainId === chain.id && config.markets.length === 2, `config: chain ${config.chainId} · ${config.markets.map((m: { name: string }) => m.name).join(", ")} · desfase del reloj ${config.clockOffset.toFixed(1)} s`);

const key = hm.createSessionKey();
await client.waitForTransactionReceipt({ hash: await hm.registerSessionKey(wallet, config, key.address, 3600) });
check(await hm.isValidSessionKey(client, config, user, key.address), `session key ${key.address} registrada (1 h)`);
const signer = hm.sessionKeyAccount(key.privateKey);

const limit = hm.priceLimit(q, { isLong: true });
const opened = await hm.openPosition(config, { user, signer, instrumentId: 0, isLong: true, margin: 10_000_000, leverage: 100, quote: q });
check(BigInt(opened.price) <= limit, `open con priceLimit +0,5% (${(Number(limit) / 1e18).toFixed(2)}): posición ${opened.positionId} a ${(Number(opened.price) / 1e18).toFixed(2)}`);

const closed = await hm.closePosition(config, { user, signer, positionId: opened.positionId, isLong: true, quote: q });
check(closed.positionId === opened.positionId, `close: posición ${closed.positionId} a ${(Number(closed.price) / 1e18).toFixed(2)}`);

try {
  await hm.openPosition(config, { user, signer, instrumentId: 0, isLong: true, margin: 10_000_000, leverage: 5000 });
  check(false, "5000x debería rechazarse");
} catch (e) {
  const err = e as { code: string; message: string };
  check(err.code === "InvalidLeverage", `error con mensaje para el usuario: ${err.code} → "${err.message}"`);
}

try {
  // priceLimit imposible para un long (10% por debajo del precio): el contrato la rechaza al ejecutar.
  await hm.openPosition(config, { user, signer, instrumentId: 0, isLong: true, margin: 10_000_000, leverage: 100, quote: q, slippageBps: -1000 });
  check(false, "un priceLimit por debajo del precio debería fallar");
} catch (e) {
  const err = e as { code: string; message: string };
  check(err.code === "PriceLimitExceeded", `priceLimit superado: ${err.code} → "${err.message}"`);
}

process.exit(failures ? 1 : 0);
