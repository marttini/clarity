import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { clientHealth, contactAlert, inactiveMonths, isClientActive, type Health } from "@/domain/rules";
import {
  type ISODate,
  TZ,
  addDays,
  diffDays,
  endOfMonth,
  shortDate,
  startOfDayInstant,
  startOfMonth,
  toISODate,
  weekday,
  workdaysSince,
} from "@/domain/dates";
import type { Period } from "@/domain/period";
import { getEntryTypes, getHolidays, getSettings, STAGES, type StageKey } from "../data/common";

/**
 * Leituras de Clientes e Contatos (US-29, US-30, US-35, US-37, US-38, US-45).
 * Funções reaproveitáveis: Gestão e TV usam `clientPortfolio`.
 */

export type DateRange = { from: ISODate; to: ISODate };

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
/** "14:30" no horário de Brasília. */
export function hhmm(at: Date): string {
  return timeFmt.format(at);
}

function instantRange(r: DateRange) {
  return { start: startOfDayInstant(r.from), end: startOfDayInstant(addDays(r.to, 1)) };
}

/**
 * Período comparável: se o período ainda não acabou, compara só até hoje com o
 * mesmo número de dias do período anterior ("setembro até 08/09").
 */
export function comparablePeriod(p: Period, today: ISODate) {
  const open = p.from <= today && p.to > today;
  const cur: DateRange = { from: p.from, to: open ? today : p.to };
  if (!open) return { cur, prev: { from: p.prev.from, to: p.prev.to } as DateRange, prevLabel: p.prev.label };
  const cand = addDays(p.prev.from, diffDays(today, p.from));
  const prevTo = cand < p.prev.to ? cand : p.prev.to;
  return { cur, prev: { from: p.prev.from, to: prevTo } as DateRange, prevLabel: `${p.prev.label} até ${shortDate(prevTo)}` };
}

// ---------- Carteira (US-45) ----------

export type PortfolioRow = {
  id: string;
  name: string;
  color: string;
  /** US-30: horas reais (sem Provisionamento) nos últimos 6 meses. */
  active: boolean;
  lastRealEntry: ISODate | null;
  /** Meses completos desde a última hora real; null se nunca teve horas. */
  inactiveMonths: number | null;
  /** Projetos (kind = projeto, não arquivados) por etapa. */
  stages: Record<StageKey, number>;
  openTasks: number;
  overdueTasks: number;
  /** Itens abertos (projetos e tarefas) com prazo vencido. */
  overdueItems: number;
  demandsAwaiting: number;
  minutes: { total: number; sustentacao: number; byType: { typeId: string; code: string; name: string; minutes: number }[] };
  lastContact: { date: ISODate; at: Date; type: string; by: string } | null;
  /** Dias úteis desde o último contato Realizado; null se nunca houve. */
  workdaysSinceContact: number | null;
  /** Alerta de cadência (US-37): cliente ativo sem contato há 5+ dias úteis. */
  contactAlert: boolean;
  nextContact: { id: string; at: Date; type: string; responsible: string; overdue: boolean } | null;
  unansweredComments: number;
  health: Health;
  reasons: string[];
};

const HEALTH_ORDER: Record<Health, number> = { vermelho: 0, amarelo: 1, verde: 2 };

/**
 * Uma linha por cliente com saúde (clientHealth), situação, projetos por etapa, tarefas,
 * demandas aguardando, horas do período por tipo e contatos.
 * `period` padrão: mês de `today`. Ordena por saúde (vermelho primeiro), depois nome.
 * Não inclui o cliente interno (Síntese).
 */
