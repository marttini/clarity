import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pullFromOdoo } from "@/server/odoo/pull";
import { processQueue } from "@/server/odoo/push";

/**
 * Rotina de sincronização com o Odoo (US-05, US-21, US-28, US-32): lê o que mudou no Odoo
 * e envia a fila. Chamada pelo Vercel Cron a cada 15 minutos com `Authorization: Bearer ${CRON_SECRET}`.
 * Em desenvolvimento, sem CRON_SECRET, fica liberada.
 */
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const started = Date.now();
  const skipPull = req.nextUrl.searchParams.get("pull") === "0";
  let pull: Awaited<ReturnType<typeof pullFromOdoo>> | { error: string } | null = null;
  if (!skipPull) {
    try {
      pull = await pullFromOdoo();
    } catch (e) {
      pull = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  let push: Awaited<ReturnType<typeof processQueue>> | { error: string };
  try {
    push = await processQueue({ limit: 100 });
  } catch (e) {
    push = { error: e instanceof Error ? e.message : String(e) };
  }
  const ok = !(pull && "error" in pull) && !("error" in push) && !(pull && "errors" in pull && pull.errors.length);
  return NextResponse.json({ ok, ms: Date.now() - started, pull, push }, { status: ok ? 200 : 207 });
}
