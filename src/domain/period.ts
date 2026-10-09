import { type ISODate, addDays, addMonths, startOfMonth, endOfMonth, weekday, parseISO, monthName, shortDate } from "./dates";

export type PeriodKey = "hoje" | "semana" | "mes" | "trimestre" | "ano" | "personalizado";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
  { value: "trimestre", label: "Trimestre" },
  { value: "ano", label: "Ano" },
  { value: "personalizado", label: "Personalizado" },
];

export type Period = {
  key: PeriodKey;
  from: ISODate;
  to: ISODate; // inclusive
  label: string;
  /** Período anterior equivalente, para comparação. */
  prev: { from: ISODate; to: ISODate; label: string };
};

/**
 * "Do macro ao micro": toda visão tem seletor de período.
 * Trimestre = trimestre do calendário; Ano = ano do calendário até hoje.
 */
export function resolvePeriod(params: { p?: string; de?: string; ate?: string }, today: ISODate): Period {
  const key = (PERIOD_OPTIONS.some((o) => o.value === params.p) ? params.p : "mes") as PeriodKey;
  const { y, m } = parseISO(today);
  switch (key) {
    case "hoje": {
      const prev = addDays(today, -1);
      return { key, from: today, to: today, label: "hoje", prev: { from: prev, to: prev, label: "ontem" } };
    }
    case "semana": {
      const w = weekday(today);
      const mon = addDays(today, -((w + 6) % 7));
      return {
        key,
        from: mon,
        to: addDays(mon, 6),
        label: `semana de ${shortDate(mon)}`,
        prev: { from: addDays(mon, -7), to: addDays(mon, -1), label: "semana anterior" },
      };
    }
    case "trimestre": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const from = `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
      const to = endOfMonth(addMonths(from, 2));
      const pf = addMonths(from, -3);
      return { key, from, to, label: `${Math.floor((m - 1) / 3) + 1}º trimestre de ${y}`, prev: { from: pf, to: endOfMonth(addMonths(pf, 2)), label: "trimestre anterior" } };
    }
    case "ano":
      return { key, from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), prev: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) } };
    case "personalizado": {
      const valid = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
      const from = valid(params.de) ? params.de! : startOfMonth(today);
      const to = valid(params.ate) && params.ate! >= from ? params.ate! : today;
      const len = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      return { key, from, to, label: `${shortDate(from)} a ${shortDate(to)}`, prev: { from: addDays(from, -len), to: addDays(from, -1), label: "período anterior" } };
    }
    default: {
      const from = startOfMonth(today);
      const pf = addMonths(from, -1);
      return { key: "mes", from, to: endOfMonth(today), label: `${monthName(m)} de ${y}`, prev: { from: pf, to: endOfMonth(pf), label: monthName(parseISO(pf).m) } };
    }
  }
}
