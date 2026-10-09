import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/session";
import { getFile } from "@/server/storage";
import { attachmentForDownload } from "@/server/services/portal";

/** Download de anexo pelo portal: só anexo não interno de item visível do próprio cliente. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session || session.kind !== "client") return NextResponse.json({ error: "Entre no portal para baixar." }, { status: 401 });
  const a = await attachmentForDownload(session.contact, id);
  if (!a) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  let data: Buffer;
  try {
    data = await getFile(a.storagePath);
  } catch {
    return NextResponse.json({ error: "Arquivo indisponível no momento. Avise a Síntese." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": a.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
