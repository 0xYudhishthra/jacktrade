import { actionId, actionTypedData, deployment, safeError, type Action, type ActionStatus, type getNetwork, type RejectCode } from "@hm/shared";
import { decodeErrorResult, encodeFunctionData, erc20Abi, hashTypedData, hexToSignature, type Account, type Hex, type WalletClient } from "viem";

import type { ChainState } from "./chain.js";
import { Rejected } from "./validate.js";

type Client = ReturnType<typeof getNetwork>["client"];

const c = deployment.contracts;
const exchange = { address: c.Exchange.address, abi: c.Exchange.abi } as const;
const sessionKeys = { address: c.SessionKeyManager.address, abi: c.SessionKeyManager.abi } as const;
const staking = { address: c.JackTradeStaking.address, abi: c.JackTradeStaking.abi } as const;
const token = deployment.token.address as Hex;
const usdg = deployment.collateral.address as Hex;

export type QueuedAction = { id: string; action: Action; signature: Hex; receivedAt: number };

/**
 * Acciones firmadas por la wallet que esperan su turno. Se mandan de a una desde el mismo loop del batcher,
 * así la wallet del relayer nunca manda dos transacciones a la vez (los nonces no se pisan).
 */
export class ActionQueue {
  private readonly waiting: QueuedAction[] = [];
  private readonly statuses = new Map<string, ActionStatus>();
  private readonly reserved = new Map<string, string>(); // id validándose → usuario: un duplicado simultáneo se rechaza
  private readonly inFlight = new Map<string, Hex>(); // id → usuario de acciones mandadas sin recibo todavía
  private readonly daily = new Map<string, { day: number; count: number }>(); // usuario → acciones pagadas hoy

  /** Reserva el id antes de cualquier `await`: si la misma acción llega dos veces, la segunda se rechaza. */
  reserve(id: string, user: Hex) {
    const s = this.statuses.get(id);
    if (this.reserved.has(id) || (s && s.status !== "failed")) return false;
    this.reserved.set(id, user.toLowerCase());
    return true;
  }

  release(id: string) {
    this.reserved.delete(id);
  }

  add(action: Action, signature: Hex): QueuedAction {
    const q = { id: actionId(action), action, signature, receivedAt: Date.now() };
    this.reserved.delete(q.id);
    this.waiting.push(q);
    this.statuses.set(q.id, { id: q.id, status: "queued" });
    const user = action.action.user.toLowerCase();
    const day = Math.floor(Date.now() / 86_400_000);
    const d = this.daily.get(user);
    this.daily.set(user, d && d.day === day ? { day, count: d.count + 1 } : { day, count: 1 });
    return q;
  }

  /**
   * Acciones de este usuario en fila, mandadas sin recibo o validándose ahora (sin contar `except`, la que se está
   * validando): así varios pedidos simultáneos no pasan todos el tope.
   */
  pendingOf(user: Hex, except?: string) {
    const u = user.toLowerCase();
    let n = this.waiting.filter((q) => q.action.action.user.toLowerCase() === u).length + [...this.inFlight.values()].filter((x) => x === u).length;
    for (const [id, x] of this.reserved) if (x === u && id !== except) n++;
    return n;
  }

  /** Acciones pagadas por el relayer para este usuario hoy (UTC), más las que se están validando. */
  usedToday(user: Hex, except?: string) {
    const u = user.toLowerCase();
    const d = this.daily.get(u);
    let n = d && d.day === Math.floor(Date.now() / 86_400_000) ? d.count : 0;
    for (const [id, x] of this.reserved) if (x === u && id !== except) n++;
    return n;
  }

  markInFlight(id: string, user: Hex) {
    this.inFlight.set(id, user.toLowerCase() as Hex);
  }

  settled(id: string) {
    this.inFlight.delete(id);
  }

  take() {
    return this.waiting.shift();
  }

  /** Un estado final (executed) no se pisa: una copia o una conciliación tardía no puede decir "falló" de algo que salió. */
  setStatus(s: ActionStatus) {
    if (this.statuses.get(s.id)?.status === "executed") return;
    this.statuses.set(s.id, s);
  }

  status(id: string) {
    return this.statuses.get(id);
  }

  get size() {
    return this.waiting.length;
  }

  /** Un retiro en fila usa un nonce del Exchange (el mismo espacio que abrir y cerrar). */
  hasExchangeNonce(user: Hex, nonce: bigint) {
    return this.waiting.some((q) => q.action.kind === "withdraw" && q.action.action.user.toLowerCase() === user.toLowerCase() && q.action.action.nonce === nonce);
  }

