/**
 * Comprueba que los updates de Hermes los acepta el contrato real de Pyth: toma el último update de BTC y ETH,
 * lo manda a Pyth en el fork y lee el precio de vuelta. Solo corre contra el fork.
 *
 *   pnpm fork          # en otra terminal
 *   pnpm check:pyth
 */
import { createPriceFeed, markets, toUsd } from "@hm/prices";
import { deployment, getNetwork } from "@hm/shared";
import { createWalletClient, http, parseAbi } from "viem";

const { chain, rpcUrl, client } = getNetwork("fork");
const pyth = deployment.pyth as `0x${string}`;
const abi = parseAbi([
  "function getUpdateFee(bytes[] updateData) view returns (uint256)",
  "function updatePriceFeeds(bytes[] updateData) payable",
  "function getPriceNoOlderThan(bytes32 id, uint256 age) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))",
]);

// Las cuentas de prueba de anvil están desbloqueadas en el fork: no hace falta clave.
const [account] = await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses();
if (!account) throw new Error("El fork no tiene cuentas de prueba");
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

const { store, stop } = createPriceFeed();
const feedIds = markets.map((m) => m.feedId);
const after = Math.floor(Date.now() / 1000);

let update = store.getUpdateAfter(feedIds, after);
for (let i = 0; !update && i < 50; i++) {
  await new Promise((r) => setTimeout(r, 200));
  update = store.getUpdateAfter(feedIds, after);
}
await stop();
if (!update) throw new Error("Hermes no mandó precios en 10 s");

const fee = await client.readContract({ address: pyth, abi, functionName: "getUpdateFee", args: [update.updateData] });
const hash = await wallet.writeContract({
  address: pyth,
  abi,
  functionName: "updatePriceFeeds",
  args: [update.updateData],
  value: fee,
});
const receipt = await client.waitForTransactionReceipt({ hash });
console.log(`updatePriceFeeds: ${receipt.status} · ${update.updateData.length} update(s) · fee ${fee} wei · gas ${receipt.gasUsed}`);

for (const [i, m] of markets.entries()) {
  const offchain = update.updates[i]!;
  const onchain = await client.readContract({ address: pyth, abi, functionName: "getPriceNoOlderThan", args: [m.feedId, 60n] });
  const same = onchain.price === offchain.price && onchain.publishTime === BigInt(offchain.publishTime);
  console.log(
    `${m.name}: Hermes $${toUsd(offchain.price, offchain.expo).toFixed(2)} · Pyth en el fork $${toUsd(onchain.price, onchain.expo).toFixed(2)} · ${same ? "coinciden" : "NO coinciden"}`,
  );
}
