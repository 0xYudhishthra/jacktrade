import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { API_URL, EXPLORER_URL, RELAYER_URL, RPC_URL, requestJson } from "./backend.js";

const SESSION_STORAGE_KEY = "hm.session-key.v1";
const SESSION_KEY_ABI = [
  { type: "function", name: "isValidSessionKey", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "key", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "revokeSessionKey", stateMutability: "nonpayable", inputs: [{ name: "key", type: "address" }], outputs: [] },
  { type: "function", name: "epochOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint64" }] },
];
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
];
const STAKING_ABI = [
  { type: "function", name: "stakeOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "accrued", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
];

export const REJECT_MESSAGES = {
  BadRequest: "The request is invalid.", InvalidSignature: "Your session expired or was revoked. Connect it again.",
  NonceAlreadyUsed: "This request was already sent.", IntentExpired: "The request expired. Try again.",
  TooOld: "The request took too long. Try again.", TradingIsPaused: "Trading is paused.",
  MarketNotListed: "This market is not available yet.", MarketIsRetired: "This market was retired.",
  InvalidLeverage: "Choose leverage within this market's limits.", InvalidSize: "The position size is outside this market's limits.",
  InsufficientBalance: "Insufficient available balance. Deposit USDG to continue.", OiCapExceeded: "Open interest is full on this side.",
  NoPrice: "No fresh price is available. Try again.", PriceTooOld: "The price is stale. Try again.",
  PriceUncertain: "Price confidence is too wide. Wait a few seconds.", PriceJump: "The price moved too quickly. Try again.",
  PriceLimitExceeded: "The price moved beyond your tolerance.", PositionNotFound: "This position no longer exists.",
  NotPositionOwner: "This position belongs to another wallet.", PositionLiquidatable: "The position crossed liquidation and will be closed by the liquidator.",
  SignatureExpired: "The wallet signature expired. Try again.", BelowMinimum: "The amount is below the protocol minimum.",
  InvalidKey: "The session key is invalid.", InvalidExpiry: "The session duration is invalid.", StaleEpoch: "Your sessions were reset. Please try again.",
  InsufficientStake: "You do not have enough HOUSE staked.", NothingToClaim: "There are no rewards to claim.",
  ZeroAmount: "Enter an amount greater than zero.", NotActivated: "Deposit USDG before enabling this action.",
  RateLimited: "Too many requests. Wait a moment.", Timeout: "The relayer took too long. Refresh your account before trying again.",
  Unknown: "The request failed. Try again.",
};

export class RelayerError extends Error {
  constructor(code, detail) {
    super(REJECT_MESSAGES[code] ?? detail ?? REJECT_MESSAGES.Unknown);
    this.name = "RelayerError";
    this.code = code ?? "Unknown";
    this.detail = detail;
  }
}

export function chainFor(config) {
  return defineChain({
    id: config.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
    ...(EXPLORER_URL ? { blockExplorers: { default: { name: "Explorer", url: EXPLORER_URL } } } : {}),
  });
}

export function publicClientFor(config) {
  return createPublicClient({ chain: chainFor(config), transport: http(RPC_URL) });
}

// /config sends market amounts in raw USDG units (6 decimals); the UI works in whole USDG.
export function normalizeConfig(config) {
  const usdg = (raw) => formatUnits(BigInt(raw ?? 0), config.collateral.decimals);
  const markets = config.markets.map((m) => ({ ...m, minMargin: usdg(m.minMargin), minNotional: usdg(m.minNotional), maxNotional: usdg(m.maxNotional) }));
  return { ...config, markets };
}

// The deployed contracts. Everything the wallet or the session key signs points at these, so they are fixed here and the
// relayer's /config must match them: a compromised relayer could otherwise ask for a USDG permit to another spender.
// After a contracts redeploy, update them (or set the VITE_* overrides) together with the backend.
const env = import.meta.env ?? {};
export const TRUSTED = {
  chainId: Number(env.VITE_CHAIN_ID ?? 4663),
  Exchange: env.VITE_EXCHANGE ?? "0x698cf1a9220f89ccf6ee75269086288a623ede54",
  SessionKeyManager: env.VITE_SESSION_KEY_MANAGER ?? "0xe82bb6f411a9a53170f9c4fff53207eb80b7bb29",
  JackTradeStaking: env.VITE_STAKING ?? "0xbe4fe6490c3feb50bfb347ac5ce641673e25d0bd",
  collateral: env.VITE_USDG ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  token: env.VITE_JACKTRADE ?? "0x10f1fd34d2b3b1b6e5a56b4e08e44d25d9df7a76",
};

const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Throws unless /config points at the trusted chain and contracts, with the expected EIP-712 domains. */
export function assertTrustedConfig(config, trusted = TRUSTED) {
  const domain = (d, name, contract) => d?.name === name && d?.version === "1" && Number(d?.chainId) === trusted.chainId && sameAddress(d?.verifyingContract, contract);
  const problems = [
    Number(config?.chainId) === trusted.chainId || "chainId",
    sameAddress(config?.contracts?.Exchange, trusted.Exchange) || "Exchange",
    sameAddress(config?.contracts?.SessionKeyManager, trusted.SessionKeyManager) || "SessionKeyManager",
    sameAddress(config?.contracts?.JackTradeStaking, trusted.JackTradeStaking) || "JackTradeStaking",
    sameAddress(config?.collateral?.address, trusted.collateral) || "collateral",
    Number(config?.collateral?.decimals) === 6 || "collateral decimals",
    sameAddress(config?.token?.address, trusted.token) || "token",
    Number(config?.token?.decimals) === 18 || "token decimals",
    domain(config?.eip712?.domain, "JackTrade Exchange", trusted.Exchange) || "Exchange domain",
    domain(config?.eip712Actions?.sessionKeys?.domain, "JackTrade SessionKeyManager", trusted.SessionKeyManager) || "session key domain",
    domain(config?.eip712Actions?.staking?.domain, "JackTrade Staking", trusted.JackTradeStaking) || "staking domain",
  ].filter((p) => p !== true);
  if (problems.length) throw new Error(`The relayer config does not match the JACKTRADE contracts (${problems.join(", ")}). Trading is disabled; please reload later.`);
  return config;
}

export async function loadConfig() {
  const config = normalizeConfig(assertTrustedConfig(await requestJson(`${RELAYER_URL}/config`)));
  return { ...config, relayerUrl: RELAYER_URL, clockOffset: config.chainTime - Date.now() / 1000 };
}

export function chainNow(config) {
  return BigInt(Math.floor(Date.now() / 1000 + config.clockOffset));
}

export function newNonce() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  return BigInt(Date.now()) * 10_000_000_000n + BigInt(random);
}