  /** Balance que se va a llevar un retiro todavía no mandado: no se puede usar como margen. */
  reservedWithdraw(user: Hex) {
    let total = 0n;
    for (const q of this.waiting) if (q.action.kind === "withdraw" && q.action.action.user.toLowerCase() === user.toLowerCase()) total += q.action.action.amount;
    return total;
  }
}

export type ActionContext = {
  client: Client;
  chain: ChainState;
  queue: ActionQueue;
  /** Margen reservado por intents en fila (para no retirar lo que un open ya va a usar). */
  reservedMargin: (user: Hex) => bigint;
  /** Nonce de un intent en fila. */
  intentHasNonce: (user: Hex, nonce: bigint) => boolean;
  /** Segundos mínimos que le tienen que quedar al deadline: la acción puede esperar un poco su turno. */
  minDeadlineSeconds: number;
  /** Cada acción le cuesta gas al relayer: topes para que nadie lo vacíe ni tape la fila de los demás. */
  maxPendingPerUser: number;
  maxPending: number;
  dailyQuota: number;
  sessionKeyMaxDuration: number;
};

const reject = (code: RejectCode, message: string): never => {
  throw new Rejected(code, message);
};

/** Mismas reglas que los contratos, para rechazar antes de que el relayer gaste gas. */
export async function validateAction(a: Action, signature: Hex, signer: Hex, ctx: ActionContext) {
  const { client, chain } = ctx;
  const user = a.action.user;
  const now = chain.now();
  if (Number(a.action.deadline) < now + ctx.minDeadlineSeconds) {
    reject("SignatureExpired", `the deadline expires in less than ${ctx.minDeadlineSeconds} s`);
  }

  // Firma: solo la wallet (los contratos no aceptan session keys acá). Con código, por ERC-1271.
  const ok = (await chain.hasCode(user)) ? await chain.isValidErc1271(user, hashTypedData(actionTypedData(a)), signature) : signer.toLowerCase() === user.toLowerCase();
  if (!ok) reject("InvalidSignature", `signed by ${signer}: these actions must be signed by the wallet ${user} (session keys are not accepted)`);
  if (ctx.queue.size >= ctx.maxPending) reject("RateLimited", "the relayer has too many queued actions; try again in a moment");
  const id = actionId(a);
  if (ctx.queue.pendingOf(user, id) >= ctx.maxPendingPerUser) reject("RateLimited", `you already have ${ctx.maxPendingPerUser} actions pending; wait for them to go through`);
  if (ctx.queue.usedToday(user, id) >= ctx.dailyQuota) reject("RateLimited", `you reached ${ctx.dailyQuota} relayer-paid actions today`);

  const read = <T>(contract: { address: Hex; abi: readonly unknown[] }, functionName: string, args: unknown[]) =>
    client.readContract({ ...contract, functionName, args } as never) as Promise<T>;

  const requireActivated = async (u: Hex) => {
    if (!(await read<boolean>(exchange, "activated", [u]))) reject("NotActivated", "deposit into the Exchange first");
  };

  switch (a.kind) {
    case "withdraw": {
      const { to, amount, nonce } = a.action;
      if (ctx.intentHasNonce(user, nonce) || ctx.queue.hasExchangeNonce(user, nonce) || (await chain.nonceUsed(user, nonce))) {
        reject("NonceAlreadyUsed", `nonce ${nonce} already used`);
      }
      if (/^0x0{40}$/i.test(to)) reject("BadRequest", "to cannot be the zero address");
      if (amount === 0n) reject("ZeroAmount", "amount is 0");
      const balance = await chain.balance(user);
      const free = balance - ctx.reservedMargin(user) - ctx.queue.reservedWithdraw(user);
      if (amount > free) reject("InsufficientBalance", `free balance ${free}, withdrawal ${amount}`);
      const minWithdraw = (await read<readonly bigint[]>(exchange, "limits", []))[5]!;
      if (amount < minWithdraw && amount !== balance) reject("BelowMinimum", `minimum withdrawal ${minWithdraw} (or the whole balance)`);
      return;
    }
    case "registerSessionKey": {
      const { key, expiry, epoch, nonce } = a.action;
      // Sin esto, cualquiera crea wallets sin fondos y hace que el relayer pague registros sin límite.
      await requireActivated(user);
      // El contrato firma contra el epoch actual: uno viejo (después de revokeAllSessionKeys) da InvalidSignature.
      const current = await read<bigint>(sessionKeys, "epochOf", [user]);
      if (epoch !== current) reject("StaleEpoch", `epoch ${epoch} is not the current one (${current}): read epochOf(user) and sign again`);
      if (await read<boolean>(sessionKeys, "nonceUsed", [user, nonce])) reject("NonceAlreadyUsed", `nonce ${nonce} already used`);
      if (/^0x0{40}$/i.test(key) || key.toLowerCase() === user.toLowerCase()) reject("InvalidKey", "the session key cannot be zero or the wallet itself");
      if (Number(expiry) <= now + ctx.minDeadlineSeconds || Number(expiry) > now + ctx.sessionKeyMaxDuration) {
        reject("InvalidExpiry", `expiry must be between now and ${ctx.sessionKeyMaxDuration / 86400} days`);
      }
      return;
    }
    case "stake":
    case "unstake":
    case "claim": {
      if (await read<boolean>(staking, "nonceUsed", [user, a.action.nonce])) reject("NonceAlreadyUsed", `nonce ${a.action.nonce} already used`);
      if (a.kind === "claim") {
        if ((await read<bigint>(staking, "pendingReward", [user])) === 0n) reject("NothingToClaim", "no rewards to claim");
        return;
      }
      const amount = a.action.amount;
      if (amount === 0n) reject("ZeroAmount", "amount is 0");
      await requireActivated(user);
      if (a.kind === "stake") {
        const bal = await read<bigint>({ address: token, abi: erc20Abi }, "balanceOf", [user]);
        if (amount > bal) reject("InsufficientBalance", `has ${bal} JACKTRADE, wants to stake ${amount}`);
      } else {
        const staked = await read<bigint>(staking, "stakeOf", [user]);
        if (amount > staked) reject("InsufficientStake", `has ${staked} staked, wants to unstake ${amount}`);
      }
      return;
    }
    case "depositPermit": {
      const { amount, nonce } = a.action;
      const current = await read<bigint>({ address: usdg, abi: [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] }] }, "nonces", [user]);
      if (nonce !== current) reject("NonceAlreadyUsed", `the permit nonce must be ${current} (USDG nonces)`);
      const bal = await read<bigint>({ address: usdg, abi: erc20Abi }, "balanceOf", [user]);
      if (amount > bal) reject("InsufficientBalance", `has ${bal} USDG in the wallet, wants to deposit ${amount}`);
      const [limits, activated] = await Promise.all([read<readonly bigint[]>(exchange, "limits", []), read<boolean>(exchange, "activated", [user])]);
      const min = limits[4]! + (activated ? 0n : limits[6]!);
      if (amount < min) reject("BelowMinimum", `minimum ${min} (minimum deposit${activated ? "" : " + activation fee"})`);
      return;
    }
  }
}

