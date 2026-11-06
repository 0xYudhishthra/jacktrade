import { createWalletClient, custom, getAddress } from "viem";
import { robinhood, publicClient } from "./chain.js";
import { CHAIN_ID, EXPLORER_URL, RPC_URL } from "./config.js";

const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

export function walletClient(account) {
  if (!hasWallet()) throw new Error("No browser wallet found. Install MetaMask, Rabby or similar.");
  return createWalletClient({ account, chain: robinhood, transport: custom(window.ethereum) });
}

export async function requestAccount() {
  if (!hasWallet()) throw new Error("No browser wallet found. Install MetaMask, Rabby or similar.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("Wallet returned no accounts");
  return getAddress(accounts[0]);
}

export async function currentAccount() {
  if (!hasWallet()) return null;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    return accounts?.length ? getAddress(accounts[0]) : null;
  } catch {
    return null;
  }
}

function addChainParams() {
  const params = {
    chainId: CHAIN_HEX,
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [RPC_URL],
  };
  if (EXPLORER_URL) params.blockExplorerUrls = [EXPLORER_URL];
  return params;
}

export async function ensureChain() {
  const eth = window.ethereum;
  const current = await eth.request({ method: "eth_chainId" });
  if (parseInt(current, 16) === CHAIN_ID) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (err) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === 4902 || /unrecognized|not been added|unknown chain/i.test(err?.message || "")) {
      await eth.request({ method: "wallet_addEthereumChain", params: [addChainParams()] });
    } else {
      throw err;
    }
  }
  const after = await eth.request({ method: "eth_chainId" });
  if (parseInt(after, 16) !== CHAIN_ID) throw new Error("Please switch your wallet to Robinhood Chain (4663)");
}

export function onWalletChange(cb) {
  if (!hasWallet() || !window.ethereum.on) return () => {};
  const handler = () => cb();
  window.ethereum.on("accountsChanged", handler);
  window.ethereum.on("chainChanged", handler);
  return () => {
    window.ethereum.removeListener?.("accountsChanged", handler);
    window.ethereum.removeListener?.("chainChanged", handler);
  };
}

/** Send a raw {to,data,value} tx from the connected account and wait for it to land. */
export async function sendAndWait(account, tx, onHash) {
  await ensureChain();
  const wc = walletClient(account);
  const hash = await wc.sendTransaction({
    account,
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
export async function signTypedDataJson(account, typedDataJson) {
  const parsed = JSON.parse(typedDataJson);
  const { EIP712Domain: _ignored, ...types } = parsed.types || {};
  const domain = { ...parsed.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  await ensureChain();
  return walletClient(account).signTypedData({
    account,
    domain,
    types,
    primaryType: parsed.primaryType,
    message: parsed.message,
  });
}

export function errMsg(err) {
  if (!err) return "Unknown error";
  if (err.code === 4001 || /user rejected|user denied/i.test(err.message || "")) return "Rejected in wallet";
  return err.shortMessage || err.details || err.message || String(err);
}
