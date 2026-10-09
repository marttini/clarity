/**
 * Regras de negócio do Clarity, puras e testáveis (sem banco, sem tela).
 * Cada função cita a história que implementa.
 */
import {
  type ISODate,
  type HolidaySet,
  addDays,
  isWorkday,
  workdaysBetween,
  workdaysSince,
  startOfDayInstant,
  startOfMonth,
  endOfMonth,
  addMonths,
} from "./dates";

// ---------- Configuração (editável pelo administrador: US-50, US-37, Config) ----------

export type Settings = {
  /** Faixas do consultor, em horas Faturáveis no mês. */
  bands: { quota: number; band1: number; band2: number; band3: number; extra: number };
  /** Metas da equipe, em horas Faturáveis no mês. */
  teamGoals: { name: string; hours: number }[];
  editWindowHours: number; // 48
  missingDaysLimit: number; // 3
  contactAlertWorkdays: number; // 5
  activeClientMonths: number; // 6
  clientCommentAlertWorkdays: number; // 1
  deadlineSoonDays: number; // 3
  businessHours: { start: number; end: number }; // 8 – 18
};

export const DEFAULT_SETTINGS: Settings = {
  bands: { quota: 60, band1: 90, band2: 140, band3: 175, extra: 240 },
  teamGoals: [
    { name: "Cota", hours: 1280 },
    { name: "Meta", hours: 1500 },
    { name: "MetaMonkey", hours: 1725 },
    { name: "MetaCrazyMonkey", hours: 2000 },
  ],
  editWindowHours: 48,
  missingDaysLimit: 3,
  contactAlertWorkdays: 5,
  activeClientMonths: 6,
  clientCommentAlertWorkdays: 1,
  deadlineSoonDays: 3,
  businessHours: { start: 8, end: 18 },
};

// ---------- Cores do dia (US-06) ----------

export type DayColor = "vermelho" | "amarelo" | "azul" | "verde";

/** vermelho sem horas; amarelo acima de 0 e abaixo de 4 h; azul de 4 h a 6 h; verde acima de 6 h. */
export function dayColor(minutes: number): DayColor {
  if (minutes <= 0) return "vermelho";
  if (minutes < 240) return "amarelo";
  if (minutes <= 360) return "azul";
  return "verde";
}

// ---------- Faixas do consultor (US-50) ----------

export type BandKey = "abaixo" | "cota" | "faixa1" | "faixa2" | "faixa3";

export type BandResult = {
  key: BandKey;
  label: string;
  /** Rótulo e horas da próxima faixa; null se já está na última. */
  next: { label: string; hours: number } | null;
  missingMinutes: number;
  /** Acima do limite extra (240 h). */
  extra: boolean;
};

/** Só horas Faturáveis. O limite inferior pertence à faixa de cima (140 h já é Faixa 2). */
export function consultantBand(faturavelMinutes: number, s: Settings = DEFAULT_SETTINGS): BandResult {
  const h = faturavelMinutes / 60;
  const b = s.bands;
  const steps: { key: BandKey; label: string; from: number }[] = [
    { key: "abaixo", label: "Abaixo da cota", from: -Infinity },
    { key: "cota", label: "Cota atingida", from: b.quota },
    { key: "faixa1", label: "Faixa 1", from: b.band1 },
    { key: "faixa2", label: "Faixa 2", from: b.band2 },
    { key: "faixa3", label: "Faixa 3", from: b.band3 },
  ];
  let idx = 0;
  for (let i = 0; i < steps.length; i++) if (h >= steps[i].from) idx = i;
  const cur = steps[idx];
  const nxt = steps[idx + 1];
  const extra = h > b.extra;
  let next: BandResult["next"] = nxt ? { label: nxt.label, hours: nxt.from } : null;
  if (!nxt && !extra) next = { label: "Bônus extra", hours: b.extra };
  const missingMinutes = next ? Math.max(0, Math.ceil(next.hours * 60 - faturavelMinutes)) : 0;
  return { key: cur.key, label: cur.label, next, missingMinutes, extra };
}