/** La llamada que hace el relayer por el usuario. */
export function actionCall(a: Action, signature: Hex): { to: Hex; data: Hex } {
  switch (a.kind) {
    case "withdraw": {
      const { user, to, amount, nonce, deadline } = a.action;
      return { to: exchange.address, data: encodeFunctionData({ abi: exchange.abi, functionName: "withdrawBySig", args: [user, to, amount, nonce, deadline, signature] }) };
    }
    case "registerSessionKey": {
      const { user, key, expiry, nonce, deadline } = a.action;
      return { to: sessionKeys.address, data: encodeFunctionData({ abi: sessionKeys.abi, functionName: "registerSessionKeyBySig", args: [user, key, expiry, nonce, deadline, signature] }) };
    }
    case "stake":
    case "unstake": {
      const { user, amount, nonce, deadline } = a.action;
      const functionName = a.kind === "stake" ? "stakeBySig" : "unstakeBySig";
      return { to: staking.address, data: encodeFunctionData({ abi: staking.abi, functionName, args: [user, amount, nonce, deadline, signature] }) };
    }
    case "claim": {
      const { user, nonce, deadline } = a.action;
      return { to: staking.address, data: encodeFunctionData({ abi: staking.abi, functionName: "claimBySig", args: [user, nonce, deadline, signature] }) };
    }
    case "depositPermit": {
      const { user, amount, deadline } = a.action;
      const { v, r, s } = hexToSignature(signature);
      return { to: exchange.address, data: encodeFunctionData({ abi: exchange.abi, functionName: "depositWithPermit", args: [user, amount, deadline, Number(v), r, s] }) };
    }
  }
}

export type ActionSenderOptions = {
  client: Client;
  wallet: WalletClient & { account: Account };
  queue: ActionQueue;
  gas: bigint;
};

/**
 * Manda la próxima acción: simula con el mismo gas (si revierte, falla sin gastar), la envía y sigue; el recibo se
 * espera en segundo plano. La llama el loop del batcher, así nunca hay dos envíos a la vez desde la wallet.
 */
