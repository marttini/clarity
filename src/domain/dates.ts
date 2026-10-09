/**
 * Datas do Clarity. Toda regra de "dia" usa o horário de Brasília (America/Sao_Paulo).
 * Datas de calendário circulam como string ISO "AAAA-MM-DD" para não sofrer com fuso.
 */
export const TZ = "America/Sao_Paulo";

export type ISODate = string; // "2026-10-08"

const pad = (n: number) => String(n).padStart(2, "0");

/** Data de hoje (ou de um instante) no horário de Brasília. */
export function toISODate(at: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts; // en-CA já sai como AAAA-MM-DD
}

export function parseISO(d: ISODate): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

/** Meio-dia UTC da data: seguro para aritmética de dias e dia da semana. */
function utcNoon(d: ISODate): Date {
  const { y, m, day } = parseISO(d);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

function fromUtc(dt: Date): ISODate {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = utcNoon(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, day } = parseISO(d);
  const first = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return fromUtc(first);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(d: ISODate): number {
  return utcNoon(d).getUTCDay();
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utcNoon(a).getTime() - utcNoon(b).getTime()) / 86_400_000);
}

export function startOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + "01";
}

export function endOfMonth(d: ISODate): ISODate {
  return addDays(startOfMonth(addMonths(startOfMonth(d), 1)), -1);
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Instante (UTC) em que começa o dia `d` em Brasília. */
export function startOfDayInstant(d: ISODate): Date {
  // Brasília não tem horário de verão desde 2019: UTC-3 fixo.
  const { y, m, day } = parseISO(d);
  return new Date(Date.UTC(y, m - 1, day, 3, 0, 0));
}

// ---------- Feriados nacionais ----------

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Feriados nacionais (lei federal). Pontos facultativos (Carnaval, Corpus Christi) não entram. */
export function nationalHolidays(year: number): { date: ISODate; name: string }[] {
  const easter = easterSunday(year);
  return [
    { date: `${year}-01-01`, name: "Confraternização Universal" },
    { date: addDays(easter, -2), name: "Sexta-feira Santa" },
    { date: `${year}-04-21`, name: "Tiradentes" },
    { date: `${year}-05-01`, name: "Dia do Trabalho" },
    { date: `${year}-09-07`, name: "Independência do Brasil" },
    { date: `${year}-10-12`, name: "Nossa Senhora Aparecida" },
    { date: `${year}-11-02`, name: "Finados" },
    { date: `${year}-11-15`, name: "Proclamação da República" },
    { date: `${year}-11-20`, name: "Dia Nacional de Zumbi e da Consciência Negra" },
    { date: `${year}-12-25`, name: "Natal" },
  ].sort((x, y) => x.date.localeCompare(y.date));
}

export type HolidaySet = ReadonlySet<ISODate>;

export function isWorkday(d: ISODate, holidays: HolidaySet): boolean {
  const w = weekday(d);
  return w !== 0 && w !== 6 && !holidays.has(d);
}

export function workdaysBetween(from: ISODate, to: ISODate, holidays: HolidaySet): ISODate[] {
  if (from > to) return [];
  return eachDay(from, to).filter((d) => isWorkday(d, holidays));
}

/** Quantos dias úteis se passaram de `from` (exclusive) até `to` (inclusive). */
export function workdaysSince(from: ISODate, to: ISODate, holidays: HolidaySet): number {
  return workdaysBetween(addDays(from, 1), to, holidays).length;
}

export function addWorkdays(d: ISODate, n: number, holidays: HolidaySet): ISODate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isWorkday(cur, holidays)) left--;
  }
  return cur;
}

// ---------- Horas ----------

/** "1:30", "1h30", "1h", "90min", "1,5" → minutos. Retorna null se inválido. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,3}):([0-5]\d)$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d{1,3})h(?:([0-5]?\d)(?:min|m)?)?$/))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  if ((m = s.match(/^(\d{1,4})(?:min|m)$/))) return +m[1];
  if ((m = s.match(/^(\d{1,3})(?:[.,](\d{1,2}))?$/))) {
    const frac = m[2] ? Number("0." + m[2]) : 0;
    return Math.round((+m[1] + frac) * 60);
  }
  return null;
}

/** 90 → "1:30" */
export function formatMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}:${pad(a % 60)}`;
}

/** Formato de horas do Odoo: decimal (1:30 → 1.5). */
export function minutesToOdooHours(min: number): number {
  return Math.round((min / 60) * 10000) / 10000;
}

export function odooHoursToMinutes(h: number): number {
  return Math.round(h * 60);
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function monthName(m: number): string {
  return MONTHS[m - 1];
}

/** "quinta, 8 de outubro" */
export function longDate(d: ISODate): string {
  const { m, day } = parseISO(d);
  return `${WEEKDAYS[weekday(d)]}, ${day} de ${MONTHS[m - 1]}`;
}

/** "08/10" */
export function shortDate(d: ISODate): string {
  const { m, day } = parseISO(d);
  return `${pad(day)}/${pad(m)}`;
}

export function weekdayShort(d: ISODate): string {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][weekday(d)];
}
