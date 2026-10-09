import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { now, today } from "@/lib/clock";
import { parseISO, shortDate } from "@/domain/dates";
import { audit, type Tx } from "../audit";
import { enqueueSync } from "../sync/enqueue";
import { notify } from "../notify";
import { saveAttachment } from "../attachments";
import { STAGES, type StageKey } from "../data/common";
import { isManager, type TeamUser } from "../session";

/**
 * Projetos e tarefas (US-13 a US-21, US-24, US-27 lado do time).
 * Toda escrita passa por aqui: checa permissão, grava auditoria e põe na fila do Odoo
 * o que muda em item confirmado (rascunho nunca vai ao Odoo).
 */
export class ItemError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
    /** Pede confirmação explícita (ex.: concluir projeto com tarefas abertas). */
    public needsConfirm = false,
  ) {
    super(message);
  }
}

export const REQUEST_CHANNELS = ["E-mail", "WhatsApp", "Telefone", "Reunião", "Portal"] as const;

type Item = typeof s.items.$inferSelect;
const parentT = alias(s.items, "parent_item");

export async function loadItemCtx(id: string, tx: Tx | typeof db = db) {
  const [row] = await tx
    .select({ item: s.items, parent: parentT, annual: s.annualProjects, client: s.clients })
    .from(s.items)
    .leftJoin(parentT, eq(parentT.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(eq(s.items.id, id));
  if (!row) throw new ItemError("Item não encontrado.");
  return row;
}

/** Rascunho: projeto com escopo em rascunho, ou tarefa de um projeto em rascunho. Nunca vai ao Odoo. */
export function isDraft(item: Pick<Item, "kind" | "scopeStatus">, parent?: Pick<Item, "scopeStatus"> | null) {
  return (item.kind === "projeto" && item.scopeStatus === "rascunho") || parent?.scopeStatus === "rascunho";
}

/** US-21: tudo que muda num item confirmado vai para a fila do Odoo. */
async function syncIfConfirmed(tx: Tx, item: Item, parent: Item | null) {
  if (isDraft(item, parent)) return;
  await tx.update(s.items).set({ syncStatus: "pendente", syncError: null }).where(eq(s.items.id, item.id));
  await enqueueSync(tx, "item", item.id, item.archived ? "delete" : "upsert");
}

async function assigneeIds(itemId: string, tx: Tx | typeof db = db) {
  const rows = await tx.select({ id: s.itemAssignees.personId }).from(s.itemAssignees).where(eq(s.itemAssignees.itemId, itemId));
  return rows.map((r) => r.id);
}

/** Projeto anual do ano corrente do cliente (vem do Odoo; criado na virada do ano). */
export async function currentAnnualProject(clientId: string, tx: Tx | typeof db = db) {
  const year = parseISO(today()).y;
  const [ap] = await tx
    .select()
    .from(s.annualProjects)
    .where(and(eq(s.annualProjects.clientId, clientId), eq(s.annualProjects.year, year), eq(s.annualProjects.active, true)));
  if (!ap) throw new ItemError(`Este cliente ainda não tem o projeto anual de ${year}. Ele é criado no Odoo; peça à gestão.`, { clientId: "Cliente sem projeto anual." });
  return ap;
}

function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function validDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function checkPeople(ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: s.people.id }).from(s.people).where(and(inArray(s.people.id, ids), eq(s.people.active, true)));
  if (rows.length !== new Set(ids).size) throw new ItemError("Responsável inválido.", { assignees: "Escolha pessoas ativas do time." });
}