export function teamGoalStatus(faturavelMinutes: number, s: Settings = DEFAULT_SETTINGS) {
  const h = faturavelMinutes / 60;
  const goals = [...s.teamGoals].sort((a, b) => a.hours - b.hours);
  const reached = goals.filter((g) => h >= g.hours);
  const next = goals.find((g) => h < g.hours) ?? null;
  return {
    reached: reached.at(-1) ?? null,
    next,
    missingMinutes: next ? Math.ceil(next.hours * 60 - faturavelMinutes) : 0,
    goals,
  };
}

// ---------- Projeção e comparações (US-33) ----------

/** Projeção do mês no ritmo atual: realizado / dias úteis passados × dias úteis do mês. */
export function projectMonth(
  minutesSoFar: number,
  today: ISODate,
  holidays: HolidaySet,
  opts: { includeToday?: boolean } = {},
): number {
  const month = workdaysBetween(startOfMonth(today), endOfMonth(today), holidays);
  const end = opts.includeToday ? today : addDays(today, -1);
  const elapsed = month.filter((d) => d <= end).length;
  if (elapsed === 0) return minutesSoFar;
  return Math.round((minutesSoFar / elapsed) * month.length);
}

export type MonthlyComparison = {
  current: number;
  projection: number;
  previous: number | null;
  avg3: number | null;
  avg6: number | null;
  avg12: number | null;
};

/**
 * `history` = valores dos meses anteriores, do mais recente para o mais antigo
 * (history[0] = mês anterior). Médias só consideram meses existentes.
 */
export function compareMonthly(current: number, projection: number, history: number[]): MonthlyComparison {
  const avg = (n: number) => {
    const slice = history.slice(0, n);
    if (slice.length === 0) return null;
    return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
  };
  return { current, projection, previous: history[0] ?? null, avg3: avg(3), avg6: avg(6), avg12: avg(12) };
}

/** Variação percentual com sinal; null se não há base. */
export function delta(value: number, base: number | null): number | null {
  if (base === null || base === 0) return null;
  return (value - base) / base;
}

// ---------- Regra das 48 horas (US-04, US-09, US-12) ----------

export function editDeadline(entry: { createdAt: Date; date: ISODate; isProvisioning: boolean }, s: Settings = DEFAULT_SETTINGS): Date {
  const ms = s.editWindowHours * 3_600_000;
  if (entry.isProvisioning) {
    // No provisionamento, as 48 horas contam a partir da data provisionada.
    const fromDate = startOfDayInstant(entry.date).getTime() + ms;
    return new Date(Math.max(fromDate, entry.createdAt.getTime() + ms));
  }
  return new Date(entry.createdAt.getTime() + ms);
}

export function canEditFreely(
  entry: { createdAt: Date; date: ISODate; isProvisioning: boolean },
  now: Date,
  s: Settings = DEFAULT_SETTINGS,
): boolean {
  return now.getTime() < editDeadline(entry, s).getTime();
}

// ---------- Validação do apontamento (US-01, US-02) ----------

export type EntryTypeInfo = {
  id: string;
  code: string;
  acceptsSalesOrder: boolean;
  isInternal: boolean;
  isProvisioning: boolean;
  active: boolean;
};

export type ItemInfo = {
  id: string;
  kind: "projeto" | "tarefa";
  scopeStatus: "rascunho" | "confirmado";
  parentScopeStatus?: "rascunho" | "confirmado" | null;
  outOfScope: boolean;
  clientApproval: "nao_se_aplica" | "aguardando" | "aprovada" | "recusada";
  isInternalProject: boolean;
  archived: boolean;
  stage: string;
};

export type EntryInput = {
  date: ISODate;
  minutes: number;
  description: string;
  type: EntryTypeInfo;
  item: ItemInfo;
  salesOrderLineId?: string | null;
};

export type EntryErrors = Partial<Record<"date" | "minutes" | "description" | "type" | "item" | "salesOrder", string>>;

