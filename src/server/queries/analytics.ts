import "server-only";
/**
 * Leituras de análise do time (US-07, US-11, US-12, US-33, US-44, US-47, US-48, US-49, US-50).
 * Tudo é só leitura. Regras:
 * - Horas realizadas = apontamentos não excluídos e que não são Provisionamento.
 * - Só o tipo com counts_for_bonus (Faturável) conta para faixas, metas e ranking.
 * - Só consultores (people.is_consultor) entram em carga, ranking, faixas e regra dos 3 dias.
 * A estratégia é buscar o necessário uma vez (loadActivity) e fatiar em memória por período.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import {
  type ISODate,
  type HolidaySet,
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  startOfMonth,
  toISODate,
  workdaysBetween,
  workdaysSince,
  weekday,
  parseISO,
  monthName,
  startOfDayInstant,
} from "@/domain/dates";
import { clientHealth, currentMissingStreak, editDeadline, isClientActive, monthMissingRule, type Health, type Settings } from "@/domain/rules";
import { getEntryTypes, getHolidays, getSettings } from "../data/common";

// ---------- Tipos básicos ----------

export type Range = { from: ISODate; to: ISODate };
export type TypeKind = "fat" | "bon" | "int" | "outro";

export type Hours = { fat: number; bon: number; int: number; outro: number; tot: number; sust: number; dev: number };
export const emptyHours = (): Hours => ({ fat: 0, bon: 0, int: 0, outro: 0, tot: 0, sust: 0, dev: 0 });

export type EntryAgg = { personId: string; date: ISODate; clientId: string; typeId: string; sust: boolean; minutes: number };

/** Classifica cada tipo de apontamento. Provisionamento fica fora (nunca é realizado). */
export async function typeKinds(): Promise<Map<string, { kind: TypeKind | "prov"; name: string; code: string; sort: number }>> {
  const types = await getEntryTypes();
  return new Map(
    types.map((t) => [
      t.id,
      {
        kind: t.isProvisioning ? "prov" : t.countsForBonus ? "fat" : t.isInternal ? "int" : t.code === "bonificado" ? "bon" : "outro",
        name: t.name,
        code: t.code,
        sort: t.sort,
      },
    ]),
  );
}

export function addHours(h: Hours, kind: TypeKind, sust: boolean, min: number) {
  h[kind] += min;
  h.tot += min;
  if (kind !== "int") {
    if (sust) h.sust += min;
    else h.dev += min;
  }
}

/** Soma os agregados numa chave qualquer (pessoa, cliente, dia, ...). */
export function groupHours<K>(rows: EntryAgg[], kinds: Awaited<ReturnType<typeof typeKinds>>, key: (r: EntryAgg) => K): Map<K, Hours> {
  const out = new Map<K, Hours>();
  for (const r of rows) {
    const k = kinds.get(r.typeId)?.kind;
    if (!k || k === "prov") continue;
    const id = key(r);
    let h = out.get(id);
    if (!h) out.set(id, (h = emptyHours()));
    addHours(h, k, r.sust, r.minutes);
  }
  return out;
}

export function sumHours(rows: EntryAgg[], kinds: Awaited<ReturnType<typeof typeKinds>>): Hours {
  return groupHours(rows, kinds, () => 0).get(0) ?? emptyHours();
}

// ---------- Horas realizadas ----------

/** Horas realizadas agrupadas por pessoa, dia, cliente, tipo e sustentação. Exclui Provisionamento e excluídos. */
export async function entryAgg(range: Range, opts: { personIds?: string[]; clientId?: string } = {}): Promise<EntryAgg[]> {
  const conds = [
    isNull(s.timeEntries.deletedAt),
    eq(s.entryTypes.isProvisioning, false),
    gte(s.timeEntries.date, range.from),
    lte(s.timeEntries.date, range.to),
  ];
  if (opts.personIds) {
    if (!opts.personIds.length) return [];
    conds.push(inArray(s.timeEntries.personId, opts.personIds));
  }
  if (opts.clientId) conds.push(eq(s.annualProjects.clientId, opts.clientId));
  return db
    .select({
      personId: s.timeEntries.personId,
      date: s.timeEntries.date,
      clientId: s.annualProjects.clientId,
      typeId: s.timeEntries.typeId,
      sust: s.timeEntries.isSustentacao,
      minutes: sql<number>`sum(${s.timeEntries.minutes})`.mapWith(Number),
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(and(...conds))
    .groupBy(s.timeEntries.personId, s.timeEntries.date, s.annualProjects.clientId, s.timeEntries.typeId, s.timeEntries.isSustentacao);
}

/** Horas por pessoa, cliente, tipo e dia num intervalo (atalho para telas). */
export async function hoursBreakdown(range: Range, opts: { personIds?: string[]; clientId?: string } = {}) {
  const [rows, kinds] = await Promise.all([entryAgg(range, opts), typeKinds()]);
  return {
    rows,
    total: sumHours(rows, kinds),
    byPerson: groupHours(rows, kinds, (r) => r.personId),
    byClient: groupHours(rows, kinds, (r) => r.clientId),
    byDay: groupHours(rows, kinds, (r) => r.date),
    byType: groupTypes(rows, kinds),
  };
}

export function groupTypes(rows: EntryAgg[], kinds: Awaited<ReturnType<typeof typeKinds>>) {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (kinds.get(r.typeId)?.kind === "prov") continue;
    m.set(r.typeId, (m.get(r.typeId) ?? 0) + r.minutes);
  }
  return [...m.entries()]
    .map(([typeId, minutes]) => ({ typeId, name: kinds.get(typeId)?.name ?? "?", kind: kinds.get(typeId)?.kind as TypeKind, sort: kinds.get(typeId)?.sort ?? 100, minutes }))
    .sort((a, b) => a.sort - b.sort);
}

/** Lançamentos individuais (para "clique no total abre os apontamentos" e para o dia do calendário). */
export async function entryList(
  range: Range,
  opts: { personId?: string; clientId?: string; typeId?: string; sust?: boolean; includeProvisioning?: boolean; limit?: number } = {},
) {
  const parent = alias(s.items, "parent");
  const conds = [isNull(s.timeEntries.deletedAt), gte(s.timeEntries.date, range.from), lte(s.timeEntries.date, range.to)];
  if (!opts.includeProvisioning) conds.push(eq(s.entryTypes.isProvisioning, false));
  if (opts.personId) conds.push(eq(s.timeEntries.personId, opts.personId));
  if (opts.clientId) conds.push(eq(s.annualProjects.clientId, opts.clientId));
  if (opts.typeId) conds.push(eq(s.timeEntries.typeId, opts.typeId));
  if (opts.sust !== undefined) conds.push(eq(s.timeEntries.isSustentacao, opts.sust), eq(s.entryTypes.isInternal, false));
  return db
    .select({
      id: s.timeEntries.id,
      date: s.timeEntries.date,
      minutes: s.timeEntries.minutes,
      description: s.timeEntries.description,
      sust: s.timeEntries.isSustentacao,
      personId: s.timeEntries.personId,
      personName: s.people.name,
      itemId: s.items.id,
      itemName: s.items.name,
      parentName: parent.name,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
      typeName: s.entryTypes.name,
      typeCode: s.entryTypes.code,
      isProvisioning: s.entryTypes.isProvisioning,
      isInternal: s.entryTypes.isInternal,
      countsForBonus: s.entryTypes.countsForBonus,
      syncStatus: s.timeEntries.syncStatus,
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(...conds))
    .orderBy(desc(s.timeEntries.date), asc(s.people.name), desc(s.timeEntries.minutes))
    .limit(opts.limit ?? 500);
}

/** Provisionamentos (nunca somam em realizado; aparecem à parte). */
export async function provisionedEntries(opts: { range?: Range; personIds?: string[]; dueBy?: ISODate } = {}) {
  const conds = [isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, true)];
  if (opts.range) conds.push(gte(s.timeEntries.date, opts.range.from), lte(s.timeEntries.date, opts.range.to));
  if (opts.dueBy) conds.push(lte(s.timeEntries.date, opts.dueBy));
  if (opts.personIds) {
    if (!opts.personIds.length) return [];
    conds.push(inArray(s.timeEntries.personId, opts.personIds));
  }
  return db
    .select({
      id: s.timeEntries.id,
      personId: s.timeEntries.personId,
      personName: s.people.name,
      date: s.timeEntries.date,
      minutes: s.timeEntries.minutes,
      description: s.timeEntries.description,
      createdAt: s.timeEntries.createdAt,
      itemId: s.items.id,
      itemName: s.items.name,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
    })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(...conds))
    .orderBy(asc(s.timeEntries.date), asc(s.people.name));
}

