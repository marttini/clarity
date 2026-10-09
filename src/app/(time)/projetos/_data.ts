import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { initials, STAGES } from "@/server/data/common";

/** Consultas de leitura das telas de projetos (Server Components). */

export type Filters = {
  q?: string;
  c?: string; // cliente
  r?: string; // responsável
  e?: string; // etapa
  m?: string; // marcador
  s?: string; // sustentação: "1" | "0"
  tipo?: string; // projeto | tarefa
  meus?: string;
  de?: string; // prazo de
  ate?: string; // prazo até
  conc?: string; // "1" mostra concluídos
};

const parent = alias(s.items, "parent_item");

export type Person = { id: string; name: string; initials: string };
export type TagLite = { id: string; name: string; color: string };

export type Row = {
  id: string;
  kind: "projeto" | "tarefa";
  name: string;
  stage: string;
  scopeStatus: "rascunho" | "confirmado";
  deadline: string | null;
  isSustentacao: boolean;
  visibleToClient: boolean;
  outOfScope: boolean;
  clientApproval: string;
  plannedMinutes: number | null;
  client: { id: string; name: string; color: string };
  annualName: string;
  parent: { id: string; name: string; scopeStatus: string } | null;
  assignees: Person[];
  tags: TagLite[];
  workedMinutes: number;
  tasksTotal: number;
  tasksDone: number;
};

/** Minutos realizados por item (sem excluídos e sem Provisionamento, que nunca soma em realizado). */
export async function workedByItem(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, number>();
  const rows = await db
    .select({ itemId: s.timeEntries.itemId, m: sql<number>`coalesce(sum(${s.timeEntries.minutes}), 0)::int` })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .where(and(inArray(s.timeEntries.itemId, itemIds), isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, false)))
    .groupBy(s.timeEntries.itemId);
  return new Map(rows.map((r) => [r.itemId, Number(r.m)]));
}

export async function peopleOf(itemIds: string[]) {
  const map = new Map<string, Person[]>();
  if (!itemIds.length) return map;
  const rows = await db
    .select({ itemId: s.itemAssignees.itemId, id: s.people.id, name: s.people.name })
    .from(s.itemAssignees)
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .where(inArray(s.itemAssignees.itemId, itemIds))
    .orderBy(asc(s.people.name));
  for (const r of rows) (map.get(r.itemId) ?? map.set(r.itemId, []).get(r.itemId)!).push({ id: r.id, name: r.name, initials: initials(r.name) });
  return map;
}

export async function tagsOf(itemIds: string[]) {
  const map = new Map<string, TagLite[]>();
  if (!itemIds.length) return map;
  const rows = await db
    .select({ itemId: s.itemTags.itemId, id: s.tags.id, name: s.tags.name, color: s.tags.color })
    .from(s.itemTags)
    .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
    .where(and(inArray(s.itemTags.itemId, itemIds), eq(s.tags.system, false)))
    .orderBy(asc(s.tags.name));
  for (const r of rows) (map.get(r.itemId) ?? map.set(r.itemId, []).get(r.itemId)!).push({ id: r.id, name: r.name, color: r.color });
  return map;
}

export async function listItems(f: Filters, meId: string): Promise<Row[]> {
  const where: (SQL | undefined)[] = [eq(s.items.archived, false), eq(s.annualProjects.active, true)];
  if (f.c) where.push(eq(s.clients.id, f.c));
  if (f.e && STAGES.some((x) => x.key === f.e)) where.push(eq(s.items.stage, f.e as (typeof STAGES)[number]["key"]));
  else if (f.conc !== "1") where.push(sql`${s.items.stage} <> 'concluido'`);
  if (f.s === "1") where.push(eq(s.items.isSustentacao, true));
  if (f.s === "0") where.push(eq(s.items.isSustentacao, false));
  if (f.tipo === "projeto" || f.tipo === "tarefa") where.push(eq(s.items.kind, f.tipo));
  if (f.de) where.push(sql`${s.items.deadline} >= ${f.de}`);
  if (f.ate) where.push(sql`${s.items.deadline} <= ${f.ate}`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    where.push(or(ilike(s.items.name, like), ilike(parent.name, like), ilike(s.clients.name, like)));
  }
  const personFilter = f.meus === "1" ? meId : f.r;
  if (personFilter) where.push(sql`exists (select 1 from item_assignees ia where ia.item_id = ${s.items.id} and ia.person_id = ${personFilter})`);
  if (f.m) where.push(sql`exists (select 1 from item_tags it where it.item_id = ${s.items.id} and it.tag_id = ${f.m})`);

  const base = await db
    .select({ item: s.items, parent: { id: parent.id, name: parent.name, scopeStatus: parent.scopeStatus }, client: s.clients, annual: s.annualProjects })
    .from(s.items)
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(...where))
    .orderBy(sql`${s.items.deadline} asc nulls last`, asc(s.items.name))
    .limit(500);
  const ids = base.map((b) => b.item.id);
  const projectIds = base.filter((b) => b.item.kind === "projeto").map((b) => b.item.id);
  const children = projectIds.length
    ? await db
        .select({ id: s.items.id, parentId: s.items.parentId, stage: s.items.stage })
        .from(s.items)
        .where(and(inArray(s.items.parentId, projectIds), eq(s.items.archived, false)))
    : [];
  const [worked, people, tags] = await Promise.all([workedByItem([...ids, ...children.map((c) => c.id)]), peopleOf(ids), tagsOf(ids)]);
  return base.map(({ item, parent: p, client, annual }) => {
    const kids = children.filter((c) => c.parentId === item.id);
    const w = (worked.get(item.id) ?? 0) + kids.reduce((a, k) => a + (worked.get(k.id) ?? 0), 0);
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      stage: item.stage,
      scopeStatus: item.scopeStatus,
      deadline: item.deadline,
      isSustentacao: item.isSustentacao,
      visibleToClient: item.visibleToClient,
      outOfScope: item.outOfScope,
      clientApproval: item.clientApproval,
      plannedMinutes: item.plannedMinutes,
      client: { id: client.id, name: client.name, color: client.color },
      annualName: annual.name,
      parent: p?.id ? { id: p.id, name: p.name, scopeStatus: p.scopeStatus } : null,
      assignees: people.get(item.id) ?? [],
      tags: tags.get(item.id) ?? [],
      workedMinutes: w,
      tasksTotal: kids.length,
      tasksDone: kids.filter((k) => k.stage === "concluido").length,
    };
  });
}

