import "server-only";
/**
 * Leituras de Minha fila e de Minhas horas (US-01, US-04, US-06, US-09, US-11, US-12, US-35, US-41, US-46).
 * Só leitura. Escritas passam pelos serviços (entries.ts, contacts.ts).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { type ISODate, addDays, diffDays, endOfMonth, eachDay, isWorkday, startOfMonth, toISODate, weekday, workdaysSince } from "@/domain/dates";
import { currentMissingStreak, editDeadline, type Settings } from "@/domain/rules";
import { getHolidays, getSettings } from "../data/common";
import { firstEntryDates, itemTagsOf, loadJustifications, portfolioLite } from "./analytics";
import { hhmm, listContacts } from "./clients";

const parent = alias(s.items, "parent");

// ---------- Opções do lançador (US-01, US-02, US-03) ----------

export type LaunchClient = { id: string; name: string; color: string; isInternal: boolean };
export type LaunchAnnual = { id: string; clientId: string; name: string };
export type LaunchTask = {
  id: string;
  clientId: string;
  annualId: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  kind: "projeto" | "tarefa";
  isSustentacao: boolean;
  /** Motivo de não aceitar horas (demanda aguardando/recusada). */
  disabled: string | null;
  mine: boolean;
};
export type LaunchType = { id: string; code: string; name: string; acceptsSalesOrder: boolean; isInternal: boolean; isProvisioning: boolean };
export type LaunchSO = { id: string; clientId: string; label: string };
export type LaunchOptions = { clients: LaunchClient[]; annuals: LaunchAnnual[]; tasks: LaunchTask[]; types: LaunchType[]; salesOrders: LaunchSO[]; year: number };

/**
 * Projetos anuais do ano atual ("Novo modelo"), tarefas abertas que aceitam horas,
 * tipos ativos e pedidos de venda. Projetos em rascunho (e suas tarefas) não aparecem.
 */