/**
 * US-12: provisionamentos cuja data já passou e que não foram convertidos.
 * `expired` = passou também a janela de 48 h a partir da data (agora só com pedido aprovado).
 */
export async function overdueProvisioning(today: ISODate, now: Date, settings?: Settings) {
  const st = settings ?? (await getSettings());
  const rows = await provisionedEntries({ dueBy: addDays(today, -1) });
  return rows.map((r) => ({
    ...r,
    daysLate: diffDays(today, r.date),
    expired: now.getTime() >= editDeadline({ createdAt: r.createdAt, date: r.date, isProvisioning: true }, st).getTime(),
  }));
}

// ---------- Pessoas ----------

export async function consultants() {
  return db
    .select()
    .from(s.people)
    .where(and(eq(s.people.active, true), eq(s.people.isConsultor, true)))
    .orderBy(asc(s.people.name));
}

/** Primeiro dia com hora real de cada pessoa (para não contar dias antes de a pessoa existir no histórico). */
export async function firstEntryDates(personIds: string[]): Promise<Map<string, ISODate>> {
  if (!personIds.length) return new Map();
  const rows = await db
    .select({ personId: s.timeEntries.personId, first: sql<string>`min(${s.timeEntries.date})` })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .where(and(inArray(s.timeEntries.personId, personIds), isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, false)))
    .groupBy(s.timeEntries.personId);
  return new Map(rows.map((r) => [r.personId, String(r.first)]));
}

// ---------- Atividade (itens, contatos, justificativas) ----------

export type ActItem = {
  id: string;
  kind: "projeto" | "tarefa";
  parentId: string | null;
  parentName: string | null;
  name: string;
  stage: string;
  deadline: ISODate | null;
  completedOn: ISODate | null;
  outOfScope: boolean;
  clientApproval: string;
  isSustentacao: boolean;
  createdOn: ISODate;
  requestedAt: ISODate | null;
  clientId: string;
  clientName: string;
  clientColor: string;
  annualName: string;
  assignees: string[];
};

export type ActContact = {
  id: string;
  responsibleId: string;
  clientId: string;
  clientName: string;
  clientColor: string;
  status: string;
  scheduledAt: Date;
  doneOn: ISODate | null;
  objective: string;
  type: string;
};

export type ActJustification = { personId: string; date: ISODate; reason: string; note: string | null; attachmentId: string; createdAt: Date };

export type Activity = {
  range: Range;
  rows: EntryAgg[];
  kinds: Awaited<ReturnType<typeof typeKinds>>;
  items: ActItem[];
  contacts: ActContact[];
  justifications: ActJustification[];
  first: Map<string, ISODate>;
  holidays: HolidaySet;
  settings: Settings;
};

/** Itens (projetos e tarefas) não arquivados que ainda importam para o intervalo, com responsáveis. */
export async function loadItems(since: ISODate): Promise<ActItem[]> {
  const parent = alias(s.items, "parent");
  const rows = await db
    .select({
      id: s.items.id,
      kind: s.items.kind,
      parentId: s.items.parentId,
      parentName: parent.name,
      name: s.items.name,
      stage: s.items.stage,
      deadline: s.items.deadline,
      completedAt: s.items.completedAt,
      outOfScope: s.items.outOfScope,
      clientApproval: s.items.clientApproval,
      isSustentacao: s.items.isSustentacao,
      createdAt: s.items.createdAt,
      requestedAt: s.items.requestedAt,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
      annualName: s.annualProjects.name,
    })
    .from(s.items)
    .leftJoin(parent, eq(parent.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(
      and(
        eq(s.items.archived, false),
        or(ne(s.items.stage, "concluido"), gte(s.items.completedAt, startOfDayInstant(since)), gte(s.items.deadline, since)),
      ),
    );
  const ids = rows.map((r) => r.id);
  const asg = ids.length ? await db.select().from(s.itemAssignees).where(inArray(s.itemAssignees.itemId, ids)) : [];
  const byItem = new Map<string, string[]>();
  for (const a of asg) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a.personId]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    parentId: r.parentId,
    parentName: r.parentName,
    name: r.name,
    stage: r.stage,
    deadline: r.deadline,
    completedOn: r.completedAt ? toISODate(r.completedAt) : r.stage === "concluido" ? toISODate(r.createdAt) : null,
    outOfScope: r.outOfScope,
    clientApproval: r.clientApproval,
    isSustentacao: r.isSustentacao,
    createdOn: toISODate(r.createdAt),
    requestedAt: r.requestedAt,
    clientId: r.clientId,
    clientName: r.clientName,
    clientColor: r.clientColor,
    annualName: r.annualName,
    assignees: byItem.get(r.id) ?? [],
  }));
}

