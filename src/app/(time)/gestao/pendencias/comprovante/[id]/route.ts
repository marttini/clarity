import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { getFile } from "@/server/storage";

/**
 * US-11: comprovante da justificativa de ausência.
 * Só o próprio consultor e a gestão abrem; o resto do time vê apenas "dia justificado".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireTeam();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Comprovante não encontrado.", { status: 404 });
  const [row] = await db
    .select({ att: s.attachments, personId: s.absenceJustifications.personId })
    .from(s.attachments)
    .innerJoin(s.absenceJustifications, eq(s.absenceJustifications.attachmentId, s.attachments.id))
    .where(and(eq(s.attachments.id, id)));
  if (!row) return new Response("Comprovante não encontrado.", { status: 404 });
  if (!isManager(me) && me.id !== row.personId) return new Response("Só o próprio consultor e a gestão veem o comprovante.", { status: 403 });
  try {
    const data = await getFile(row.att.storagePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": row.att.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.att.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Arquivo não encontrado no armazenamento.", { status: 404 });
  }
}
