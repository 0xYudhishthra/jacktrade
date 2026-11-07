import { deployment, safeError, type getNetwork } from "@hm/shared";
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

const erc1271 = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const ERC1271_GAS_CAP = BigInt(process.env.RELAYER_ERC1271_GAS ?? 150_000);

type Client = ReturnType<typeof getNetwork>["client"];

const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const sessionKeys = { address: deployment.contracts.SessionKeyManager.address, abi: deployment.contracts.SessionKeyManager.abi } as const;

export type MarketSnapshot = {
  listed: boolean;
  retired: boolean;
  longOi: bigint;
  shortOi: bigint;
  maxLeverage: bigint;
  liqBufferBps: number;
  maxConfBps: number;
  maxNotional: bigint;
  minMargin: bigint;
  minNotional: bigint;
  longOiCap: bigint;
  shortOiCap: bigint;
};

/**
 * Lo que el relayer necesita leer de la cadena para validar. Lo global (mercados, pausa, TTL, hora del bloque)
 * se refresca cada `refreshMs`; lo de cada usuario (balance, nonce, session key, posición) se lee en el momento.
 */
export class ChainState {
  markets = new Map<number, MarketSnapshot>();
  tradingPaused = false;
  intentTtl = 0;
  private blockTime = 0; // segundos, del último bloque leído
  private blockTimeReadAt = 0; // ms locales cuando se leyó
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly client: Client,
    private readonly marketIds: readonly number[],
  ) {}

  async start(refreshMs = 1000) {
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch((e) => console.error(`[chain] refresh: ${safeError(e)}`)), refreshMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Hora de la cadena estimada: la del último bloque más lo que pasó desde que se leyó. */
  now() {
    return this.blockTime + (Date.now() - this.blockTimeReadAt) / 1000;
  }

  async refresh() {
    const [block, paused, limits, ...perMarket] = await Promise.all([
      this.client.getBlock(),
      this.client.readContract({ ...exchange, functionName: "tradingPaused" }),
      this.client.readContract({ ...exchange, functionName: "limits" }),
      ...this.marketIds.map((id) =>
        Promise.all([
          this.client.readContract({ ...exchange, functionName: "marketState", args: [id] }),
          this.client.readContract({ ...exchange, functionName: "marketConfig", args: [id] }),
          this.client.readContract({ ...exchange, functionName: "marketRisk", args: [id] }),
        ]),
      ),
    ]);
    this.blockTime = Number(block.timestamp);
    this.blockTimeReadAt = Date.now();
    // Si la cadena se separa del reloj real, los precios de Pyth (hora real) quedan viejos o "en el futuro"
    // para el contrato (StalePrice, IntentExpired). Se vio una vez en el fork, con ~14 s de diferencia.
    const drift = this.blockTime - Date.now() / 1000;
    if (Math.abs(drift) > 5) console.warn(`⚠ [chain] el reloj de la cadena está ${drift.toFixed(1)} s ${drift > 0 ? "adelantado" : "atrasado"} respecto del real`);
    this.tradingPaused = paused;
    this.intentTtl = limits[1];
    perMarket.forEach(([state, config, risk], i) => {
      this.markets.set(this.marketIds[i]!, {
        listed: state[0],
        retired: state[1],
        longOi: state[3],
        shortOi: state[4],
        maxLeverage: BigInt(config.maxLeverage),
        liqBufferBps: config.liqBufferBps,
        maxConfBps: config.maxConfBps,
        maxNotional: config.maxNotional,
        minMargin: risk[0],
        minNotional: risk[1],
        longOiCap: risk[2],
        shortOiCap: risk[3],
      });
    });
  }

  balance(user: `0x${string}`) {
    return this.client.readContract({ ...exchange, functionName: "balances", args: [user] });
  }

  nonceUsed(user: `0x${string}`, nonce: bigint) {
    return this.client.readContract({ ...exchange, functionName: "nonceUsed", args: [user, nonce] });
  }

  async hasCode(address: Hex) {
    const code = await this.client.getCode({ address });
    return !!code && code !== "0x";
  }

  /**
   * ERC-1271: la wallet con código dice si la firma es suya. Se consulta como lo hace el contrato: llamada desde el
   * Exchange (una wallet maliciosa podría responder distinto según quién llama) y con tope de gas (una que gaste de más
   * para validar también quemaría el gas del batch). Cualquier error cuenta como inválida.
   */
  async isValidErc1271(wallet: Hex, hash: Hex, signature: Hex) {
    try {
      const { data } = await this.client.call({
        account: exchange.address,
        to: wallet,
        data: encodeFunctionData({ abi: erc1271, functionName: "isValidSignature", args: [hash, signature] }),
        gas: ERC1271_GAS_CAP,
      });
      return !!data && decodeFunctionResult({ abi: erc1271, functionName: "isValidSignature", data }) === "0x1626ba7e";
    } catch {
      return false;
    }
  }

  isValidSessionKey(user: `0x${string}`, key: `0x${string}`) {
    return this.client.readContract({ ...sessionKeys, functionName: "isValidSessionKey", args: [user, key] });
  }

  async position(id: bigint) {
    const [owner, instrumentId, isLong, leverage, , margin, entryPrice] = await this.client.readContract({
      ...exchange,
      functionName: "positions",
      args: [id],
    });
    return { owner, instrumentId, isLong, leverage: BigInt(leverage), margin, entryPrice };
  }
}