export async function loadContacts(personIds: string[] | null, since: ISODate): Promise<ActContact[]> {
  const conds = [or(gte(s.contacts.scheduledAt, startOfDayInstant(since)), eq(s.contacts.status, "agendado"))];
  if (personIds) {
    if (!personIds.length) return [];
    conds.push(inArray(s.contacts.responsibleId, personIds));
  }
  const rows = await db
    .select({
      id: s.contacts.id,
      responsibleId: s.contacts.responsibleId,
      clientId: s.clients.id,
      clientName: s.clients.name,
      clientColor: s.clients.color,
      status: s.contacts.status,
      scheduledAt: s.contacts.scheduledAt,
      doneAt: s.contacts.doneAt,
      objective: s.contacts.objective,
      type: s.contacts.type,
    })
    .from(s.contacts)
    .innerJoin(s.clients, eq(s.clients.id, s.contacts.clientId))
    .where(and(...conds))
    .orderBy(asc(s.contacts.scheduledAt));
  return rows.map((r) => ({
    ...r,
    doneOn: r.status === "realizado" ? toISODate(r.doneAt ?? r.scheduledAt) : null,
  }));
}

export async function loadJustifications(personIds: string[] | null, range: Range): Promise<ActJustification[]> {
  const conds = [gte(s.absenceJustifications.date, range.from), lte(s.absenceJustifications.date, range.to)];
  if (personIds) {
    if (!personIds.length) return [];
    conds.push(inArray(s.absenceJustifications.personId, personIds));
  }
  return db
    .select({
      personId: s.absenceJustifications.personId,
      date: s.absenceJustifications.date,
      reason: s.absenceReasons.name,
      note: s.absenceJustifications.note,
      attachmentId: s.absenceJustifications.attachmentId,
      createdAt: s.absenceJustifications.createdAt,
    })
    .from(s.absenceJustifications)
    .innerJoin(s.absenceReasons, eq(s.absenceReasons.id, s.absenceJustifications.reasonId))
    .where(and(...conds))
    .orderBy(desc(s.absenceJustifications.date));
}

/** Busca, numa ida ao banco, tudo o que as métricas por pessoa precisam no intervalo. */
export async function loadActivity(personIds: string[], range: Range): Promise<Activity> {
  const [rows, kinds, items, contacts, justifications, first, holidays, settings] = await Promise.all([
    entryAgg(range, { personIds }),
    typeKinds(),
    loadItems(range.from),
    loadContacts(personIds, range.from),
    loadJustifications(personIds, range),
    firstEntryDates(personIds),
    getHolidays(),
    getSettings(),
  ]);
  return { range, rows, kinds, items, contacts, justifications, first, holidays, settings };
}

// ---------- Métricas por pessoa ----------

export type Metrics = {
  hours: Hours;
  /** Tarefas concluídas no intervalo. */
  done: number;
  /** Se o intervalo inclui hoje: tarefas abertas atrasadas agora. Senão: prazos perdidos no intervalo. */
  late: number;
  deadlineMet: number;
  deadlineTotal: number;
  /** Prazos cumpridos (%), null sem prazos no intervalo. */
  pct: number | null;
  /** Contatos realizados no intervalo. */
  contacts: number;
  /** Dias úteis sem apontamento e sem justificativa (até ontem). */
  missing: ISODate[];
  justified: ISODate[];
  worstStreak: number;
  /** Dias úteis do intervalo e quantos já passaram (incluindo hoje). */
  workdays: number;
  elapsedWorkdays: number;
  /** Média de horas (todas as realizadas) por dia útil decorrido. */
  avg: number;
  /** Média de horas faturáveis por dia útil decorrido (cor do desempenho). */
  avgFat: number;
};

/** Dias com hora real por pessoa. */
export function daysWithEntries(rows: EntryAgg[], kinds: Activity["kinds"], personId: string): Set<ISODate> {
  const out = new Set<ISODate>();
  for (const r of rows) if (r.personId === personId && r.minutes > 0 && kinds.get(r.typeId)?.kind !== "prov") out.add(r.date);
  return out;
}

export function metricsFor(act: Activity, personId: string, range: Range, today: ISODate): Metrics {
  const inR = (d: ISODate | null) => !!d && d >= range.from && d <= range.to;
  const rows = act.rows.filter((r) => r.personId === personId && inR(r.date));
  const hours = sumHours(rows, act.kinds);
  const mine = act.items.filter((i) => i.kind === "tarefa" && i.assignees.includes(personId));
  const done = mine.filter((i) => inR(i.completedOn)).length;
  const includesToday = range.from <= today && today <= range.to;
  // Prazos: vencidos no intervalo (até hoje). Cumprido = concluído até o prazo.
  const dlEnd = range.to < today ? range.to : today;
  let met = 0;
  let missed = 0;
  for (const i of mine) {
    if (!i.deadline || i.deadline < range.from || i.deadline > dlEnd) continue;
    if (i.completedOn && i.completedOn <= i.deadline) met++;
    else if (i.completedOn || i.deadline < today) missed++;
  }
  const lateNow = mine.filter((i) => !i.completedOn && i.stage !== "concluido" && i.deadline && i.deadline < today).length;
  const contacts = act.contacts.filter((c) => c.responsibleId === personId && inR(c.doneOn)).length;
  // Dias sem apontamento (US-11): só dias úteis encerrados.
  const first = act.first.get(personId);
  const yest = addDays(today, -1);
  const missEnd = range.to < yest ? range.to : yest;
  const missFrom = first && first > range.from ? first : range.from;
  const withEntries = daysWithEntries(rows, act.kinds, personId);
  const justSet = new Set(act.justifications.filter((j) => j.personId === personId).map((j) => j.date));
  const missing: ISODate[] = [];
  const justified: ISODate[] = [];
  let run = 0;
  let worst = 0;
  for (const d of workdaysBetween(missFrom, missEnd, act.holidays)) {
    if (withEntries.has(d)) run = 0;
    else if (justSet.has(d)) {
      justified.push(d);
      run = 0;
    } else {
      missing.push(d);
      worst = Math.max(worst, ++run);
    }
  }
  const all = workdaysBetween(range.from, range.to, act.holidays);
  const elapsed = all.filter((d) => d <= today).length;
  return {
    hours,
    done,
    late: includesToday ? lateNow : missed,
    deadlineMet: met,
    deadlineTotal: met + missed,
    pct: met + missed ? Math.round((met / (met + missed)) * 100) : null,
    contacts,
    missing,
    justified,
    worstStreak: worst,
    workdays: all.length,
    elapsedWorkdays: elapsed,
    avg: elapsed ? Math.round(hours.tot / elapsed) : 0,
    avgFat: elapsed ? Math.round(hours.fat / elapsed) : 0,
  };
}