export async function sendNextAction(o: ActionSenderOptions) {
  const q = o.queue.take();
  if (!q) return;
  const call = { ...actionCall(q.action, q.signature), gas: o.gas };
  try {
    const [block] = await o.client.simulateBlocks({ blocks: [{ calls: [{ account: o.wallet.account, ...call }] }] });
    const sim = block!.calls[0]!;
    if (sim.status !== "success") {
      const name = errorName(sim.data);
      o.queue.setStatus({ id: q.id, status: "failed", code: (KNOWN.has(name) ? name : "Unknown") as RejectCode, message: `would fail on-chain: ${name}` });
      console.log(`[acción] ${q.id} fallaría por ${name}: se descarta`);
      return;
    }
    let txHash: Hex;
    try {
      txHash = await o.wallet.sendTransaction({ account: o.wallet.account, chain: o.wallet.chain, ...call });
    } catch (e) {
      // Pudo haber salido igual (timeout del RPC después de difundirla): se mira en la cadena antes de decir "falló".
      if (await alreadyDone(o.client, q.action)) {
        o.queue.setStatus({ id: q.id, status: "executed", txHash: "0x" as Hex });
        return;
      }
      o.queue.setStatus({ id: q.id, status: "failed", code: "Unknown", message: `could not be sent: ${safeError(e)}` });
      throw e;
    }
    o.queue.setStatus({ id: q.id, status: "submitted", txHash });
    o.queue.markInFlight(q.id, q.action.action.user);
    console.log(`[acción] ${q.id} enviada · tx ${txHash}`);
    // El recibo se espera aparte: el loop sigue con los batches y la próxima acción (el nonce sale de "pending").
    void o.client
      .waitForTransactionReceipt({ hash: txHash, timeout: 10 * 60_000 })
      .then((receipt) => {
        o.queue.setStatus(
          receipt.status === "success" ? { id: q.id, status: "executed", txHash } : { id: q.id, status: "failed", txHash, code: "Unknown", message: "the transaction reverted" },
        );
        console.log(`[acción] ${q.id} ${receipt.status === "success" ? "✔ ejecutada" : "✖ revirtió"} en el bloque ${receipt.blockNumber}`);
      })
      .catch(async () => {
        const done = await alreadyDone(o.client, q.action).catch(() => false);
        o.queue.setStatus(done ? { id: q.id, status: "executed", txHash } : { id: q.id, status: "failed", txHash, code: "Unknown", message: "the transaction was not confirmed" });
        console.warn(`⚠ ALERTA [acción] ${q.id} sin recibo en 10 min · en la cadena: ${done ? "ejecutada" : "no ejecutada"}`);
      })
      .finally(() => o.queue.settled(q.id));
  } catch (e) {
    if (o.queue.status(q.id)?.status === "queued") o.queue.setStatus({ id: q.id, status: "failed", code: "Unknown", message: `could not be simulated: ${safeError(e)}` });
    throw e;
  }
}

/** Si la acción ya se ejecutó en la cadena: su nonce está usado (o el de USDG avanzó, en un permit). */
async function alreadyDone(client: Client, a: Action) {
  const { user, nonce } = a.action;
  switch (a.kind) {
    case "withdraw":
      return client.readContract({ ...exchange, functionName: "nonceUsed", args: [user, nonce] });
    case "registerSessionKey":
      return client.readContract({ ...sessionKeys, functionName: "nonceUsed", args: [user, nonce] });
    case "stake":
    case "unstake":
    case "claim":
      return client.readContract({ ...staking, functionName: "nonceUsed", args: [user, nonce] });
    case "depositPermit": {
      const current = (await client.readContract({
        address: usdg,
        abi: [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "nonces",
        args: [user],
      })) as bigint;
      return current > nonce;
    }
  }
}

const KNOWN = new Set(["InvalidSignature", "NonceAlreadyUsed", "SignatureExpired", "BelowMinimum", "InsufficientBalance", "InvalidKey", "InvalidExpiry", "InsufficientStake", "ZeroAmount"]);
const ERRORS = [...c.Exchange.abi, ...c.SessionKeyManager.abi, ...c.JackTradeStaking.abi] as const;

function errorName(data: Hex | undefined) {
  if (!data || data === "0x") return "sin motivo (¿sin gas?)";
  try {
    return decodeErrorResult({ abi: ERRORS, data }).errorName;
  } catch {
    return `desconocido (${data.slice(0, 10)})`;
  }
}