async function userTagIds(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(s.tags).where(and(inArray(s.tags.id, ids), eq(s.tags.system, false)));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------

export type ProjectInput = {
  clientId: string;
  name: string;
  description?: string | null;
  assigneeIds: string[];
  startDate?: string | null;
  deadline: string | null;
  plannedMinutes?: number | null;
  isSustentacao?: boolean;
  tagIds?: string[];
  visibleToClient?: boolean;
};

/** US-14: qualquer pessoa do time cria projeto. Nasce Rascunho e não vai ao Odoo até o escopo ser confirmado. */
export async function createProject(me: TeamUser, input: ProjectInput) {
  const errors: Record<string, string> = {};
  const name = cleanText(input.name);
  if (!name) errors.name = "Dê um nome ao projeto.";
  if (!input.assigneeIds?.length) errors.assignees = "Escolha ao menos um responsável.";
  const deadline = validDate(input.deadline);
  if (!deadline) errors.deadline = "Informe o prazo.";
  const start = validDate(input.startDate ?? null);
  if (start && deadline && start > deadline) errors.startDate = "O início vem antes do prazo.";
  if (input.plannedMinutes != null && (!Number.isFinite(input.plannedMinutes) || input.plannedMinutes < 0)) errors.planned = "Horas previstas inválidas.";
  if (!input.clientId) errors.clientId = "Escolha o cliente.";
  if (Object.keys(errors).length) throw new ItemError(Object.values(errors)[0], errors);
  await checkPeople(input.assigneeIds);
  const tagIds = await userTagIds(input.tagIds ?? []);
  const ap = await currentAnnualProject(input.clientId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.items)
      .values({
        annualProjectId: ap.id,
        kind: "projeto",
        name,
        description: cleanText(input.description) || null,
        stage: "analise",
        scopeStatus: "rascunho",
        startDate: start,
        deadline,
        plannedMinutes: input.plannedMinutes ?? null,
        isSustentacao: !!input.isSustentacao,
        // US-19: todo item nasce interno, a não ser que a pessoa marque.
        visibleToClient: !!input.visibleToClient,
        syncStatus: "nao_sincroniza",
        createdBy: me.id,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    await tx.insert(s.itemAssignees).values([...new Set(input.assigneeIds)].map((personId) => ({ itemId: row.id, personId })));
    if (tagIds.length) await tx.insert(s.itemTags).values(tagIds.map((tagId) => ({ itemId: row.id, tagId })));
    // US-22: o rascunho do escopo (versão 0) nasce junto.
    await tx.insert(s.scopeVersions).values({ itemId: row.id, version: 0, objective: cleanText(input.description) || null, updatedBy: me.id });
    await tx.insert(s.stageHistory).values({ itemId: row.id, fromStage: null, toStage: "analise", byPersonId: me.id, at: now() });
    await audit(tx, { personId: me.id, entity: "item", entityId: row.id, action: "criar", after: row });
    return row;
  });
}

export type TaskInput = Omit<ProjectInput, "clientId" | "deadline"> & {
  clientId?: string | null;
  parentId?: string | null;
  deadline?: string | null;
  checklist?: { text: string; done: boolean }[];
  /** Projeto confirmado: a qual entregável atende. Nulo + outOfScope = demanda adicional. */
  deliverableId?: string | null;
  outOfScope?: boolean;
  requestedByContactId?: string | null;
  requestedAt?: string | null;
  requestChannel?: string | null;
};

/**
 * US-15: tarefa dentro de um projeto (subtarefa no Odoo) ou simples no projeto anual.
 * Herda do projeto cliente, sustentação e visibilidade (editáveis).
 * US-24: num projeto confirmado, pergunta o entregável; sem entregável vira demanda adicional,
 * que nasce aguardando o cliente (US-27) e não aceita horas até a aprovação.
 */
export async function createTask(me: TeamUser, input: TaskInput) {
  const errors: Record<string, string> = {};
  const name = cleanText(input.name);
  if (!name) errors.name = "Dê um nome à tarefa.";
  if (!input.assigneeIds?.length) errors.assignees = "Escolha ao menos um responsável.";
  const deadline = validDate(input.deadline ?? null);
  const start = validDate(input.startDate ?? null);
  if (start && deadline && start > deadline) errors.startDate = "O início vem antes do prazo.";
  if (Object.keys(errors).length) throw new ItemError(Object.values(errors)[0], errors);
  await checkPeople(input.assigneeIds);
  const tagIds = await userTagIds(input.tagIds ?? []);

  let parent: Item | null = null;
  let annualProjectId: string;
  let clientId: string;
  if (input.parentId) {
    const ctx = await loadItemCtx(input.parentId);
    parent = ctx.item;
    if (parent.kind !== "projeto" || parent.parentId) throw new ItemError("Subtarefa não tem subtarefa: escolha um projeto como pai.", { parentId: "Escolha um projeto." });
    if (parent.archived) throw new ItemError("Este projeto está arquivado.");
    annualProjectId = parent.annualProjectId;
    clientId = ctx.client.id;
  } else {
    if (!input.clientId) throw new ItemError("Escolha o cliente.", { clientId: "Escolha o cliente." });
    const ap = await currentAnnualProject(input.clientId);
    annualProjectId = ap.id;
    clientId = input.clientId;
  }

  // US-24: classificação da demanda num projeto confirmado.
  let deliverableId: string | null = null;
  let outOfScope = false;
  const confirmedProject = parent && parent.scopeStatus === "confirmado";
  if (parent && input.deliverableId) {
    const [d] = await db
      .select({ id: s.deliverables.id, itemId: s.scopeVersions.itemId })
      .from(s.deliverables)
      .innerJoin(s.scopeVersions, eq(s.scopeVersions.id, s.deliverables.scopeVersionId))
      .where(eq(s.deliverables.id, input.deliverableId));
    if (!d || d.itemId !== parent.id) throw new ItemError("Entregável não é deste projeto.", { deliverableId: "Escolha um entregável do projeto." });
    deliverableId = d.id;
  }
  if (confirmedProject && !deliverableId) {
    if (!input.outOfScope)
      throw new ItemError("Diga a qual entregável a tarefa atende ou marque como demanda adicional.", { deliverableId: "Escolha o entregável ou Demanda adicional." });
    outOfScope = true;
    const e2: Record<string, string> = {};
    if (!input.requestedByContactId) e2.requestedBy = "Quem pediu?";
    if (!validDate(input.requestedAt ?? null)) e2.requestedAt = "Quando pediu?";
    if (!cleanText(input.requestChannel)) e2.requestChannel = "Por qual canal?";
    if (Object.keys(e2).length) throw new ItemError("Demanda adicional precisa de quem pediu, quando e por qual canal.", e2);
    const [ct] = await db.select().from(s.clientContacts).where(eq(s.clientContacts.id, input.requestedByContactId!));
    if (!ct || ct.clientId !== clientId) throw new ItemError("Este contato não é do cliente do projeto.", { requestedBy: "Escolha um contato do cliente." });
  }

  const draft = parent?.scopeStatus === "rascunho";
  const checklist = (input.checklist ?? []).map((c) => ({ text: cleanText(c.text), done: !!c.done })).filter((c) => c.text);
  const contacts = outOfScope
    ? await db
        .select()
        .from(s.clientContacts)
        .where(and(eq(s.clientContacts.clientId, clientId), eq(s.clientContacts.portalAccess, true), eq(s.clientContacts.active, true), isNull(s.clientContacts.portalRevokedAt)))
    : [];

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.items)
      .values({
        annualProjectId,
        parentId: parent?.id ?? null,
        kind: "tarefa",
        name,
        description: cleanText(input.description) || null,
        stage: "analise",
        scopeStatus: "confirmado",
        startDate: start,
        deadline,
        plannedMinutes: input.plannedMinutes ?? null,
        isSustentacao: input.isSustentacao ?? parent?.isSustentacao ?? false,
        // US-25: demanda adicional é visível ao cliente, que precisa aprová-la.
        visibleToClient: outOfScope ? true : (input.visibleToClient ?? parent?.visibleToClient ?? false),
        checklist,
        deliverableId,
        outOfScope,
        clientApproval: outOfScope ? "aguardando" : "nao_se_aplica",
        requestedByContactId: outOfScope ? input.requestedByContactId! : null,
        requestedAt: outOfScope ? input.requestedAt! : null,
        requestChannel: outOfScope ? cleanText(input.requestChannel) : null,
        syncStatus: draft ? "nao_sincroniza" : "pendente",
        createdBy: me.id,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    await tx.insert(s.itemAssignees).values([...new Set(input.assigneeIds)].map((personId) => ({ itemId: row.id, personId })));
    const sysTags = await tx.select().from(s.tags).where(eq(s.tags.system, true));
    const sys = Object.fromEntries(sysTags.map((t) => [t.name, t.id]));
    const allTags = [...tagIds, ...(!parent && sys["Tarefa"] ? [sys["Tarefa"]] : []), ...(outOfScope && sys["Fora do escopo"] ? [sys["Fora do escopo"]] : [])];
    if (allTags.length) await tx.insert(s.itemTags).values(allTags.map((tagId) => ({ itemId: row.id, tagId })));
    await tx.insert(s.stageHistory).values({ itemId: row.id, fromStage: null, toStage: "analise", byPersonId: me.id, at: now() });
    await audit(tx, { personId: me.id, entity: "item", entityId: row.id, action: outOfScope ? "criar_demanda_adicional" : "criar", after: row });
    if (!draft) await enqueueSync(tx, "item", row.id, "upsert");
    // US-43: demanda adicional aguardando aprovação avisa os contatos do cliente por e-mail, na hora.
    for (const c of contacts) {
      if (!c.email) continue;
      await notify(tx, {
        event: "demanda_aguardando_cliente",
        to: { contactId: c.id, email: c.email },
        title: `Demanda adicional aguardando sua aprovação: ${name}`,
        body: parent ? `Projeto ${parent.name}. As horas só são lançadas depois da sua aprovação.` : undefined,
        link: `/portal`,
      });
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Alterar
// ---------------------------------------------------------------------------

export type ItemPatch = {
  name?: string;
  description?: string | null;
  startDate?: string | null;
  plannedMinutes?: number | null;
  isSustentacao?: boolean;
  checklist?: { text: string; done: boolean }[];
};

export async function updateItem(me: TeamUser, id: string, patch: ItemPatch) {
  const { item, parent } = await loadItemCtx(id);
  const set: Partial<Item> = { updatedAt: now() };
  if (patch.name !== undefined) {
    const n = cleanText(patch.name);
    if (!n) throw new ItemError("O nome não pode ficar vazio.", { name: "Informe o nome." });
    set.name = n;
  }
  if (patch.description !== undefined) set.description = cleanText(patch.description) || null;
  if (patch.startDate !== undefined) set.startDate = validDate(patch.startDate);
  if (patch.plannedMinutes !== undefined) {
    if (patch.plannedMinutes != null && (!Number.isFinite(patch.plannedMinutes) || patch.plannedMinutes < 0)) throw new ItemError("Horas previstas inválidas.");
    set.plannedMinutes = patch.plannedMinutes;
  }
  if (patch.isSustentacao !== undefined) set.isSustentacao = patch.isSustentacao;
  if (patch.checklist !== undefined) set.checklist = patch.checklist.map((c) => ({ text: cleanText(c.text), done: !!c.done })).filter((c) => c.text);
  return db.transaction(async (tx) => {
    const [after] = await tx.update(s.items).set(set).where(eq(s.items.id, id)).returning();
    await audit(tx, { personId: me.id, entity: "item", entityId: id, action: "editar", before: pick(item, Object.keys(set)), after: pick(after, Object.keys(set)) });
    await syncIfConfirmed(tx, after, parent);
    return after;
  });
}

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k !== "updatedAt").map((k) => [k, o[k]]));
}

/** US-16: mover pelas etapas. Concluir projeto com tarefas abertas pede confirmação. Toda mudança fica no histórico. */
export async function changeStage(me: TeamUser, id: string, stage: StageKey, opts: { confirmOpenTasks?: boolean } = {}) {
  if (!STAGES.some((x) => x.key === stage)) throw new ItemError("Etapa inválida.");
  const { item, parent } = await loadItemCtx(id);
  if (isDraft(item, null) && item.kind === "projeto")
    throw new ItemError("Projeto em rascunho fica em Análise/Aprovação até o escopo ser confirmado.");
  if (item.stage === stage) return item;
  if (stage === "concluido" && item.kind === "projeto" && !opts.confirmOpenTasks) {
    const open = await openTaskCount(id);
    if (open > 0)
      throw new ItemError(`Este projeto tem ${open} ${open === 1 ? "tarefa aberta" : "tarefas abertas"}. Confirme para concluir mesmo assim.`, {}, true);
  }
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.items)
      .set({ stage, completedAt: stage === "concluido" ? now() : null, updatedAt: now() })
      .where(eq(s.items.id, id))
      .returning();
    await tx.insert(s.stageHistory).values({ itemId: id, fromStage: item.stage, toStage: stage, byPersonId: me.id, at: now() });
    await audit(tx, { personId: me.id, entity: "item", entityId: id, action: "etapa", before: { stage: item.stage }, after: { stage } });
    await syncIfConfirmed(tx, after, parent);
    return after;
  });
}