export async function clientPortfolio(
  today: ISODate,
  period?: DateRange,
  opts: { clientIds?: string[]; now?: Date } = {},
): Promise<PortfolioRow[]> {
  const per = period ?? { from: startOfMonth(today), to: endOfMonth(today) };
  const nowAt = opts.now ?? new Date(startOfDayInstant(addDays(today, 1)).getTime() - 1);
  const where = [eq(s.clients.active, true), eq(s.clients.isInternal, false)];
  if (opts.clientIds) where.push(inArray(s.clients.id, opts.clientIds.length ? opts.clientIds : ["00000000-0000-0000-0000-000000000000"]));
  const [clients, settings, holidays, types] = await Promise.all([
    db.select().from(s.clients).where(and(...where)).orderBy(asc(s.clients.name)),
    getSettings(),
    getHolidays(),
    getEntryTypes(),
  ]);
  if (!clients.length) return [];
  const ids = clients.map((c) => c.id);

  const [itemRows, lastEntries, hours, lastContacts, nextContacts, unanswered] = await Promise.all([
    db
      .select({
        clientId: s.annualProjects.clientId,
        kind: s.items.kind,
        stage: s.items.stage,
        deadline: s.items.deadline,
        outOfScope: s.items.outOfScope,
        clientApproval: s.items.clientApproval,
      })
      .from(s.items)
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .where(and(eq(s.items.archived, false), inArray(s.annualProjects.clientId, ids))),
    db
      .select({ clientId: s.annualProjects.clientId, last: sql<string | null>`max(${s.timeEntries.date})` })
      .from(s.timeEntries)
      .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
      .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .where(
        and(
          isNull(s.timeEntries.deletedAt),
          eq(s.entryTypes.isProvisioning, false),
          lte(s.timeEntries.date, today),
          inArray(s.annualProjects.clientId, ids),
        ),
      )
      .groupBy(s.annualProjects.clientId),
    db
      .select({
        clientId: s.annualProjects.clientId,
        typeId: s.timeEntries.typeId,
        sust: s.timeEntries.isSustentacao,
        minutes: sql<number>`coalesce(sum(${s.timeEntries.minutes}), 0)::int`,
      })
      .from(s.timeEntries)
      .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
      .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .where(
        and(
          isNull(s.timeEntries.deletedAt),
          eq(s.entryTypes.isProvisioning, false),
          gte(s.timeEntries.date, per.from),
          lte(s.timeEntries.date, per.to),
          inArray(s.annualProjects.clientId, ids),
        ),
      )
      .groupBy(s.annualProjects.clientId, s.timeEntries.typeId, s.timeEntries.isSustentacao),
    db
      .selectDistinctOn([s.contacts.clientId], { clientId: s.contacts.clientId, at: s.contacts.scheduledAt, type: s.contacts.type, by: s.people.name })
      .from(s.contacts)
      .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
      .where(and(eq(s.contacts.status, "realizado"), lte(s.contacts.scheduledAt, nowAt), inArray(s.contacts.clientId, ids)))
      .orderBy(s.contacts.clientId, desc(s.contacts.scheduledAt)),
    db
      .selectDistinctOn([s.contacts.clientId], {
        id: s.contacts.id,
        clientId: s.contacts.clientId,
        at: s.contacts.scheduledAt,
        type: s.contacts.type,
        by: s.people.name,
      })
      .from(s.contacts)
      .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
      .where(and(eq(s.contacts.status, "agendado"), inArray(s.contacts.clientId, ids)))
      .orderBy(s.contacts.clientId, asc(s.contacts.scheduledAt)),
    db
      .select({ clientId: s.annualProjects.clientId, at: s.comments.createdAt })
      .from(s.comments)
      .innerJoin(s.items, eq(s.items.id, s.comments.itemId))
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .where(
        and(
          eq(s.comments.channel, "cliente"),
          isNotNull(s.comments.authorContactId),
          isNull(s.comments.answeredAt),
          isNull(s.comments.deletedAt),
          inArray(s.annualProjects.clientId, ids),
        ),
      ),
  ]);

  const typeById = new Map(types.map((t) => [t.id, t]));
  const startOfToday = startOfDayInstant(today);

  const rows = clients.map((c): PortfolioRow => {
    const its = itemRows.filter((i) => i.clientId === c.id);
    const stages = Object.fromEntries(STAGES.map((x) => [x.key, 0])) as Record<StageKey, number>;
    const deadlines: ISODate[] = [];
    let openTasks = 0;
    let overdueTasks = 0;
    let demandsAwaiting = 0;
    for (const i of its) {
      if (i.outOfScope && i.clientApproval === "aguardando") demandsAwaiting++;
      const pendingDemand = i.outOfScope && (i.clientApproval === "aguardando" || i.clientApproval === "recusada");
      if (i.kind === "projeto") stages[i.stage]++;
      if (i.stage === "concluido" || pendingDemand) continue;
      if (i.deadline) deadlines.push(i.deadline);
      if (i.kind === "tarefa") {
        openTasks++;
        if (i.deadline && i.deadline < today) overdueTasks++;
      }
    }
    const last = lastEntries.find((x) => x.clientId === c.id)?.last ?? null;
    const active = isClientActive(last, today, settings);
    const hrs = hours.filter((h) => h.clientId === c.id);
    const byTypeMap = new Map<string, number>();
    let total = 0;
    let sust = 0;
    for (const h of hrs) {
      byTypeMap.set(h.typeId, (byTypeMap.get(h.typeId) ?? 0) + h.minutes);
      total += h.minutes;
      if (h.sust) sust += h.minutes;
    }
    const byType = [...byTypeMap.entries()]
      .map(([typeId, minutes]) => {
        const t = typeById.get(typeId);
        return { typeId, code: t?.code ?? "", name: t?.name ?? "Outro", minutes, sort: t?.sort ?? 999 };
      })
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort, ...rest }) => (void sort, rest));
    const lc = lastContacts.find((x) => x.clientId === c.id);
    const lastContact = lc ? { date: toISODate(lc.at), at: lc.at, type: lc.type, by: lc.by } : null;
    const nc = nextContacts.find((x) => x.clientId === c.id);
    const unans = unanswered.filter((u) => u.clientId === c.id).map((u) => u.at);
    const h = clientHealth({
      today,
      holidays,
      openDeadlines: deadlines,
      unansweredClientCommentsSince: unans,
      lastRealizedContact: lastContact?.date ?? null,
      active,
      demandsAwaitingClient: demandsAwaiting,
      settings,
    });
    const ca = contactAlert(lastContact?.date ?? null, today, holidays, settings);
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      active,
      lastRealEntry: last,
      inactiveMonths: active ? null : inactiveMonths(last, today),
      stages,
      openTasks,
      overdueTasks,
      overdueItems: deadlines.filter((d) => d < today).length,
      demandsAwaiting,
      minutes: { total, sustentacao: sust, byType },
      lastContact,
      workdaysSinceContact: lastContact ? workdaysSince(lastContact.date, today, holidays) : null,
      contactAlert: active && ca.alert,
      nextContact: nc ? { id: nc.id, at: nc.at, type: nc.type, responsible: nc.by, overdue: nc.at < startOfToday } : null,
      unansweredComments: unans.length,
      health: h.health,
      reasons: h.reasons,
    };
  });
  return rows.sort((a, b) => Number(b.active) - Number(a.active) || HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.name.localeCompare(b.name, "pt-BR"));
}

