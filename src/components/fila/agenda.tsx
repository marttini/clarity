import Link from "next/link";
import { cx } from "@/components/ui";
import { contactTypeLabel } from "@/components/contatos/labels";
import { addDays, addWorkdays, formatMinutes, longDate, weekday, type HolidaySet, type ISODate } from "@/domain/dates";
import { ContactIcon, CountPill } from "./bits";
import { ContactResult, type PersonOpt } from "./contact-forms";

export type AgendaContact = {
  id: string;
  date: ISODate;
  time: string;
  type: string;
  client: string;
  color: string;
  with: string | null;
  objective: string;
  createdBy: string;
  responsibleId: string;
  relatedItem: string | null;
};

/** Prazos rápidos do follow-up: amanhã, em 2 dias úteis, próxima semana. */
export function followUpDeadlines(today: ISODate, holidays: HolidaySet): [string, string][] {
  const nextMonday = addDays(today, 8 - (weekday(today) || 7));
  return [
    ["Amanhã", addWorkdays(today, 1, holidays)],
    ["Em 2 dias úteis", addWorkdays(today, 2, holidays)],
    ["Próxima semana", nextMonday],
  ];
}

function dayHeading(d: ISODate, today: ISODate, holidays: HolidaySet) {
  const base = longDate(d);
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  if (d === today) return `Hoje, ${base}`;
  if (d === addDays(today, 1)) return `Amanhã, ${base}`;
  // Lembra feriado no meio do caminho (V3: "segunda é feriado").
  const prev = addDays(d, -1);
  if (weekday(d) === 2 && holidays.has(prev)) return `${cap} (segunda é feriado)`;
  return cap;
}