export async function openTaskCount(projectId: string) {
  const rows = await db
    .select({ id: s.items.id })
    .from(s.items)
    .where(and(eq(s.items.parentId, projectId), ne(s.items.stage, "concluido"), eq(s.items.archived, false)));
  return rows.length;
}

/** US-17: só o responsável pelo item ou a gestão mudam o prazo, sempre com motivo. */
export async function canChangeDeadline(me: TeamUser, itemId: string) {
  if (isManager(me)) return true;
  return (await assigneeIds(itemId)).includes(me.id);
}

export async function changeDeadline(me: TeamUser, id: string, newDeadline: string, reason: string) {
  const { item, parent } = await loadItemCtx(id);
  if (!(await canChangeDeadline(me, id))) throw new ItemError("Só o responsável pelo item ou a gestão mudam o prazo.");
  const d = validDate(newDeadline);
  if (!d) throw new ItemError("Informe o novo prazo.", { deadline: "Data inválida." });
  if (!cleanText(reason)) throw new ItemError("Diga o motivo da mudança de prazo.", { reason: "O motivo é obrigatório." });
  if (d === item.deadline) throw new ItemError("O novo prazo é igual ao atual.", { deadline: "Escolha outra data." });
  return db.transaction(async (tx) => {
    const [after] = await tx.update(s.items).set({ deadline: d, updatedAt: now() }).where(eq(s.items.id, id)).returning();
    await tx.insert(s.deadlineChanges).values({ itemId: id, oldDeadline: item.deadline, newDeadline: d, reason: cleanText(reason), byPersonId: me.id, at: now() });
    await audit(tx, { personId: me.id, entity: "item", entityId: id, action: "prazo", before: { deadline: item.deadline }, after: { deadline: d, reason: cleanText(reason) } });
    await syncIfConfirmed(tx, after, parent);
    return after;
  });
}

