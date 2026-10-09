import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getSession } from "@/server/session";
import { getFile } from "@/server/storage";

/**
 * Download de anexo (US-39, US-42).
 * Time: vê tudo. Contato do cliente: só anexo não interno de item visível do próprio cliente
 * (direto no item ou num comentário do canal Cliente). Comprovantes e justificativas nunca.
 */
const INLINE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/;

async function clientCanSee(contactClientId: string, a: typeof s.attachments.$inferSelect) {
  if (a.internal) return false;
  let itemId: string | null = null;
  if (a.ownerType === "item") itemId = a.ownerId;
  else if (a.ownerType === "comment") {
    const [c] = await db.select().from(s.comments).where(eq(s.comments.id, a.ownerId));
    if (!c || c.deletedAt || c.channel !== "cliente" || !c.itemId) return false;
    itemId = c.itemId;
  } else return false;
  const [row] = await db
    .select({ visible: s.items.visibleToClient, archived: s.items.archived, clientId: s.annualProjects.clientId })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(eq(s.items.id, itemId));
  return !!row && row.visible && !row.archived && row.clientId === contactClientId;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Entre no Clarity para baixar este arquivo.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Anexo não encontrado.", { status: 404 });
  const [a] = await db.select().from(s.attachments).where(eq(s.attachments.id, id));
  if (!a) return new Response("Anexo não encontrado.", { status: 404 });
  if (session.kind === "client" && !(await clientCanSee(session.contact.clientId, a))) {
    // Não revela se o anexo existe.
    return new Response("Anexo não encontrado.", { status: 404 });
  }
  let data: Buffer;
  try {
    data = await getFile(a.storagePath);
  } catch {
    return new Response("Arquivo indisponível no armazenamento.", { status: 404 });
  }
  const download = req.nextUrl.searchParams.get("baixar") === "1" || !INLINE.test(a.mime);
  const name = encodeURIComponent(a.filename);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": INLINE.test(a.mime) ? a.mime : "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
