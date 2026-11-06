/**
 * Levanta un fork local de Robinhood Chain con anvil y alinea su reloj con la hora real.
 * Sin alinear, el fork arranca 2 o 3 s atrasado y los updates de Pyth (hora real) quedan "en el futuro".
 *
 *   pnpm fork
 *
 * Queda corriendo hasta Ctrl-C. Nada de lo que pase acá toca mainnet.
 */
import { spawn } from "node:child_process";

const upstream = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const forkUrl = new URL(process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545");
// Robinhood Chain hace un bloque cada ~100 ms. Sin intervalo, anvil solo mina con transacciones y el último bloque envejece.
const blockTime = process.env.FORK_BLOCK_TIME ?? "0.2";

// Si ya hay un fork en ese puerto, no levantar otro encima.
try {
  await rpc("eth_chainId");
  console.error(`Ya hay un nodo corriendo en ${forkUrl.href}. Cortalo con Ctrl-C en su terminal o usá otro FORK_RPC_URL.`);
  process.exit(1);
} catch {
  // Puerto libre.
}

const anvil = spawn(
  "anvil",
  ["--fork-url", upstream, "--host", forkUrl.hostname, "--port", forkUrl.port, "--block-time", blockTime, "--silent", ...(process.env.FORK_ANVIL_ARGS?.split(" ").filter(Boolean) ?? [])],
  { stdio: "inherit" },
);
anvil.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => anvil.kill(signal));

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(forkUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      return await rpc<string>("eth_blockNumber");
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil no respondió en 30 s");
}

await waitReady();

// Un bloque con la hora actual; anvil sigue el reloj real desde ahí.
await rpc("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000)]);
await rpc("evm_mine");

console.log(
  `Fork listo en ${forkUrl.href} · copia de mainnet · reloj alineado · un bloque cada ${blockTime} s`,
);
console.log("Probar en otra terminal: NETWORK=fork pnpm check:contracts");

// Vigilante del reloj. Mientras anvil baja estado del RPC (por ejemplo en el primer setup:fork) deja de generar bloques,
// y al retomar sigue contando desde donde quedó: la cadena queda atrasada para siempre (se vieron 13 s), y Pyth
// rechaza los precios (StalePrice). Si se atrasa más de 2 s, el próximo bloque salta a la hora real.
setInterval(async () => {
  try {
    const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false]);
    const behind = Date.now() / 1000 - Number(block.timestamp);
    if (behind > 2) {
      await rpc("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000)]);
      console.log(`Reloj del fork atrasado ${behind.toFixed(1)} s: se realinea`);
    }
  } catch {
    // anvil ocupado o cerrándose: se reintenta en el próximo segundo.
  }
}, 1000).unref();