/** Texto curto de situação: "Ativo" ou "Inativo há 7 meses". */
export function situationLabel(r: { active: boolean; inactiveMonths: number | null }): string {
  if (r.active) return "Ativo";
  if (r.inactiveMonths === null) return "Inativo, sem horas registradas";
  return `Inativo há ${r.inactiveMonths} ${r.inactiveMonths === 1 ? "mês" : "meses"}`;
}

// ---------- Pendências do Odoo (US-28) ----------

export async function syncPendencies() {
  const rows = await db
    .select()
    .from(s.syncLog)
    .where(eq(s.syncLog.level, "pendencia"))
    .orderBy(desc(s.syncLog.at))
    .limit(300);
  const projIds = rows.filter((r) => r.model === "project.project" && r.odooId !== null).map((r) => r.odooId!);
  const linked = projIds.length
    ? await db
        .select({ odooId: s.annualProjects.odooProjectId, clientId: s.annualProjects.clientId, client: s.clients.name })
        .from(s.annualProjects)
        .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
        .where(inArray(s.annualProjects.odooProjectId, projIds))
    : [];
  return rows.map((r) => {
    const fix = r.model === "project.project" ? linked.find((l) => l.odooId === r.odooId) : undefined;
    return { ...r, resolved: !!fix, resolvedClient: fix ? { id: fix.clientId, name: fix.client } : null };
  });
}

// ---------- Ficha 360° (US-29, US-30, US-31, US-38) ----------

export async function getClientHead(id: string) {
  const [client] = await db.select().from(s.clients).where(eq(s.clients.id, id));
  if (!client) return null;
  const [contacts, annuals] = await Promise.all([
    db.select().from(s.clientContacts).where(eq(s.clientContacts.clientId, id)).orderBy(desc(s.clientContacts.portalAccess), asc(s.clientContacts.name)),
    db.select().from(s.annualProjects).where(eq(s.annualProjects.clientId, id)).orderBy(desc(s.annualProjects.year)),
  ]);
  return { client, contacts, annuals };
}

