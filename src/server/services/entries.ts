import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { now, today } from "@/lib/clock";
import { canEditFreely, validateEntry, type EntryErrors } from "@/domain/rules";
import { formatMinutes, shortDate } from "@/domain/dates";
import { audit } from "../audit";
import { enqueueSync } from "../sync/enqueue";
import { notify } from "../notify";
import { getSettings } from "../data/common";
import type { TeamUser } from "../session";

export class EntryError extends Error {
  constructor(
    message: string,
    public fields: EntryErrors = {},
  ) {
    super(message);
  }
}

export type EntryInput = {
  itemId: string;
  date: string;
  minutes: number;
  description: string;
  typeId: string;
  isSustentacao?: boolean | null;
  salesOrderLineId?: string | null;
};

const parent = alias(s.items, "parent");

async function loadItem(itemId: string) {
  const [row] = await db
    .select({ item: s.items, parentScope: parent.scopeStatus, client: s.clients, annual: s.annualProjects })
    .from(s.items)
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(eq(s.items.id, itemId));
  if (!row) throw new EntryError("Tarefa não encontrada.", { item: "Escolha a tarefa." });
  return row;
}

async function loadType(typeId: string) {
  const [t] = await db.select().from(s.entryTypes).where(eq(s.entryTypes.id, typeId));
  if (!t) throw new EntryError("Tipo inválido.", { type: "Escolha o tipo." });
  return t;
}

async function check(me: TeamUser, input: EntryInput) {
  const [ctx, type] = await Promise.all([loadItem(input.itemId), loadType(input.typeId)]);
  const errors = validateEntry(
    {
      date: input.date,
      minutes: input.minutes,
      description: input.description,
      salesOrderLineId: input.salesOrderLineId,
      type,
      item: {
        id: ctx.item.id,
        kind: ctx.item.kind,
        scopeStatus: ctx.item.scopeStatus,
        parentScopeStatus: ctx.parentScope,
        outOfScope: ctx.item.outOfScope,
        clientApproval: ctx.item.clientApproval,
        isInternalProject: ctx.client.isInternal,
        archived: ctx.item.archived,
        stage: ctx.item.stage,
      },
    },
    today(),
    me,
  );
  if (input.salesOrderLineId) {
    const [so] = await db.select().from(s.salesOrderLines).where(eq(s.salesOrderLines.id, input.salesOrderLineId));
    if (!so || so.clientId !== ctx.client.id) errors.salesOrder = "Este pedido de venda não é do cliente da tarefa.";
  }
  if (Object.keys(errors).length) throw new EntryError(Object.values(errors)[0]!, errors);
  return { ctx, type };
}

/** US-01: lançar. Sempre em nome de quem está logado. */
export async function createEntry(me: TeamUser, input: EntryInput) {
  const { ctx, type } = await check(me, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.timeEntries)
      .values({
        personId: me.id,
        itemId: input.itemId,
        date: input.date,
        minutes: input.minutes,
        description: input.description.trim(),
        typeId: type.id,
        // US-03: o marcador vem da tarefa, mas a pessoa pode mudar.
        isSustentacao: input.isSustentacao ?? ctx.item.isSustentacao,
        salesOrderLineId: type.acceptsSalesOrder ? (input.salesOrderLineId ?? null) : null,
        syncStatus: "pendente",
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    await audit(tx, { personId: me.id, entity: "time_entry", entityId: row.id, action: "criar", after: row });
    await enqueueSync(tx, "time_entry", row.id, "upsert");
    return row;
  });
}

async function own(me: TeamUser, id: string) {
  const [row] = await db
    .select({ e: s.timeEntries, type: s.entryTypes })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .where(and(eq(s.timeEntries.id, id), isNull(s.timeEntries.deletedAt)));
  // US-04: só o próprio consultor edita ou exclui; gestor não altera horas de outra pessoa.
  if (!row || row.e.personId !== me.id) throw new EntryError("Apontamento não encontrado.");
  return row;
}

function editable(row: { e: typeof s.timeEntries.$inferSelect; type: typeof s.entryTypes.$inferSelect }, settings: Awaited<ReturnType<typeof getSettings>>) {
  return canEditFreely({ createdAt: row.e.createdAt, date: row.e.date, isProvisioning: row.type.isProvisioning }, now(), settings);
}