/** US-18: marcadores de situação (só os que não são de sistema). */
export async function setTags(me: TeamUser, id: string, tagIds: string[]) {
  const { item, parent } = await loadItemCtx(id);
  const wanted = await userTagIds([...new Set(tagIds)]);
  const current = await db
    .select({ id: s.itemTags.tagId })
    .from(s.itemTags)
    .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
    .where(and(eq(s.itemTags.itemId, id), eq(s.tags.system, false)));
  const cur = current.map((c) => c.id);
  await db.transaction(async (tx) => {
    if (cur.length) await tx.delete(s.itemTags).where(and(eq(s.itemTags.itemId, id), inArray(s.itemTags.tagId, cur)));
    if (wanted.length) await tx.insert(s.itemTags).values(wanted.map((tagId) => ({ itemId: id, tagId })));
    await tx.update(s.items).set({ updatedAt: now() }).where(eq(s.items.id, id));
    await audit(tx, { personId: me.id, entity: "item", entityId: id, action: "marcadores", before: cur, after: wanted });
    await syncIfConfirmed(tx, item, parent);
  });
}

export async function setAssignees(me: TeamUser, id: string, personIds: string[]) {
  const ids = [...new Set(personIds)];
  if (!ids.length) throw new ItemError("Escolha ao menos um responsável.", { assignees: "Ao menos um." });
  await checkPeople(ids);
  const { item, parent } = await loadItemCtx(id);
  const before = await assigneeIds(id);
  await db.transaction(async (tx) => {
    await tx.delete(s.itemAssignees).where(eq(s.itemAssignees.itemId, id));
    await tx.insert(s.itemAssignees).values(ids.map((personId) => ({ itemId: id, personId })));
    await tx.update(s.items).set({ updatedAt: now() }).where(eq(s.items.id, id));
    await audit(tx, { personId: me.id, entity: "item", entityId: id, action: "responsaveis", before, after: ids });
    await syncIfConfirmed(tx, item, parent);
  });
}