/** Ids dos itens do cliente (inclui arquivados), com nome e pai, para montar a linha do tempo. */
async function clientItemIndex(clientId: string) {
  const parent = alias(s.items, "parent");
  const rows = await db
    .select({
      id: s.items.id,
      name: s.items.name,
      kind: s.items.kind,
      parentId: s.items.parentId,
      parentName: parent.name,
      annualYear: s.annualProjects.year,
    })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .where(eq(s.annualProjects.clientId, clientId));
  return new Map(rows.map((r) => [r.id, r]));
}

export type EntryRow = {
  id: string;
  date: ISODate;
  personId: string;
  person: string;
  itemId: string;
  minutes: number;
  typeId: string;
  typeCode: string;
  typeName: string;
  sust: boolean;
};

/** Apontamentos reais (sem Provisionamento, sem excluídos) do cliente no intervalo. */
export async function clientEntries(clientId: string, r: DateRange): Promise<EntryRow[]> {
  return db
    .select({
      id: s.timeEntries.id,
      date: s.timeEntries.date,
      personId: s.timeEntries.personId,
      person: s.people.name,
      itemId: s.timeEntries.itemId,
      minutes: s.timeEntries.minutes,
      typeId: s.timeEntries.typeId,
      typeCode: s.entryTypes.code,
      typeName: s.entryTypes.name,
      sust: s.timeEntries.isSustentacao,
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(
      and(
        eq(s.annualProjects.clientId, clientId),
        isNull(s.timeEntries.deletedAt),
        eq(s.entryTypes.isProvisioning, false),
        gte(s.timeEntries.date, r.from),
        lte(s.timeEntries.date, r.to),
      ),
    )
    .orderBy(desc(s.timeEntries.date), asc(s.people.name));
}

export type TimelineEvent =
  | { kind: "tarefa"; at: Date; itemId: string; title: string; parent: string | null; who: string | null }
  | { kind: "coment"; at: Date; itemId: string; itemName: string; who: string; text: string; open: boolean }
  | { kind: "contato"; at: Date; contactId: string; type: string; by: string; with: string | null; text: string | null; next: string | null; status: string }
  | { kind: "etapa"; at: Date; itemId: string; itemName: string; from: string | null; to: string; who: string | null }
  | { kind: "anexo"; at: Date; file: string; who: string | null; itemId: string | null; itemName: string | null }
  | { kind: "demanda"; at: Date; itemId: string; title: string; minutes: number | null; approval: string }
  | { kind: "prazo"; at: Date; itemId: string; itemName: string; from: ISODate | null; to: ISODate; reason: string; who: string | null };

/** Eventos do período para "O que aconteceu" (sem os apontamentos, que vêm de clientEntries). */
export async function clientTimeline(clientId: string, r: DateRange): Promise<TimelineEvent[]> {
  const { start, end } = instantRange(r);
  const idx = await clientItemIndex(clientId);
  const itemIds = [...idx.keys()];
  const none = ["00000000-0000-0000-0000-000000000000"];
  const ids = itemIds.length ? itemIds : none;
  const [done, comments, contacts, stages, demands, deadlines, clientContactIds] = await Promise.all([
    db
      .select({ id: s.items.id, at: s.items.completedAt, who: sql<string | null>`(select p.name from item_assignees ia join people p on p.id = ia.person_id where ia.item_id = "items"."id" order by p.name limit 1)` })
      .from(s.items)
      .where(and(inArray(s.items.id, ids), gte(s.items.completedAt, start), lt(s.items.completedAt, end))),
    db
      .select({ id: s.comments.id, itemId: s.comments.itemId, at: s.comments.createdAt, body: s.comments.body, answeredAt: s.comments.answeredAt, who: s.clientContacts.name })
      .from(s.comments)
      .innerJoin(s.clientContacts, eq(s.clientContacts.id, s.comments.authorContactId))
      .where(and(inArray(s.comments.itemId, ids), eq(s.comments.channel, "cliente"), isNull(s.comments.deletedAt), gte(s.comments.createdAt, start), lt(s.comments.createdAt, end))),
    db
      .select({
        id: s.contacts.id,
        at: s.contacts.scheduledAt,
        type: s.contacts.type,
        status: s.contacts.status,
        by: s.people.name,
        with: s.clientContacts.name,
        text: s.contacts.resultSummary,
        next: s.contacts.nextStep,
      })
      .from(s.contacts)
      .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
      .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.contacts.clientContactId))
      .where(and(eq(s.contacts.clientId, clientId), inArray(s.contacts.status, ["realizado", "nao_atendeu"]), gte(s.contacts.scheduledAt, start), lt(s.contacts.scheduledAt, end))),
    db
      .select({ itemId: s.stageHistory.itemId, at: s.stageHistory.at, from: s.stageHistory.fromStage, to: s.stageHistory.toStage, who: s.people.name })
      .from(s.stageHistory)
      .leftJoin(s.people, eq(s.people.id, s.stageHistory.byPersonId))
      .where(and(inArray(s.stageHistory.itemId, ids), gte(s.stageHistory.at, start), lt(s.stageHistory.at, end))),
    db
      .select({ id: s.items.id, at: s.items.createdAt, name: s.items.name, minutes: s.items.plannedMinutes, approval: s.items.clientApproval })
      .from(s.items)
      .where(and(inArray(s.items.id, ids), eq(s.items.outOfScope, true), gte(s.items.createdAt, start), lt(s.items.createdAt, end))),
    db
      .select({ itemId: s.deadlineChanges.itemId, at: s.deadlineChanges.at, from: s.deadlineChanges.oldDeadline, to: s.deadlineChanges.newDeadline, reason: s.deadlineChanges.reason, who: s.people.name })
      .from(s.deadlineChanges)
      .leftJoin(s.people, eq(s.people.id, s.deadlineChanges.byPersonId))
      .where(and(inArray(s.deadlineChanges.itemId, ids), gte(s.deadlineChanges.at, start), lt(s.deadlineChanges.at, end))),
    db.select({ id: s.contacts.id }).from(s.contacts).where(eq(s.contacts.clientId, clientId)),
  ]);
  const ownerIds = [...itemIds, ...clientContactIds.map((c) => c.id)];
  const files = ownerIds.length
    ? await db
        .select({ ownerType: s.attachments.ownerType, ownerId: s.attachments.ownerId, at: s.attachments.createdAt, file: s.attachments.filename, person: s.people.name, contact: s.clientContacts.name })
        .from(s.attachments)
        .leftJoin(s.people, eq(s.people.id, s.attachments.uploadedByPersonId))
        .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.attachments.uploadedByContactId))
        .where(and(inArray(s.attachments.ownerId, ownerIds), inArray(s.attachments.ownerType, ["item", "contact"]), gte(s.attachments.createdAt, start), lt(s.attachments.createdAt, end)))
    : [];
  const nm = (id: string | null) => (id ? (idx.get(id)?.name ?? "Item") : "Item");
  const ev: TimelineEvent[] = [
    ...done.map((d) => ({ kind: "tarefa" as const, at: d.at!, itemId: d.id, title: nm(d.id), parent: idx.get(d.id)?.parentName ?? null, who: d.who })),
    ...comments.map((c) => ({ kind: "coment" as const, at: c.at, itemId: c.itemId!, itemName: nm(c.itemId), who: c.who, text: c.body, open: !c.answeredAt })),
    ...contacts.map((c) => ({ kind: "contato" as const, at: c.at, contactId: c.id, type: c.type, by: c.by, with: c.with, text: c.text, next: c.next, status: c.status })),
    ...stages.map((x) => ({ kind: "etapa" as const, at: x.at, itemId: x.itemId, itemName: nm(x.itemId), from: x.from, to: x.to, who: x.who })),
    ...demands.map((d) => ({ kind: "demanda" as const, at: d.at, itemId: d.id, title: d.name, minutes: d.minutes, approval: d.approval })),
    ...deadlines.map((d) => ({ kind: "prazo" as const, at: d.at, itemId: d.itemId, itemName: nm(d.itemId), from: d.from, to: d.to, reason: d.reason, who: d.who })),
    ...files.map((f) => ({
      kind: "anexo" as const,
      at: f.at,
      file: f.file,
      who: f.person ?? f.contact,
      itemId: f.ownerType === "item" ? f.ownerId : null,
      itemName: f.ownerType === "item" ? nm(f.ownerId) : "Contato",
    })),
  ];
  return ev.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Nome de item e do pai, para as linhas de apontamento. */
