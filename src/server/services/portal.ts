import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { addDays, endOfMonth, startOfMonth, shortDate, toISODate, type ISODate } from "@/domain/dates";
import { audit } from "../audit";
import { notify } from "../notify";
import { saveAttachment } from "../attachments";
import { checkFile } from "../storage";
import { enqueueSync } from "../sync/enqueue";
import type { ClientUser } from "../session";

/**
 * Portal do cliente (US-19, US-23, US-25, US-27, US-41, US-42, avaliações, convites).
 * Regra de ouro: TODA consulta parte do cliente do contato logado (contact.clientId) e só
 * enxerga itens com visible_to_client. O cliente nunca vê Provisionamento, Interno,
 * avaliações de outros, justificativas, observações internas, canal Interno nem anexos internos.
 */
export class PortalError extends Error {}

type Item = typeof s.items.$inferSelect;

/** Tipos que o cliente vê nas horas: só Faturável e Bonificado. */
export const CLIENT_TYPE_CODES = ["faturavel", "bonificado"] as const;

/** Condição base de visibilidade: item do cliente do contato, visível, não arquivado e fora de rascunho. */
function visibleWhere(clientId: string) {
  return and(
    eq(s.annualProjects.clientId, clientId),
    eq(s.items.visibleToClient, true),
    eq(s.items.archived, false),
    ne(s.items.scopeStatus, "rascunho"),
  );
}

export async function visibleItems(contact: Pick<ClientUser, "clientId">): Promise<Item[]> {
  const rows = await db
    .select({ item: s.items })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(visibleWhere(contact.clientId), eq(s.clients.isInternal, false)))
    .orderBy(asc(s.items.createdAt));
  const items = rows.map((r) => r.item);
  // Tarefa de projeto em rascunho também fica de fora.
  const parentIds = [...new Set(items.map((i) => i.parentId).filter((x): x is string => !!x))];
  const drafts = parentIds.length
    ? new Set((await db.select({ id: s.items.id }).from(s.items).where(and(inArray(s.items.id, parentIds), eq(s.items.scopeStatus, "rascunho")))).map((r) => r.id))
    : new Set<string>();
  return items.filter((i) => !i.parentId || !drafts.has(i.parentId));
}

/** Item visível para este contato, ou erro. Use antes de toda escrita do portal. */
export async function getVisibleItem(contact: Pick<ClientUser, "clientId">, itemId: string): Promise<Item> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new PortalError("Item não encontrado.");
  const items = await visibleItems(contact);
  const it = items.find((i) => i.id === itemId);
  if (!it) throw new PortalError("Item não encontrado.");
  return it;
}

/** Agrupa os itens visíveis: projetos com as tarefas visíveis e tarefas avulsas. */
export function groupItems(items: Item[]) {
  const projects = items.filter((i) => i.kind === "projeto");
  const pIds = new Set(projects.map((p) => p.id));
  const children = new Map<string, Item[]>();
  const loose: Item[] = [];
  for (const i of items) {
    if (i.kind === "projeto") continue;
    if (i.parentId && pIds.has(i.parentId)) {
      if (!children.has(i.parentId)) children.set(i.parentId, []);
      children.get(i.parentId)!.push(i);
    } else loose.push(i);
  }
  return { projects, children, loose };
}

// ---------- Horas (só Faturável e Bonificado, só itens visíveis) ----------

export type HoursRow = { itemId: string; faturavel: number; bonificado: number };

export async function hoursByItem(contact: Pick<ClientUser, "clientId">, month: ISODate): Promise<HoursRow[]> {
  const ids = (await visibleItems(contact)).map((i) => i.id);
  if (!ids.length) return [];
  const rows = await db
    .select({ itemId: s.timeEntries.itemId, code: s.entryTypes.code, minutes: sql<number>`sum(${s.timeEntries.minutes})::int` })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(
      and(
        inArray(s.timeEntries.itemId, ids),
        eq(s.annualProjects.clientId, contact.clientId),
        isNull(s.timeEntries.deletedAt),
        inArray(s.entryTypes.code, [...CLIENT_TYPE_CODES]),
        eq(s.entryTypes.isProvisioning, false),
        eq(s.entryTypes.isInternal, false),
        gte(s.timeEntries.date, startOfMonth(month)),
        lte(s.timeEntries.date, endOfMonth(month)),
      ),
    )
    .groupBy(s.timeEntries.itemId, s.entryTypes.code);
  const m = new Map<string, HoursRow>();
  for (const r of rows) {
    if (!m.has(r.itemId)) m.set(r.itemId, { itemId: r.itemId, faturavel: 0, bonificado: 0 });
    const h = m.get(r.itemId)!;
    if (r.code === "faturavel") h.faturavel += r.minutes;
    else h.bonificado += r.minutes;
  }
  return [...m.values()];
}