export function createSessionKey() {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

// One slot per wallet, so switching wallets never forgets (and strands) another wallet's live key.
const sessionSlot = (user) => `${SESSION_STORAGE_KEY}:${user.toLowerCase()}`;

export function readStoredSessionKey(user) {
  try {
    const stored = JSON.parse(localStorage.getItem(sessionSlot(user)));
    return stored?.user?.toLowerCase() === user.toLowerCase() ? stored : null;
  } catch { return null; }
}

export function storeSessionKey(user, key, expiry) {
  localStorage.setItem(sessionSlot(user), JSON.stringify({ user, ...key, expiry: Number(expiry) }));
  localStorage.removeItem(SESSION_STORAGE_KEY); // the old single slot
}

export function clearSessionKey(user) {
  if (user) localStorage.removeItem(sessionSlot(user));
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function switchToRobinhood(provider, chainId = TRUSTED.chainId) {
  const chain = chainFor({ chainId });
  const id = `0x${chainId.toString(16)}`;
  // Already there (the usual case before a trade): no wallet round trip.
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (current != null && Number(current) === chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] });
  } catch (error) {
    // Unknown chain is 4902, but some wallets (MetaMask mobile, others) wrap it or use another code: only a rejection
    // by the user stops here; anything else tries to add Robinhood Chain.
    if (error.code === 4001 || error.data?.originalError?.code === 4001) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: id, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC_URL], ...(chain.blockExplorers ? { blockExplorerUrls: [chain.blockExplorers.default.url] } : {}) }] });
  }
}

