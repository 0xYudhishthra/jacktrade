import type { getNetwork } from "@hm/shared";
import { createWalletClient, type Account, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Wallet de los keepers, separada de la del relayer y la del liquidador: si una se queda sin ETH o se compromete,
 * las otras siguen. Para `heartbeat` tiene que estar en `BatchExecutor.isRelayer` (owner: `setRelayer`).
 * - Con `KEEPER_PRIVATE_KEY`, usa esa clave (mainnet; en producción va en el gestor de secretos).
 * - En el fork, sin clave, usa la cuenta 6 de anvil (desbloqueada; `setup:fork` la registra y le borra el código EIP-7702).
 */
export async function keeperWallet({ name, chain, transport }: ReturnType<typeof getNetwork>): Promise<WalletClient & { account: Account }> {
  const key = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  // El fork usa el chain id y los nonces de mainnet: algo firmado ahí con una clave real se puede reenviar a mainnet.
  if (key && name === "fork") throw new Error("KEEPER_PRIVATE_KEY está cargada y NETWORK=fork: sacala del entorno para usar el fork");
  for (const other of ["RELAYER_PRIVATE_KEY", "LIQUIDATOR_PRIVATE_KEY"]) {
    if (key && process.env[other] && key.toLowerCase() === process.env[other]!.toLowerCase()) {
      throw new Error(`los keepers no pueden usar la misma clave que ${other} (se pisarían los nonces)`);
    }
  }
  if (key) return createWalletClient({ account: privateKeyToAccount(key), chain, transport });
  if (name !== "fork") throw new Error("Falta KEEPER_PRIVATE_KEY: en mainnet los keepers necesitan su clave");

  const address = (await createWalletClient({ chain, transport }).getAddresses())[6];
  if (!address) throw new Error("El fork no tiene la cuenta 6 de anvil");
  return createWalletClient({ account: { address, type: "json-rpc" }, chain, transport }) as WalletClient & { account: Account };
}
