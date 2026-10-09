import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendOutbox } from "@/server/services/notifications";

/**
 * Envio dos avisos externos (US-43): Slack para o time, e-mail para clientes.
 * Vercel Cron a cada 10 minutos com `Authorization: Bearer ${CRON_SECRET}`.
 * Em desenvolvimento, sem CRON_SECRET, fica liberada.
 */
export const maxDuration = 120;

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
  try {
    const sent = await sendOutbox({ limit: 200 });
    return NextResponse.json({ ok: true, ms: Date.now() - started, ...sent });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
