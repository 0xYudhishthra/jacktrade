import type { getNetwork } from "@hm/shared";
import { createWalletClient, type Account, type Hex, type WalletClient } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

/**
 * Wallet del liquidador, separada de la del relayer: si una se queda sin ETH o se compromete, la otra sigue.
 * - Con `LIQUIDATOR_PRIVATE_KEY`, usa esa clave (mainnet; en producción va en el gestor de secretos).
 * - En el fork, sin clave, usa la cuenta 5 de anvil (desbloqueada; `setup:fork` le borra el código EIP-7702).
 */
export async function liquidatorWallet({ name, chain, transport }: ReturnType<typeof getNetwork>): Promise<WalletClient & { account: Account }> {
  const key = process.env.LIQUIDATOR_PRIVATE_KEY as Hex | undefined;
  // El fork usa el chain id y los nonces de mainnet: algo firmado ahí con una clave real se puede reenviar a mainnet.
  if (key && name === "fork") throw new Error("LIQUIDATOR_PRIVATE_KEY está cargada y NETWORK=fork: sacala del entorno para usar el fork");
  if (key && process.env.RELAYER_PRIVATE_KEY && key.toLowerCase() === process.env.RELAYER_PRIVATE_KEY.toLowerCase()) {
    throw new Error("el liquidador no puede usar la misma clave que el relayer (se pisarían los nonces)");
  }
  // nonceManager: el liquidador manda dos transacciones seguidas sin esperar la primera.
  if (key) return createWalletClient({ account: privateKeyToAccount(key, { nonceManager }), chain, transport });
  if (name !== "fork") throw new Error("Falta LIQUIDATOR_PRIVATE_KEY: en mainnet el liquidador necesita su clave");

  const address = (await createWalletClient({ chain, transport }).getAddresses())[5];
  if (!address) throw new Error("El fork no tiene la cuenta 5 de anvil");
  return createWalletClient({ account: { address, type: "json-rpc" }, chain, transport }) as WalletClient & { account: Account };
}