export function validateEntry(input: EntryInput, today: ISODate, person: { isConsultor: boolean; active: boolean }): EntryErrors {
  const e: EntryErrors = {};
  if (!person.active || !person.isConsultor) e.item = "Só consultores apontam horas.";
  if (!input.type.active) e.type = "Este tipo está desativado.";
  if (input.date > today && !input.type.isProvisioning) e.date = "Data futura só com o tipo Provisionamento.";
  if (input.type.isProvisioning && input.date <= today) e.date = "Provisionamento é só para datas futuras.";
  if (!Number.isFinite(input.minutes) || input.minutes <= 0) e.minutes = "Informe as horas (maior que zero).";
  if (input.minutes > 24 * 60) e.minutes = "Mais de 24 horas num lançamento? Confira o valor.";
  if (!input.description.trim()) e.description = "Descreva o que foi feito.";
  if (input.salesOrderLineId && !input.type.acceptsSalesOrder) e.salesOrder = "Este tipo não aceita pedido de venda.";
  const it = input.item;
  if (it.archived) e.item = "Este item está arquivado.";
  if (it.scopeStatus === "rascunho" || it.parentScopeStatus === "rascunho")
    e.item = "Projeto em rascunho não recebe horas. Horas de montagem de escopo não são apontadas.";
  if (it.outOfScope && it.clientApproval !== "aprovada")
    e.item =
      it.clientApproval === "recusada"
        ? "O cliente recusou esta demanda adicional."
        : "Demanda adicional aguardando aprovação do cliente: as horas só entram depois da aprovação.";
  if (input.type.isInternal && !it.isInternalProject) e.type = "Horas do tipo Interno vão para o projeto Síntese do ano.";
  if (!input.type.isInternal && it.isInternalProject && !input.type.isProvisioning)
    e.type = "No projeto Síntese, use o tipo Interno.";
  return e;
}

// ---------- Regra dos 3 dias (US-11) ----------

/**
 * Dias úteis encerrados (até ontem) sem apontamento real e sem justificativa,
 * contados de trás para a frente até o primeiro dia apontado.
 */
export function currentMissingStreak(params: {
  today: ISODate;
  daysWithEntries: ReadonlySet<ISODate>;
  justifiedDays: ReadonlySet<ISODate>;
  holidays: HolidaySet;
  since?: ISODate; // início do vínculo, para não contar antes de a pessoa existir
}): ISODate[] {
  const out: ISODate[] = [];
  let d = addDays(params.today, -1);
  const floor = params.since ?? addDays(params.today, -60);
  while (d >= floor) {
    if (isWorkday(d, params.holidays)) {
      if (params.daysWithEntries.has(d) || params.justifiedDays.has(d)) break;
      out.push(d);
    }
    d = addDays(d, -1);
  }
  return out.reverse();
}

/** No mês, a pessoa perdeu o bônus se teve 3 dias úteis seguidos sem apontar e sem justificar. */
export function monthMissingRule(params: {
  month: ISODate; // qualquer dia do mês
  today: ISODate;
  daysWithEntries: ReadonlySet<ISODate>;
  justifiedDays: ReadonlySet<ISODate>;
  holidays: HolidaySet;
  limit?: number;
}) {
  const limit = params.limit ?? 3;
  const end = endOfMonth(params.month) < params.today ? endOfMonth(params.month) : addDays(params.today, -1);
  const days = workdaysBetween(startOfMonth(params.month), end, params.holidays);
  let run = 0;
  let worst = 0;
  const missing: ISODate[] = [];
  const justified: ISODate[] = [];
  for (const d of days) {
    if (params.daysWithEntries.has(d)) {
      run = 0;
    } else if (params.justifiedDays.has(d)) {
      justified.push(d);
      run = 0;
    } else {
      missing.push(d);
      run++;
      worst = Math.max(worst, run);
    }
  }
  return { missing, justified, worstStreak: worst, lostBonus: worst >= limit };
}

// ---------- Contatos e clientes (US-30, US-37, US-45) ----------

export function isClientActive(lastRealEntryDate: ISODate | null, today: ISODate, s: Settings = DEFAULT_SETTINGS): boolean {
  if (!lastRealEntryDate) return false;
  return lastRealEntryDate >= addMonths(today, -s.activeClientMonths);
}