export async function connectInjectedWallet(config, provider = window.ethereum) {
  if (!provider) throw new Error("This wallet is not installed in your browser.");
  // No wallet prompt here: the picker already linked the account, and every signature switches to Robinhood Chain
  // first. A phone wallet reached over WalletConnect needs a trip to its app per request, and one sent right after
  // connecting never reaches the user: connecting would hang.
  const walletClient = createWalletClient({ chain: chainFor(config), transport: custom(provider) });
  const linked = await walletClient.getAddresses().catch(() => []);
  const [user] = linked.length ? linked : await walletClient.requestAddresses();
  return { user, walletClient, publicClient: publicClientFor(config), provider };
}

export async function isValidSessionKey(config, user, key) {
  return publicClientFor(config).readContract({ address: config.contracts.SessionKeyManager, abi: SESSION_KEY_ABI, functionName: "isValidSessionKey", args: [user, key] });
}

export function priceLimit(quote, { isLong, closing = false, slippageBps = 50 }) {
  if (!quote) throw new RelayerError("NoPrice");
  const exponent = 18 + Number(quote.expo);
  const wad = exponent >= 0 ? BigInt(quote.price) * 10n ** BigInt(exponent) : BigInt(quote.price) / 10n ** BigInt(-exponent);
  const buying = closing ? !isLong : isLong;
  return buying ? (wad * BigInt(10_000 + slippageBps)) / 10_000n : (wad * BigInt(10_000 - slippageBps)) / 10_000n;
}

function bigintJson(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "bigint" ? item.toString() : item]));
}

