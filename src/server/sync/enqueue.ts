import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Tx } from "../audit";

/**
 * Coloca uma operação na fila de envio ao Odoo (US-05, US-21).
 * Nenhuma tela chama o Odoo direto: se o Odoo cair, o Clarity continua.
 * Se já houver uma operação pendente para o mesmo registro, ela é reaproveitada.
 */
export async function enqueueSync(tx: Tx | typeof db, entity: "time_entry" | "item" | "attachment", entityId: string, op: "upsert" | "delete") {
  const pending = await tx
    .select({ id: s.syncQueue.id })
    .from(s.syncQueue)
    .where(and(eq(s.syncQueue.entity, entity), eq(s.syncQueue.entityId, entityId), eq(s.syncQueue.status, "pendente")));
  if (pending[0]) {
    await tx.update(s.syncQueue).set({ op, updatedAt: new Date(), nextAttemptAt: new Date() }).where(eq(s.syncQueue.id, pending[0].id));
    return;
  }
  await tx.insert(s.syncQueue).values({ entity, entityId, op });
}