// ---------- Série mensal (13 meses) e comparação (US-33) ----------

export type MonthPoint = { month: ISODate; label: string; m: Metrics; exists: boolean; lostBonus: boolean };

export function monthLabel(month: ISODate, short = false): string {
  const { y, m } = parseISO(month);
  const n = monthName(m);
  return short ? `${n.slice(0, 3)}/${String(y).slice(2)}` : `${n} de ${y}`;
}

/** Meses do mais antigo ao atual: 12 anteriores + o mês de `today`. */
export function last13Months(today: ISODate): ISODate[] {
  const cur = startOfMonth(today);
  return Array.from({ length: 13 }, (_, i) => addMonths(cur, i - 12));
}

export function monthlySeries(act: Activity, personId: string, today: ISODate): MonthPoint[] {
  const first = act.first.get(personId);
  return last13Months(today).map((month) => {
    const r = { from: month, to: endOfMonth(month) };
    const m = metricsFor(act, personId, r, today);
    // Regra dos 3 dias: só conta a partir do primeiro apontamento da pessoa.
    return { month, label: monthLabel(month, true), m, exists: !!first && first <= r.to, lostBonus: !!first && m.worstStreak >= act.settings.missingDaysLimit };
  });
}

export type MetricKey = "fat" | "bon" | "int" | "tot" | "done" | "late" | "pct" | "ct" | "miss" | "avg";
export const METRICS: { key: MetricKey; label: string; hint?: string; kind: "h" | "n" | "pct"; dir: 1 | 0 | -1; additive: boolean }[] = [
  { key: "fat", label: "Horas faturáveis", kind: "h", dir: 1, additive: true },
  { key: "bon", label: "Horas bonificadas", hint: "sem juízo", kind: "h", dir: 0, additive: true },
  { key: "int", label: "Horas internas", hint: "sem juízo", kind: "h", dir: 0, additive: true },
  { key: "tot", label: "Horas totais", kind: "h", dir: 1, additive: true },
  { key: "done", label: "Tarefas concluídas", kind: "n", dir: 1, additive: true },
  { key: "late", label: "Tarefas atrasadas", hint: "menor é melhor", kind: "n", dir: -1, additive: false },
  { key: "pct", label: "Prazos cumpridos", kind: "pct", dir: 1, additive: false },
  { key: "ct", label: "Contatos com clientes", kind: "n", dir: 1, additive: true },
  { key: "miss", label: "Dias sem apontamento", hint: "menor é melhor", kind: "n", dir: -1, additive: false },
  { key: "avg", label: "Média de horas por dia útil", kind: "h", dir: 1, additive: false },
];

export function metricValue(m: Metrics, k: MetricKey): number | null {
  switch (k) {
    case "fat":
    case "bon":
    case "int":
    case "tot":
      return m.hours[k];
    case "done":
      return m.done;
    case "late":
      return m.late;
    case "pct":
      return m.pct;
    case "ct":
      return m.contacts;
    case "miss":
      return m.missing.length;
    case "avg":
      return m.avg;
  }
}

export type Verdict = "melhor" | "pior" | "parecido" | "acima" | "abaixo" | "sem base";
export type Compare = { ref: number | null; delta: number | null; deltaText: string; verdict: Verdict };

/** Compara o valor atual (ou a projeção) com uma referência. Até 5% de diferença = parecido. */
export function compareValue(v: number | null, ref: number | null, kind: "h" | "n" | "pct", dir: 1 | 0 | -1): Compare {
  if (v === null || ref === null) return { ref, delta: null, deltaText: "", verdict: "sem base" };
  const d = v - ref;
  let eq: boolean;
  let txt: string;
  if (kind === "pct") {
    eq = Math.abs(d) < 2;
    txt = `${d > 0 ? "+" : ""}${Math.round(d)} pp`;
  } else if (kind === "h") {
    const rel = ref ? d / ref : v ? 1 : 0;
    eq = Math.abs(rel) < 0.05;
    txt = ref ? `${rel > 0 ? "+" : ""}${Math.round(rel * 100)}%` : `+${Math.round(d / 60)} h`;
  } else {
    eq = Math.abs(d) < 0.5 || (ref > 4 && Math.abs(d / ref) < 0.05);
    txt = `${d > 0 ? "+" : ""}${Number.isInteger(d) ? d : d.toFixed(1).replace(".", ",")}`;
  }
  if (eq) return { ref, delta: d, deltaText: "igual", verdict: "parecido" };
  const up = d > 0;
  const verdict: Verdict = dir === 0 ? (up ? "acima" : "abaixo") : (dir > 0) === up ? "melhor" : "pior";
  return { ref, delta: d, deltaText: txt, verdict };
}

export type ComparisonRow = {
  key: MetricKey;
  label: string;
  hint?: string;
  kind: "h" | "n" | "pct";
  current: number | null;
  projection: number | null;
  cols: Compare[];
};

export type Comparison = { curHead: string; projHead: string | null; heads: string[]; rows: ComparisonRow[]; note: string };

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/**
 * Tabela de comparação da ficha (US-33).
 * Mês: mês atual (até hoje e projeção) × mês anterior × médias de 3, 6 e 12 meses.
 * Outros períodos: período (e projeção, se em andamento) × período anterior × médias mensais ajustadas aos dias úteis do período.
 */