export async function launcherOptions(personId: string, today: ISODate, opts: { includeItemIds?: string[] } = {}): Promise<LaunchOptions> {
  const year = Number(today.slice(0, 4));
  const [clients, annuals, types, sos] = await Promise.all([
    db.select({ id: s.clients.id, name: s.clients.name, color: s.clients.color, isInternal: s.clients.isInternal }).from(s.clients).where(eq(s.clients.active, true)).orderBy(asc(s.clients.name)),
    db
      .select({ id: s.annualProjects.id, clientId: s.annualProjects.clientId, name: s.annualProjects.name })
      .from(s.annualProjects)
      .where(and(eq(s.annualProjects.year, year), eq(s.annualProjects.active, true)))
      .orderBy(asc(s.annualProjects.name)),
    db.select().from(s.entryTypes).where(eq(s.entryTypes.active, true)).orderBy(asc(s.entryTypes.sort), asc(s.entryTypes.name)),
    db
      .select({ id: s.salesOrderLines.id, clientId: s.salesOrderLines.clientId, order: s.salesOrderLines.orderName, line: s.salesOrderLines.lineName })
      .from(s.salesOrderLines)
      .where(eq(s.salesOrderLines.active, true))
      .orderBy(asc(s.salesOrderLines.orderName)),
  ]);
  const annualIds = annuals.map((a) => a.id);
  const extra = opts.includeItemIds?.filter(Boolean) ?? [];
  const rows = annualIds.length || extra.length
    ? await db
        .select({
          id: s.items.id,
          annualId: s.items.annualProjectId,
          clientId: s.annualProjects.clientId,
          name: s.items.name,
          kind: s.items.kind,
          parentId: s.items.parentId,
          parentName: parent.name,
          parentScope: parent.scopeStatus,
          scope: s.items.scopeStatus,
          isSustentacao: s.items.isSustentacao,
          outOfScope: s.items.outOfScope,
          clientApproval: s.items.clientApproval,
          stage: s.items.stage,
          archived: s.items.archived,
        })
        .from(s.items)
        .leftJoin(parent, eq(parent.id, s.items.parentId))
        .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
        .where(
          or(
            annualIds.length ? and(inArray(s.items.annualProjectId, annualIds), eq(s.items.archived, false), ne(s.items.stage, "concluido")) : undefined,
            extra.length ? inArray(s.items.id, extra) : undefined,
          ),
        )
        .orderBy(asc(parent.name), asc(s.items.name))
    : [];
  // Itens de outros anos (edição de apontamento antigo): traz também o projeto anual deles.
  const missingAnnuals = [...new Set(rows.map((r) => r.annualId).filter((a) => !annualIds.includes(a)))];
  if (missingAnnuals.length)
    annuals.push(
      ...(await db
        .select({ id: s.annualProjects.id, clientId: s.annualProjects.clientId, name: s.annualProjects.name })
        .from(s.annualProjects)
        .where(inArray(s.annualProjects.id, missingAnnuals))),
    );
  const ids = rows.map((r) => r.id);
  const mine = ids.length
    ? new Set((await db.select({ id: s.itemAssignees.itemId }).from(s.itemAssignees).where(and(eq(s.itemAssignees.personId, personId), inArray(s.itemAssignees.itemId, ids)))).map((r) => r.id))
    : new Set<string>();
  const tasks: LaunchTask[] = rows
    .filter((r) => extra.includes(r.id) || (r.scope !== "rascunho" && r.parentScope !== "rascunho"))
    .map((r) => ({
      id: r.id,
      clientId: r.clientId,
      annualId: r.annualId,
      name: r.name,
      parentId: r.parentId,
      parentName: r.parentName,
      kind: r.kind,
      isSustentacao: r.isSustentacao,
      disabled:
        r.outOfScope && r.clientApproval === "aguardando"
          ? "aguardando aprovação do cliente"
          : r.outOfScope && r.clientApproval === "recusada"
            ? "recusada pelo cliente"
            : r.scope === "rascunho" || r.parentScope === "rascunho"
              ? "projeto em rascunho"
              : r.archived
                ? "arquivada"
                : null,
      mine: mine.has(r.id),
    }));
  return {
    clients,
    annuals,
    tasks,
    types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, acceptsSalesOrder: t.acceptsSalesOrder, isInternal: t.isInternal, isProvisioning: t.isProvisioning })),
    salesOrders: sos.map((x) => ({ id: x.id, clientId: x.clientId, label: `${x.order} · ${x.line}` })),
    year,
  };
}

// ---------- Régua do mês e regra dos 3 dias (US-06, US-11) ----------

export type RulerDay = {
  date: ISODate;
  /** Horas reais (sem Provisionamento). */
  minutes: number;
  /** Faturáveis do dia. */
  fat: number;
  prov: number;
  holiday: string | null;
  justified: boolean;
  isToday: boolean;
  future: boolean;
  workday: boolean;
};