export async function clientItemNames(clientId: string) {
  const idx = await clientItemIndex(clientId);
  return Object.fromEntries([...idx.entries()].map(([k, v]) => [k, { name: v.name, parent: v.parentName }]));
}

/** Contagens do período para os números da ficha (tarefas concluídas, demandas criadas). */
export async function clientCounts(clientId: string, r: DateRange) {
  const ir = instantRange(r);
  const start = sql`${ir.start.toISOString()}::timestamptz`;
  const end = sql`${ir.end.toISOString()}::timestamptz`;
  const [row] = await db
    .select({
      done: sql<number>`count(*) filter (where ${s.items.kind} = 'tarefa' and ${s.items.completedAt} >= ${start} and ${s.items.completedAt} < ${end})::int`,
      demands: sql<number>`count(*) filter (where ${s.items.outOfScope} and ${s.items.createdAt} >= ${start} and ${s.items.createdAt} < ${end})::int`,
      overdueAtStart: sql<number>`count(*) filter (where ${s.items.kind} = 'tarefa' and ${s.items.deadline} < ${r.from} and ${s.items.createdAt} < ${start} and (${s.items.completedAt} is null or ${s.items.completedAt} >= ${start}) and not (${s.items.outOfScope} and ${s.items.clientApproval} in ('aguardando','recusada')))::int`,
    })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(and(eq(s.annualProjects.clientId, clientId), eq(s.items.archived, false)));
  return row;
}

