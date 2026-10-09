/**
 * Banco próprio do E2E (clarity_e2e): cria se faltar, aplica as migrações e recria os dados fictícios
 * de 08/10/2026. Não derruba o banco (o next dev já pode estar conectado); o seed esvazia as tabelas.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "./env";

export default async function globalSetup() {
  const url = new URL(E2E_DATABASE_URL);
  const name = url.pathname.slice(1);
  const admin = new URL(E2E_DATABASE_URL);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql`select 1 from pg_database where datname = ${name}`;
    if (!row) await sql.unsafe(`create database "${name.replace(/"/g, "")}"`);
  } finally {
    await sql.end();
  }
  const root = process.cwd();
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, CLARITY_NOW: "2026-10-08T13:00:00-03:00" };
  const tsx = path.join(root, "node_modules/.bin/tsx");
  execFileSync(tsx, ["scripts/migrate.ts"], { cwd: root, env, stdio: "pipe" });
  execFileSync(tsx, ["scripts/seed.ts", "--today=2026-10-08"], { cwd: root, env, stdio: "pipe" });
}