/** US-35: agenda de contatos em três grupos (atrasados, hoje, próximos 7 dias), com "Registrar resultado". */
export function ContactAgenda({
  late,
  todayList,
  next,
  people,
  meId,
  today,
  holidays,
  compact,
  showAsked,
}: {
  late: AgendaContact[];
  todayList: AgendaContact[];
  next: AgendaContact[];
  people: PersonOpt[];
  meId: string;
  today: ISODate;
  holidays: HolidaySet;
  compact?: boolean;
  showAsked?: boolean;
}) {
  const groups: { key: string; title: string; tone: "red" | "neutral"; rows: AgendaContact[] }[] = [];
  if (late.length) groups.push({ key: "late", title: "Atrasados", tone: "red", rows: late });
  if (compact) {
    groups.push({ key: "today", title: "Hoje", tone: "neutral", rows: todayList });
    if (next.length) groups.push({ key: "next", title: "Próximos 7 dias", tone: "neutral", rows: next });
  } else {
    groups.push({ key: "today", title: dayHeading(today, today, holidays), tone: "neutral", rows: todayList });
    const days = [...new Set(next.map((c) => c.date))];
    for (const d of days) groups.push({ key: d, title: dayHeading(d, today, holidays), tone: "neutral", rows: next.filter((c) => c.date === d) });
  }
  const options = followUpDeadlines(today, holidays);
  return (
    <div className="flex flex-col">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col">
          <h3 className={cx("mt-2.5 mb-1 flex items-center gap-2 text-[13px] font-bold", g.tone === "red" ? "text-red" : "text-muted")}>
            {g.title}
            {g.key === "late" && <CountPill n={g.rows.length} tone="red" />}
          </h3>
          {g.rows.length === 0 && <p className="border-t border-line py-3 text-sm text-faint">Nenhum contato {g.key === "today" ? "para hoje" : ""}.</p>}
          {g.rows.map((c) => (
            <div key={c.id} className="flex flex-wrap items-start gap-x-3.5 gap-y-2 border-t border-line px-1 py-2.5">
              <span className={cx("num w-12 shrink-0 pt-2 text-sm font-bold", g.tone === "red" ? "text-red" : "text-white")}>{g.key === "late" || (compact && g.key === "next") ? c.date.slice(8) + "/" + c.date.slice(5, 7) : c.time}</span>
              {!compact && <ContactIcon type={c.type} />}
              <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md px-2 py-[3px] text-xs font-extrabold" style={{ background: c.color, color: "#1A0F22" }}>
                    {c.client}
                  </span>
                  {c.with && <strong className="text-[15px] text-white">{c.with}</strong>}
                  <span className="text-[13px] text-faint">{contactTypeLabel(c.type)}</span>
                  {c.type === "whatsapp" && !compact && <span className="rounded-full border border-line-5 px-2 py-0.5 text-[11px] font-bold text-muted">Envio pelo Clarity: Fase 2</span>}
                </div>
                <span className="text-sm text-ink">{c.objective}</span>
                {showAsked && <span className="text-xs text-faint">{c.createdBy === "" ? "" : `Pedido por ${c.createdBy}`}{c.relatedItem ? ` · ${c.relatedItem}` : ""}</span>}
              </div>
              <div className="ml-auto flex max-w-full min-w-0 justify-end max-sm:w-full">
                <ContactResult contactId={c.id} people={people} meId={meId} today={today} workdayOptions={options} label={compact ? "Registrar resultado" : "Registrar contato"} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Agenda compacta do dia (V3): apontamentos em blocos a partir das 8h e contatos no horário marcado. */
export function DayAgenda({
  entries,
  contacts,
  nowMinutes,
}: {
  entries: { id: string; minutes: number; client: string; color: string; task: string }[];
  contacts: { id: string; time: string; type: string; color: string; who: string }[];
  /** Minutos desde 0h no horário de Brasília. */
  nowMinutes: number;
}) {
  const H0 = 8;
  const H1 = 18;
  const ROW = 36;
  const top = (min: number) => ((min - H0 * 60) / 60) * ROW;
  const blocks = entries.map((e, i) => {
    const from = H0 * 60 + entries.slice(0, i).reduce((a, x) => a + x.minutes, 0);
    return { ...e, from, to: Math.min(from + e.minutes, H1 * 60 + 30) };
  });
  const hours = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);
  return (
    <div className="relative rounded-[14px] border border-line bg-surface py-1.5 pr-2.5">
      {hours.map((h) => (
        <div key={h} className="flex h-9">
          <span className="num w-[52px] shrink-0 -translate-y-1.5 pr-2 text-right text-[11px] text-faint">{String(h).padStart(2, "0")}:00</span>
          <Link href="#lancar" aria-label={`Lançar horas a partir das ${h}:00`} className="flex-1 cursor-copy border-t border-line hover:bg-[#21142C]" />
        </div>
      ))}
      <div className="pointer-events-none absolute top-1.5 right-2.5 bottom-1.5 left-[60px]">
        {blocks
          .filter((b) => b.from < H1 * 60 + 30)
          .map((b) => (
            <div
              key={b.id}
              className="absolute right-[22%] left-0 box-border flex items-center justify-between gap-2 overflow-hidden rounded-lg px-2.5 py-1"
              style={{ top: top(b.from) + 2, height: Math.max(18, top(b.to) - top(b.from) - 4), background: b.color, color: "#1A0F22" }}
            >
              <strong className="truncate text-xs">
                {b.client} · {b.task}
              </strong>
              <span className="num text-[11px] font-bold">{formatMinutes(b.minutes)}</span>
            </div>
          ))}
        {contacts.map((c) => {
          const [hh, mm] = c.time.split(":").map(Number);
          const start = hh * 60 + mm;
          if (start < H0 * 60 || start > H1 * 60) return null;
          return (
            <div
              key={c.id}
              className="absolute right-0 left-[42%] box-border flex items-center justify-between gap-2 overflow-hidden rounded-lg border-[1.5px] bg-surface px-2.5 py-1"
              style={{ top: top(start) + 2, height: ROW * 0.75 - 4, borderColor: c.color, color: c.color }}
            >
              <strong className="truncate text-xs">
                {contactTypeLabel(c.type)} · {c.who}
              </strong>
              <span className="num text-[11px] font-bold">{c.time}</span>
            </div>
          );
        })}
        {nowMinutes >= H0 * 60 && nowMinutes <= H1 * 60 && (
          <div className="absolute right-0 -left-2.5 flex items-center gap-1" style={{ top: top(nowMinutes) }} aria-hidden>
            <span className="size-2 rounded-full bg-accent" />
            <span className="h-0.5 flex-1 bg-accent" />
          </div>
        )}
      </div>
    </div>
  );
}
