// Reown AppKit: the wallet picker (hundreds of wallets, WalletConnect QR for phones, email and social login as the
// fallback). It only hands back the chosen wallet's EIP-1193 provider; connecting, sessions and signing stay in
// jacktradeClient. Loaded on the first "Connect": the library is large.
import { EXPLORER_URL, RPC_URL } from "./backend.js";
import { TRUSTED } from "./jacktradeClient.js";

export const APPKIT_PROJECT_ID = import.meta.env?.VITE_REOWN_PROJECT_ID ?? "";

let loading = null;

async function load() {
  const [{ createAppKit }, { WagmiAdapter }, core] = await Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit-adapter-wagmi"),
    import("@wagmi/core"),
  ]);
  const robinhood = {
    id: TRUSTED.chainId,
    caipNetworkId: `eip155:${TRUSTED.chainId}`,
    chainNamespace: "eip155",
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
    ...(EXPLORER_URL ? { blockExplorers: { default: { name: "Explorer", url: EXPLORER_URL } } } : {}),
  };
  const adapter = new WagmiAdapter({ projectId: APPKIT_PROJECT_ID, networks: [robinhood] });
  const kit = createAppKit({
    adapters: [adapter],
    networks: [robinhood],
    defaultNetwork: robinhood,
    // A wallet left on another chain (after a cross-chain deposit, say) is fine: the app asks to switch back only
    // before a Robinhood Chain signature. AppKit's own "unsupported network" screen would block the app instead.
    allowUnsupportedChain: true,
    projectId: APPKIT_PROJECT_ID,
    metadata: {
      name: "JackTrade",
      description: "Leveraged trading on Robinhood Chain.",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    },
    themeMode: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    themeVariables: { "--w3m-accent": "#5b82c4", "--w3m-font-family": "Inter, system-ui, sans-serif", "--w3m-border-radius-master": "2px" },
    // Wallets first; email and Google / X / Apple as the alternative. Nothing else from the kit.
    features: { analytics: false, email: true, socials: ["google", "x", "apple"], emailShowWallets: true, connectMethodsOrder: ["wallet", "email", "social"], swaps: false, onramp: false, send: false, history: false },
    // MetaMask, Rabby, Coinbase Wallet, Phantom, Trust Wallet (WalletConnect explorer ids).
    featuredWalletIds: [
      "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
      "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1",
      "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
      "a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393",
      "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
    ],
  });
  return { kit, config: adapter.wagmiConfig, core };
}

// A wallet that connected here stays connected across reloads until the user disconnects.
const REMEMBER_KEY = "hm.wallet.remember";
export const rememberWallet = (on) => { try { if (on) localStorage.setItem(REMEMBER_KEY, "1"); else localStorage.removeItem(REMEMBER_KEY); } catch { /* optional */ } };
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) === "1"; } catch { return false; } };

async function settledAccount(config, core) {
  // AppKit reconnects the last wallet on load: wait for that to settle.
  const current = core.getAccount(config);
  if (current.status !== "reconnecting" && current.status !== "connecting") return current;
  return new Promise((settle) => {
    const stop = core.watchAccount(config, { onChange: (account) => { if (account.status === "connected" || account.status === "disconnected") { stop(); settle(account); } } });
    setTimeout(() => { stop(); settle(core.getAccount(config)); }, 3000);
  });
}

/** On page load: the remembered wallet's provider, without any prompt; null if there is none or it is gone. */
export async function restoreWallet() {
  if (!APPKIT_PROJECT_ID || !remembered()) return null;
  const { config, core } = await (loading ??= load());
  let account = await settledAccount(config, core);
  // An extension that announced itself after AppKit loaded is not picked up by its own reconnect: ask wagmi again.
  if (!account.isConnected) {
    await core.reconnect(config).catch(() => []);
    account = core.getAccount(config);
  }
  // Not reconnected (wallet locked, extension slow): keep the preference; only "Disconnect" forgets it.
  if (!account.isConnected || !account.connector) return null;
  return account.connector.getProvider();
}

/** Opens the picker and resolves with the chosen wallet's provider; rejects (code 4001) if the user closes it. */
export async function pickWallet() {
  const { kit, config, core } = await (loading ??= load());
  kit.setThemeMode(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  // Don't open the picker over a wallet AppKit is still reconnecting, and reuse a connection it already holds:
  // otherwise the wallet says "already linked" while the app shows no wallet.
  let current = await settledAccount(config, core);
  if (!current.isConnected) {
    await core.reconnect(config).catch(() => []);
    current = core.getAccount(config);
  }
  if (current.isConnected && current.connector) return current.connector.getProvider();
  // A stale connection that can't be resumed: drop it so the wallet can be linked again from the picker.
  if (config.state.connections.size) await core.disconnect(config).catch(() => {});
  return new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    let done = false;
    const finish = (fn) => { if (settled) return; settled = true; stopAccount(); stopModal(); fn(); };
    const stopAccount = core.watchAccount(config, {
      onChange: (account) => {
        if (!account.isConnected || !account.connector) return;
        account.connector.getProvider().then((provider) => finish(() => { done = true; kit.close(); resolve(provider); }), (error) => finish(() => reject(error)));
      },
    });
    const stopModal = kit.subscribeState((state) => {
      if (state.open) opened = true;
      // Closed without a wallet: give a just-approved connection a moment to land before calling it cancelled.
      else if (opened) setTimeout(() => { if (!core.getAccount(config).isConnected) finish(() => reject(Object.assign(new Error("Wallet connection cancelled."), { code: 4001 }))); }, 600);
    });
    // open() is async: a wallet that connects while it opens would leave the picker up over the app.
    Promise.resolve(kit.open({ view: "Connect" })).then(() => { if (done) kit.close(); });
  });
}

/** Ends the AppKit session too, so the next "Connect" shows the picker again. */
export async function forgetWallet() {
  rememberWallet(false);
  if (!loading) return;
  const { config, core } = await loading;
  await core.disconnect(config).catch(() => {});
}