/** Horas totais (todas as datas) por item visível, Faturável + Bonificado. */
export async function totalHoursByItem(contact: Pick<ClientUser, "clientId">, itemIds: string[]) {
  const vis = new Set((await visibleItems(contact)).map((i) => i.id));
  const ids = itemIds.filter((i) => vis.has(i));
  if (!ids.length) return new Map<string, number>();
  const rows = await db
    .select({ itemId: s.timeEntries.itemId, minutes: sql<number>`sum(${s.timeEntries.minutes})::int` })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .where(and(inArray(s.timeEntries.itemId, ids), isNull(s.timeEntries.deletedAt), inArray(s.entryTypes.code, [...CLIENT_TYPE_CODES]), eq(s.entryTypes.isProvisioning, false)))
    .groupBy(s.timeEntries.itemId);
  return new Map(rows.map((r) => [r.itemId, r.minutes]));
}

// ---------- Andamento ----------

export async function stageDates(contact: Pick<ClientUser, "clientId">, itemId: string) {
  await getVisibleItem(contact, itemId);
  return db.select({ to: s.stageHistory.toStage, at: s.stageHistory.at }).from(s.stageHistory).where(eq(s.stageHistory.itemId, itemId)).orderBy(asc(s.stageHistory.at));
}

export async function assigneesOf(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { id: string; name: string }[]>();
  const rows = await db
    .select({ itemId: s.itemAssignees.itemId, id: s.people.id, name: s.people.name })
    .from(s.itemAssignees)
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .where(inArray(s.itemAssignees.itemId, itemIds))
    .orderBy(asc(s.people.name));
  const m = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) {
    if (!m.has(r.itemId)) m.set(r.itemId, []);
    m.get(r.itemId)!.push({ id: r.id, name: r.name });
  }
  return m;
}

const STAGE_PT: Record<string, string> = {
  analise: "Análise e aprovação",
  estimativa: "Estimativa de esforço",
  alocacao: "Alocação da equipe",
  andamento: "Em andamento",
  concluido: "Concluído",
};
const first = (n: string) => n.split(/\s+/)[0];

/** Última atualização de um projeto (ou tarefa) em uma frase, a partir de eventos que o cliente pode ver. */
export async function lastUpdate(contact: Pick<ClientUser, "clientId">, item: Item, children: Item[]): Promise<{ at: Date; text: string } | null> {
  await getVisibleItem(contact, item.id);
  const ids = [item.id, ...children.map((c) => c.id)];
  const names = new Map([item, ...children].map((i) => [i.id, i.name]));
  const [st] = await db
    .select({ itemId: s.stageHistory.itemId, to: s.stageHistory.toStage, at: s.stageHistory.at, who: s.people.name })
    .from(s.stageHistory)
    .leftJoin(s.people, eq(s.people.id, s.stageHistory.byPersonId))
    .where(inArray(s.stageHistory.itemId, ids))
    .orderBy(desc(s.stageHistory.at))
    .limit(1);
  const [cm] = await db
    .select({ itemId: s.comments.itemId, at: s.comments.createdAt, who: s.people.name })
    .from(s.comments)
    .innerJoin(s.people, eq(s.people.id, s.comments.authorPersonId))
    .where(and(inArray(s.comments.itemId, ids), eq(s.comments.channel, "cliente"), isNull(s.comments.deletedAt)))
    .orderBy(desc(s.comments.createdAt))
    .limit(1);
  const cands: { at: Date; text: string }[] = [];
  if (st) {
    const name = names.get(st.itemId) ?? "";
    const who = st.who ? first(st.who) : "A equipe";
    const isSelf = st.itemId === item.id;
    cands.push({
      at: st.at,
      text: st.to === "concluido" ? `${who} concluiu ${isSelf ? "este item" : `"${name}"`}.` : `${who} moveu ${isSelf ? "o projeto" : `"${name}"`} para ${STAGE_PT[st.to]}.`,
    });
  }
  if (cm) cands.push({ at: cm.at, text: `${first(cm.who)} escreveu para vocês em "${names.get(cm.itemId!) ?? ""}".` });
  for (const c of children) if (c.completedAt) cands.push({ at: c.completedAt, text: `"${c.name}" foi concluída.` });
  if (!cands.length) return { at: item.createdAt, text: "Projeto aberto pela Síntese." };
  return cands.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
}

