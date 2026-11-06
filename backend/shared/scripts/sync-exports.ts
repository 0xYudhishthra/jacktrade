/**
 * Genera direcciones, ABIs y tipos EIP-712 desde `main` de jacktradeexchange/contracts (lo desplegado)
 * y los escribe en shared/src/generated como módulos TS con `as const`, para que viem tipe las llamadas.
 *
 *   pnpm sync:exports
 *
 * Clona `main` en una carpeta temporal: no lee ni toca tu copia local de contracts, esté en la rama que esté.
 * Otra rama solo con CONTRACTS_REF=<rama> (por defecto main). CONTRACTS_COMMIT=<sha> exige ese commit exacto.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = process.env.CONTRACTS_REPO ?? "jacktradeexchange/contracts";
const ref = process.env.CONTRACTS_REF ?? "main";
const outDir = path.resolve("shared/src/generated");
const dir = mkdtempSync(path.join(tmpdir(), "hm-contracts-"));
// Entorno mínimo para npm y hardhat: el .env del backend (claves, RPC) no tiene por qué llegar a código de otro repo.
const baseEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "" };

// La salida (avisos del compilador, npm) solo se muestra si el comando falla.
function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  try {
    execFileSync(cmd, args, { cwd: dir, stdio: "pipe", env: { ...baseEnv, ...env } });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    console.error(`${stdout ?? ""}${stderr ?? ""}`);
    throw new Error(`Falló: ${cmd} ${args.join(" ")}`);
  }
}

try {
  console.log(`Clonando ${repo}@${ref}…`);
  execFileSync("gh", ["repo", "clone", repo, dir, "--", "--depth", "1", "--branch", ref, "--quiet"], { stdio: "inherit" });
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir }).toString().trim();
  // CONTRACTS_COMMIT fija el commit esperado: si main cambió, no se genera nada sin revisarlo antes.
  const expected = process.env.CONTRACTS_COMMIT;
  if (expected && !commit.startsWith(expected.slice(0, 7))) throw new Error(`${ref} está en ${commit}, se esperaba ${expected}`);

  console.log("Instalando dependencias y compilando…");
  run("npm", ["ci", "--silent", "--no-audit", "--no-fund"]);
  for (const chainId of ["4663", "31337"]) run("npx", ["hardhat", "run", "scripts/export.ts"], { CHAIN_ID: chainId });

  const exportsDir = path.join(dir, "exports");
  for (const file of readdirSync(exportsDir).filter((f) => /^jacktrade\.\d+\.json$/.test(f))) {
    // Se parsea y se vuelve a serializar: lo que se escribe como TypeScript es solo datos, nunca código.
    const json = JSON.stringify(JSON.parse(readFileSync(path.join(exportsDir, file), "utf8")), null, 2);
    const out = path.join(outDir, `jacktrade.${file.split(".")[1]}.ts`);
    writeFileSync(out, `// Generado por pnpm sync:exports desde ${repo}@${ref} (${commit}). No editar.\nexport default ${json.trim()} as const;\n`);
    console.log(`Escrito ${path.relative(process.cwd(), out)} (${ref} @ ${commit})`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
