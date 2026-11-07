/**
 * Prueba de los keepers contra el fork, forzando los dos casos con anvil_setStorageAt:
 * 1. heartbeat: se atrasa lastExecutorActivity 21 h (el escape hatch vence en 3 h) y el keeper tiene que renovarlo.
 * 2. harvest: se arma una fila de dos ganadores (30 y 5 USDG) con 32 USDG de pérdidas en sideBucket. El keeper paga
 *    la primera entera y 2 de la segunda; después, con 3 USDG más, vacía la fila y el bankroll vuelve a estar libre.
 * Los slots se encuentran con eth_createAccessList (no depende del layout del contrato). Solo contra el fork.
 *
 *   pnpm fork                                   # terminal 1
 *   pnpm setup:fork                             # una vez por fork
 *   NETWORK=fork KEEPER_CHECK_MS=2000 pnpm keepers   # terminal 2
 *   pnpm try:keepers                            # terminal 3
 */
import { deployment, getNetwork } from "@hm/shared";
import { createTestClient, createWalletClient, encodeAbiParameters, encodeFunctionData, formatUnits, http, keccak256, numberToHex, pad, type Address, type Hex } from "viem";

const keepersUrl = process.env.KEEPERS_URL ?? `http://localhost:${process.env.KEEPERS_PORT ?? 8095}`;
const { chain, rpcUrl, client } = getNetwork("fork");
const test = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });
const exchange = { address: deployment.contracts.Exchange.address, abi: deployment.contracts.Exchange.abi } as const;
const [, , winnerA, winnerB] = (await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses()) as Address[];
const USD = 1_000_000n;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✖"} ${label}`);
};
const usd = (v: bigint) => `${formatUnits(v, 6)} USDG`;
const read = <T>(functionName: string, args: unknown[] = []) => client.readContract({ ...exchange, functionName, args } as never) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(label: string, fn: () => Promise<boolean>, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(500);
  }
  console.log(`  … ${label}: no pasó en ${timeoutMs / 1000} s`);
  return false;
}

/** Slots del Exchange que lee un getter (sin el slot de la implementación del proxy). */
async function slotsOf(functionName: string, args: unknown[] = []): Promise<Hex[]> {
  const data = encodeFunctionData({ abi: exchange.abi, functionName, args } as never);
  const res = (await client.request({ method: "eth_createAccessList", params: [{ to: exchange.address, data }, "latest"] } as never)) as { accessList: { address: Address; storageKeys: Hex[] }[] };
  return res.accessList.filter((e) => e.address.toLowerCase() === exchange.address.toLowerCase()).flatMap((e) => e.storageKeys).filter((k) => k !== IMPLEMENTATION_SLOT);
}
async function slotOf(functionName: string, args: unknown[] = []) {
  const keys = await slotsOf(functionName, args);
  if (keys.length !== 1) throw new Error(`${functionName} lee ${keys.length} slots, se esperaba 1`);
  return keys[0]!;
}
/** Slot base p de un mapping: el que cumple keccak256(key . p) == slot leído. */
function mappingBase(slot: Hex, key: Hex, type: "uint256" | "address") {
  for (let p = 0n; p < 1000n; p++) if (keccak256(encodeAbiParameters([{ type }, { type: "uint256" }], [key as never, p])) === slot) return p;
  throw new Error("no se encontró el slot base del mapping");
}
const at = (base: bigint, key: Hex, type: "uint256" | "address") => keccak256(encodeAbiParameters([{ type }, { type: "uint256" }], [key as never, base]));
const set = (slot: Hex, value: bigint) => test.setStorageAt({ address: exchange.address, index: slot, value: pad(numberToHex(value), { size: 32 }) });
const health = async () => (await (await fetch(`${keepersUrl}/health`)).json()) as { ok: boolean; problems: string[]; lastHeartbeat?: { tx: Hex }; lastHarvest?: { paid: string } };