/** Meses completos desde a última hora real (para "Inativo há X meses"). */
export function inactiveMonths(lastRealEntryDate: ISODate | null, today: ISODate): number | null {
  if (!lastRealEntryDate) return null;
  let n = 0;
  while (addMonths(lastRealEntryDate, n + 1) <= today) n++;
  return n;
}

export function contactAlert(
  lastRealizedContact: ISODate | null,
  today: ISODate,
  holidays: HolidaySet,
  s: Settings = DEFAULT_SETTINGS,
): { alert: boolean; workdays: number | null } {
  if (!lastRealizedContact) return { alert: true, workdays: null };
  const n = workdaysSince(lastRealizedContact, today, holidays);
  return { alert: n >= s.contactAlertWorkdays, workdays: n };
}

export type Health = "vermelho" | "amarelo" | "verde";

/** Semáforo da carteira (US-45). Retorna a cor e os motivos em português. */
export function clientHealth(params: {
  today: ISODate;
  holidays: HolidaySet;
  openDeadlines: ISODate[]; // prazos de itens não concluídos
  unansweredClientCommentsSince: Date[]; // instante dos comentários do cliente sem resposta
  lastRealizedContact: ISODate | null;
  active: boolean;
  demandsAwaitingClient: number;
  settings?: Settings;
}): { health: Health; reasons: string[] } {
  const s = params.settings ?? DEFAULT_SETTINGS;
  const red: string[] = [];
  const yellow: string[] = [];
  const overdue = params.openDeadlines.filter((d) => d < params.today).length;
  if (overdue) red.push(overdue === 1 ? "1 prazo vencido" : `${overdue} prazos vencidos`);
  const waiting = params.unansweredClientCommentsSince.filter((at) => {
    const n = workdaysSince(toISO(at), params.today, params.holidays);
    return n >= s.clientCommentAlertWorkdays;
  }).length;
  if (waiting) red.push(waiting === 1 ? "comentário do cliente sem resposta" : `${waiting} comentários do cliente sem resposta`);
  if (params.active) {
    const c = contactAlert(params.lastRealizedContact, params.today, params.holidays, s);
    if (c.alert) red.push(c.workdays === null ? "nenhum contato registrado" : `sem contato há ${c.workdays} dias úteis`);
  }
  if (params.demandsAwaitingClient)
    yellow.push(
      params.demandsAwaitingClient === 1 ? "1 demanda adicional aguardando o cliente" : `${params.demandsAwaitingClient} demandas adicionais aguardando o cliente`,
    );
  const soonLimit = addDays(params.today, s.deadlineSoonDays);
  const soon = params.openDeadlines.filter((d) => d >= params.today && d <= soonLimit).length;
  if (soon) yellow.push(soon === 1 ? "1 prazo vence em até 3 dias" : `${soon} prazos vencem em até 3 dias`);
  if (red.length) return { health: "vermelho", reasons: [...red, ...yellow] };
  if (yellow.length) return { health: "amarelo", reasons: yellow };
  return { health: "verde", reasons: [] };
}

function toISO(at: Date): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

// ---------- Avisos em horário comercial (Central de avisos) ----------

/** Próximo instante permitido para aviso externo: dias úteis, 8h–18h (Brasília). */
export function nextBusinessInstant(now: Date, holidays: HolidaySet, s: Settings = DEFAULT_SETTINGS): Date {
  const day = toISO(now);
  const hourBR = (now.getUTCHours() + 21) % 24 + now.getUTCMinutes() / 60; // UTC-3
  if (isWorkday(day, holidays) && hourBR >= s.businessHours.start && hourBR < s.businessHours.end) return now;
  let d = day;
  if (isWorkday(d, holidays) && hourBR < s.businessHours.start) {
    return new Date(startOfDayInstant(d).getTime() + s.businessHours.start * 3_600_000);
  }
  do d = addDays(d, 1);
  while (!isWorkday(d, holidays));
  return new Date(startOfDayInstant(d).getTime() + s.businessHours.start * 3_600_000);
}
