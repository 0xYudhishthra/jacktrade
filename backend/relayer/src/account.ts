import type { getNetwork } from "@hm/shared";
import { createWalletClient, type Account, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Wallet con la que el relayer firma y paga los batches.
 * - Con `RELAYER_PRIVATE_KEY` en el entorno, usa esa clave (mainnet; en producción va en el gestor de secretos).
 * - En el fork, sin clave, usa la cuenta 1 de anvil, que está desbloqueada (la que `setup:fork` autoriza como relayer).
 */
export async function relayerWallet({ name, chain, transport }: ReturnType<typeof getNetwork>): Promise<WalletClient & { account: Account }> {
  const key = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  // El fork usa el chain id y los nonces de mainnet: algo firmado ahí con una clave real se puede reenviar a mainnet.
  if (key && name === "fork") throw new Error("RELAYER_PRIVATE_KEY está cargada y NETWORK=fork: sacala del entorno para usar el fork");
  if (key) return createWalletClient({ account: privateKeyToAccount(key), chain, transport });
  if (name !== "fork") throw new Error("Falta RELAYER_PRIVATE_KEY: en mainnet el relayer necesita su clave");

  const accounts = await createWalletClient({ chain, transport }).getAddresses();
  const address = accounts[1];
  if (!address) throw new Error("El fork no tiene la cuenta 1 de anvil");
  return createWalletClient({ account: { address, type: "json-rpc" }, chain, transport }) as WalletClient & { account: Account };
}