export function buildComparison(
  act: Activity,
  personId: string,
  period: { key: string; from: ISODate; to: ISODate; label: string; prev: { from: ISODate; to: ISODate; label: string } },
  today: ISODate,
  series: MonthPoint[],
): Comparison {
  const isMonth = period.key === "mes";
  const cur = metricsFor(act, personId, period, today);
  const incomplete = period.to >= today && period.from <= today && cur.elapsedWorkdays < cur.workdays;
  const factor = incomplete && cur.elapsedWorkdays ? cur.workdays / cur.elapsedWorkdays : null;
  const hist = series.slice(0, -1).reverse().filter((p) => p.exists); // mais recente primeiro
  const prev = isMonth ? null : metricsFor(act, personId, period.prev, today);
  const rows = METRICS.map((def) => {
    const v = metricValue(cur, def.key);
    const projection = factor && def.additive && v !== null ? Math.round(v * factor) : null;
    const cmpV = projection ?? v;
    const histVals = (n: number) =>
      hist
        .slice(0, n)
        .map((p) => {
          const x = metricValue(p.m, def.key);
          if (x === null) return null;
          // Fora do mês, médias mensais ajustadas aos dias úteis do período.
          return !isMonth && def.additive && p.m.workdays ? (x / p.m.workdays) * cur.workdays : x;
        })
        .filter((x): x is number => x !== null);
    const refs: (number | null)[] = isMonth
      ? [hist[0] ? metricValue(hist[0].m, def.key) : null, mean(histVals(3)), mean(histVals(6)), mean(histVals(12))]
      : [prev ? metricValue(prev, def.key) : null, mean(histVals(3)), mean(histVals(6)), mean(histVals(12))];
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      kind: def.kind,
      current: v,
      projection,
      cols: refs.map((r) => compareValue(cmpV, r === null ? null : Math.round(r), def.kind, def.dir)),
    };
  });
  const prevLabel = isMonth ? (hist[0] ? cap(monthName(parseISO(hist[0].month).m)) : "Mês anterior") : "Período anterior";
  const note = incomplete
    ? `${cap(period.label)} está no dia útil ${cur.elapsedWorkdays} de ${cur.workdays}. Para horas, tarefas concluídas e contatos, as setas comparam a projeção no ritmo atual, não o valor parcial. Para prazos cumpridos, média por dia, atrasadas e dias sem apontar, usamos o valor de hoje.`
    : isMonth
      ? "Mês fechado: as setas comparam o valor do mês."
      : `Período de ${cur.workdays} dias úteis. As médias mensais foram ajustadas para o mesmo número de dias úteis.`;
  return {
    curHead: incomplete ? `${cap(period.label)} até hoje` : cap(period.label),
    projHead: incomplete ? "Projeção" : null,
    heads: [prevLabel, "Média 3 meses", "Média 6 meses", "Média 12 meses"],
    rows,
    note,
  };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- Carga do time (US-44 + US-07) ----------

export type WorkloadRow = {
  person: typeof s.people.$inferSelect;
  hours: Hours;
  /** Média faturável por dia útil decorrido (cor do dia). */
  avgFat: number;
  projects: number;
  tasks: number;
  late: number;
  clients: { id: string; name: string; color: string }[];
  waitingClient: number;
  contactsWeek: number;
  contactsLate: number;
  /** Semana (seg a sex): minutos por cliente em cada dia. */
  week: { date: ISODate; total: number; byClient: { clientId: string; minutes: number }[] }[];
  monthFat: number;
  missingStreak: number;
  lostBonus: boolean;
};

export function weekOf(d: ISODate): ISODate[] {
  const mon = addDays(d, -((weekday(d) + 6) % 7));
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
}

export async function workload(range: Range, today: ISODate, now: Date) {
  const people = await consultants();
  const ids = people.map((p) => p.id);
  const ref = range.to < today ? range.to : today;
  const week = weekOf(ref);
  const month = { from: startOfMonth(ref), to: endOfMonth(ref) };
  const wide = {
    from: [range.from, week[0], month.from, addDays(today, -60)].sort()[0],
    to: [range.to, week[4], month.to].sort().at(-1)!,
  };
  const act = await loadActivity(ids, wide);
  const weekRows = act.rows.filter((r) => r.date >= week[0] && r.date <= week[4]);
  const weekEnd = addDays(week[0], 7);
  const rows: WorkloadRow[] = people.map((p) => {
    const m = metricsFor(act, p.id, range, today);
    const open = act.items.filter((i) => i.stage !== "concluido" && !i.completedOn);
    const myTasks = open.filter((i) => i.kind === "tarefa" && i.assignees.includes(p.id));
    const projIds = new Set<string>();
    for (const i of open) {
      if (!i.assignees.includes(p.id)) continue;
      if (i.kind === "projeto") projIds.add(i.id);
      else if (i.parentId) projIds.add(i.parentId);
    }
    const activeProjects = open.filter((i) => i.kind === "projeto" && projIds.has(i.id)).length;
    const cl = new Map<string, { id: string; name: string; color: string }>();
    for (const i of open) if (i.assignees.includes(p.id)) cl.set(i.clientId, { id: i.clientId, name: i.clientName, color: i.clientColor });
    const myContacts = act.contacts.filter((c) => c.responsibleId === p.id && c.status === "agendado");
    const days = week.map((d) => {
      const by = new Map<string, number>();
      for (const r of weekRows) {
        if (r.personId !== p.id || r.date !== d) continue;
        const k = act.kinds.get(r.typeId)?.kind;
        if (!k || k === "prov") continue;
        by.set(r.clientId, (by.get(r.clientId) ?? 0) + r.minutes);
      }
      const byClient = [...by.entries()].map(([clientId, minutes]) => ({ clientId, minutes })).sort((a, b) => b.minutes - a.minutes);
      return { date: d, total: byClient.reduce((a, b) => a + b.minutes, 0), byClient };
    });
    const withEntries = daysWithEntries(act.rows, act.kinds, p.id);
    const justSet = new Set(act.justifications.filter((j) => j.personId === p.id).map((j) => j.date));
    const streak = currentMissingStreak({ today, daysWithEntries: withEntries, justifiedDays: justSet, holidays: act.holidays, since: act.first.get(p.id) });
    const monthM = metricsFor(act, p.id, month, today);
    return {
      person: p,
      hours: m.hours,
      avgFat: m.avgFat,
      projects: activeProjects,
      tasks: myTasks.length,
      late: myTasks.filter((i) => i.deadline && i.deadline < today).length,
      clients: [...cl.values()].sort((a, b) => a.name.localeCompare(b.name)),
      waitingClient: open.filter((i) => i.outOfScope && i.clientApproval === "aguardando" && (i.assignees.includes(p.id) || (i.parentId && projIds.has(i.parentId) && i.assignees.length === 0))).length,
      contactsWeek: myContacts.filter((c) => c.scheduledAt >= startOfDayInstant(week[0]) && c.scheduledAt < startOfDayInstant(weekEnd)).length,
      contactsLate: myContacts.filter((c) => c.scheduledAt < now).length,
      week: days,
      monthFat: monthM.hours.fat,
      missingStreak: streak.length,
      lostBonus: monthM.worstStreak >= act.settings.missingDaysLimit,
    };
  });
  return { rows, week, act };
}

