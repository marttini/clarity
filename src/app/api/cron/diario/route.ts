import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDaily, sendOutbox } from "@/server/services/notifications";

/**
 * Rotina diária (US-43), dias úteis às 8h: lembretes com no máximo um envio por dia por
 * pendência e o resumo diário da gestão no #clarity-gestao. Em seguida envia o que já pode sair.
 * `?parte=fim-do-dia` (opcional, ~17h) só lembra quem ainda não apontou horas hoje.
 * Protegida por `Authorization: Bearer ${CRON_SECRET}`; em desenvolvimento, sem CRON_SECRET, fica liberada.
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
  const part = req.nextUrl.searchParams.get("parte") === "fim-do-dia" ? "fim-do-dia" : "manha";
  try {
    const daily = await runDaily({ part });
    const sent = await sendOutbox({ limit: 200 });
    return NextResponse.json({ ok: true, ms: Date.now() - started, part, daily, sent });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
