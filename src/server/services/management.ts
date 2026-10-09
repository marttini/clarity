import "server-only";
/**
 * Casos de uso da gestão (US-10, US-12, US-33, US-47).
 * Toda escrita checa permissão aqui, grava auditoria e dispara os avisos da US-43.
 */
import { and, asc, eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now, today } from "@/lib/clock";
import { addWorkdays, startOfDayInstant } from "@/domain/dates";
import { audit } from "../audit";
import { notify } from "../notify";
import { getHolidays } from "../data/common";
import { isManager, type TeamUser } from "../session";
import { resend } from "../odoo/push";

export class ManagementError extends Error {}

function requireManager(me: TeamUser) {
  if (!isManager(me)) throw new ManagementError("Só a gestão pode fazer isso.");
}

/**
 * US-33: a gestão decide, uma a uma, publicar a avaliação para o time ou mantê-la oculta (uso só em feedback).
 * "Manter oculta" registra a decisão (published_by/published_at preenchidos com published = false).
 */
export async function decideEvaluation(me: TeamUser, evaluationId: string, publish: boolean) {
  requireManager(me);
  const [ev] = await db.select().from(s.evaluations).where(eq(s.evaluations.id, evaluationId));
  if (!ev) throw new ManagementError("Avaliação não encontrada.");
  const at = now();
  await db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.evaluations)
      .set({ published: publish, publishedBy: me.id, publishedAt: at })
      .where(eq(s.evaluations.id, evaluationId))
      .returning();
    await audit(tx, { personId: me.id, entity: "evaluation", entityId: evaluationId, action: publish ? "publicar" : "manter_oculta", before: ev, after });
    if (publish && ev.consultantId && !ev.published) {
      // Só no sino: a avaliação já foi avisada à gestão quando chegou.
      await notify(tx, {
        event: "avaliacao_recebida",
        to: { personId: ev.consultantId },
        title: "Uma avaliação de cliente foi publicada na sua ficha",
        link: `/time/${ev.consultantId}#avaliacoes`,
        external: "none",
      });
    }
  });
}

/** Desfaz a decisão: a avaliação volta para "a publicar" (oculta). */
export async function reopenEvaluation(me: TeamUser, evaluationId: string) {
  requireManager(me);
  const [ev] = await db.select().from(s.evaluations).where(eq(s.evaluations.id, evaluationId));
  if (!ev) throw new ManagementError("Avaliação não encontrada.");
  await db.transaction(async (tx) => {
    await tx.update(s.evaluations).set({ published: false, publishedBy: null, publishedAt: null }).where(eq(s.evaluations.id, evaluationId));
    await audit(tx, { personId: me.id, entity: "evaluation", entityId: evaluationId, action: "reabrir", before: ev });
  });
}

/** Pessoa administrativa que cobra os clientes (Maria). Prefere quem se chama Maria. */
async function collector() {
  const rows = await db
    .select()
    .from(s.people)
    .where(and(eq(s.people.role, "administrativo"), eq(s.people.active, true)))
    .orderBy(asc(s.people.name));
  return rows.find((p) => p.name.toLowerCase().startsWith("maria")) ?? rows[0] ?? null;
}

/**
 * Demanda adicional parada com o cliente: "Cobrar cliente" agenda um contato para a Maria
 * (administrativo) no próximo dia útil, às 10h, com objetivo "Cobrar aprovação da demanda X".
 * Não duplica: se já existe cobrança agendada, devolve a existente.
 */
export async function chargeClientForDemand(me: TeamUser, itemId: string) {
  requireManager(me);
  const [row] = await db
    .select({ item: s.items, clientId: s.annualProjects.clientId })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(eq(s.items.id, itemId));
  if (!row) throw new ManagementError("Demanda não encontrada.");
  if (!row.item.outOfScope || row.item.clientApproval !== "aguardando") throw new ManagementError("Esta demanda não está aguardando o cliente.");
  const [existing] = await db
    .select()
    .from(s.contacts)
    .where(and(eq(s.contacts.relatedItemId, itemId), eq(s.contacts.status, "agendado"), like(s.contacts.objective, "Cobrar aprovação%")));
  if (existing) return { contact: existing, created: false };
  const maria = await collector();
  if (!maria) throw new ManagementError("Cadastre uma pessoa do administrativo para receber a cobrança.");
  const day = addWorkdays(today(), 1, await getHolidays());
  const at = new Date(startOfDayInstant(day).getTime() + 10 * 3_600_000);
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(s.contacts)
      .values({
        clientId: row.clientId,
        clientContactId: row.item.requestedByContactId,
        type: "ligacao",
        responsibleId: maria.id,
        scheduledAt: at,
        objective: `Cobrar aprovação da demanda ${row.item.name}`,
        relatedItemId: itemId,
        createdBy: me.id,
      })
      .returning();
    await audit(tx, { personId: me.id, entity: "contact", entityId: contact.id, action: "cobrar_demanda", after: contact });
    // US-43: contato agendado vai para a Agenda Google do responsável. Aqui fica no sino;
    // o evento na agenda sai pelo serviço de contatos quando ele existir.
    await notify(tx, {
      event: "contato_agendado",
      to: { personId: maria.id, slackUserId: maria.slackUserId },
      title: `Cobrar aprovação da demanda ${row.item.name}`,
      body: `Pedido de ${me.name}.`,
      link: "/contatos",
      external: "none",
    });
    return { contact, created: true };
  });
}

/** US-21: reenviar ao Odoo um item ou apontamento com erro de sincronização. */
export async function resendSync(me: TeamUser, entity: "time_entry" | "item", entityId: string) {
  requireManager(me);
  if (entity !== "time_entry" && entity !== "item") throw new ManagementError("Tipo de registro inválido.");
  await resend(entity, entityId);
  await audit(db, { personId: me.id, entity, entityId, action: "reenviar_odoo" });
}
