// Hackathon addition (ETHGlobal Mumbai 2026): the Grok pages use the exchange's own wallet (AppKit picker, kept in
// the TradingSession context) instead of a second wallet integration. These helpers wrap it for raw transactions and
// JSON EIP-712 payloads (Definitive Flash), always switching to Robinhood Chain first.
import { useTradingSession } from "@/hooks/useTradingSession";
import { useProductUI } from "@/components/product/ProductUI";
import { publicClientFor, switchToRobinhood } from "@/lib/jacktradeClient";
import { CHAIN_ID } from "./config.js";

export const publicClient = publicClientFor({ chainId: CHAIN_ID });

/** The connected wallet, from the exchange's session. `connect()` opens the app's wallet picker. */
export function useGrokWallet() {
  const { walletAddress, walletConnected, account, backendConfig } = useTradingSession();
  const { setModal } = useProductUI();
  const address = walletConnected ? walletAddress ?? null : null;
  return {
    address,
    walletClient: account.walletClient ?? null,
    provider: account.walletProvider ?? null,
    config: backendConfig ?? null,
    balance: account.balance,
    connect: () => setModal({ type: "wallet" }),
    deposit: () => setModal({ type: "deposit-trade" }),
  };
}

function requireWallet(w) {
  if (!w?.address || !w?.walletClient) throw new Error("Connect your wallet first.");
}

export async function ensureChain(w) {
  if (w?.provider) await switchToRobinhood(w.provider, CHAIN_ID);
}

/** Send a raw {to,data,value} tx from the connected account and wait for it to land. */
export async function sendAndWait(w, tx, onHash) {
  requireWallet(w);
  await ensureChain(w);
  const hash = await w.walletClient.sendTransaction({
    account: w.address,
    to: tx.to,
    data: tx.data || "0x",
    value: tx.value ? BigInt(tx.value) : 0n,
  });
  onHash?.(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return hash;
}

/**
 * Sign an EIP-712 payload given as a JSON string (Definitive Flash style).
 * chainId arrives as a string ("4663"); wallets want a number. The hash is identical.
 */
export async function signTypedDataJson(w, typedDataJson) {
  requireWallet(w);
  const parsed = JSON.parse(typedDataJson);
  // viem derives EIP712Domain from `domain`; passing it in `types` too makes it reject the payload.
  const types = { ...(parsed.types || {}) };
  delete types.EIP712Domain;
  const domain = { ...parsed.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  await ensureChain(w);
  return w.walletClient.signTypedData({
    account: w.address,
    domain,
    types,
    primaryType: parsed.primaryType,
    message: parsed.message,
  });
}

export function errMsg(err) {
  if (!err) return "Unknown error";
  if (err.code === 4001 || err.cause?.code === 4001 || /user rejected|user denied/i.test(err.message || ""))
    return "Rejected in wallet";
  return err.shortMessage || err.details || err.message || String(err);
}