/** Minutos por dia de uma pessoa num intervalo: reais, faturáveis e provisionados. */
export async function dailyMinutes(personId: string, from: ISODate, to: ISODate) {
  const rows = await db
    .select({
      date: s.timeEntries.date,
      prov: s.entryTypes.isProvisioning,
      fat: s.entryTypes.countsForBonus,
      minutes: sql<number>`sum(${s.timeEntries.minutes})`.mapWith(Number),
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .where(and(eq(s.timeEntries.personId, personId), isNull(s.timeEntries.deletedAt), gte(s.timeEntries.date, from), lte(s.timeEntries.date, to)))
    .groupBy(s.timeEntries.date, s.entryTypes.isProvisioning, s.entryTypes.countsForBonus);
  const m = new Map<ISODate, { minutes: number; fat: number; prov: number }>();
  for (const r of rows) {
    const d = m.get(r.date) ?? { minutes: 0, fat: 0, prov: 0 };
    if (r.prov) d.prov += r.minutes;
    else {
      d.minutes += r.minutes;
      if (r.fat) d.fat += r.minutes;
    }
    m.set(r.date, d);
  }
  return m;
}

/**
 * Dias do mês (seg a sex, feriados marcados), total faturável do mês e a sequência atual
 * de dias úteis sem apontamento nem justificativa (US-11).
 */
export async function monthRuler(personId: string, today: ISODate) {
  const monthFrom = startOfMonth(today);
  const monthTo = endOfMonth(today);
  const from = addDays(today, -70) < monthFrom ? addDays(today, -70) : monthFrom;
  const [daily, holidays, holidayRows, just, first, settings] = await Promise.all([
    dailyMinutes(personId, from, addDays(monthTo, 7)),
    getHolidays(),
    db.select().from(s.holidays).where(and(gte(s.holidays.date, monthFrom), lte(s.holidays.date, monthTo))),
    loadJustifications([personId], { from, to: monthTo }),
    firstEntryDates([personId]),
    getSettings(),
  ]);
  const holidayName = new Map(holidayRows.map((h) => [h.date, h.name]));
  const justSet = new Set(just.map((j) => j.date));
  const withEntries = new Set([...daily.entries()].filter(([, v]) => v.minutes > 0).map(([d]) => d));
  const streak = currentMissingStreak({ today, daysWithEntries: withEntries, justifiedDays: justSet, holidays, since: first.get(personId) });
  const days: RulerDay[] = eachDay(monthFrom, monthTo)
    .filter((d) => weekday(d) !== 0 && weekday(d) !== 6)
    .map((d) => {
      const v = daily.get(d) ?? { minutes: 0, fat: 0, prov: 0 };
      return {
        date: d,
        minutes: v.minutes,
        fat: v.fat,
        prov: v.prov,
        holiday: holidayName.get(d) ?? (holidays.has(d) ? "Feriado" : null),
        justified: justSet.has(d),
        isToday: d === today,
        future: d > today,
        workday: isWorkday(d, holidays),
      };
    });
  const fatMonth = [...daily.entries()].filter(([d]) => d >= monthFrom && d <= monthTo).reduce((a, [, v]) => a + v.fat, 0);
  return { days, fatMonth, streak, settings, daily, justified: just, holidays, first: first.get(personId) ?? null };
}

// ---------- Itens do consultor (US-46) ----------

export type QueueItem = {
  id: string;
  kind: "projeto" | "tarefa";
  name: string;
  path: string;
  stage: string;
  deadline: ISODate | null;
  clientId: string;
  clientName: string;
  clientColor: string;
  outOfScope: boolean;
  clientApproval: string;
  isSustentacao: boolean;
  requestedAt: ISODate | null;
  createdOn: ISODate;
  tags: { name: string; color: string }[];
};

/** Itens abertos em que a pessoa é responsável (ou todos, para o administrativo cobrar). */
export async function openItems(opts: { personId?: string; withTags?: string[] }): Promise<QueueItem[]> {
  const conds = [eq(s.items.archived, false), ne(s.items.stage, "concluido")];
  let base = db
    .select({
      id: s.items.id,
      kind: s.items.kind,
      name: s.items.name,
      parentName: parent.name,
      stage: s.items.stage,
      scope: s.items.scopeStatus,
      deadline: s.items.deadline,
      outOfScope: s.items.outOfScope,
      clientApproval: s.items.clientApproval,
      isSustentacao: s.items.isSustentacao,
      requestedAt: s.items.requestedAt,
      createdAt: s.items.createdAt,
      annualName: s.annualProjects.name,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
    })
    .from(s.items)
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .$dynamic();
  if (opts.personId) base = base.innerJoin(s.itemAssignees, and(eq(s.itemAssignees.itemId, s.items.id), eq(s.itemAssignees.personId, opts.personId)));
  if (opts.withTags?.length) {
    const tagged = db
      .select({ id: s.itemTags.itemId })
      .from(s.itemTags)
      .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
      .where(inArray(s.tags.name, opts.withTags));
    conds.push(inArray(s.items.id, tagged));
  }
  const rows = await base.where(and(...conds)).orderBy(asc(s.items.deadline), asc(s.items.name));
  const tags = await itemTagsOf(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    path: r.parentName ? `${r.annualName} › ${r.parentName}` : `${r.annualName} · ${r.kind === "projeto" ? (r.scope === "rascunho" ? "projeto em rascunho" : "projeto") : "tarefa simples"}`,
    stage: r.stage,
    deadline: r.deadline,
    clientId: r.clientId,
    clientName: r.clientName,
    clientColor: r.clientColor,
    outOfScope: r.outOfScope,
    clientApproval: r.clientApproval,
    isSustentacao: r.isSustentacao,
    requestedAt: r.requestedAt,
    createdOn: toISODate(r.createdAt),
    tags: tags.get(r.id) ?? [],
  }));
}