/**
 * US-19: visibilidade ao cliente. Tornar um projeto visível pergunta se as tarefas também ficam
 * (`cascade`). Demanda adicional é sempre visível (o cliente precisa aprovar).
 */
export async function setVisibility(me: TeamUser, id: string, visible: boolean, opts: { cascade?: boolean } = {}) {
  const { item, parent } = await loadItemCtx(id);
  if (!visible && item.outOfScope) throw new ItemError("Demanda adicional fica visível ao cliente: ele precisa aprová-la.");
  return db.transaction(async (tx) => {
    const [after] = await tx.update(s.items).set({ visibleToClient: visible, updatedAt: now() }).where(eq(s.items.id, id)).returning();
    await audit(tx, { personId: me.id, entity: "item", entityId: id, action: "visibilidade", before: { visible: item.visibleToClient }, after: { visible, cascade: !!opts.cascade } });
    await syncIfConfirmed(tx, after, parent);
    if (item.kind === "projeto" && opts.cascade) {
      const kids = await tx
        .update(s.items)
        .set({ visibleToClient: visible, updatedAt: now() })
        .where(and(eq(s.items.parentId, id), visible ? eq(s.items.visibleToClient, false) : eq(s.items.outOfScope, false)))
        .returning();
      for (const k of kids) await syncIfConfirmed(tx, k, after);
    }
    return after;
  });
}

