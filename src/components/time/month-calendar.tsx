import Link from "next/link";
import { type ISODate, type HolidaySet, addDays, endOfMonth, isWorkday, parseISO, startOfMonth, weekday } from "@/domain/dates";
import { dayColor } from "@/domain/rules";
import { cx } from "@/components/ui";
import { DAY_BG, hm } from "./bits";

export type CalDay = { real: number; prov: number; justified: boolean };

/** Calendário do mês, seg a sex, com as cores do dia (US-06/US-33), feriados, provisionados e dias justificados. */
export function MonthCalendar({
  month,
  today,
  days,
  holidays,
  selected,
  hrefFor,
  since,
}: {
  month: ISODate;
  today: ISODate;
  days: Map<ISODate, CalDay>;
  holidays: HolidaySet;
  selected: ISODate | null;
  hrefFor: (d: ISODate) => string;
  /** Antes desta data a pessoa não tinha apontamentos: não pinta de vermelho. */
  since?: ISODate;
}) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const start = addDays(first, -((weekday(first) + 6) % 7));
  const cells: ISODate[] = [];
  let d = start;
  while (d <= last || cells.length % 5 !== 0) {
    if (weekday(d) >= 1 && weekday(d) <= 5) cells.push(d);
    d = addDays(d, 1);
  }
  const { m } = parseISO(month);
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {["seg", "ter", "qua", "qui", "sex"].map((w) => (
        <span key={w} className="px-1 text-xs font-bold text-faint">
          {w}
        </span>
      ))}
      {cells.map((d) => {
        const out = parseISO(d).m !== m;
        const info = days.get(d) ?? { real: 0, prov: 0, justified: false };
        const hol = holidays.has(d);
        const past = d <= today;
        const isToday = d === today;
        const before = !!since && d < since;
        let cls = "bg-surface-3 border border-line-2";
        let label = "";
        let labCls = "text-faint";
        let numCls = "text-ink";
        if (out) {
          cls = "bg-[#140c1c] border border-line";
          numCls = "text-faint";
        } else if (hol || !isWorkday(d, holidays)) {
          cls = "bg-surface-2 border border-dashed border-line-4";
          label = "feriado";
          labCls = "text-muted";
        } else if (past && info.real === 0 && info.justified) {
          cls = "bg-line-2 border border-line-5";
          label = "justificado";
          labCls = "text-[#e6d9f2]";
        } else if (past && !before && !(isToday && info.real === 0)) {
          const c = dayColor(info.real);
          cls = cx(DAY_BG[c], "border border-transparent");
          label = info.real ? `${hm(info.real)} h` : "sem horas";
          labCls = "text-bg";
          numCls = "text-bg";
        } else if (info.prov) {
          cls = "bg-[#1c1018] border-[1.5px] border-dashed border-accent";
          label = `${hm(info.prov)} prov.`;
          labCls = "text-accent-soft";
        } else if (isToday) {
          label = "hoje";
        }
        const aria = `${d.split("-").reverse().join("/")}${label ? `: ${label}` : ""}`;
        const body = (
          <>
            <span className={cx("text-sm", isToday ? "font-extrabold" : "font-bold", numCls)}>{out ? d.slice(8) + "/" + d.slice(5, 7) : Number(d.slice(8))}</span>
            <span className={cx("num text-xs font-bold", labCls)}>{label}</span>
          </>
        );
        const base = cx(
          "flex min-h-16 flex-col items-start justify-between rounded-[10px] px-2.5 py-2 text-left no-underline",
          cls,
          isToday && "outline-2 outline-offset-2 outline-white",
          selected === d && !isToday && "outline-2 outline-offset-2 outline-accent-soft",
          selected === d && isToday && "shadow-[inset_0_0_0_2px_#120a19]",
        );
        return out ? (
          <span key={d} className={base} aria-hidden>
            {body}
          </span>
        ) : (
          <Link key={d} href={hrefFor(d)} scroll={false} aria-label={aria} aria-current={selected === d ? "date" : undefined} className={base}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