try {
  await health();
} catch {
  console.log(`✖ no hay keepers en ${keepersUrl}: correr NETWORK=fork KEEPER_CHECK_MS=2000 pnpm keepers`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. heartbeat
console.log("1. heartbeat");
const [, , escapeDelay] = await read<readonly [number, number, number]>("limits");
const now = (await client.getBlock()).timestamp;
await set(await slotOf("lastExecutorActivity"), now - 21n * 3600n);
console.log(`  lastExecutorActivity atrasado 21 h (escapeDelay ${escapeDelay / 3600} h): el escape hatch vence en 3 h`);
const renewed = await until("heartbeat", async () => (await read<bigint>("lastExecutorActivity")) >= now - 60n);
const last = await read<bigint>("lastExecutorActivity");
check(renewed, `el keeper mandó heartbeat: lastExecutorActivity hace ${(await client.getBlock()).timestamp - last} s`);
const h1 = await health();
check(!!h1.lastHeartbeat, `/health muestra el heartbeat (tx ${h1.lastHeartbeat?.tx ?? "—"})`);

// ---------------------------------------------------------------- 2. harvest
console.log("2. harvest");
const [head, tail, totalQueued, sideBucket] = await Promise.all([read<bigint>("queueHead"), read<bigint>("queueTail"), read<bigint>("totalQueued"), read<bigint>("sideBucket")]);
if (head !== tail) throw new Error(`la fila del fork no está vacía (${tail - head} entradas): reiniciar el fork`);

const queueBase = mappingBase((await slotsOf("queue", [head]))[0]!, numberToHex(head, { size: 32 }), "uint256");
const queuedOfBase = mappingBase(await slotOf("queuedOf", [winnerA]), winnerA!, "address");
const entry = (user: Address, amount: bigint) => (amount << 160n) | BigInt(user); // QueueEntry(address, uint96) en un slot
const A = 30n * USD;
const B = 5n * USD;
const [balA, balB] = await Promise.all([read<bigint>("balances", [winnerA]), read<bigint>("balances", [winnerB])]);

await set(at(queueBase, numberToHex(head, { size: 32 }), "uint256"), entry(winnerA!, A));
await set(at(queueBase, numberToHex(head + 1n, { size: 32 }), "uint256"), entry(winnerB!, B));
await set(at(queuedOfBase, winnerA!, "address"), A);
await set(at(queuedOfBase, winnerB!, "address"), B);
await set(await slotOf("totalQueued"), totalQueued + A + B);
await set(await slotOf("sideBucket"), sideBucket + 32n * USD);
await set(await slotOf("queueTail"), head + 2n);
check((await read<bigint>("lpBankrollAvailable")) === 0n, `fila armada: A espera ${usd(A)}, B espera ${usd(B)}, sideBucket ${usd(sideBucket + 32n * USD)} · bankroll libre 0`);

await until("primer harvest", async () => (await read<bigint>("queueHead")) === head + 1n);
const [paidA, restB, side1] = await Promise.all([read<bigint>("balances", [winnerA]), read<readonly [Address, bigint]>("queue", [head + 1n]), read<bigint>("sideBucket")]);
check(paidA - balA === A, `A cobró entera: ${usd(paidA - balA)}`);
check(restB[1] === B - 2n * USD && side1 === sideBucket, `B cobró 2 de 5 (le quedan ${usd(restB[1])} en la fila) y sideBucket volvió a ${usd(side1)}`);
await sleep(5_000);
check((await read<bigint>("queueHead")) === head + 1n, "sin caja, el keeper no vuelve a mandar harvest");

await set(await slotOf("sideBucket"), sideBucket + 3n * USD);
await until("segundo harvest", async () => (await read<bigint>("queueHead")) === head + 2n);
const [paidB, bankroll, lpCash, queuedEnd] = await Promise.all([read<bigint>("balances", [winnerB]), read<bigint>("lpBankrollAvailable"), read<bigint>("lpCash"), read<bigint>("totalQueued")]);
check(paidB - balB === B && queuedEnd === totalQueued, `con 3 USDG más, B completó ${usd(paidB - balB)} y la fila quedó vacía`);
check(bankroll === lpCash, `sin fila, el bankroll vuelve a estar libre: lpBankrollAvailable = lpCash = ${usd(bankroll)}`);

const h2 = await health();
check(h2.ok, `/health ${h2.ok ? "sano" : `con problemas: ${h2.problems.join(" · ")}`}`);
process.exit(failures ? 1 : 0);