// ---------------------------------------------------------------------------
// Demandas adicionais (US-24, US-27 lado do time)
// ---------------------------------------------------------------------------

/** US-27: aprovação recebida fora do portal (e-mail, mensagem). O print da evidência é obrigatório. */
export async function registerExternalApproval(me: TeamUser, id: string, evidence: File | null | undefined, note?: string) {
  const { item, parent } = await loadItemCtx(id);
  if (!item.outOfScope) throw new ItemError("Esta tarefa não é demanda adicional.");
  if (item.clientApproval !== "aguardando") throw new ItemError("Esta demanda já foi decidida.");
  if (!evidence || evidence.size === 0) throw new ItemError("Anexe o print da aprovação do cliente.", { evidence: "A evidência é obrigatória." });
  const assignees = await db
    .select({ id: s.people.id, slackUserId: s.people.slackUserId })
    .from(s.itemAssignees)
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .where(eq(s.itemAssignees.itemId, id));
  return db.transaction(async (tx) => {
    // Comprovante de aprovação: sempre interno, só no Clarity (US-39).
    const att = await saveAttachment(tx, evidence, { type: "approval", id }, { personId: me.id }, { internal: true });
    const [after] = await tx
      .update(s.items)
      .set({ clientApproval: "aprovada", clientApprovalAt: now(), clientApprovalRegisteredBy: me.id, clientApprovalByContactId: null, updatedAt: now() })
      .where(eq(s.items.id, id))
      .returning();
    await audit(tx, {
      personId: me.id,
      entity: "item",
      entityId: id,
      action: "aprovacao_externa",
      before: { clientApproval: item.clientApproval },
      after: { clientApproval: "aprovada", attachmentId: att.id, note: cleanText(note) || null },
    });
    await syncIfConfirmed(tx, after, parent);
    for (const a of assignees) {
      if (a.id === me.id) continue;
      await notify(tx, {
        event: "demanda_decidida",
        to: { personId: a.id, slackUserId: a.slackUserId },
        title: `Demanda adicional aprovada: ${item.name}`,
        body: `Aprovação registrada por ${me.name} com evidência anexada. As horas já podem ser lançadas.`,
        link: `/projetos/${parent?.id ?? id}?aba=demandas`,
      });
    }
    return after;
  });
}