/** Escopo confirmado (versão vigente), só leitura (US-23). Rascunho nunca aparece. */
export async function confirmedScope(contact: Pick<ClientUser, "clientId">, projectId: string) {
  const it = await getVisibleItem(contact, projectId);
  if (it.kind !== "projeto" || it.scopeStatus !== "confirmado") return null;
  const [v] = await db
    .select()
    .from(s.scopeVersions)
    .where(and(eq(s.scopeVersions.itemId, projectId), gte(s.scopeVersions.version, 1), sql`${s.scopeVersions.confirmedAt} is not null`))
    .orderBy(desc(s.scopeVersions.version))
    .limit(1);
  if (!v) return null;
  const dels = await db
    .select({ number: s.deliverables.number, title: s.deliverables.title, description: s.deliverables.description })
    .from(s.deliverables)
    .where(eq(s.deliverables.scopeVersionId, v.id))
    .orderBy(asc(s.deliverables.number));
  return { version: v.version, confirmedAt: v.confirmedAt, objective: v.objective, exclusions: v.exclusions, assumptions: v.assumptions, deliverables: dels };
}

// ---------- Demandas adicionais (US-25, US-27) ----------

export async function listDemands(contact: Pick<ClientUser, "clientId">) {
  const items = (await visibleItems(contact)).filter((i) => i.outOfScope && i.clientApproval !== "nao_se_aplica");
  if (!items.length) return [];
  const contactIds = [...new Set(items.flatMap((i) => [i.requestedByContactId, i.clientApprovalByContactId]).filter((x): x is string => !!x))];
  const contacts = contactIds.length
    ? await db
        .select({ id: s.clientContacts.id, name: s.clientContacts.name })
        .from(s.clientContacts)
        .where(and(inArray(s.clientContacts.id, contactIds), eq(s.clientContacts.clientId, contact.clientId)))
    : [];
  const cName = new Map(contacts.map((c) => [c.id, c.name]));
  const parents = new Map((await visibleItems(contact)).map((i) => [i.id, i.name]));
  const hours = await totalHoursByItem(contact, items.map((i) => i.id));
  return items
    .map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      project: i.parentId ? (parents.get(i.parentId) ?? null) : null,
      status: i.clientApproval as "aguardando" | "aprovada" | "recusada",
      requestedBy: i.requestedByContactId ? (cName.get(i.requestedByContactId) ?? null) : null,
      requestedById: i.requestedByContactId,
      requestedAt: i.requestedAt ?? toISODate(i.createdAt),
      estimateMinutes: i.plannedMinutes,
      workedMinutes: hours.get(i.id) ?? 0,
      decidedAt: i.clientApprovalAt,
      decidedBy: i.clientApprovalByContactId ? (cName.get(i.clientApprovalByContactId) ?? null) : i.clientApprovalRegisteredBy ? "a equipe da Síntese" : null,
      reason: i.clientApproval === "recusada" ? i.clientApprovalReason : null,
      stage: i.stage,
    }))
    .sort((a, b) => (a.status === "aguardando" ? 0 : 1) - (b.status === "aguardando" ? 0 : 1) || b.requestedAt.localeCompare(a.requestedAt));
}

async function responsibles(item: Item) {
  let rows = await db
    .select({ id: s.people.id, slack: s.people.slackUserId })
    .from(s.itemAssignees)
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .where(and(eq(s.itemAssignees.itemId, item.id), eq(s.people.active, true)));
  if (!rows.length && item.parentId)
    rows = await db
      .select({ id: s.people.id, slack: s.people.slackUserId })
      .from(s.itemAssignees)
      .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
      .where(and(eq(s.itemAssignees.itemId, item.parentId), eq(s.people.active, true)));
  if (!rows.length) rows = await managers();
  return rows;
}

async function managers() {
  return db
    .select({ id: s.people.id, slack: s.people.slackUserId })
    .from(s.people)
    .where(and(eq(s.people.active, true), inArray(s.people.role, ["administrador", "gestor"])));
}