export const WAIT_TAGS = ["Ag. retorno cliente", "Pend. doc. cliente"];

/** Desde quando o item espera o cliente: última troca de marcadores (auditoria) ou pedido da demanda. */
export async function waitingSince(items: QueueItem[]): Promise<Map<string, ISODate>> {
  const ids = items.map((i) => i.id);
  const out = new Map<string, ISODate>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: s.auditLog.entityId, at: sql<Date>`max(${s.auditLog.at})` })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, "item"), inArray(s.auditLog.entityId, ids), eq(s.auditLog.action, "marcadores")))
    .groupBy(s.auditLog.entityId);
  const audit = new Map(rows.map((r) => [r.id, toISODate(new Date(r.at))]));
  for (const i of items) out.set(i.id, i.outOfScope && i.clientApproval === "aguardando" ? (i.requestedAt ?? i.createdOn) : (audit.get(i.id) ?? i.createdOn));
  return out;
}

// ---------- Comentários do cliente sem resposta (US-41) ----------

export async function unansweredClientComments(personId: string) {
  const rows = await db
    .select({
      id: s.comments.id,
      body: s.comments.body,
      at: s.comments.createdAt,
      itemId: s.items.id,
      itemName: s.items.name,
      contactName: s.clientContacts.name,
      clientName: s.clients.name,
      clientColor: s.clients.color,
    })
    .from(s.comments)
    .innerJoin(s.items, eq(s.items.id, s.comments.itemId))
    .innerJoin(s.itemAssignees, and(eq(s.itemAssignees.itemId, s.items.id), eq(s.itemAssignees.personId, personId)))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .innerJoin(s.clientContacts, eq(s.clientContacts.id, s.comments.authorContactId))
    .where(and(eq(s.comments.channel, "cliente"), isNotNull(s.comments.authorContactId), isNull(s.comments.answeredAt), isNull(s.comments.deletedAt)))
    .orderBy(asc(s.comments.createdAt));
  return rows;
}

/** "há 5 h", "há 2 dias úteis". */
export function waitingText(at: Date, now: Date, today: ISODate, holidays: ReadonlySet<string>) {
  const wd = workdaysSince(toISODate(at), today, holidays);
  if (wd >= 1) return { text: `há ${wd} ${wd === 1 ? "dia útil" : "dias úteis"}`, workdays: wd };
  const h = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 3_600_000));
  return { text: h < 1 ? "há menos de 1 h" : `há ${h} h`, workdays: 0 };
}

// ---------- Provisionamentos e pedidos de alteração (US-09, US-12) ----------