/** US-04: editar em até 48 h (provisionamento: 48 h a partir da data provisionada). */
export async function updateEntry(me: TeamUser, id: string, input: EntryInput) {
  const row = await own(me, id);
  if (!editable(row, await getSettings())) throw new EntryError("Passaram 48 horas: use Solicitar alteração.");
  if (row.e.pendingChange) throw new EntryError("Há um pedido de alteração pendente para este apontamento.");
  const { ctx, type } = await check(me, input);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.timeEntries)
      .set({
        itemId: input.itemId,
        date: input.date,
        minutes: input.minutes,
        description: input.description.trim(),
        typeId: type.id,
        isSustentacao: input.isSustentacao ?? ctx.item.isSustentacao,
        salesOrderLineId: type.acceptsSalesOrder ? (input.salesOrderLineId ?? null) : null,
        convertedAt: row.type.isProvisioning && !type.isProvisioning ? now() : row.e.convertedAt,
        syncStatus: "pendente",
        updatedAt: now(),
      })
      .where(eq(s.timeEntries.id, id))
      .returning();
    await audit(tx, { personId: me.id, entity: "time_entry", entityId: id, action: row.type.isProvisioning && !type.isProvisioning ? "converter" : "editar", before: row.e, after });
    await enqueueSync(tx, "time_entry", id, "upsert");
    return after;
  });
}

export async function deleteEntry(me: TeamUser, id: string) {
  const row = await own(me, id);
  if (!editable(row, await getSettings())) throw new EntryError("Passaram 48 horas: use Solicitar alteração.");
  if (row.e.pendingChange) throw new EntryError("Há um pedido de alteração pendente para este apontamento.");
  await db.transaction(async (tx) => {
    await tx.update(s.timeEntries).set({ deletedAt: now(), syncStatus: "pendente", updatedAt: now() }).where(eq(s.timeEntries.id, id));
    await audit(tx, { personId: me.id, entity: "time_entry", entityId: id, action: "excluir", before: row.e });
    await enqueueSync(tx, "time_entry", id, "delete");
  });
}

/** US-09: pedir alteração depois de 48 h. */
export async function requestChange(
  me: TeamUser,
  id: string,
  req: { kind: "alterar" | "excluir"; newValues?: Partial<EntryInput>; justification: string },
) {
  const row = await own(me, id);
  if (editable(row, await getSettings())) throw new EntryError("Ainda dentro das 48 horas: edite direto.");
  if (row.e.pendingChange) throw new EntryError("Já existe um pedido pendente para este apontamento.");
  if (!req.justification.trim()) throw new EntryError("A justificativa é obrigatória.", { description: "Explique o motivo." });
  if (req.kind === "alterar") {
    const merged: EntryInput = {
      itemId: req.newValues?.itemId ?? row.e.itemId,
      date: req.newValues?.date ?? row.e.date,
      minutes: req.newValues?.minutes ?? row.e.minutes,
      description: req.newValues?.description ?? row.e.description,
      typeId: req.newValues?.typeId ?? row.e.typeId,
      isSustentacao: req.newValues?.isSustentacao ?? row.e.isSustentacao,
      salesOrderLineId: req.newValues?.salesOrderLineId === undefined ? row.e.salesOrderLineId : req.newValues.salesOrderLineId,
    };
    // Valida como se fosse hoje, exceto a data (que já passou).
    await check(me, merged);
    req.newValues = merged;
  }
  const approvers = await db.select().from(s.people).where(and(eq(s.people.canApproveHours, true), eq(s.people.active, true)));
  return db.transaction(async (tx) => {
    const [cr] = await tx
      .insert(s.changeRequests)
      .values({
        timeEntryId: id,
        personId: me.id,
        kind: req.kind,
        oldValues: {
          itemId: row.e.itemId,
          date: row.e.date,
          minutes: row.e.minutes,
          description: row.e.description,
          typeId: row.e.typeId,
          isSustentacao: row.e.isSustentacao,
          salesOrderLineId: row.e.salesOrderLineId,
        },
        newValues: req.kind === "alterar" ? (req.newValues as Record<string, unknown>) : null,
        justification: req.justification.trim(),
      })
      .returning();
    await tx.update(s.timeEntries).set({ pendingChange: true }).where(eq(s.timeEntries.id, id));
    await audit(tx, { personId: me.id, entity: "change_request", entityId: cr.id, action: "solicitar", after: cr });
    for (const a of approvers) {
      await notify(tx, {
        event: "pedido_alteracao",
        to: { personId: a.id, slackUserId: a.slackUserId },
        title: `${me.name} pediu para ${req.kind === "excluir" ? "excluir" : "alterar"} um apontamento de ${shortDate(row.e.date)}`,
        body: req.justification,
        link: "/gestao/pendencias",
      });
    }
    return cr;
  });
}

