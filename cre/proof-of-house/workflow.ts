/**
 * Proof of House: every 5 minutes, attest the JackTrade Exchange's solvency onchain.
 *
 * 1. HTTP: Robinhood Chain JSON-RPC `eth_call` (one batched POST) for the Exchange's
 *    bankroll / queue getters. Robinhood Chain is not a CRE-supported chain, so it is read
 *    over plain JSON-RPC rather than with the EVM read capability.
 * 2. HTTP: JackTrade indexer `/api/house` for total open interest and open positions.
 * 3. Each DON node fetches independently; results are aggregated field-by-field with median.
 * 4. The report `(uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions,
 *    uint64 observedAt)` is signed by the DON and written to `HouseAttestation` on Sepolia.
 *
 * All USD amounts are 6-decimal integers (USDG units).
 */
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	cre,
	getNetwork,
	type HTTPSendRequester,
	hexToBase64,
	median,
	ok,
	type Runtime,
	text,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	type Hex,
	parseAbi,
	parseAbiParameters,
	parseUnits,
	zeroAddress,
} from 'viem'
import { z } from 'zod'

export const configSchema = z.object({
	schedule: z.string(),
	robinhoodRpcUrl: z.string(),
	exchangeAddress: z.string(),
	indexerUrl: z.string(),
	evm: z.object({
		chainSelectorName: z.string(),
		consumerAddress: z.string(),
		gasLimit: z.string(),
	}),
})

type Config = z.infer<typeof configSchema>

// ---------------------------------------------------------------------------
// JackTrade Exchange (Robinhood Chain, chain id 4663): hand-written public getters.
// ---------------------------------------------------------------------------
const EXCHANGE_ABI = parseAbi([
	'function lpCash() view returns (uint256)',
	'function totalQueued() view returns (uint256)',
	'function lpBankrollAvailable() view returns (uint256)',
	'function totalMargin() view returns (uint256)',
])

const GETTERS = ['lpCash', 'totalQueued', 'lpBankrollAvailable', 'totalMargin'] as const

type ExchangeState = {
	lpCash: bigint
	totalQueued: bigint
	lpBankrollAvailable: bigint
	totalMargin: bigint
}

type RpcResult = { id: number; result?: Hex; error?: { message?: string } }

const readExchange = (sendRequester: HTTPSendRequester, config: Config): ExchangeState => {
	const batch = GETTERS.map((functionName, id) => ({
		jsonrpc: '2.0',
		id,
		method: 'eth_call',
		params: [{ to: config.exchangeAddress, data: encodeFunctionData({ abi: EXCHANGE_ABI, functionName }) }, 'latest'],
	}))

	const response = sendRequester
		.sendRequest({
			url: config.robinhoodRpcUrl,
			method: 'POST',
			multiHeaders: { 'Content-Type': { values: ['application/json'] } },
			body: Buffer.from(JSON.stringify(batch)).toString('base64'),
		})
		.result()

	if (!ok(response)) {
		throw new Error(`Robinhood Chain RPC failed with status ${response.statusCode}`)
	}

	const results = JSON.parse(text(response)) as RpcResult[]
	const state = {} as ExchangeState
	GETTERS.forEach((functionName, id) => {
		const r = results.find((x) => x.id === id)
		if (!r?.result) {
			throw new Error(`eth_call ${functionName}() failed: ${r?.error?.message ?? 'no result'}`)
		}
		state[functionName] = decodeFunctionResult({ abi: EXCHANGE_ABI, functionName, data: r.result })
	})
	return state
}

// ---------------------------------------------------------------------------
// JackTrade indexer: GET /api/house (USD amounts are decimal strings).
// ---------------------------------------------------------------------------
type HouseApiResponse = {
	positions: number
	markets: { name: string; longOi: string; shortOi: string }[]
}

type IndexerState = {
	openInterest: bigint
	positions: bigint
}

/** "1234.5" USD -> 1234500000n (6 decimals). */
const usd6 = (usd: string): bigint => {
	if (!/^\d+(\.\d+)?$/.test(usd)) throw new Error(`Bad USD amount from indexer: ${usd}`)
	return parseUnits(usd, 6)
}

const readIndexer = (sendRequester: HTTPSendRequester, config: Config): IndexerState => {
	const response = sendRequester.sendRequest({ url: config.indexerUrl, method: 'GET' }).result()

	if (!ok(response)) {
		throw new Error(`Indexer request failed with status ${response.statusCode}`)
	}

	const house = JSON.parse(text(response)) as HouseApiResponse
	let openInterest = 0n
	for (const market of house.markets) {
		openInterest += usd6(market.longOi) + usd6(market.shortOi)
	}
	return { openInterest, positions: BigInt(house.positions) }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
const fmtUsd = (v: bigint): string => `$${(Number(v) / 1e6).toFixed(2)}`

export const onCron = (runtime: Runtime<Config>, _payload: CronPayload): string => {
	const { evm } = runtime.config
	if (evm.consumerAddress.toLowerCase() === zeroAddress) {
		throw new Error('Set evm.consumerAddress in config.staging.json to the deployed HouseAttestation address')
	}

	const http = new cre.capabilities.HTTPClient()

	// 1. Exchange state from Robinhood Chain (median across nodes; nodes may see different "latest" blocks).
	const exchange = http
		.sendRequest(
			runtime,
			readExchange,
			ConsensusAggregationByFields<ExchangeState>({
				lpCash: median,
				totalQueued: median,
				lpBankrollAvailable: median,
				totalMargin: median,
			}),
		)(runtime.config)
		.result()

	// 2. Open interest + position count from the indexer.
	const indexer = http
		.sendRequest(
			runtime,
			readIndexer,
			ConsensusAggregationByFields<IndexerState>({ openInterest: median, positions: median }),
		)(runtime.config)
		.result()

	// DON time (deterministic across nodes), never Date.now().
	const observedAt = BigInt(Math.floor(runtime.now().getTime() / 1000))

	runtime.log(
		`House: bankroll ${fmtUsd(exchange.lpBankrollAvailable)} (lpCash ${fmtUsd(exchange.lpCash)}), ` +
			`queued ${fmtUsd(exchange.totalQueued)}, margin ${fmtUsd(exchange.totalMargin)}, ` +
			`openInterest ${fmtUsd(indexer.openInterest)}, positions ${indexer.positions}, observedAt ${observedAt}`,
	)

	// 3. Encode + sign the report. Layout must match HouseAttestation.onReport's abi.decode.
	const reportData = encodeAbiParameters(
		parseAbiParameters('uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions, uint64 observedAt'),
		[exchange.lpBankrollAvailable, exchange.totalQueued, indexer.openInterest, indexer.positions, observedAt],
	)

	const report = runtime
		.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	// 4. Write to the HouseAttestation consumer via the (Mock)KeystoneForwarder.
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: evm.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Unknown chain: ${evm.chainSelectorName}`)

	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const resp = evmClient
		.writeReport(runtime, {
			receiver: evm.consumerAddress,
			report,
			gasConfig: { gasLimit: evm.gasLimit },
		})
		.result()

	if (resp.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${resp.errorMessage || resp.txStatus}`)
	}
	// ReceiverContractExecutionStatus: 0 = SUCCESS, 1 = REVERTED (e.g. wrong forwarder or stale report).
	if (resp.receiverContractExecutionStatus === 1) {
		throw new Error('HouseAttestation.onReport reverted (check the forwarder address set on the contract)')
	}

	const txHash = bytesToHex(resp.txHash ?? new Uint8Array(32))
	runtime.log(`Proof of House written: https://sepolia.etherscan.io/tx/${txHash}`)
	return txHash
}

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}