/** US-24: a gestão reclassifica uma demanda (dentro ou fora do escopo), sempre com motivo. */
export async function reclassifyDemand(me: TeamUser, id: string, input: { outOfScope: boolean; deliverableId?: string | null; reason: string }) {
  if (!isManager(me)) throw new ItemError("Só a gestão reclassifica demandas.");
  if (!cleanText(input.reason)) throw new ItemError("Diga o motivo da reclassificação.", { reason: "O motivo é obrigatório." });
  const { item, parent } = await loadItemCtx(id);
  if (!parent || parent.kind !== "projeto" || parent.scopeStatus !== "confirmado") throw new ItemError("Só tarefas de projeto confirmado são classificadas.");
  let deliverableId: string | null = null;
  if (!input.outOfScope) {
    if (!input.deliverableId) throw new ItemError("Escolha o entregável que a tarefa atende.", { deliverableId: "Escolha o entregável." });
    const [d] = await db
      .select({ id: s.deliverables.id, itemId: s.scopeVersions.itemId })
      .from(s.deliverables)
      .innerJoin(s.scopeVersions, eq(s.scopeVersions.id, s.deliverables.scopeVersionId))
      .where(eq(s.deliverables.id, input.deliverableId));
    if (!d || d.itemId !== parent.id) throw new ItemError("Entregável não é deste projeto.");
    deliverableId = d.id;
  }
  if (input.outOfScope === item.outOfScope && deliverableId === item.deliverableId) throw new ItemError("Nada mudou na classificação.");
  const [fora] = await db.select().from(s.tags).where(and(eq(s.tags.name, "Fora do escopo"), eq(s.tags.system, true)));
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.items)
      .set({
        outOfScope: input.outOfScope,
        deliverableId,
        // Volta a ser demanda: aguarda o cliente de novo. Entra no escopo: não há aprovação a pedir.
        clientApproval: input.outOfScope ? (item.clientApproval === "nao_se_aplica" ? "aguardando" : item.clientApproval) : "nao_se_aplica",
        visibleToClient: input.outOfScope ? true : item.visibleToClient,
        updatedAt: now(),
      })
      .where(eq(s.items.id, id))
      .returning();
    if (fora) {
      if (input.outOfScope) await tx.insert(s.itemTags).values({ itemId: id, tagId: fora.id }).onConflictDoNothing();
      else await tx.delete(s.itemTags).where(and(eq(s.itemTags.itemId, id), eq(s.itemTags.tagId, fora.id)));
    }
    await audit(tx, {
      personId: me.id,
      entity: "item",
      entityId: id,
      action: "reclassificar",
      before: { outOfScope: item.outOfScope, deliverableId: item.deliverableId, clientApproval: item.clientApproval },
      after: { outOfScope: after.outOfScope, deliverableId, clientApproval: after.clientApproval, reason: cleanText(input.reason) },
    });
    await syncIfConfirmed(tx, after, parent);
    return after;
  });
}

// ---------------------------------------------------------------------------
// Anexos (US-39)
// ---------------------------------------------------------------------------

/** Vários arquivos de uma vez; mesmo nome cria nova versão. Anexo de rascunho sobe ao Odoo na confirmação do escopo. */
export async function uploadItemAttachments(me: TeamUser, id: string, files: File[], opts: { internal?: boolean } = {}) {
  await loadItemCtx(id);
  const list = files.filter((f) => f && f.size > 0);
  if (!list.length) throw new ItemError("Escolha ao menos um arquivo.");
  return db.transaction(async (tx) => {
    const out = [];
    for (const f of list) {
      const row = await saveAttachment(tx, f, { type: "item", id }, { personId: me.id }, { internal: !!opts.internal });
      await audit(tx, { personId: me.id, entity: "attachment", entityId: row.id, action: "anexar", after: { itemId: id, filename: row.filename, version: row.version, internal: row.internal } });
      out.push(row);
    }
    return out;
  });
}

/** Texto curto de prazo para avisos. */
export function deadlineLabel(d: string | null) {
  return d ? shortDate(d) : "sem prazo";
}
