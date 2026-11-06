# Proof of House (Chainlink CRE)

A Chainlink CRE workflow that attests, onchain, that the JackTrade house is good for it.

Every 5 minutes (cron trigger) each node in the DON:

1. **HTTP → Robinhood Chain JSON-RPC** (`https://rpc.mainnet.chain.robinhood.com`, chain id 4663):
   one batched `eth_call` to the JackTrade Exchange `0x698cf1a9220f89ccf6ee75269086288a623ede54`
   for `lpCash()`, `totalQueued()`, `lpBankrollAvailable()`, `totalMargin()` (uint256, 6-decimal USDG).
   Robinhood Chain is not a CRE-supported chain, so it is read over plain JSON-RPC with the HTTP
   capability instead of the EVM read capability. The ABI fragments are hand-written in `workflow.ts`.
2. **HTTP → JackTrade indexer** `GET https://hmindexer-production.up.railway.app/api/house`:
   total open interest (sum of `longOi + shortOi` over `markets[]`, USD → 6 decimals) and open
   position count.
3. **Consensus**: every field is aggregated with `median` across nodes.
4. **EVM write**: the DON signs the report
   `(uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions, uint64 observedAt)`
   and writes it to `HouseAttestation` on **Ethereum Sepolia** through the Keystone forwarder.
   `bankroll = lpBankrollAvailable()`, `queued = totalQueued()`, `observedAt` = DON time (unix seconds).

`HouseAttestation` only accepts `onReport` from its configured forwarder, rejects stale reports,
stores the latest attestation, emits `HouseAttested`, and exposes
`latest() returns (bankroll, queued, openInterest, positions, observedAt)`.

## Layout

| Path | What |
| --- | --- |
| `project.yaml` | CRE project settings (`staging-settings` target, Sepolia RPC) |
| `.env` | `CRE_ETH_PRIVATE_KEY` (Sepolia deployer / broadcaster), gitignored. See `.env.example` |
| `proof-of-house/` | The TypeScript workflow (`workflow.ts`, `main.ts`, `config.staging.json`, `workflow.yaml`) |
| `proof-of-house/workflow.test.ts` | `bun test`: runs the handler against live RPC + indexer data with the EVM write mocked |
| `contracts/` | Foundry project: `src/HouseAttestation.sol`, `test/`, `script/Deploy.s.sol` (no dependencies) |

## Run it

All commands are run from `cre/`. Needs the CRE CLI (`export PATH=$HOME/.cre/bin:$PATH`), bun and Foundry.

```bash
cd cre
export PATH=$HOME/.cre/bin:$PATH
set -a; . ./.env; set +a                 # loads CRE_ETH_PRIVATE_KEY (never echo it)
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
```

**0. Fund the deployer** (the address in `.env` as `DEPLOYER_ADDRESS`) with a little Sepolia ETH:

```bash
cast balance $DEPLOYER_ADDRESS --rpc-url $SEPOLIA_RPC --ether
```

**1. Deploy `HouseAttestation`** (forwarder defaults to the Sepolia simulation `MockKeystoneForwarder`
`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`):

```bash
(cd contracts && forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC \
  --private-key $CRE_ETH_PRIVATE_KEY --broadcast)
HOUSE=$(jq -r '.transactions[0].contractAddress' contracts/broadcast/Deploy.s.sol/11155111/run-latest.json)
echo $HOUSE
```

**2. Point the workflow at it** (`evm.consumerAddress` in `proof-of-house/config.staging.json`):

```bash
jq --arg a "$HOUSE" '.evm.consumerAddress = $a' proof-of-house/config.staging.json > /tmp/poh.json \
  && mv /tmp/poh.json proof-of-house/config.staging.json
```

**3. Log in and simulate with a real onchain write**:

```bash
(cd proof-of-house && bun install)      # once
cre login                               # browser
cre workflow simulate ./proof-of-house --target staging-settings --broadcast
# non-interactive: add  --non-interactive --trigger-index 0
```

The simulator logs the house numbers and `Proof of House written: https://sepolia.etherscan.io/tx/0x...`.

**4. Read the attestation**:

```bash
cast call $HOUSE "latest()(uint256,uint256,uint256,uint256,uint64)" --rpc-url $SEPOLIA_RPC
```

## Develop

```bash
(cd contracts && forge build && forge test)
(cd proof-of-house && bun run typecheck && bun test)
cre workflow build ./proof-of-house     # compiles to WASM, no login needed
```

## Moving to a deployed workflow

Simulation uses the `MockKeystoneForwarder`. A deployed workflow writes through the production
`KeystoneForwarder` (Sepolia `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`); switch with
`cast send $HOUSE "setForwarder(address)" 0xF8344CFd5c43616a4366C34E3EEE75af79a74482 --private-key $CRE_ETH_PRIVATE_KEY --rpc-url $SEPOLIA_RPC`
(owner only), or redeploy with `FORWARDER=0x... forge script ...`.
