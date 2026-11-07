# JackTrade profiles: frontend integration

Wallet-linked public profiles with a unique, editable `username`. The wallet is the identity: every change is signed by the wallet that owns the profile. No contract changes.

## Base URL

| Environment | URL |
| --- | --- |
| Production | `https://jt-indexer-production.up.railway.app` |
| Local fork | `http://localhost:8096` (`NETWORK=fork pnpm indexer`) |

Same server as the rest of the read API (`/api/account`, `/api/positions`, `/api/leaderboard`…).

## Flow

1. `GET /api/profile/:wallet` with the connected wallet.
2. The user picks a username. Call `POST /api/profile/challenge` with `{ wallet, username }`.
3. Sign the returned `typedData` with the wallet (`eth_signTypedData_v4`). If the wallet cannot sign typed data, sign the returned `message` with `personal_sign` instead; both are accepted.
4. Call `PUT /api/profile/username` with `{ wallet, username, challengeId, signature }`.
5. Use the returned profile. It is stored server-side: it shows up on any browser or device.

Never ask for private keys. The signature is single-use: the challenge is consumed when the username is saved.

## Endpoints

### `GET /api/profile/:wallet`

```json
{ "wallet": "0x1234...abcd", "username": "house.trader", "createdAt": "2026-10-21T15:00:00.000Z", "updatedAt": "2026-10-21T15:00:00.000Z" }
```

If the wallet has no username yet, the response is still `200`:

```json
{ "wallet": "0x1234...abcd", "username": null, "createdAt": null, "updatedAt": null }
```

`wallet` is always returned in lowercase.

### `GET /api/profile/by-username/:username`

Resolves `/u/:username` to a wallet, then use the existing endpoints (`/api/account/:wallet`, `/api/positions/:wallet`, `/api/history/:wallet`). Case-insensitive (`/u/House.Trader` works). Same response shape as above. If nobody has that name, it returns `404` with `PROFILE_NOT_FOUND`.

### `POST /api/profile/challenge`

Request:

```json
{ "wallet": "0x1234...abcd", "username": "house.trader" }
```

Response `200`:

```json
{
  "challengeId": "7fb92d7a-1c2e-4b8f-9a1d-0e5f6a7b8c9d",
  "message": "JACKTRADE profile\nWallet: 0x1234...AbCd\nUsername: house.trader\nNonce: 0x5f2c…\nExpires: 2026-10-21T15:10:00.000Z\nChain ID: 4663",
  "typedData": {
    "domain": { "name": "JackTrade Profile", "version": "1", "chainId": 4663 },
    "types": {
      "SetUsername": [
        { "name": "wallet", "type": "address" },
        { "name": "username", "type": "string" },
        { "name": "nonce", "type": "bytes32" },
        { "name": "expires", "type": "uint256" }
      ]
    },
    "primaryType": "SetUsername",
    "message": { "wallet": "0x1234...AbCd", "username": "house.trader", "nonce": "0x5f2c…", "expires": "1792602600" }
  },
  "expiresAt": "2026-10-21T15:10:00.000Z"
}
```

- The challenge expires in **10 minutes** and works **once**.
- If the name already belongs to another wallet, it fails right away with `409 USERNAME_TAKEN`, so you can use this call as an availability check.
- `typedData.message.expires` comes as a string (JSON has no bigint): pass `BigInt(expires)` to viem.
- The domain has **no `verifyingContract`** (no contract involved).

### `PUT /api/profile/username`

Request:

```json
{ "wallet": "0x1234...abcd", "username": "house.trader", "challengeId": "7fb92d7a-…", "signature": "0x…" }
```

Response `200`: the updated profile (same shape as `GET`). Setting the same username again is a no-op that returns the profile.

## Example (viem)

```js
const API = import.meta.env.VITE_API_URL; // https://jt-indexer-production.up.railway.app

async function setUsername(walletClient, wallet, username) {
  const ch = await fetch(`${API}/api/profile/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, username }),
  }).then(asJson);

  const { domain, types, primaryType, message } = ch.typedData;
  const signature = await walletClient.signTypedData({
    account: wallet,
    domain,
    types,
    primaryType,
    message: { ...message, expires: BigInt(message.expires) },
  });
  // Fallback for wallets without typed-data support:
  // const signature = await walletClient.signMessage({ account: wallet, message: ch.message });

  return fetch(`${API}/api/profile/username`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, username, challengeId: ch.challengeId, signature }),
  }).then(asJson);
}