// ---------- Metas da equipe (US-47, US-50) ----------

/** Fator para escalar metas mensais: mês = 1; trimestre = 3; ano = 12; outros = dias úteis / dias úteis do mês. */
export function goalFactor(period: { key: string; from: ISODate; to: ISODate }, holidays: HolidaySet): number {
  if (period.key === "mes") return 1;
  if (period.key === "trimestre") return 3;
  if (period.key === "ano") return 12;
  const wd = workdaysBetween(period.from, period.to, holidays).length;
  const month = workdaysBetween(startOfMonth(period.to), endOfMonth(period.to), holidays).length || 21;
  return Math.max(wd, 1) / month;
}

/** Horas faturáveis da equipe (só consultores) no período, com projeção e barras por dia útil. */
export async function teamProgress(period: { key: string; from: ISODate; to: ISODate }, today: ISODate) {
  const people = await consultants();
  const [rows, kinds, holidays, settings] = await Promise.all([
    entryAgg(period, { personIds: people.map((p) => p.id) }),
    typeKinds(),
    getHolidays(),
    getSettings(),
  ]);
  const total = sumHours(rows, kinds);
  const byDay = groupHours(rows, kinds, (r) => r.date);
  const all = workdaysBetween(period.from, period.to, holidays);
  const elapsed = all.filter((d) => d <= today).length;
  const incomplete = period.from <= today && today <= period.to && elapsed < all.length;
  const projection = incomplete && elapsed ? Math.round((total.fat / elapsed) * all.length) : total.fat;
  const factor = goalFactor(period, holidays);
  const goals = [...settings.teamGoals].sort((a, b) => a.hours - b.hours).map((g) => ({ name: g.name, minutes: Math.round(g.hours * factor * 60) }));
  const days = all.filter((d) => d <= today).map((d) => ({ date: d, fat: byDay.get(d)?.fat ?? 0 }));
  const todayFat = byDay.get(today)?.tot ?? 0;
  const appointedToday = new Set(rows.filter((r) => r.date === today && kinds.get(r.typeId)?.kind !== "prov").map((r) => r.personId)).size;
  return { total, projection, goals, days, workdays: all.length, elapsed, incomplete, consultants: people.length, todayMinutes: todayFat, appointedToday };
}

// ---------- Ranking (US-48, US-50) ----------

export type RankCriterion = "h" | "p" | "c";

export type RankRow = {
  person: typeof s.people.$inferSelect;
  value: number;
  fat: number;
  pct: number | null;
  met: number;
  dlTotal: number;
  contacts: number;
  pos: number;
  prevPos: number | null;
  /** Horas faturáveis usadas na faixa (mês atual, ou média mensal dos meses fechados do período). */
  bandMinutes: number;
  lostBonus: boolean;
  series: MonthPoint[];
};

export async function ranking(
  period: { key: string; from: ISODate; to: ISODate; prev: { from: ISODate; to: ISODate } },
  crit: RankCriterion,
  today: ISODate,
) {
  const people = await consultants();
  const ids = people.map((p) => p.id);
  const months = last13Months(today);
  const wide = { from: [months[0], period.prev.from].sort()[0], to: [endOfMonth(today), period.to].sort().at(-1)! };
  const act = await loadActivity(ids, wide);
  const val = (m: Metrics) => (crit === "h" ? m.hours.fat : crit === "p" ? (m.pct ?? -1) : m.contacts);
  const base = people.map((p) => {
    const cur = metricsFor(act, p.id, period, today);
    const prev = metricsFor(act, p.id, period.prev, today);
    const series = monthlySeries(act, p.id, today);
    // Faixa: no mês, o mês corrente; em trimestre/ano, média dos meses fechados do período.
    let bandMinutes = series.at(-1)!.m.hours.fat;
    if (period.key !== "mes") {
      const closed = series.filter((sp) => sp.month >= startOfMonth(period.from) && endOfMonth(sp.month) <= period.to && endOfMonth(sp.month) < today && sp.exists);
      if (closed.length) bandMinutes = Math.round(closed.reduce((a, sp) => a + sp.m.hours.fat, 0) / closed.length);
    }
    return { p, cur, prev, series, bandMinutes, lostBonus: series.at(-1)!.lostBonus };
  });
  const order = (get: (x: (typeof base)[number]) => number, tie: (x: (typeof base)[number]) => number) =>
    [...base].sort((a, b) => get(b) - get(a) || tie(b) - tie(a) || a.p.name.localeCompare(b.p.name)).map((x) => x.p.id);
  const now = order((x) => val(x.cur), (x) => x.cur.hours.fat);
  const before = order((x) => val(x.prev), (x) => x.prev.hours.fat);
  const rows: RankRow[] = now.map((id, i) => {
    const x = base.find((b) => b.p.id === id)!;
    return {
      person: x.p,
      value: val(x.cur),
      fat: x.cur.hours.fat,
      pct: x.cur.pct,
      met: x.cur.deadlineMet,
      dlTotal: x.cur.deadlineTotal,
      contacts: x.cur.contacts,
      pos: i + 1,
      prevPos: before.indexOf(id) + 1 || null,
      bandMinutes: x.bandMinutes,
      lostBonus: x.lostBonus,
      series: x.series,
    };
  });
  return { rows, act };
}

// ---------- Carteira mínima (US-45, versão própria) ----------
// TODO: trocar por clientPortfolio(...) de src/server/queries/clients.ts quando estiver pronto.

