import "server-only";
import { and, eq, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema as s } from "@/db";
import { checkFile, putFile } from "./storage";
import type { Tx } from "./audit";
import { enqueueSync } from "./sync/enqueue";

export type Uploader = { personId?: string; contactId?: string };

/** Guarda um arquivo e registra o anexo. Mesmo nome no mesmo lugar = nova versão (a anterior fica). */
export async function saveAttachment(
  tx: Tx | typeof db,
  file: File,
  owner: { type: string; id: string },
  by: Uploader,
  opts: { internal?: boolean } = {},
) {
  const err = checkFile(file.name, file.size);
  if (err) throw new Error(err);
  const [{ v }] = await tx
    .select({ v: max(s.attachments.version) })
    .from(s.attachments)
    .where(and(eq(s.attachments.ownerType, owner.type), eq(s.attachments.ownerId, owner.id), eq(s.attachments.filename, file.name)));
  const key = `${owner.type}/${owner.id}/${randomUUID()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  await putFile(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
  const [row] = await tx
    .insert(s.attachments)
    .values({
      ownerType: owner.type,
      ownerId: owner.id,
      filename: file.name,
      storagePath: key,
      sizeBytes: file.size,
      mime: file.type || "application/octet-stream",
      version: (v ?? 0) + 1,
      internal: !!opts.internal,
      uploadedByPersonId: by.personId ?? null,
      uploadedByContactId: by.contactId ?? null,
    })
    .returning();
  // US-39: anexo de projeto ou tarefa também vai para o Odoo (exceto rascunho, tratado na fila).
  if (owner.type === "item" && !opts.internal) await enqueueSync(tx, "attachment", row.id, "upsert");
  return row;
}