/** US-27: qualquer contato com acesso aprova ou recusa (recusa exige motivo e cancela a demanda). */
export async function decideDemand(contact: ClientUser, itemId: string, approve: boolean, reason?: string) {
  const it = await getVisibleItem(contact, itemId);
  if (!it.outOfScope) throw new PortalError("Este item não é uma demanda adicional.");
  if (it.clientApproval !== "aguardando") throw new PortalError("Esta demanda já foi decidida.");
  const why = reason?.trim() ?? "";
  if (!approve && !why) throw new PortalError("Escreva o motivo para confirmar a recusa.");
  const at = now();
  const to = await responsibles(it);
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.items)
      .set({
        clientApproval: approve ? "aprovada" : "recusada",
        clientApprovalAt: at,
        clientApprovalByContactId: contact.id,
        clientApprovalRegisteredBy: null,
        clientApprovalReason: approve ? null : why.slice(0, 1000),
        updatedAt: at,
      })
      .where(and(eq(s.items.id, itemId), eq(s.items.clientApproval, "aguardando")))
      .returning();
    if (!after) throw new PortalError("Esta demanda já foi decidida.");
    await audit(tx, { contactId: contact.id, entity: "item", entityId: itemId, action: approve ? "cliente_aprovar" : "cliente_recusar", before: { clientApproval: it.clientApproval }, after: { clientApproval: after.clientApproval, reason: after.clientApprovalReason } });
    await enqueueSync(tx, "item", itemId, "upsert");
    for (const p of to)
      await notify(tx, {
        event: "demanda_decidida",
        to: { personId: p.id, slackUserId: p.slack },
        title: approve ? `${contact.clientName} aprovou "${it.name}"` : `${contact.clientName} recusou "${it.name}"`,
        body: approve ? `Aprovada por ${contact.name}. As horas já podem ser apontadas.` : `Recusada por ${contact.name}. Motivo: ${why}`,
        link: `/projetos/${it.parentId ?? it.id}`,
      });
    return after;
  });
}

// ---------- Mensagens (US-41, US-42) ----------

export type ThreadEntry =
  | { kind: "comment"; id: string; at: Date; body: string; fromClient: boolean; who: string; mine: boolean }
  | { kind: "file"; id: string; at: Date; filename: string; size: number; fromClient: boolean; who: string; mine: boolean };