export type PortfolioRow = {
  id: string;
  name: string;
  color: string;
  health: Health;
  reasons: string[];
  active: boolean;
  stages: Record<string, number>;
  openTasks: number;
  waiting: number;
  monthMinutes: number;
  lastContact: ISODate | null;
  contactWorkdays: number | null;
};

export async function portfolioLite(today: ISODate): Promise<PortfolioRow[]> {
  const [clients, items, holidays, settings, kinds] = await Promise.all([
    db.select().from(s.clients).where(and(eq(s.clients.active, true), eq(s.clients.isInternal, false))).orderBy(asc(s.clients.name)),
    loadItems(today),
    getHolidays(),
    getSettings(),
    typeKinds(),
  ]);
  const month = { from: startOfMonth(today), to: endOfMonth(today) };
  const [rows, lastReal, lastContacts, unanswered] = await Promise.all([
    entryAgg(month),
    db
      .select({ clientId: s.annualProjects.clientId, last: sql<string>`max(${s.timeEntries.date})` })
      .from(s.timeEntries)
      .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
      .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .where(and(isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, false), lte(s.timeEntries.date, today)))
      .groupBy(s.annualProjects.clientId),
    db
      .select({ clientId: s.contacts.clientId, last: sql<Date>`max(coalesce(${s.contacts.doneAt}, ${s.contacts.scheduledAt}))` })
      .from(s.contacts)
      .where(eq(s.contacts.status, "realizado"))
      .groupBy(s.contacts.clientId),
    db
      .select({ clientId: s.annualProjects.clientId, at: s.comments.createdAt })
      .from(s.comments)
      .innerJoin(s.items, eq(s.items.id, s.comments.itemId))
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .where(and(eq(s.comments.channel, "cliente"), isNotNull(s.comments.authorContactId), isNull(s.comments.answeredAt), isNull(s.comments.deletedAt))),
  ]);
  const hours = groupHours(rows, kinds, (r) => r.clientId);
  const lastRealMap = new Map(lastReal.map((r) => [r.clientId, String(r.last)]));
  const lastContactMap = new Map(lastContacts.map((r) => [r.clientId, toISODate(new Date(r.last))]));
  return clients.map((c) => {
    const its = items.filter((i) => i.clientId === c.id && i.stage !== "concluido" && !i.completedOn);
    const active = isClientActive(lastRealMap.get(c.id) ?? null, today, settings);
    const waiting = its.filter((i) => i.outOfScope && i.clientApproval === "aguardando").length;
    const lastContact = lastContactMap.get(c.id) ?? null;
    const h = clientHealth({
      today,
      holidays,
      openDeadlines: its.filter((i) => i.deadline).map((i) => i.deadline!),
      unansweredClientCommentsSince: unanswered.filter((u) => u.clientId === c.id).map((u) => u.at),
      lastRealizedContact: lastContact,
      active,
      demandsAwaitingClient: waiting,
      settings,
    });
    const stages: Record<string, number> = {};
    for (const i of items.filter((x) => x.clientId === c.id && x.kind === "projeto")) stages[i.stage] = (stages[i.stage] ?? 0) + 1;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      health: h.health,
      reasons: h.reasons,
      active,
      stages,
      openTasks: its.filter((i) => i.kind === "tarefa").length,
      waiting,
      monthMinutes: hours.get(c.id)?.tot ?? 0,
      lastContact,
      contactWorkdays: lastContact ? workdaysSince(lastContact, today, holidays) : null,
    };
  });
}

// ---------- Gestão: pendências e "Precisa de você" (US-10, US-11, US-12, US-47) ----------

export async function pendingChangeRequests() {
  const rows = await db
    .select({ cr: s.changeRequests, person: s.people, entry: s.timeEntries })
    .from(s.changeRequests)
    .innerJoin(s.people, eq(s.people.id, s.changeRequests.personId))
    .innerJoin(s.timeEntries, eq(s.timeEntries.id, s.changeRequests.timeEntryId))
    .where(eq(s.changeRequests.status, "pendente"))
    .orderBy(asc(s.changeRequests.createdAt));
  return rows;
}

export async function recentDecisions(since: Date) {
  const decider = alias(s.people, "decider");
  return db
    .select({ cr: s.changeRequests, person: s.people, decider: decider.name })
    .from(s.changeRequests)
    .innerJoin(s.people, eq(s.people.id, s.changeRequests.personId))
    .leftJoin(decider, eq(decider.id, s.changeRequests.decidedBy))
    .where(and(ne(s.changeRequests.status, "pendente"), gte(s.changeRequests.decidedAt, since)))
    .orderBy(desc(s.changeRequests.decidedAt));
}

/** Demandas adicionais aguardando o cliente, com dias parados. */
export async function demandsAwaitingClient(today: ISODate) {
  const items = (await loadItems(today)).filter((i) => i.outOfScope && i.clientApproval === "aguardando" && i.stage !== "concluido");
  const ids = items.map((i) => i.id);
  const charges = ids.length
    ? await db
        .select({ itemId: s.contacts.relatedItemId, scheduledAt: s.contacts.scheduledAt, responsible: s.people.name })
        .from(s.contacts)
        .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
        .where(and(inArray(s.contacts.relatedItemId, ids), eq(s.contacts.status, "agendado"), sql`${s.contacts.objective} like 'Cobrar aprovação%'`))
    : [];
  const est = ids.length
    ? await db.select({ itemId: s.items.id, planned: s.items.plannedMinutes }).from(s.items).where(inArray(s.items.id, ids))
    : [];
  return items
    .map((i) => {
      const since = i.requestedAt ?? i.createdOn;
      return {
        ...i,
        since,
        days: Math.max(0, diffDays(today, since)),
        planned: est.find((e) => e.itemId === i.id)?.planned ?? null,
        charge: charges.find((c) => c.itemId === i.id) ?? null,
      };
    })
    .sort((a, b) => b.days - a.days);
}

