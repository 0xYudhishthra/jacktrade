/**
 * Manda intents buenos y malos al relayer y compara la respuesta con lo esperado. Solo contra el fork.
 *
 *   pnpm fork                      # terminal 1
 *   pnpm setup:fork                # una vez por fork
 *   NETWORK=fork pnpm relayer      # terminal 2
 *   pnpm try:intents               # terminal 3
 *
 * Firma con las cuentas de prueba de anvil (desbloqueadas en el fork): [2] usuario, [3] otra cuenta, [4] session key.
 */
import {
  deployment,
  getNetwork,
  intentToJson,
  intentTypedData,
  type Intent,
  type IntentStatus,
} from "@hm/shared";
import { createWalletClient, http, type Address, type Hex } from "viem";

const relayerUrl = process.env.RELAYER_URL ?? `http://localhost:${process.env.RELAYER_PORT ?? 8091}`;
const { chain, rpcUrl, client } = getNetwork("fork");
const wallet = (account: Address) => createWalletClient({ account, chain, transport: http(rpcUrl) });
const [, , user, other, sessionKey] = (await wallet("0x0000000000000000000000000000000000000000").getAddresses()) as Address[];
if (!user || !other || !sessionKey) throw new Error("El fork no tiene las cuentas de prueba de anvil");

const USD = 1_000_000n;
const chainNow = async () => (await client.getBlock()).timestamp;
const sign = (signer: Address, i: Intent) => wallet(signer).signTypedData(intentTypedData(i) as never);
let nonce = BigInt(Date.now()) * 1000n;

async function post(body: unknown) {
  const res = await fetch(`${relayerUrl}/intent`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return { http: res.status, ...((await res.json()) as { status: string; code?: string; id?: string; message?: string }) };
}

async function open(overrides: Partial<Extract<Intent, { kind: "open" }>["intent"]> = {}, signer: Address = user) {
  const i: Intent = {
    kind: "open",
    intent: { user, instrumentId: 0, isLong: true, margin: 10n * USD, leverage: 100n, priceLimit: 0n, signedAt: await chainNow(), nonce: nonce++, ...overrides },
  };
  return { i, signature: await sign(signer, i) };
}
const submit = ({ i, signature }: { i: Intent; signature: Hex }) => post({ ...intentToJson(i), signature });

// Session key para el usuario (30 días máximo), registrada directo desde su wallet en el fork.
const sk = { address: deployment.contracts.SessionKeyManager.address, abi: deployment.contracts.SessionKeyManager.abi } as const;
if (!(await client.readContract({ ...sk, functionName: "isValidSessionKey", args: [user, sessionKey] }))) {
  const expiry = (await chainNow()) + 7n * 86_400n;
  const hash = await wallet(user).writeContract({ ...sk, functionName: "registerSessionKey", args: [sessionKey, expiry] });
  await client.waitForTransactionReceipt({ hash });
}

const good = await open();
const cases: [string, string, () => Promise<{ status: string; code?: string; id?: string }>][] = [
  ["open firmado por la wallet", "queued", () => submit(good)],
  ["mismo nonce otra vez", "NonceAlreadyUsed", () => submit(good)],
  ["firmado por otra cuenta", "InvalidSignature", async () => submit(await open({}, other))],
  ["open firmado por session key", "queued", async () => submit(await open({ isLong: false }, sessionKey))],
  ["apalancamiento 2000x", "InvalidLeverage", async () => submit(await open({ leverage: 2000n }))],
  ["notional 100 USDG (mínimo 1000)", "InvalidSize", async () => submit(await open({ leverage: 10n }))],
  ["margen 5 USDG (mínimo 10)", "InvalidSize", async () => submit(await open({ margin: 5n * USD, leverage: 500n }))],
  ["margen mayor que el balance", "InsufficientBalance", async () => submit(await open({ margin: 5_000n * USD, leverage: 1n }))],
  ["mercado que no existe", "MarketNotListed", async () => submit(await open({ instrumentId: 7 }))],
  ["signedAt 60 s en el futuro", "IntentExpired", async () => submit(await open({ signedAt: (await chainNow()) + 60n }))],
  ["signedAt de hace 2 minutos", "TooOld", async () => submit(await open({ signedAt: (await chainNow()) - 120n }))],
  [
    "close de una posición que no existe",
    "PositionNotFound",
    async () => {
      const i: Intent = { kind: "close", intent: { user, positionId: 999_999n, priceLimit: 0n, signedAt: await chainNow(), nonce: nonce++ } };
      return submit({ i, signature: await sign(user, i) });
    },
  ],
  ["JSON roto", "BadRequest", () => post("{no es json")],
];

let failures = 0;
for (const [label, expected, run] of cases) {
  const r = await run();
  const got = r.status === "rejected" ? r.code! : r.status;
  if (got !== expected) failures++;
  console.log(`${got === expected ? "✔" : "✖"} ${label}: ${got}${got === expected ? "" : ` (esperaba ${expected})`}`);
}

// El relayer ya ejecuta: el primero puede estar en cualquier estado, pero tiene que existir.
const status = (await (await fetch(`${relayerUrl}/intent/${user.toLowerCase()}:${good.i.intent.nonce}`)).json()) as IntentStatus;
console.log(`${status.status ? "✔" : "✖"} GET /intent/:id del primero: ${status.status}`);
if (!status.status) failures++;

process.exit(failures ? 1 : 0);