/** Projetos e tarefas de primeiro nível (fora demandas), com escopo x realizado e responsáveis. */
export async function clientWorkItems(clientId: string) {
  const items = await db
    .select({
      id: s.items.id,
      name: s.items.name,
      kind: s.items.kind,
      stage: s.items.stage,
      scopeStatus: s.items.scopeStatus,
      deadline: s.items.deadline,
      planned: s.items.plannedMinutes,
      isSust: s.items.isSustentacao,
      year: s.annualProjects.year,
      completedAt: s.items.completedAt,
    })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(and(eq(s.annualProjects.clientId, clientId), isNull(s.items.parentId), eq(s.items.archived, false), eq(s.items.outOfScope, false)));
  if (!items.length) return [];
  const ids = items.map((i) => i.id);
  const [scopes, done, tags, people] = await Promise.all([
    db
      .selectDistinctOn([s.scopeVersions.itemId], { itemId: s.scopeVersions.itemId, est: s.scopeVersions.estimateMinutes })
      .from(s.scopeVersions)
      .where(and(inArray(s.scopeVersions.itemId, ids), sql`${s.scopeVersions.version} >= 1`))
      .orderBy(s.scopeVersions.itemId, desc(s.scopeVersions.version)),
    db.execute<{ root: string; minutes: number }>(sql`
      select coalesce(i.parent_id, i.id) as root, coalesce(sum(t.minutes),0)::int as minutes
      from ${s.timeEntries} t
      join ${s.entryTypes} et on et.id = t.type_id
      join ${s.items} i on i.id = t.item_id
      where t.deleted_at is null and not et.is_provisioning
        and (i.id in ${ids} or i.parent_id in ${ids})
      group by 1`),
    db
      .select({ itemId: s.itemTags.itemId, name: s.tags.name })
      .from(s.itemTags)
      .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
      .where(and(inArray(s.itemTags.itemId, ids), eq(s.tags.system, false))),
    db
      .select({ itemId: s.itemAssignees.itemId, id: s.people.id, name: s.people.name })
      .from(s.itemAssignees)
      .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
      .where(inArray(s.itemAssignees.itemId, ids)),
  ]);
  const doneMap = new Map([...done].map((d) => [d.root, Number(d.minutes)]));
  return items.map((i) => ({
    ...i,
    estimate: scopes.find((x) => x.itemId === i.id)?.est ?? i.planned ?? null,
    done: doneMap.get(i.id) ?? 0,
    tags: tags.filter((t) => t.itemId === i.id).map((t) => t.name),
    people: people.filter((p) => p.itemId === i.id).map((p) => ({ id: p.id, name: p.name })),
  }));
}

/** Demandas adicionais do cliente (US-24 a US-27), da mais recente para a mais antiga. */
export async function clientDemands(clientId: string) {
  const requester = alias(s.clientContacts, "requester");
  const approver = alias(s.clientContacts, "approver");
  const parent = alias(s.items, "parent");
  return db
    .select({
      id: s.items.id,
      name: s.items.name,
      parent: parent.name,
      approval: s.items.clientApproval,
      approvalAt: s.items.clientApprovalAt,
      reason: s.items.clientApprovalReason,
      minutes: s.items.plannedMinutes,
      requestedAt: s.items.requestedAt,
      requester: requester.name,
      approver: approver.name,
      createdAt: s.items.createdAt,
    })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .leftJoin(requester, eq(requester.id, s.items.requestedByContactId))
    .leftJoin(approver, eq(approver.id, s.items.clientApprovalByContactId))
    .where(and(eq(s.annualProjects.clientId, clientId), eq(s.items.outOfScope, true), eq(s.items.archived, false)))
    .orderBy(desc(s.items.createdAt));
}

