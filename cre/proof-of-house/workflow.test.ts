// bun test: runs the handler against LIVE Robinhood Chain RPC + indexer data (via curl),
// with the EVM write mocked, and checks the ABI-encoded report the contract will receive.
import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from '@chainlink/cre-sdk/test'
import { bytesToHex, decodeAbiParameters, parseAbiParameters } from 'viem'
import config from './config.staging.json'
import { onCron } from './workflow'

const SEPOLIA_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const CONSUMER = '0x000000000000000000000000000000000000dEaD'
const NOW_MS = 1_762_400_000_000

const testConfig = { ...config, evm: { ...config.evm, consumerAddress: CONSUMER } }

describe('onCron', () => {
	test('reads the house and writes an ABI-encoded attestation', () => {
		// HTTP capability -> real synchronous request through curl.
		const http = HttpActionsMock.testInstance()
		http.sendRequest = (req) => {
			const args = ['curl', '-sS', '-X', req.method, req.url]
			if (req.body.length > 0) {
				args.push('-H', 'content-type: application/json', '--data-binary', Buffer.from(req.body).toString())
			}
			const out = Bun.spawnSync(args)
			if (out.exitCode !== 0) throw new Error(`curl failed: ${out.stderr.toString()}`)
			return { statusCode: 200, body: Buffer.from(out.stdout).toString('base64') }
		}

		const evm = EvmMock.testInstance(SEPOLIA_SELECTOR)
		let rawReport: Uint8Array | undefined
		let receiver = ''
		evm.writeReport = (req) => {
			rawReport = req.report?.rawReport
			receiver = bytesToHex(req.receiver)
			return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32) }
		}

		const runtime = newTestRuntime(null, { timeProvider: () => NOW_MS }, testConfig)
		onCron(runtime as any, {} as any)

		expect(receiver.toLowerCase()).toBe(CONSUMER.toLowerCase())
		expect(rawReport).toBeDefined()
		const [bankroll, queued, openInterest, positions, observedAt] = decodeAbiParameters(
			parseAbiParameters('uint256, uint256, uint256, uint256, uint64'),
			bytesToHex(rawReport!.slice(REPORT_METADATA_HEADER_LENGTH)),
		)
		console.log({ bankroll, queued, openInterest, positions, observedAt })
		expect(bankroll).toBeGreaterThan(0n)
		expect(observedAt).toBe(BigInt(NOW_MS / 1000))
		expect(queued >= 0n && openInterest >= 0n && positions >= 0n).toBe(true)
	})

	test('refuses to run with the placeholder consumer address', () => {
		const runtime = newTestRuntime(null, {}, config)
		expect(() => onCron(runtime as any, {} as any)).toThrow('consumerAddress')
	})
})
