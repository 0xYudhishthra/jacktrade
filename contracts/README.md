# JackTradePoints

An onchain, **non-transferable** points ledger for JackTrade on Robinhood Chain mainnet (chain id 4663).

It looks like an ERC-20 to wallets and explorers (`name` "JackTrade Points", `symbol` "JTP", `decimals` 18, `totalSupply`, `balanceOf`, `allowance` = 0), but `transfer`, `transferFrom` and `approve` always revert with `NonTransferable()`. Points are only ever minted, and each award emits a standard `Transfer(address(0), user, amount)` so indexers pick it up like a mint.

No external dependencies: no forge-std, no OpenZeppelin. The few cheatcodes the tests and script use are declared in [`lib/Vm.sol`](lib/Vm.sol).

## The rule

**10 points per $100 of notional traded, win or lose.** Notional = margin × leverage.

```
notional        USDG raw units (6 decimals), e.g. $1,000 = 1_000_000_000
points          = notional * 1e12 * POINTS_PER_100_USD / 100      (18 decimals)
                = notional * 1e11                                  (exact, no rounding)

$1,000 notional  -> 100 points  (100e18)
$20 at 50x       -> $1,000 notional -> 100 points
$10 at 1000x     -> $10,000 notional -> 1,000 points
```

Onchain points keep fractions (`$1,005` -> `100.5` points). The connector's off-chain `pointsFor` in `connector/src/points.ts` floors to whole points, so the two can differ by less than 1 point.

## How it works

| Function | Who | What |
|----------|-----|------|
| `sync(address[] users, uint256[] cumulativeNotional)` | `syncer` | For each user: if `cumulativeNotional > notionalSynced[user]`, mints points for the difference and stores the new total. Equal or lower values are skipped. Emits `Transfer` + `PointsSynced(user, deltaNotional, pointsAwarded)`. Reverts on length mismatch (`LengthMismatch`) or a zero-address user (`ZeroAddress`). |
| `notionalSynced(address)` | anyone | Cumulative notional already credited (USDG raw units). |
| `pointsForNotional(uint256)` | anyone | Points for a given notional. |
| `setSyncer(address)` | `owner` | Changes the syncer. Emits `SyncerUpdated`. |
| `transferOwnership(address)` / `acceptOwnership()` | `owner` / `pendingOwner` | Two-step ownership transfer. `transferOwnership(address(0))` cancels a pending transfer. |

Because `sync` takes **cumulative** totals and only credits the increase, it is idempotent: pushing the same totals twice, or a stale lower total, never double-awards or claws back. Duplicate users in one batch are safe.

## The syncer

The syncer is an off-chain job (not in this folder) that runs on a timer:

1. Read each trader's lifetime notional from the exchange indexer. The connector already does this in `connector/src/points.ts`: `GET {INDEXER_URL}/api/leaderboard/accounts?window=all&sortKey=volume&sortDir=desc` returns `{ user, volume }` per account, where `volume` is cumulative notional in USD.
2. Convert `volume` to USDG raw units (6 decimals) from the string, not a float, e.g. viem `parseUnits(volume, 6)` after truncating to 6 decimal places.
3. Optionally skip users whose value equals `notionalSynced(user)` to save gas.
4. Call `sync(users, cumulativeNotional)` from the syncer key, in batches (for example 100 users per transaction).

A one-user `sync` call for a first-time trader measured about 88k gas in the tests, mostly first-time storage writes. Batching spreads the fixed per-transaction cost. At Robinhood Chain's ~0.02 gwei gas price, a sync costs a fraction of a cent.

## Test

```bash
cd contracts
forge test -vv
```

19 tests cover: award math ($1,000 -> 100e18, 1 raw unit -> 1e11), `Transfer`/`PointsSynced` events, idempotent re-sync, partial increases, ignored decreases, a batch with duplicates, a fuzz test on the high-water mark, only-syncer, length mismatch, zero-address user, transfer/approve/transferFrom reverts, `setSyncer`, and two-step ownership.

## Deploy (Robinhood Chain mainnet)

The deployer key lives only in `contracts/.env` (gitignored by the root `.gitignore`):

```
DEPLOYER_PRIVATE_KEY=0x...
SYNCER=0x...            # optional; defaults to the deployer
```

Forge loads `contracts/.env` automatically, so the key never goes on the command line.

Dry run (simulates and prints the gas estimate, sends nothing):

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url robinhood
```

Broadcast (fund the deployer with Robinhood Chain ETH first):

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url robinhood --broadcast
```

`robinhood` is defined in `foundry.toml` as `https://rpc.mainnet.chain.robinhood.com`. The deployed address is printed under `== Return ==` and saved in `broadcast/Deploy.s.sol/4663/run-latest.json`. The deployer becomes `owner`; hand ownership to a safer wallet with `transferOwnership` + `acceptOwnership` if needed.

Deployment costs about 640k gas (Nitro node estimate, L1 data fee included). At ~0.02 gwei that is about 0.000013 ETH; forge budgets up to ~0.000033 ETH with its 1.3x gas and 2x base-fee buffers.