/** Avaliações: médias das publicadas e quantas aguardam publicação (esta só para a gestão). */
export async function clientEvaluations(clientId: string, year: number) {
  const [row] = await db
    .select({
      n: sql<number>`count(*) filter (where ${s.evaluations.published})::int`,
      nYear: sql<number>`count(*) filter (where ${s.evaluations.published} and extract(year from ${s.evaluations.createdAt} at time zone 'America/Sao_Paulo') = ${year})::int`,
      result: sql<number | null>`avg(${s.evaluations.scoreResult}) filter (where ${s.evaluations.published})::float`,
      consultant: sql<number | null>`avg(${s.evaluations.scoreConsultant}) filter (where ${s.evaluations.published})::float`,
      team: sql<number | null>`avg(${s.evaluations.scoreTeam}) filter (where ${s.evaluations.published})::float`,
      pending: sql<number>`count(*) filter (where not ${s.evaluations.published})::int`,
    })
    .from(s.evaluations)
    .where(eq(s.evaluations.clientId, clientId));
  return row;
}

/** Reprogramações de prazo do cliente (US-17, US-29), mais recentes primeiro. */
export async function clientDeadlineChanges(clientId: string, limit = 50) {
  return db
    .select({
      id: s.deadlineChanges.id,
      itemId: s.deadlineChanges.itemId,
      item: s.items.name,
      from: s.deadlineChanges.oldDeadline,
      to: s.deadlineChanges.newDeadline,
      reason: s.deadlineChanges.reason,
      who: s.people.name,
      at: s.deadlineChanges.at,
    })
    .from(s.deadlineChanges)
    .innerJoin(s.items, eq(s.items.id, s.deadlineChanges.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .leftJoin(s.people, eq(s.people.id, s.deadlineChanges.byPersonId))
    .where(eq(s.annualProjects.clientId, clientId))
    .orderBy(desc(s.deadlineChanges.at))
    .limit(limit);
}

/** Pessoas responsáveis por itens abertos do cliente (para "consultores envolvidos"). */
export async function clientAssignees(clientId: string) {
  return db
    .selectDistinct({ id: s.people.id, name: s.people.name })
    .from(s.itemAssignees)
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .innerJoin(s.items, eq(s.items.id, s.itemAssignees.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(and(eq(s.annualProjects.clientId, clientId), ne(s.items.stage, "concluido"), eq(s.items.archived, false)));
}

/** Itens abertos do cliente para o seletor "item relacionado" do agendamento. */
export async function clientOpenItems(clientId: string) {
  return db
    .select({ id: s.items.id, name: s.items.name, kind: s.items.kind })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(and(eq(s.annualProjects.clientId, clientId), ne(s.items.stage, "concluido"), eq(s.items.archived, false)))
    .orderBy(asc(s.items.name));
}

// ---------- Contatos (US-34 a US-38) ----------

export type ContactRow = {
  id: string;
  clientId: string;
  client: string;
  color: string;
  type: string;
  status: "agendado" | "realizado" | "nao_atendeu" | "remarcado" | "cancelado";
  at: Date;
  date: ISODate;
  time: string;
  responsibleId: string;
  responsible: string;
  clientContactId: string | null;
  with: string | null;
  objective: string;
  summary: string | null;
  nextStep: string | null;
  reason: string | null;
  relatedItemId: string | null;
  relatedItem: string | null;
  createdBy: string;
};

/** Contatos com filtros (período por data agendada, cliente, pessoa, tipo, situação). */
export async function listContacts(f: {
  range?: DateRange;
  clientId?: string;
  personId?: string;
  type?: string;
  status?: ContactRow["status"][];
  id?: string;
  limit?: number;
  order?: "asc" | "desc";
}): Promise<ContactRow[]> {
  const cond = [];
  if (f.range) {
    const { start, end } = instantRange(f.range);
    cond.push(gte(s.contacts.scheduledAt, start), lt(s.contacts.scheduledAt, end));
  }
  if (f.clientId) cond.push(eq(s.contacts.clientId, f.clientId));
  if (f.personId) cond.push(eq(s.contacts.responsibleId, f.personId));
  if (f.type) cond.push(sql`${s.contacts.type} = ${f.type}`);
  if (f.status?.length) cond.push(inArray(s.contacts.status, f.status));
  if (f.id) cond.push(eq(s.contacts.id, f.id));
  const creator = alias(s.people, "creator");
  const rows = await db
    .select({
      c: s.contacts,
      client: s.clients.name,
      color: s.clients.color,
      responsible: s.people.name,
      with: s.clientContacts.name,
      relatedItem: s.items.name,
      createdBy: creator.name,
    })
    .from(s.contacts)
    .innerJoin(s.clients, eq(s.clients.id, s.contacts.clientId))
    .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
    .innerJoin(creator, eq(creator.id, s.contacts.createdBy))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.contacts.clientContactId))
    .leftJoin(s.items, eq(s.items.id, s.contacts.relatedItemId))
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(f.order === "asc" ? asc(s.contacts.scheduledAt) : desc(s.contacts.scheduledAt))
    .limit(f.limit ?? 500);
  return rows.map((r) => ({
    id: r.c.id,
    clientId: r.c.clientId,
    client: r.client,
    color: r.color,
    type: r.c.type,
    status: r.c.status,
    at: r.c.scheduledAt,
    date: toISODate(r.c.scheduledAt),
    time: hhmm(r.c.scheduledAt),
    responsibleId: r.c.responsibleId,
    responsible: r.responsible,
    clientContactId: r.c.clientContactId,
    with: r.with,
    objective: r.c.objective,
    summary: r.c.resultSummary,
    nextStep: r.c.nextStep,
    reason: r.c.rescheduleReason,
    relatedItemId: r.c.relatedItemId,
    relatedItem: r.relatedItem,
    createdBy: r.createdBy,
  }));
}

/** US-35: agenda de uma pessoa em três grupos: atrasados, hoje e próximos 7 dias. */
export async function personAgenda(personId: string, today: ISODate) {
  const rows = await listContacts({ personId, status: ["agendado"], range: { from: addDays(today, -365), to: addDays(today, 7) }, order: "asc" });
  return {
    late: rows.filter((r) => r.date < today),
    today: rows.filter((r) => r.date === today),
    next: rows.filter((r) => r.date > today),
  };
}

/** Segunda-feira da semana de `d`. */
export function mondayOf(d: ISODate): ISODate {
  return addDays(d, -((weekday(d) + 6) % 7));
}

/** Contatos agendados atrasados de todo o time (para avisos e painéis). */
export async function lateContacts(today: ISODate) {
  return listContacts({ status: ["agendado"], range: { from: addDays(today, -365), to: addDays(today, -1) }, order: "asc" });
}

/** Contatos do cliente: histórico (realizados e não atendidos) e próximos agendados. */
export async function clientContactsSummary(clientId: string, historyLimit = 6) {
  const [history, upcoming] = await Promise.all([
    listContacts({ clientId, status: ["realizado", "nao_atendeu"], limit: historyLimit }),
    listContacts({ clientId, status: ["agendado"], order: "asc", limit: 5 }),
  ]);
  return { history, upcoming };
}

/** Pessoas ativas do time (todas: consultores, gestão e administrativo podem receber contatos). */
export async function teamPeople() {
  return db
    .select({ id: s.people.id, name: s.people.name, role: s.people.role, isConsultor: s.people.isConsultor })
    .from(s.people)
    .where(eq(s.people.active, true))
    .orderBy(asc(s.people.name));
}

/** Clientes (ativos no cadastro, fora o interno) e seus contatos, para os formulários. */
export async function clientsWithContacts() {
  const [clients, contacts] = await Promise.all([
    db
      .select({ id: s.clients.id, name: s.clients.name, color: s.clients.color })
      .from(s.clients)
      .where(and(eq(s.clients.active, true), eq(s.clients.isInternal, false)))
      .orderBy(asc(s.clients.name)),
    db
      .select({ id: s.clientContacts.id, clientId: s.clientContacts.clientId, name: s.clientContacts.name })
      .from(s.clientContacts)
      .where(eq(s.clientContacts.active, true))
      .orderBy(asc(s.clientContacts.name)),
  ]);
  return clients.map((c) => ({ ...c, contacts: contacts.filter((x) => x.clientId === c.id).map(({ id, name }) => ({ id, name })) }));
}
