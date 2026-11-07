/**
 * Lee la configuración del Exchange para confirmar que estamos apuntando bien.
 *
 *   pnpm check:contracts              # mainnet
 *   NETWORK=fork pnpm check:contracts # fork local
 */
import { deployment, getNetwork } from "@hm/shared";

const { name, rpcUrl, client } = getNetwork();
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;

// El desfase se mide apenas llega el bloque; las lecturas de abajo tardan y lo inflarían.
const block = await client.getBlock();
const drift = Date.now() / 1000 - Number(block.timestamp);

const [config, fees, paused] = await Promise.all([
  client.readContract({ ...exchange, functionName: "marketConfig", args: [0] }),
  client.readContract({ ...exchange, functionName: "fees" }),
  client.readContract({ ...exchange, functionName: "tradingPaused" }),
]);

console.log(`Red: ${name} (${new URL(rpcUrl).host})`); // solo el host: la URL puede tener la clave del RPC
console.log(`Bloque: ${block.number} · desfase del reloj: ${drift.toFixed(1)} s`);
console.log(`Exchange: ${exchange.address} · trading pausado: ${paused}`);
console.log("marketConfig(0) BTC/USD:", config);
console.log("fees():", fees);