export async function itemThread(contact: ClientUser, itemId: string): Promise<ThreadEntry[]> {
  await getVisibleItem(contact, itemId);
  const cs = await db
    .select({ c: s.comments, person: s.people.name, cname: s.clientContacts.name, cclient: s.clientContacts.clientId })
    .from(s.comments)
    .leftJoin(s.people, eq(s.people.id, s.comments.authorPersonId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.comments.authorContactId))
    .where(and(eq(s.comments.itemId, itemId), eq(s.comments.channel, "cliente"), isNull(s.comments.deletedAt)));
  const fs = await db
    .select({ a: s.attachments, person: s.people.name, cname: s.clientContacts.name })
    .from(s.attachments)
    .leftJoin(s.people, eq(s.people.id, s.attachments.uploadedByPersonId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.attachments.uploadedByContactId))
    .where(and(eq(s.attachments.ownerType, "item"), eq(s.attachments.ownerId, itemId), eq(s.attachments.internal, false)));
  const out: ThreadEntry[] = [
    ...cs
      // Comentário de contato de outro cliente nunca aparece (defesa extra).
      .filter((r) => !r.c.authorContactId || r.cclient === contact.clientId)
      .map((r) => ({
        kind: "comment" as const,
        id: r.c.id,
        at: r.c.createdAt,
        body: r.c.body,
        fromClient: !!r.c.authorContactId,
        who: r.c.authorContactId ? (r.cname ?? "Cliente") : `${r.person ?? "Síntese"} (Síntese)`,
        mine: r.c.authorContactId === contact.id,
      })),
    ...fs.map((r) => ({
      kind: "file" as const,
      id: r.a.id,
      at: r.a.createdAt,
      filename: r.a.filename,
      size: r.a.sizeBytes,
      fromClient: !!r.a.uploadedByContactId,
      who: r.a.uploadedByContactId ? (r.cname ?? "Cliente") : `${r.person ?? "Síntese"} (Síntese)`,
      mine: r.a.uploadedByContactId === contact.id,
    })),
  ];
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Última mensagem (canal Cliente) de cada item visível, para a lista de conversas. */
export async function threadHeads(contact: ClientUser) {
  const ids = (await visibleItems(contact)).map((i) => i.id);
  if (!ids.length) return new Map<string, { at: Date; body: string; fromClient: boolean; who: string }>();
  const rows = await db
    .select({ itemId: s.comments.itemId, at: s.comments.createdAt, body: s.comments.body, contactId: s.comments.authorContactId, person: s.people.name, cname: s.clientContacts.name })
    .from(s.comments)
    .leftJoin(s.people, eq(s.people.id, s.comments.authorPersonId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.comments.authorContactId))
    .where(and(inArray(s.comments.itemId, ids), eq(s.comments.channel, "cliente"), isNull(s.comments.deletedAt), or(isNull(s.comments.authorContactId), eq(s.clientContacts.clientId, contact.clientId))))
    .orderBy(desc(s.comments.createdAt));
  const m = new Map<string, { at: Date; body: string; fromClient: boolean; who: string }>();
  for (const r of rows) if (r.itemId && !m.has(r.itemId)) m.set(r.itemId, { at: r.at, body: r.body, fromClient: !!r.contactId, who: first(r.contactId ? (r.cname ?? "") : (r.person ?? "Síntese")) });
  return m;
}

/** US-41/42: o cliente comenta no canal Cliente de um item visível, com arquivo opcional. */
export async function postComment(contact: ClientUser, itemId: string, body: string, file?: File | null) {
  const it = await getVisibleItem(contact, itemId);
  const text = body.trim();
  const hasFile = !!file && file.size > 0;
  if (!text && !hasFile) throw new PortalError("Escreva a mensagem ou escolha um arquivo.");
  if (text.length > 5000) throw new PortalError("A mensagem passou de 5.000 caracteres. Divida em duas.");
  if (hasFile) {
    const err = checkFile(file!.name, file!.size);
    if (err) throw new PortalError(err);
  }
  const to = await responsibles(it);
  return db.transaction(async (tx) => {
    let commentId: string | null = null;
    if (text) {
      const [c] = await tx.insert(s.comments).values({ itemId, channel: "cliente", authorContactId: contact.id, body: text, createdAt: now() }).returning();
      commentId = c.id;
      await audit(tx, { contactId: contact.id, entity: "comment", entityId: c.id, action: "criar", after: { itemId, channel: "cliente" } });
    }
    let att: typeof s.attachments.$inferSelect | null = null;
    if (hasFile) {
      // US-42: o arquivo fica no item, visível ao time e ao cliente (e vai para o Odoo, US-39).
      att = await saveAttachment(tx, file!, { type: "item", id: itemId }, { contactId: contact.id });
      await audit(tx, { contactId: contact.id, entity: "attachment", entityId: att.id, action: "enviar", after: { itemId, filename: att.filename, commentId } });
    }
    for (const p of to)
      await notify(tx, {
        event: "comentario_cliente",
        to: { personId: p.id, slackUserId: p.slack },
        title: text ? `${contact.name} (${contact.clientName}) comentou em "${it.name}"` : `${contact.name} (${contact.clientName}) enviou um arquivo em "${it.name}"`,
        body: text ? text.slice(0, 280) : att!.filename,
        link: `/projetos/${it.parentId ?? it.id}`,
      });
    return { commentId, attachmentId: att?.id ?? null };
  });
}

// ---------- Arquivos ----------

export async function portalFiles(contact: ClientUser) {
  const items = await visibleItems(contact);
  const ids = items.map((i) => i.id);
  if (!ids.length) return [];
  const rows = await db
    .select({ a: s.attachments, person: s.people.name, cname: s.clientContacts.name })
    .from(s.attachments)
    .leftJoin(s.people, eq(s.people.id, s.attachments.uploadedByPersonId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.attachments.uploadedByContactId))
    .where(and(eq(s.attachments.ownerType, "item"), inArray(s.attachments.ownerId, ids), eq(s.attachments.internal, false)))
    .orderBy(desc(s.attachments.createdAt));
  return rows.map((r) => ({
    id: r.a.id,
    itemId: r.a.ownerId,
    filename: r.a.filename,
    version: r.a.version,
    size: r.a.sizeBytes,
    at: r.a.createdAt,
    by: r.a.uploadedByContactId ? (r.cname ?? "Cliente") : `${r.person ?? "Síntese"} (Síntese)`,
    mine: r.a.uploadedByContactId === contact.id,
  }));
}

/** Anexo para download: só não interno, de item visível do próprio cliente. */
export async function attachmentForDownload(contact: Pick<ClientUser, "clientId">, attachmentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const [a] = await db.select().from(s.attachments).where(eq(s.attachments.id, attachmentId));
  if (!a || a.internal || a.ownerType !== "item") return null;
  const vis = new Set((await visibleItems(contact)).map((i) => i.id));
  if (!vis.has(a.ownerId)) return null;
  return a;
}

export async function uploadFile(contact: ClientUser, itemId: string, file: File | null) {
  if (!file || file.size === 0) throw new PortalError("Escolha um arquivo.");
  const it = await getVisibleItem(contact, itemId);
  const err = checkFile(file.name, file.size);
  if (err) throw new PortalError(err);
  const to = await responsibles(it);
  return db.transaction(async (tx) => {
    const att = await saveAttachment(tx, file, { type: "item", id: itemId }, { contactId: contact.id });
    await audit(tx, { contactId: contact.id, entity: "attachment", entityId: att.id, action: "enviar", after: { itemId, filename: att.filename } });
    for (const p of to)
      await notify(tx, {
        event: "comentario_cliente",
        to: { personId: p.id, slackUserId: p.slack },
        title: `${contact.name} (${contact.clientName}) enviou um arquivo em "${it.name}"`,
        body: att.filename,
        link: `/projetos/${it.parentId ?? it.id}`,
      });
    return att;
  });
}

// ---------- Avaliações ----------

/** Entregas concluídas nos últimos 90 dias que este contato ainda não avaliou. */
export async function pendingEvaluations(contact: ClientUser) {
  const items = (await visibleItems(contact)).filter((i) => i.stage === "concluido" && (!i.outOfScope || i.clientApproval === "aprovada"));
  if (!items.length) return [];
  const mine = await db.select({ itemId: s.evaluations.itemId }).from(s.evaluations).where(eq(s.evaluations.contactId, contact.id));
  const done = new Set(mine.map((m) => m.itemId));
  const limit = addDays(toISODate(now()), -90);
  const ass = await assigneesOf(items.map((i) => i.id));
  return items
    .filter((i) => !done.has(i.id) && toISODate(i.completedAt ?? i.updatedAt) >= limit)
    .sort((a, b) => (b.completedAt ?? b.updatedAt).getTime() - (a.completedAt ?? a.updatedAt).getTime())
    .map((i) => ({ id: i.id, name: i.name, kind: i.kind, completedAt: i.completedAt ?? i.updatedAt, consultant: ass.get(i.id)?.[0]?.name ?? null }));
}

/** Avaliações feitas por este contato (nunca as de outros contatos). */
export async function myEvaluations(contact: ClientUser) {
  return db
    .select({ id: s.evaluations.id, item: s.items.name, at: s.evaluations.createdAt, r: s.evaluations.scoreResult, c: s.evaluations.scoreConsultant, t: s.evaluations.scoreTeam })
    .from(s.evaluations)
    .leftJoin(s.items, eq(s.items.id, s.evaluations.itemId))
    .where(and(eq(s.evaluations.contactId, contact.id), eq(s.evaluations.clientId, contact.clientId)))
    .orderBy(desc(s.evaluations.createdAt));
}

export async function evaluate(contact: ClientUser, input: { itemId: string; result: number; consultant: number; team: number; comment?: string }) {
  const it = await getVisibleItem(contact, input.itemId);
  if (it.stage !== "concluido") throw new PortalError("Só dá para avaliar uma entrega concluída.");
  for (const [k, v] of [["Resultado", input.result], ["Consultor", input.consultant], ["Time", input.team]] as const)
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new PortalError(`Dê uma nota de 1 a 5 para ${k}.`);
  const [dup] = await db.select({ id: s.evaluations.id }).from(s.evaluations).where(and(eq(s.evaluations.contactId, contact.id), eq(s.evaluations.itemId, it.id)));
  if (dup) throw new PortalError("Você já avaliou esta entrega. Obrigado!");
  const [consultant] = (await assigneesOf([it.id])).get(it.id) ?? [];
  const gestores = await managers();
  const comment = input.comment?.trim().slice(0, 2000) || null;
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(s.evaluations)
      .values({
        clientId: contact.clientId,
        itemId: it.id,
        contactId: contact.id,
        consultantId: consultant?.id ?? null,
        scoreResult: input.result,
        scoreConsultant: input.consultant,
        scoreTeam: input.team,
        comment,
        // Nasce oculta: só a gestão vê e decide publicar.
        published: false,
      })
      .returning();
    await audit(tx, { contactId: contact.id, entity: "evaluation", entityId: ev.id, action: "avaliar", after: { itemId: it.id } });
    const low = Math.min(input.result, input.consultant, input.team) <= 2;
    for (const g of gestores)
      await notify(tx, {
        event: "avaliacao_recebida",
        to: { personId: g.id, slackUserId: g.slack },
        title: `${low ? "Nota baixa: " : ""}${contact.clientName} avaliou "${it.name}"`,
        body: `Resultado ${input.result}, consultor ${input.consultant}, time ${input.team}.${comment ? ` "${comment.slice(0, 200)}"` : ""} Avaliação de ${contact.name}, oculta até a gestão publicar.`,
        link: "/gestao/pendencias",
      });
    return ev;
  });
}

