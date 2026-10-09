import "server-only";
import { db, schema as s } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Trilha de auditoria: quem mudou o quê, quando, com valores antigos e novos. */
export async function audit(
  tx: Tx | typeof db,
  a: { personId?: string | null; contactId?: string | null; entity: string; entityId: string; action: string; before?: unknown; after?: unknown },
) {
  await tx.insert(s.auditLog).values({
    actorPersonId: a.personId ?? null,
    actorContactId: a.contactId ?? null,
    entity: a.entity,
    entityId: a.entityId,
    action: a.action,
    before: (a.before ?? null) as object | null,
    after: (a.after ?? null) as object | null,
  });
}
export type { Tx };
