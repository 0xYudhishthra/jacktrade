/**
 * Compara las interfaces de `shared` con los contratos desplegados. Solo lectura (eth_call), no firma transacciones reales.
 *
 *   pnpm check:interfaces
 *
 * 1. Dominio y typehashes EIP-712 del Exchange.
 * 2. Una firma hecha con `intentTypedData` pasa la verificación del Exchange (simulando la llamada desde el BatchExecutor).
 * 3. `liquidationPrice` / `isLiquidatable` dan lo mismo que `PnLMath.isLiquidatable` en 200 casos al azar.
 */
import { execFileSync } from "node:child_process";

import {
  deployment,
  getNetwork,
  intentTypedData,
  isLiquidatable,
  liquidationPrice,
  type Intent,
} from "@hm/shared";
import { BaseError, ContractFunctionRevertedError, keccak256, parseAbi, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { client } = getNetwork();
const exchange = deployment.contracts.Exchange;
const executor = deployment.contracts.BatchExecutor.address;
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};

// 1. Dominio y typehashes
const [, name, version, chainId, verifyingContract] = await client.readContract({
  address: exchange.address,
  abi: exchange.abi,
  functionName: "eip712Domain",
});
const { domain, types } = deployment.eip712.exchange;
check(
  name === domain.name && version === domain.version && Number(chainId) === domain.chainId &&
    verifyingContract.toLowerCase() === domain.verifyingContract.toLowerCase(),
  `dominio EIP-712: ${name} v${version} · chain ${chainId}`,
);
for (const [primary, fn] of [["Open", "OPEN_TYPEHASH"], ["Close", "CLOSE_TYPEHASH"]] as const) {
  const encoded = `${primary}(${types[primary].map((f) => `${f.type} ${f.name}`).join(",")})`;
  const onchain = await client.readContract({ address: exchange.address, abi: exchange.abi, functionName: fn });
  check(keccak256(toHex(encoded)) === onchain, `${fn} coincide`);
}

// 2. Firma aceptada por el Exchange
const wallet = privateKeyToAccount(generatePrivateKey());
const block = await client.getBlock();
const open: Intent = {
  kind: "open",
  intent: {
    user: wallet.address,
    instrumentId: 0,
    isLong: true,
    margin: 10_000_000n,
    leverage: 10n,
    priceLimit: 0n,
    signedAt: block.timestamp - 5n,
    nonce: BigInt(Date.now()),
  },
};
async function revertReason(signature: `0x${string}`) {
  try {
    await client.simulateContract({
      address: exchange.address,
      abi: exchange.abi,
      functionName: "openPositionBySig",
      args: [open.intent as never, signature],
      account: executor,
    });
    return "sin revert";
  } catch (e) {
    const revert = e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError);
    return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? "desconocido") : "desconocido";
  }
}
const good = await revertReason(await wallet.signTypedData(intentTypedData(open)));
const bad = await revertReason(await privateKeyToAccount(generatePrivateKey()).signTypedData(intentTypedData(open)));
check(good !== "InvalidSignature" && good !== "IntentExpired", `firma válida pasa la verificación (después falla con ${good})`);
check(bad === "InvalidSignature", `firma de otra cuenta se rechaza (${bad})`);

// 3. Precio de liquidación contra PnLMath
// PnLMath no está en el export: se toma de deployments/<chainId>.json en main de contracts.
const deployments = execFileSync("gh", [
  "api",
  `repos/${process.env.CONTRACTS_REPO ?? "jacktrade/contracts"}/contents/deployments/${deployment.chainId}.json?ref=main`,
  "-H",
  "Accept: application/vnd.github.raw",
]).toString();
const pnlMath = JSON.parse(deployments).PnLMath as Address;
const pnlAbi = parseAbi([
  "function isLiquidatable(uint256 entryPrice, uint256 leverage, uint256 bufferBps, bool isLong, uint256 price) pure returns (bool)",
]);
const rand = (max: number) => BigInt(Math.floor(Math.random() * max));
const cases = Array.from({ length: 200 }, () => {
  const leverage = 1n + rand(1000);
  return {
    entryPrice: (1_000n + rand(100_000)) * 10n ** 18n + rand(1e9),
    leverage,
    bufferBps: Math.floor(Math.random() * 20), // incluye casos donde el buffer pasa a equity cero
    isLong: Math.random() < 0.5,
  };
});
let mismatches = 0;
for (const p of cases) {
  const liq = liquidationPrice(p, p.bufferBps);
  for (const price of [liq - 1n, liq, liq + 1n]) {
    const onchain = await client.readContract({
      address: pnlMath,
      abi: pnlAbi,
      functionName: "isLiquidatable",
      args: [p.entryPrice, p.leverage, BigInt(p.bufferBps), p.isLong, price],
    });
    if (onchain !== isLiquidatable(p, p.bufferBps, price)) mismatches++;
  }
}
check(mismatches === 0, `precio de liquidación igual a PnLMath en ${cases.length} casos × 3 precios (${mismatches} diferencias)`);

process.exit(failures ? 1 : 0);
