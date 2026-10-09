/**
 * Banco de testes de integração (clarity_test).
 * Importe este arquivo ANTES de qualquer módulo que use "@/db": ele fixa DATABASE_URL.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test";
process.env.DATABASE_URL = TEST_DATABASE_URL;

let migrated = false;

/** Aplica as migrações (uma vez por processo). */
export async function migrateTestDb() {
  if (migrated) return;
  const client = postgres(TEST_DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  } finally {
    await client.end();
  }
  migrated = true;
}

/** Esvazia todas as tabelas do schema public. */
export async function truncateAll() {
  const { pg } = await import("@/db");
  const rows = await pg<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (!rows.length) return;
  await pg.unsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}