export async function filterOptions() {
  const [clients, people, tags] = await Promise.all([
    db.select({ id: s.clients.id, name: s.clients.name, color: s.clients.color }).from(s.clients).where(eq(s.clients.active, true)).orderBy(asc(s.clients.name)),
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(eq(s.people.active, true)).orderBy(asc(s.people.name)),
    db.select({ id: s.tags.id, name: s.tags.name, color: s.tags.color }).from(s.tags).where(eq(s.tags.system, false)).orderBy(asc(s.tags.name)),
  ]);
  return { clients, people: people.map((p) => ({ ...p, initials: initials(p.name) })), tags };
}

/** Projetos abertos (para escolher o pai de uma tarefa), com entregáveis da versão em vigor e contatos do cliente. */
export async function parentOptions() {
  const projects = await db
    .select({
      id: s.items.id,
      name: s.items.name,
      scopeStatus: s.items.scopeStatus,
      isSustentacao: s.items.isSustentacao,
      visibleToClient: s.items.visibleToClient,
      clientId: s.clients.id,
      year: s.annualProjects.year,
    })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(eq(s.items.kind, "projeto"), eq(s.items.archived, false), sql`${s.items.stage} <> 'concluido'`))
    .orderBy(asc(s.items.name));
  const ids = projects.map((p) => p.id);
  const versions = ids.length
    ? await db.select().from(s.scopeVersions).where(inArray(s.scopeVersions.itemId, ids)).orderBy(desc(s.scopeVersions.version))
    : [];
  const current = new Map<string, string>();
  for (const v of versions) if (!current.has(v.itemId)) current.set(v.itemId, v.id);
  const dels = current.size
    ? await db.select().from(s.deliverables).where(inArray(s.deliverables.scopeVersionId, [...current.values()])).orderBy(asc(s.deliverables.number))
    : [];
  const contacts = await db
    .select({ id: s.clientContacts.id, name: s.clientContacts.name, clientId: s.clientContacts.clientId })
    .from(s.clientContacts)
    .where(eq(s.clientContacts.active, true))
    .orderBy(asc(s.clientContacts.name));
  return {
    projects: projects.map((p) => ({
      ...p,
      deliverables: dels.filter((d) => d.scopeVersionId === current.get(p.id)).map((d) => ({ id: d.id, label: `E${d.number} · ${d.title}` })),
    })),
    contacts,
  };
}

export async function itemHistory(itemId: string) {
  const [stages, deadlines, audits] = await Promise.all([
    db
      .select({ h: s.stageHistory, by: s.people.name })
      .from(s.stageHistory)
      .leftJoin(s.people, eq(s.people.id, s.stageHistory.byPersonId))
      .where(eq(s.stageHistory.itemId, itemId))
      .orderBy(desc(s.stageHistory.at)),
    db
      .select({ d: s.deadlineChanges, by: s.people.name })
      .from(s.deadlineChanges)
      .leftJoin(s.people, eq(s.people.id, s.deadlineChanges.byPersonId))
      .where(eq(s.deadlineChanges.itemId, itemId))
      .orderBy(desc(s.deadlineChanges.at)),
    db
      .select({ a: s.auditLog, by: s.people.name, contact: s.clientContacts.name })
      .from(s.auditLog)
      .leftJoin(s.people, eq(s.people.id, s.auditLog.actorPersonId))
      .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.auditLog.actorContactId))
      .where(and(eq(s.auditLog.entityId, itemId), inArray(s.auditLog.entity, ["item", "scope"])))
      .orderBy(desc(s.auditLog.at))
      .limit(200),
  ]);
  return { stages, deadlines, audits };
}

/** Demandas adicionais que podem ser incorporadas numa nova versão (US-26). */
export async function extrasOf(projectId: string) {
  return db
    .select({ id: s.items.id, name: s.items.name })
    .from(s.items)
    .where(and(eq(s.items.parentId, projectId), eq(s.items.outOfScope, true), eq(s.items.archived, false), inArray(s.items.clientApproval, ["aguardando", "aprovada"])));
}