/** US-10: Marttini ou Richard aprovam ou recusam (recusa exige motivo). */
export async function decideChange(me: TeamUser, requestId: string, approve: boolean, reason?: string) {
  if (!me.canApproveHours) throw new EntryError("Só Marttini e Richard aprovam alterações de apontamento.");
  const [cr] = await db.select().from(s.changeRequests).where(eq(s.changeRequests.id, requestId));
  if (!cr || cr.status !== "pendente") throw new EntryError("Pedido não encontrado ou já decidido.");
  if (!approve && !reason?.trim()) throw new EntryError("Para recusar, informe o motivo.");
  const [person] = await db.select().from(s.people).where(eq(s.people.id, cr.personId));
  await db.transaction(async (tx) => {
    await tx
      .update(s.changeRequests)
      .set({ status: approve ? "aprovada" : "recusada", decidedBy: me.id, decidedAt: now(), decisionReason: reason?.trim() || null })
      .where(eq(s.changeRequests.id, requestId));
    const [before] = await tx.select().from(s.timeEntries).where(eq(s.timeEntries.id, cr.timeEntryId));
    if (approve) {
      if (cr.kind === "excluir") {
        await tx.update(s.timeEntries).set({ deletedAt: now(), pendingChange: false, syncStatus: "pendente", updatedAt: now() }).where(eq(s.timeEntries.id, cr.timeEntryId));
        await enqueueSync(tx, "time_entry", cr.timeEntryId, "delete");
      } else {
        const v = cr.newValues as Partial<EntryInput>;
        const [type] = await tx.select().from(s.entryTypes).where(eq(s.entryTypes.id, v.typeId ?? before.typeId));
        await tx
          .update(s.timeEntries)
          .set({
            itemId: v.itemId ?? before.itemId,
            date: v.date ?? before.date,
            minutes: v.minutes ?? before.minutes,
            description: v.description ?? before.description,
            typeId: type.id,
            isSustentacao: v.isSustentacao ?? before.isSustentacao,
            salesOrderLineId: type.acceptsSalesOrder ? (v.salesOrderLineId ?? null) : null,
            convertedAt: before.convertedAt ?? (type.isProvisioning ? null : now()),
            pendingChange: false,
            syncStatus: "pendente",
            updatedAt: now(),
          })
          .where(eq(s.timeEntries.id, cr.timeEntryId));
        await enqueueSync(tx, "time_entry", cr.timeEntryId, "upsert");
      }
    } else {
      await tx.update(s.timeEntries).set({ pendingChange: false }).where(eq(s.timeEntries.id, cr.timeEntryId));
    }
    await audit(tx, { personId: me.id, entity: "change_request", entityId: requestId, action: approve ? "aprovar" : "recusar", before, after: { reason } });
    await notify(tx, {
      event: "pedido_alteracao_decidido",
      to: { personId: cr.personId, slackUserId: person?.slackUserId },
      title: approve ? `Seu pedido de alteração de ${shortDate(before.date)} foi aprovado` : `Seu pedido de alteração de ${shortDate(before.date)} foi recusado`,
      body: approve ? `Aprovado por ${me.name}.` : `Motivo: ${reason}`,
      link: "/horas",
    });
  });
}

/** US-11: justificativa de dia sem apontamento (só registro, com comprovante obrigatório). */
export async function justifyAbsence(me: TeamUser, input: { date: string; reasonId: string; note?: string; attachmentId: string }) {
  if (!me.isConsultor) throw new EntryError("Só consultores registram justificativa.");
  if (input.date > today()) throw new EntryError("Justificativa é para dias que já passaram ou hoje.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.absenceJustifications)
      .values({ personId: me.id, date: input.date, reasonId: input.reasonId, note: input.note ?? null, attachmentId: input.attachmentId })
      .onConflictDoUpdate({ target: [s.absenceJustifications.personId, s.absenceJustifications.date], set: { reasonId: input.reasonId, note: input.note ?? null, attachmentId: input.attachmentId } })
      .returning();
    await audit(tx, { personId: me.id, entity: "absence", entityId: row.id, action: "justificar", after: row });
    return row;
  });
}

/** Texto curto de um apontamento, para avisos e auditoria. */
export function describeEntry(e: { date: string; minutes: number }) {
  return `${formatMinutes(e.minutes)} em ${shortDate(e.date)}`;
}

export async function pendingChangeIds(personId: string) {
  const rows = await db
    .select({ id: s.changeRequests.timeEntryId })
    .from(s.changeRequests)
    .where(and(eq(s.changeRequests.personId, personId), inArray(s.changeRequests.status, ["pendente"])));
  return new Set(rows.map((r) => r.id));
}