async function asJson(res) {
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.message), { code: body.code, status: res.status });
  return body;
}
```

## Which wallets work

| Wallet type | How it is verified |
| --- | --- |
| EOA (MetaMask, Rabby…) | The signer recovered from the signature is the wallet |
| Smart wallet (Safe, Coinbase Smart Wallet…) | ERC-1271 `isValidSignature` on the wallet contract, on Robinhood Chain (counterfactual ERC-6492 wallets too) |
| EOA with an EIP-7702 delegation | Accepted by either path: the EOA key still controls it |

Tested end to end with an EOA and a deployed ERC-1271 contract wallet.

## Username rules

- 3 to 24 characters: lowercase letters, numbers, `.`, `-` and `_`, starting with a letter or number: `^[a-z0-9][a-z0-9._-]{2,23}$`.
- Case-insensitive: the input is lowercased (`House.Trader` → `house.trader`). Show the user the lowercase version.
- Globally unique. One active username per wallet: changing it frees the old one.
- Reserved: system and brand names (`admin`, `support`, `jacktrade`, `jack.trade`, `relayer`, `official`, `api`, `null`…) and anything that starts with `jacktrade`.
- Cannot look like an address (`0x` followed by hex).
- **Changes:** setting it the first time is free; after that, **one change every 24 hours** (`CHANGE_TOO_SOON` says when the next change is allowed).

## Errors

All errors have the same shape:

```json
{ "code": "USERNAME_TAKEN", "message": "This username is already in use." }
```

| HTTP | `code` | When | Suggested UI |
| --- | --- | --- | --- |
| 400 | `INVALID_REQUEST` | Bad wallet, missing or malformed field, or wallet/username not matching the challenge | Fix the request |
| 400 | `INVALID_USERNAME` | Bad format or reserved name (`message` says which) | Show `message` next to the input |
| 401 | `INVALID_SIGNATURE` | The signature does not belong to the wallet | Ask to sign again with the connected wallet |
| 404 | `PROFILE_NOT_FOUND` | No profile with that username | "User not found" page |
| 409 | `USERNAME_TAKEN` | Another wallet has it | "Already taken, try another" |
| 410 | `CHALLENGE_EXPIRED` | Expired (10 min) or already used | Request a new challenge and sign again |
| 429 | `CHANGE_TOO_SOON` | Changed less than 24 h ago | Show the date in `message` |
| 429 | `RATE_LIMITED` | Too many challenges or changes | "Too many attempts, wait a minute" |
| 500 | `INTERNAL_ERROR` | Unexpected | Generic error, retry |

## Rate limits

Challenges and username changes: about 10 per IP and 5 per wallet in a burst, refilling at roughly 1 every 5 s per IP and 1 every 20 s per wallet. Reads (`GET`) use the API's general limit.

## Leaderboard

`GET /api/leaderboard` now includes `username` on every row (`null` if the wallet has none):

```json
[{ "rank": 1, "user": "0x1234...abcd", "username": "house.trader", "realizedPnl": "52.3", "volume": "90000", "trades": 31, "wins": 18 }]
```

Show `username` when present; otherwise keep the shortened wallet. The new leaderboard (positions and accounts by window) is in [leaderboard-frontend.md](leaderboard-frontend.md) and also returns `username`.

## Frontend checklist

- [ ] Portfolio: load `GET /api/profile/:wallet` for the connected wallet (replace localStorage).
- [ ] "Choose username": challenge → sign `typedData` (fallback `message`) → `PUT`.
- [ ] `/u/:username`: `GET /api/profile/by-username/:username`, then the existing account/positions/history endpoints with the returned wallet.
- [ ] Leaderboard: show `username` when present.
- [ ] Map every error `code` to a message (use `message` as the default text).
- [ ] Validate the format client-side with the same regex before asking for a signature.