/** Provisionamentos da pessoa cuja data chegou (a converter). */
export async function provisioningToConvert(personId: string, today: ISODate, now: Date, settings?: Settings) {
  const st = settings ?? (await getSettings());
  const rows = await db
    .select({
      id: s.timeEntries.id,
      date: s.timeEntries.date,
      minutes: s.timeEntries.minutes,
      description: s.timeEntries.description,
      createdAt: s.timeEntries.createdAt,
      pendingChange: s.timeEntries.pendingChange,
      itemId: s.items.id,
      itemName: s.items.name,
      annualName: s.annualProjects.name,
      clientName: s.clients.name,
      clientColor: s.clients.color,
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(eq(s.timeEntries.personId, personId), isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, true), lte(s.timeEntries.date, today)))
    .orderBy(asc(s.timeEntries.date));
  return rows.map((r) => {
    const deadline = editDeadline({ createdAt: r.createdAt, date: r.date, isProvisioning: true }, st);
    return { ...r, deadline, expired: now.getTime() >= deadline.getTime() };
  });
}

/** Pedidos de alteração da pessoa: pendentes e decididos nos últimos `days` dias. */
export async function myChangeRequests(personId: string, now: Date, days = 14) {
  const decider = alias(s.people, "decider");
  const since = new Date(now.getTime() - days * 86_400_000);
  return db
    .select({
      id: s.changeRequests.id,
      kind: s.changeRequests.kind,
      status: s.changeRequests.status,
      justification: s.changeRequests.justification,
      reason: s.changeRequests.decisionReason,
      createdAt: s.changeRequests.createdAt,
      decidedAt: s.changeRequests.decidedAt,
      decider: decider.name,
      entryId: s.timeEntries.id,
      date: s.timeEntries.date,
      minutes: s.timeEntries.minutes,
      oldValues: s.changeRequests.oldValues,
      newValues: s.changeRequests.newValues,
    })
    .from(s.changeRequests)
    .innerJoin(s.timeEntries, eq(s.timeEntries.id, s.changeRequests.timeEntryId))
    .leftJoin(decider, eq(decider.id, s.changeRequests.decidedBy))
    .where(and(eq(s.changeRequests.personId, personId), or(eq(s.changeRequests.status, "pendente"), gte(s.changeRequests.decidedAt, since))))
    .orderBy(desc(s.changeRequests.createdAt));
}

/** Pedidos aguardando aprovação (para quem aprova horas). */
export async function approvalsWaiting() {
  return db
    .select({ id: s.changeRequests.id, kind: s.changeRequests.kind, createdAt: s.changeRequests.createdAt, person: s.people.name, date: s.timeEntries.date, minutes: s.timeEntries.minutes })
    .from(s.changeRequests)
    .innerJoin(s.people, eq(s.people.id, s.changeRequests.personId))
    .innerJoin(s.timeEntries, eq(s.timeEntries.id, s.changeRequests.timeEntryId))
    .where(eq(s.changeRequests.status, "pendente"))
    .orderBy(asc(s.changeRequests.createdAt));
}

// ---------- Apontamentos da pessoa (US-05, US-06) ----------

export type MyEntry = {
  id: string;
  date: ISODate;
  minutes: number;
  description: string;
  sust: boolean;
  itemId: string;
  itemName: string;
  parentName: string | null;
  annualName: string;
  clientId: string;
  clientName: string;
  clientColor: string;
  typeId: string;
  typeName: string;
  typeCode: string;
  isProvisioning: boolean;
  isInternal: boolean;
  countsForBonus: boolean;
  salesOrderLineId: string | null;
  salesOrder: string | null;
  syncStatus: "nao_sincroniza" | "pendente" | "enviado" | "erro";
  syncError: string | null;
  pendingChange: boolean;
  convertedAt: Date | null;
  createdAt: Date;
  /** Fim da janela de edição livre (48 h). */
  editUntil: Date;
};

