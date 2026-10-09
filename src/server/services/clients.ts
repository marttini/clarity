import "server-only";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { audit } from "../audit";
import { notify } from "../notify";
import { isManager, type TeamUser } from "../session";

export class ClientError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

const MAX_NOTES = 5000;

/** US-30: campos próprios do Clarity (ERP e observações internas). Só gestão. Nunca vão ao portal nem ao Odoo. */
export async function updateClientInternal(me: TeamUser, clientId: string, input: { erp?: string | null; internalNotes?: string | null }) {
  if (!isManager(me)) throw new ClientError("Só a gestão edita o ERP e as observações internas.");
  const erp = (input.erp ?? "").trim().slice(0, 80) || null;
  const internalNotes = (input.internalNotes ?? "").trim() || null;
  if (internalNotes && internalNotes.length > MAX_NOTES) throw new ClientError(`Observações com no máximo ${MAX_NOTES} caracteres.`, { internalNotes: "Texto longo demais." });
  const [before] = await db.select().from(s.clients).where(eq(s.clients.id, clientId));
  if (!before) throw new ClientError("Cliente não encontrado.");
  return db.transaction(async (tx) => {
    const [after] = await tx.update(s.clients).set({ erp, internalNotes, updatedAt: now() }).where(eq(s.clients.id, clientId)).returning();
    await audit(tx, {
      personId: me.id,
      entity: "client",
      entityId: clientId,
      action: "editar_dados_internos",
      before: { erp: before.erp, internalNotes: before.internalNotes },
      after: { erp, internalNotes },
    });
    return after;
  });
}

/** Quem pode convidar e revogar acesso ao portal (US-31: consultor e gestão). */
export function canManagePortal(me: TeamUser): boolean {
  return me.active && me.role !== "administrativo";
}

async function loadContact(contactId: string) {
  const [row] = await db
    .select({ c: s.clientContacts, clientName: s.clients.name })
    .from(s.clientContacts)
    .innerJoin(s.clients, eq(s.clients.id, s.clientContacts.clientId))
    .where(eq(s.clientContacts.id, contactId));
  if (!row) throw new ClientError("Contato não encontrado.");
  return row;
}

/**
 * US-31: convidar para o portal. Liga o acesso e manda o convite por e-mail
 * (evento convite_portal; o e-mail sai pela fila de avisos). Reconvidar reenvia.
 */
export async function inviteToPortal(me: TeamUser, contactId: string) {
  if (!canManagePortal(me)) throw new ClientError("Só consultores e gestão convidam para o portal.");
  const { c, clientName } = await loadContact(contactId);
  if (!c.active) throw new ClientError("Este contato está inativo no Odoo. Reative no Odoo para convidar.");
  const email = c.email?.trim().toLowerCase();
  if (!email) throw new ClientError("Contato sem e-mail. Cadastre o e-mail no Odoo e sincronize para convidar.");
  const at = now();
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.clientContacts)
      .set({ portalAccess: true, portalInvitedAt: at, portalRevokedAt: null })
      .where(eq(s.clientContacts.id, contactId))
      .returning();
    await audit(tx, {
      personId: me.id,
      entity: "client_contact",
      entityId: contactId,
      action: "convidar_portal",
      before: { portalAccess: c.portalAccess, portalInvitedAt: c.portalInvitedAt, portalRevokedAt: c.portalRevokedAt },
      after: { portalAccess: true, portalInvitedAt: at },
    });
    await notify(tx, {
      event: "convite_portal",
      to: { contactId, email },
      title: `Convite para o portal da Síntese: ${clientName}`,
      body: `${me.name} convidou você para acompanhar os projetos da ${clientName}. Entre com este e-mail: você recebe um link de acesso, sem senha.`,
      link: "/entrar",
    });
    return after;
  });
}

/** US-31: revogar o acesso ao portal (vale na hora: a sessão do contato deixa de ser aceita). */
export async function revokePortal(me: TeamUser, contactId: string) {
  if (!canManagePortal(me)) throw new ClientError("Só consultores e gestão revogam acesso ao portal.");
  const { c } = await loadContact(contactId);
  if (!c.portalAccess) throw new ClientError("Este contato já está sem acesso ao portal.");
  const at = now();
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.clientContacts)
      .set({ portalAccess: false, portalRevokedAt: at })
      .where(eq(s.clientContacts.id, contactId))
      .returning();
    await audit(tx, {
      personId: me.id,
      entity: "client_contact",
      entityId: contactId,
      action: "revogar_portal",
      before: { portalAccess: true },
      after: { portalAccess: false, portalRevokedAt: at },
    });
    return after;
  });
}