async function submitAndWait(config, route, body, onStatus, timeoutMs = 20_000) {
  const accepted = await requestJson(`${config.relayerUrl}/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch((error) => {
    throw new RelayerError(error.code, error.message);
  });
  if (accepted.status === "rejected") throw new RelayerError(accepted.code, accepted.message);
  onStatus?.(accepted.status);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    // A failed status read is not a failed trade: the intent may still execute, so keep asking until the timeout.
    const status = await requestJson(`${config.relayerUrl}/${route}/${accepted.id}`).catch(() => ({ status: "unknown" }));
    onStatus?.(status.status);
    if (status.status === "executed") return status;
    if (status.status === "failed") throw new RelayerError(status.code, status.message);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the relayer answers within a block or two
  }
  throw new RelayerError("Timeout");
}

async function submitIntent(config, signer, kind, intent, onStatus) {
  const primaryType = kind === "open" ? "Open" : "Close";
  const signature = await signer.signTypedData({ domain: config.eip712.domain, types: { [primaryType]: config.eip712.types[primaryType] }, primaryType, message: intent });
  return submitAndWait(config, "intent", { kind, intent: bigintJson(intent), signature }, onStatus);
}

export async function openPosition(config, { user, privateKey, instrumentId, isLong, margin, leverage, quote, slippageBps = 50, onStatus }) {
  const intent = { user, instrumentId, isLong, margin: BigInt(margin), leverage: BigInt(leverage), priceLimit: priceLimit(quote, { isLong, slippageBps }), signedAt: chainNow(config), nonce: newNonce() };
  return submitIntent(config, privateKeyToAccount(privateKey), "open", intent, onStatus);
}

export async function closePosition(config, { user, privateKey, positionId, isLong, quote, slippageBps = 50, onStatus }) {
  const intent = { user, positionId: BigInt(positionId), priceLimit: priceLimit(quote, { isLong, closing: true, slippageBps }), signedAt: chainNow(config), nonce: newNonce() };
  return submitIntent(config, privateKeyToAccount(privateKey), "close", intent, onStatus);
}

function actionTypedData(config, item) {
  const { kind, action } = item;
  if (kind === "withdraw") return { domain: config.eip712.domain, types: { Withdraw: config.eip712.types.Withdraw }, primaryType: "Withdraw", message: action };
  if (kind === "registerSessionKey") return { domain: config.eip712Actions.sessionKeys.domain, types: { RegisterSessionKey: config.eip712Actions.sessionKeys.types.RegisterSessionKey }, primaryType: "RegisterSessionKey", message: action };
  const primaryType = kind[0].toUpperCase() + kind.slice(1);
  return { domain: config.eip712Actions.staking.domain, types: { [primaryType]: config.eip712Actions.staking.types[primaryType] }, primaryType, message: action };
}

export async function submitWalletAction(config, walletClient, user, kind, fields, onStatus) {
  const action = { user, ...fields, nonce: fields.nonce ?? newNonce(), deadline: fields.deadline ?? chainNow(config) + 600n };
  const item = { kind, action };
  const signature = await walletClient.signTypedData({ account: user, ...actionTypedData(config, item) });
  return submitAndWait(config, "action", { kind, action: bigintJson(action), signature }, onStatus);
}

export async function registerSession(config, walletClient, user, onStatus) {
  const key = createSessionKey();
  const expiry = chainNow(config) + BigInt(config.limits.sessionKeyMaxDuration);
  // The signature is bound to the current epoch: revokeAllSessionKeys bumps it and kills unsubmitted registrations.
  const epoch = await publicClientFor(config).readContract({ address: config.contracts.SessionKeyManager, abi: SESSION_KEY_ABI, functionName: "epochOf", args: [user] });
  await submitWalletAction(config, walletClient, user, "registerSessionKey", { key: key.address, expiry, epoch }, onStatus);
  storeSessionKey(user, key, expiry);
  return { ...key, expiry: Number(expiry) };
}

export async function revokeSession(config, walletClient, user, key) {
  const hash = await walletClient.writeContract({ account: user, address: config.contracts.SessionKeyManager, abi: SESSION_KEY_ABI, functionName: "revokeSessionKey", args: [key] });
  await publicClientFor(config).waitForTransactionReceipt({ hash });
  clearSessionKey(user);
  return hash;
}

export async function depositWithPermit(config, walletClient, user, amount, onStatus) {
  const client = publicClientFor(config);
  const nonce = await client.readContract({ address: config.collateral.address, abi: ERC20_ABI, functionName: "nonces", args: [user] });
  const deadline = chainNow(config) + 600n;
  const value = parseUnits(String(amount), config.collateral.decimals);
  const domain = { name: "Global Dollar", version: "1", chainId: config.chainId, verifyingContract: config.collateral.address };
  const types = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  const signature = await walletClient.signTypedData({ account: user, domain, types, primaryType: "Permit", message: { owner: user, spender: config.contracts.Exchange, value, nonce, deadline } });
  return submitAndWait(config, "action", { kind: "depositPermit", action: bigintJson({ user, amount: value, nonce, deadline }), signature }, onStatus);
}

const ACTIVATED_ABI = [{ type: "function", name: "activated", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }] }];

export async function fetchProtocolData(config, user) {
  // Protocol totals and the mint rate are extras: if one fails, the user's own account still refreshes (they come back null).
  const optional = (url) => requestJson(url).catch(() => null);
  const [account, positions, history, markets, stats, rate] = await Promise.all([
    requestJson(`${API_URL}/api/account/${user}`), requestJson(`${API_URL}/api/positions/${user}`),
    requestJson(`${API_URL}/api/history/${user}`), requestJson(`${API_URL}/api/markets`),
    optional(`${API_URL}/api/stats`), optional(`${API_URL}/api/rate`),
  ]);
  const client = publicClientFor(config);
  const [walletCollateral, token, staked, claimable, activated] = await Promise.all([
    client.readContract({ address: config.collateral.address, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: config.token.address, abi: ERC20_ABI, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: config.contracts.JackTradeStaking, abi: STAKING_ABI, functionName: "stakeOf", args: [user] }),
    client.readContract({ address: config.contracts.JackTradeStaking, abi: STAKING_ABI, functionName: "accrued", args: [user] }),
    // The first deposit also pays the one-time activation fee.
    client.readContract({ address: config.contracts.Exchange, abi: ACTIVATED_ABI, functionName: "activated", args: [user] }).catch(() => null),
  ]);
  return { account, positions, history: history.items, historyNext: history.next, markets, stats, rate, walletCollateral: formatUnits(walletCollateral, config.collateral.decimals), token: formatUnits(token, config.token.decimals), staked: formatUnits(staked, config.token.decimals), claimable: formatUnits(claimable, config.collateral.decimals), activated };
}

export async function fetchPreview(positionId) { return requestJson(`${API_URL}/api/preview/${positionId}`); }
export async function fetchLeaderboard(by = "pnl") { return requestJson(`${API_URL}/api/leaderboard?by=${by}&limit=50`); }
export { formatUnits, parseUnits };