export async function evaluationsList(opts: { consultantId?: string; onlyUndecided?: boolean } = {}) {
  const conds = [];
  if (opts.consultantId) conds.push(eq(s.evaluations.consultantId, opts.consultantId));
  if (opts.onlyUndecided) conds.push(eq(s.evaluations.published, false), isNull(s.evaluations.publishedAt));
  const consultant = alias(s.people, "consultant");
  return db
    .select({
      ev: s.evaluations,
      clientName: s.clients.name,
      clientColor: s.clients.color,
      contactName: s.clientContacts.name,
      consultantName: consultant.name,
      itemName: s.items.name,
    })
    .from(s.evaluations)
    .innerJoin(s.clients, eq(s.clients.id, s.evaluations.clientId))
    .innerJoin(s.clientContacts, eq(s.clientContacts.id, s.evaluations.contactId))
    .leftJoin(consultant, eq(consultant.id, s.evaluations.consultantId))
    .leftJoin(s.items, eq(s.items.id, s.evaluations.itemId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(s.evaluations.createdAt));
}

export async function syncErrors() {
  const [entries, items] = await Promise.all([
    db
      .select({ id: s.timeEntries.id, date: s.timeEntries.date, minutes: s.timeEntries.minutes, error: s.timeEntries.syncError, updatedAt: s.timeEntries.updatedAt, who: s.people.name, item: s.items.name, client: s.clients.name, clientColor: s.clients.color })
      .from(s.timeEntries)
      .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
      .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
      .where(eq(s.timeEntries.syncStatus, "erro"))
      .orderBy(desc(s.timeEntries.updatedAt)),
    db
      .select({ id: s.items.id, name: s.items.name, kind: s.items.kind, error: s.items.syncError, updatedAt: s.items.updatedAt, client: s.clients.name, clientColor: s.clients.color })
      .from(s.items)
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
      .where(eq(s.items.syncStatus, "erro"))
      .orderBy(desc(s.items.updatedAt)),
  ]);
  return { entries, items };
}

/** US-11: relatório mensal de dias sem apontamento por consultor. */
export async function missingReport(month: ISODate, today: ISODate) {
  const people = await consultants();
  const range = { from: startOfMonth(month), to: endOfMonth(month) };
  const act = await loadActivity(
    people.map((p) => p.id),
    { from: addDays(range.from, -10), to: range.to },
  );
  return people.map((p) => {
    const withEntries = daysWithEntries(act.rows, act.kinds, p.id);
    const just = act.justifications.filter((j) => j.personId === p.id);
    const justSet = new Set(just.map((j) => j.date));
    const first = act.first.get(p.id);
    const rule = monthMissingRule({ month: range.from, today, daysWithEntries: withEntries, justifiedDays: justSet, holidays: act.holidays, limit: act.settings.missingDaysLimit });
    const missing = first ? rule.missing.filter((d) => d >= first) : rule.missing;
    const streak = currentMissingStreak({ today, daysWithEntries: withEntries, justifiedDays: justSet, holidays: act.holidays, since: first });
    return { person: p, missing, justified: rule.justified, worstStreak: rule.worstStreak, lostBonus: rule.lostBonus, currentStreak: streak.length, justifications: just.filter((j) => j.date >= range.from && j.date <= range.to) };
  });
}

/** Contagens para as abas de pendências e para "Precisa de você". */
export async function managementCounts(today: ISODate, now: Date) {
  const [changes, prov, demands, evals, sync, report, portfolio] = await Promise.all([
    pendingChangeRequests(),
    overdueProvisioning(today, now),
    demandsAwaitingClient(today),
    evaluationsList({ onlyUndecided: true }),
    syncErrors(),
    missingReport(today, today),
    portfolioLite(today),
  ]);
  const monthJust = await loadJustifications(null, { from: startOfMonth(today), to: endOfMonth(today) });
  return { changes, prov, demands, evals, sync, report, portfolio, monthJust };
}

/** Projetos por etapa (US-47). */
export async function projectsByStage() {
  const rows = await db
    .select({ stage: s.items.stage, n: sql<number>`count(*)`.mapWith(Number) })
    .from(s.items)
    .where(and(eq(s.items.kind, "projeto"), eq(s.items.archived, false), isNull(s.items.parentId)))
    .groupBy(s.items.stage);
  return Object.fromEntries(rows.map((r) => [r.stage, r.n])) as Record<string, number>;
}

/** Contatos da pessoa (para a ficha): feitos no período e atrasados agora. */
export function contactsOf(act: Activity, personId: string, range: Range, now: Date) {
  const mine = act.contacts.filter((c) => c.responsibleId === personId);
  return {
    done: mine.filter((c) => c.doneOn && c.doneOn >= range.from && c.doneOn <= range.to).sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime()),
    late: mine.filter((c) => c.status === "agendado" && c.scheduledAt < now),
    upcoming: mine.filter((c) => c.status === "agendado" && c.scheduledAt >= now),
  };
}

/** Prazos reprogramados das tarefas da pessoa no período, com motivo. */
export async function deadlineChangesFor(personId: string, range: Range) {
  return db
    .select({ id: s.deadlineChanges.id, itemId: s.items.id, item: s.items.name, old: s.deadlineChanges.oldDeadline, new: s.deadlineChanges.newDeadline, reason: s.deadlineChanges.reason, at: s.deadlineChanges.at, by: s.people.name })
    .from(s.deadlineChanges)
    .innerJoin(s.items, eq(s.items.id, s.deadlineChanges.itemId))
    .innerJoin(s.itemAssignees, and(eq(s.itemAssignees.itemId, s.items.id), eq(s.itemAssignees.personId, personId)))
    .leftJoin(s.people, eq(s.people.id, s.deadlineChanges.byPersonId))
    .where(and(gte(s.deadlineChanges.at, startOfDayInstant(range.from)), lt(s.deadlineChanges.at, startOfDayInstant(addDays(range.to, 1)))))
    .orderBy(desc(s.deadlineChanges.at));
}

/** Etiquetas visíveis (não de sistema) de vários itens. */
export async function itemTagsOf(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { name: string; color: string }[]>();
  const rows = await db
    .select({ itemId: s.itemTags.itemId, name: s.tags.name, color: s.tags.color })
    .from(s.itemTags)
    .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
    .where(and(inArray(s.itemTags.itemId, itemIds), eq(s.tags.system, false)));
  const m = new Map<string, { name: string; color: string }[]>();
  for (const r of rows) m.set(r.itemId, [...(m.get(r.itemId) ?? []), { name: r.name, color: r.color }]);
  return m;
}

/** Token da TV (US-49): válido e não revogado. */
export async function validTvToken(token: string) {
  if (!token || token.length > 200) return null;
  const [row] = await db.select().from(s.tvTokens).where(and(eq(s.tvTokens.token, token), isNull(s.tvTokens.revokedAt)));
  return row ?? null;
}