export async function myEntries(
  personId: string,
  range: { from: ISODate; to: ISODate },
  opts: { clientId?: string; typeId?: string; settings?: Settings } = {},
): Promise<MyEntry[]> {
  const st = opts.settings ?? (await getSettings());
  const conds = [eq(s.timeEntries.personId, personId), isNull(s.timeEntries.deletedAt), gte(s.timeEntries.date, range.from), lte(s.timeEntries.date, range.to)];
  if (opts.clientId) conds.push(eq(s.annualProjects.clientId, opts.clientId));
  if (opts.typeId) conds.push(eq(s.timeEntries.typeId, opts.typeId));
  const rows = await db
    .select({
      e: s.timeEntries,
      itemName: s.items.name,
      parentName: parent.name,
      annualName: s.annualProjects.name,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
      typeName: s.entryTypes.name,
      typeCode: s.entryTypes.code,
      isProvisioning: s.entryTypes.isProvisioning,
      isInternal: s.entryTypes.isInternal,
      countsForBonus: s.entryTypes.countsForBonus,
      so: s.salesOrderLines.orderName,
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .leftJoin(s.salesOrderLines, eq(s.salesOrderLines.id, s.timeEntries.salesOrderLineId))
    .where(and(...conds))
    .orderBy(desc(s.timeEntries.date), asc(s.timeEntries.createdAt));
  return rows.map((r) => ({
    id: r.e.id,
    date: r.e.date,
    minutes: r.e.minutes,
    description: r.e.description,
    sust: r.e.isSustentacao,
    itemId: r.e.itemId,
    itemName: r.itemName,
    parentName: r.parentName,
    annualName: r.annualName,
    clientId: r.clientId,
    clientName: r.clientName,
    clientColor: r.clientColor,
    typeId: r.e.typeId,
    typeName: r.typeName,
    typeCode: r.typeCode,
    isProvisioning: r.isProvisioning,
    isInternal: r.isInternal,
    countsForBonus: r.countsForBonus,
    salesOrderLineId: r.e.salesOrderLineId,
    salesOrder: r.so,
    syncStatus: r.e.syncStatus,
    syncError: r.e.syncError,
    pendingChange: r.e.pendingChange,
    convertedAt: r.e.convertedAt,
    createdAt: r.e.createdAt,
    editUntil: editDeadline({ createdAt: r.e.createdAt, date: r.e.date, isProvisioning: r.isProvisioning }, st),
  }));
}

/** Pedidos de alteração (último por apontamento) para mostrar a situação em cada linha. */
export async function lastChangeByEntry(entryIds: string[]) {
  const out = new Map<string, { status: "pendente" | "aprovada" | "recusada"; kind: "alterar" | "excluir"; reason: string | null; decidedAt: Date | null }>();
  if (!entryIds.length) return out;
  const rows = await db
    .select({ entryId: s.changeRequests.timeEntryId, status: s.changeRequests.status, kind: s.changeRequests.kind, reason: s.changeRequests.decisionReason, decidedAt: s.changeRequests.decidedAt })
    .from(s.changeRequests)
    .where(inArray(s.changeRequests.timeEntryId, entryIds))
    .orderBy(asc(s.changeRequests.createdAt));
  for (const r of rows) out.set(r.entryId, r);
  return out;
}

export async function absenceReasons() {
  return db.select({ id: s.absenceReasons.id, name: s.absenceReasons.name }).from(s.absenceReasons).where(eq(s.absenceReasons.active, true)).orderBy(asc(s.absenceReasons.name));
}

// ---------- Contatos na fila (US-35) e administrativo ----------

/** Agenda da pessoa: atrasados, hoje e próximos 7 dias, com quem pediu. */
export async function agendaOf(personId: string, today: ISODate) {
  const rows = await listContacts({ personId, status: ["agendado"], range: { from: addDays(today, -365), to: addDays(today, 7) }, order: "asc" });
  return {
    late: rows.filter((r) => r.date < today),
    today: rows.filter((r) => r.date === today),
    next: rows.filter((r) => r.date > today),
    all: rows,
  };
}

/** Contatos feitos hoje pela pessoa (para mostrar "Feito" na agenda do dia). */
export async function doneToday(personId: string, today: ISODate) {
  return listContacts({ personId, status: ["realizado", "nao_atendeu"], range: { from: today, to: today }, order: "asc" });
}

/** Follow-ups de cobrança da pessoa (ex.: criados por "Cobrar cliente"): abertos e feitos nos últimos 7 dias. */
export async function chargeFollowUps(personId: string, today: ISODate) {
  const creator = alias(s.people, "creator");
  const rows = await db
    .select({
      id: s.contacts.id,
      objective: s.contacts.objective,
      status: s.contacts.status,
      at: s.contacts.scheduledAt,
      summary: s.contacts.resultSummary,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
      itemId: s.items.id,
      itemName: s.items.name,
      outOfScope: s.items.outOfScope,
      by: creator.name,
      byId: creator.id,
    })
    .from(s.contacts)
    .innerJoin(s.clients, eq(s.clients.id, s.contacts.clientId))
    .innerJoin(creator, eq(creator.id, s.contacts.createdBy))
    .leftJoin(s.items, eq(s.items.id, s.contacts.relatedItemId))
    .where(
      and(
        eq(s.contacts.responsibleId, personId),
        like(s.contacts.objective, "Cobrar%"),
        or(eq(s.contacts.status, "agendado"), and(inArray(s.contacts.status, ["realizado", "nao_atendeu"]), gte(s.contacts.updatedAt, new Date(Date.parse(addDays(today, -7) + "T00:00:00-03:00"))))),
      ),
    )
    .orderBy(asc(s.contacts.scheduledAt));
  return rows.map((r) => ({ ...r, date: toISODate(r.at), time: hhmm(r.at) }));
}

/** Clientes ativos sem contato realizado há N+ dias úteis, com o último contato. */
export async function staleClients(today: ISODate) {
  const [rows, settings] = await Promise.all([portfolioLite(today), getSettings()]);
  const stale = rows.filter((r) => r.active && (r.contactWorkdays === null || r.contactWorkdays >= settings.contactAlertWorkdays));
  const ids = stale.map((r) => r.id);
  const [last, scheduled] = ids.length
    ? await Promise.all([
        db
          .select({ clientId: s.contacts.clientId, at: s.contacts.scheduledAt, type: s.contacts.type, who: s.people.name })
          .from(s.contacts)
          .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
          .where(and(inArray(s.contacts.clientId, ids), eq(s.contacts.status, "realizado")))
          .orderBy(desc(s.contacts.scheduledAt)),
        db
          .select({ clientId: s.contacts.clientId, at: s.contacts.scheduledAt, who: s.people.name })
          .from(s.contacts)
          .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
          .where(and(inArray(s.contacts.clientId, ids), eq(s.contacts.status, "agendado")))
          .orderBy(asc(s.contacts.scheduledAt)),
      ])
    : [[], []];
  return {
    limit: settings.contactAlertWorkdays,
    rows: stale
      .map((r) => ({
        ...r,
        last: last.find((l) => l.clientId === r.id) ?? null,
        next: scheduled.find((l) => l.clientId === r.id) ?? null,
      }))
      .sort((a, b) => (b.contactWorkdays ?? 999) - (a.contactWorkdays ?? 999)),
  };
}

/** Cobranças já agendadas por item (para mostrar "Cobrança agendada" em vez de "Cobrar"). */
export async function openChargesByItem(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { at: Date; who: string }>();
  const rows = await db
    .select({ itemId: s.contacts.relatedItemId, at: s.contacts.scheduledAt, who: s.people.name })
    .from(s.contacts)
    .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
    .where(and(inArray(s.contacts.relatedItemId, itemIds), eq(s.contacts.status, "agendado"), like(s.contacts.objective, "Cobrar%")));
  return new Map(rows.map((r) => [r.itemId!, { at: r.at, who: r.who }]));
}

/** Instantes úteis: diferença em dias de calendário (para textos curtos). */
export function daysAgo(d: ISODate, today: ISODate) {
  return diffDays(today, d);
}
