/**
 * Barreiras de produção: login de teste só fora de produção (ou com ALLOW_DEV_AUTH) e
 * rotinas agendadas (cron) só com CRON_SECRET em produção.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://postgres@localhost:5432/clarity_test";
});

vi.mock("@/server/services/notifications", () => ({
  sendOutbox: vi.fn(async () => ({ sent: 0 })),
  runDaily: vi.fn(async () => ({})),
}));
vi.mock("@/server/odoo/pull", () => ({ pullFromOdoo: vi.fn(async () => ({ errors: [] })) }));
vi.mock("@/server/odoo/push", () => ({ processQueue: vi.fn(async () => ({ sent: 0 })) }));

import { NextRequest } from "next/server";
import { devAuthAllowed } from "@/server/session";
import { GET as cronSync } from "@/app/api/cron/sync/route";
import { GET as cronAvisos } from "@/app/api/cron/avisos/route";
import { GET as cronDiario } from "@/app/api/cron/diario/route";

afterEach(() => vi.unstubAllEnvs());

describe("login de teste", () => {
  it("vale em desenvolvimento", () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "development");
    expect(devAuthAllowed()).toBe(true);
  });
  it("é bloqueado em produção sem ALLOW_DEV_AUTH", () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_AUTH", "");
    expect(devAuthAllowed()).toBe(false);
    vi.stubEnv("ALLOW_DEV_AUTH", "true");
    expect(devAuthAllowed()).toBe(true);
  });
  it("não existe com login Supabase", () => {
    vi.stubEnv("AUTH_MODE", "supabase");
    vi.stubEnv("NODE_ENV", "development");
    expect(devAuthAllowed()).toBe(false);
  });
});

describe("cron protegido por CRON_SECRET", () => {
  const routes = { sync: cronSync, avisos: cronAvisos, diario: cronDiario };
  const req = (auth?: string) => new NextRequest("http://localhost/api/cron/x", { headers: auth ? { authorization: auth } : {} });

  for (const [name, GET] of Object.entries(routes)) {
    it(`${name}: produção sem segredo configurado recusa`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "");
      expect((await GET(req())).status).toBe(401);
    });
    it(`${name}: produção com segredo exige o Bearer certo`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "s3gredo-de-teste");
      expect((await GET(req())).status).toBe(401);
      expect((await GET(req("Bearer errado"))).status).toBe(401);
      expect((await GET(req("Bearer s3gredo-de-teste"))).status).toBe(200);
    });
  }
});