// ---------- Convidar colegas (US-31) ----------

export type InviteResult = { email: string; status: "convidado" | "ja_tem_acesso" | "nao_cadastrado" | "revogado" | "invalido"; name?: string };

export async function portalPeople(contact: ClientUser) {
  return db
    .select({ id: s.clientContacts.id, name: s.clientContacts.name, jobTitle: s.clientContacts.jobTitle, lastAccessAt: s.clientContacts.lastAccessAt, invitedAt: s.clientContacts.portalInvitedAt })
    .from(s.clientContacts)
    .where(and(eq(s.clientContacts.clientId, contact.clientId), eq(s.clientContacts.portalAccess, true), eq(s.clientContacts.active, true), isNull(s.clientContacts.portalRevokedAt)))
    .orderBy(asc(s.clientContacts.name));
}

/**
 * O contato convida colegas da própria empresa. Só vale para e-mails que já existem como
 * contato deste cliente (vindos do Odoo); o Clarity não cria contatos.
 */
export async function inviteColleagues(contact: ClientUser, raw: string): Promise<InviteResult[]> {
  const list = [...new Set(raw.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) throw new PortalError("Digite ao menos um e-mail.");
  if (list.length > 20) throw new PortalError("Convide até 20 pessoas por vez.");
  const out: InviteResult[] = [];
  const rows = await db
    .select()
    .from(s.clientContacts)
    .where(and(eq(s.clientContacts.clientId, contact.clientId), eq(s.clientContacts.active, true), inArray(sql`lower(${s.clientContacts.email})`, list)));
  const byEmail = new Map(rows.map((r) => [r.email!.toLowerCase(), r]));
  for (const email of list) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      out.push({ email, status: "invalido" });
      continue;
    }
    const c = byEmail.get(email);
    if (!c) {
      out.push({ email, status: "nao_cadastrado" });
      continue;
    }
    if (c.portalRevokedAt) {
      out.push({ email, status: "revogado", name: c.name });
      continue;
    }
    if (c.portalAccess) {
      out.push({ email, status: "ja_tem_acesso", name: c.name });
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.update(s.clientContacts).set({ portalAccess: true, portalInvitedAt: now() }).where(and(eq(s.clientContacts.id, c.id), eq(s.clientContacts.clientId, contact.clientId)));
      await audit(tx, { contactId: contact.id, entity: "client_contact", entityId: c.id, action: "convidar_portal", after: { by: contact.id } });
      await notify(tx, {
        event: "convite_portal",
        to: { contactId: c.id, email: c.email! },
        title: `${contact.name} convidou você para o portal da Síntese`,
        body: `Acompanhe os projetos da ${contact.clientName} com a Síntese, aprove demandas e converse com o time. Entre com este e-mail (${c.email}); você recebe um link de acesso, sem senha.`,
        link: "/entrar",
      });
    });
    out.push({ email, status: "convidado", name: c.name });
  }
  return out;
}

/** Registra o último acesso (ficha do cliente mostra, US-31). */
export async function touchAccess(contact: Pick<ClientUser, "id">) {
  await db.update(s.clientContacts).set({ lastAccessAt: now() }).where(eq(s.clientContacts.id, contact.id));
}

export function dateBR(d: ISODate | null | undefined) {
  return d ? shortDate(d) : "";
}
