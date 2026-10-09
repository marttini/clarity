import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui";
import { diffDays, formatMinutes, parseISO, shortDate, weekdayShort, type ISODate } from "@/domain/dates";
import { consultantBand, dayColor, type Settings } from "@/domain/rules";
import { StageSegs, TagChip } from "@/components/projetos/bits";

/** Peças da Minha fila (V3 Fila.dc.html). Só apresentação. */

export const DAY_HEX = { vermelho: "#E0453A", amarelo: "#E9B320", azul: "#3B86C9", verde: "#3FA06C" } as const;
export const dayHex = (min: number) => DAY_HEX[dayColor(min)];

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "7/out" */
export function dayMonth(d: ISODate) {
  const { m, day } = parseISO(d);
  return `${day}/${MONTH_SHORT[m - 1]}`;
}

export function CountPill({ n, tone }: { n: number; tone: "red" | "yellow" | "neutral" | "blue" }) {
  const cls = { red: "bg-day-red text-on-accent", yellow: "bg-day-yellow text-on-accent", neutral: "bg-line-2 text-[#e6d9f2]", blue: "bg-blue-bg text-blue" }[tone];
  return <span className={cx("inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px] text-xs font-bold", cls)}>{n}</span>;
}

export function Legend() {
  const sw = (bg: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: bg }} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-3.5 text-xs text-muted">
      {sw(DAY_HEX.vermelho, "sem horas")}
      {sw(DAY_HEX.amarelo, "até 4 h")}
      {sw(DAY_HEX.azul, "4 a 6 h")}
      {sw(DAY_HEX.verde, "acima de 6 h")}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="box-border size-2.5 rounded-[3px] border-[1.5px] border-dashed border-accent" />
        provisionado
      </span>
    </div>
  );
}

export type RulerDayView = { date: ISODate; minutes: number; prov: number; holiday: string | null; justified: boolean; isToday: boolean; future: boolean };

/** Régua do mês: dias de semana com a cor do dia, feriado, hoje, futuros e provisionados (US-06). */
export function MonthRuler({ days }: { days: RulerDayView[] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <ol className="m-0 grid min-w-[760px] list-none gap-1.5 p-0" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          let slot: CSSProperties = { background: "#1E1229" };
          let bar: CSSProperties = { height: 0 };
          let label = "";
          let aria = "";
          if (d.holiday) {
            slot = { background: "repeating-linear-gradient(135deg, #1E1229 0 6px, #2A1B37 6px 12px)" };
            label = "feriado";
            aria = `feriado (${d.holiday})`;
          } else if (d.future || (d.isToday && d.minutes === 0)) {
            if (d.prov > 0) {
              slot = { background: "#1C1018", border: "1.5px dashed #F07A45" };
              bar = { height: 22, background: "#5A2E1C" };
              label = formatMinutes(d.prov);
              aria = `${formatMinutes(d.prov)} h provisionadas`;
            } else aria = d.isToday ? "hoje, sem horas ainda" : "dia futuro";
          } else if (d.justified && d.minutes === 0) {
            slot = { background: "#15301F" };
            label = "justif.";
            aria = "dia justificado";
          } else {
            bar = { height: d.minutes === 0 ? 56 : Math.max(8, Math.min(56, (d.minutes / 600) * 56)), background: dayHex(d.minutes) };
            label = formatMinutes(d.minutes);
            aria = d.minutes ? `${formatMinutes(d.minutes)} h` : "sem horas";
          }
          if (d.isToday) slot = { ...slot, outline: "2px solid #FFFFFF", outlineOffset: 2 };
          return (
            <li key={d.date} className="flex min-w-0 flex-col items-center gap-[5px]">
              <span className="text-[11px] text-faint">{weekdayShort(d.date)}</span>
              <Link
                href={`/horas?v=dia&d=${d.date}`}
                aria-label={`${shortDate(d.date)}: ${aria}`}
                className="box-border flex h-14 w-full items-end overflow-hidden rounded-[7px] no-underline"
                style={slot}
              >
                <span className="block w-full" style={bar} />
              </Link>
              <span className={cx("text-[13px]", d.isToday ? "font-extrabold text-accent" : "font-semibold text-ink")}>{parseISO(d.date).day}</span>
              <span className={cx("num text-[11px]", d.justified && !d.minutes ? "text-green" : "text-muted")}>{label || " "}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Trilho da faixa (US-50): só Faturável, marcas 60/90/140/175/240 e quanto falta. */
export function BandRail({ fatMinutes, settings }: { fatMinutes: number; settings: Settings }) {
  const b = settings.bands;
  const max = b.extra + 20;
  const pct = (h: number) => Math.min(100, (h / max) * 100);
  const band = consultantBand(fatMinutes, settings);
  const marks: [string, number][] = [
    [`Cota ${b.quota}`, b.quota],
    [`Faixa 1 · ${b.band1}`, b.band1],
    [`Faixa 2 · ${b.band2}`, b.band2],
    [`Faixa 3 · ${b.band3}`, b.band3],
    [`Extra · ${b.extra}`, b.extra],
  ];
  const nextName = band.next ? (band.next.label === "Cota atingida" ? "a cota" : band.next.label === "Bônus extra" ? "o bônus extra" : `a ${band.next.label}`) : null;
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted">
        <span>
          <strong className="num text-lg text-white">{formatMinutes(fatMinutes)} h</strong> faturáveis no mês
        </span>
        <span>
          {band.next ? (
            <>
              Faltam <strong className="num text-white">{formatMinutes(band.missingMinutes)} h</strong> para {nextName} de {band.next.hours} h
            </>
          ) : (
            "Acima do bônus extra"
          )}
        </span>
      </div>
      <div className="relative h-[34px]" role="img" aria-label={`${formatMinutes(fatMinutes)} horas faturáveis; ${band.label}`}>
        <div className="absolute inset-x-0 top-1.5 h-2 rounded-full bg-line-2" />
        <div className="absolute top-1.5 left-0 h-2 rounded-full bg-accent" style={{ width: `${pct(fatMinutes / 60)}%` }} />
        {marks.map(([label, v], i) => (
          <div
            key={label}
            className={cx("absolute top-0.5 flex -translate-x-1/2 flex-col items-center gap-0.5", i % 2 === 1 && "max-sm:[&>span:last-child]:hidden")}
            style={{ left: `${pct(v)}%` }}
          >
            <span className="h-3.5 w-0.5 bg-muted" />
            <span className="text-[11px] font-semibold whitespace-nowrap text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Semana atual no cabeçalho: horas por dia com a barra da cor. */
export function WeekStrip({ days }: { days: { date: ISODate; minutes: number; isToday: boolean; future: boolean; holiday: boolean }[] }) {
  return (
    <ol aria-label="Semana" className="m-0 flex list-none gap-1.5 p-0">
      {days.map((d) => (
        <li key={d.date}>
          <Link
            href={`/horas?v=dia&d=${d.date}`}
            className={cx("flex w-14 flex-col items-center gap-[3px] rounded-[10px] border pt-[7px] pb-2 no-underline", d.isToday ? "border-accent bg-[#24142F]" : "border-line-2 bg-surface")}
          >
            <span className="text-[11px] text-muted">{weekdayShort(d.date)}</span>
            <span className="num text-[13px] font-bold text-white">{d.future || d.holiday ? "–" : formatMinutes(d.minutes)}</span>
            <span aria-hidden className="h-1 w-7 rounded-full" style={{ background: d.future || d.holiday ? "#2A1B37" : dayHex(d.minutes) }} />
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function dueText(deadline: ISODate | null, today: ISODate): { text: string; tone: "red" | "yellow" | "muted" } {
  if (!deadline) return { text: "sem prazo", tone: "muted" };
  const d = diffDays(deadline, today);
  if (d < -1) return { text: `venceu há ${-d} dias`, tone: "red" };
  if (d === -1) return { text: "venceu ontem", tone: "red" };
  if (d === 0) return { text: "hoje", tone: "yellow" };
  if (d === 1) return { text: "amanhã", tone: "muted" };
  return { text: shortDate(deadline), tone: "muted" };
}

export type RowItem = {
  id: string;
  name: string;
  path: string;
  stage: string;
  deadline: ISODate | null;
  clientName: string;
  clientColor: string;
  outOfScope: boolean;
  clientApproval: string;
  isSustentacao: boolean;
  tags: { name: string; color: string }[];
};

/** Linha de item da fila: chip do cliente, título e caminho, marcadores, etapa em 5 segmentos e prazo. */
export function QueueRow({ it, today, extra }: { it: RowItem; today: ISODate; extra?: ReactNode }) {
  const due = dueText(it.deadline, today);
  return (
    <Link href={`/projetos/${it.id}`} className="flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-line px-1 py-2.5 text-ink no-underline hover:bg-surface">
      <span className="shrink-0 rounded-md px-[9px] py-1 text-xs font-extrabold" style={{ background: it.clientColor, color: "#1A0F22" }}>
        {it.clientName}
      </span>
      <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{it.name}</span>
        <span className="text-xs text-faint">{it.path}</span>
        {extra}
      </span>
      <span className="flex flex-wrap gap-1">
        {it.tags.map((t) => (
          <TagChip key={t.name} name={t.name} color={t.color} />
        ))}
        {it.isSustentacao && <span className="rounded-full bg-blue-bg px-[9px] py-[3px] text-xs font-bold text-blue">Sustentação</span>}
        {it.outOfScope && (
          <span className={cx("rounded-full px-[9px] py-[3px] text-xs font-bold", it.clientApproval === "aguardando" ? "bg-yellow-bg text-yellow" : "bg-[#3A1E12] text-accent-soft")}>
            {it.clientApproval === "aguardando" ? "Demanda aguardando cliente" : "Demanda adicional"}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3.5">
        <StageSegs stage={it.stage} />
        <span className={cx("w-[104px] text-right text-xs font-bold", due.tone === "red" ? "text-red" : due.tone === "yellow" ? "text-yellow" : "text-muted")}>{due.text}</span>
      </span>
    </Link>
  );
}

export function GroupTitle({ title, n, tone, id }: { title: string; n: number; tone: "red" | "yellow" | "neutral" | "blue"; id?: string }) {
  return (
    <h2 id={id} className="m-0 mb-1.5 flex items-center gap-2.5 text-base font-bold text-white">
      {title}
      <CountPill n={n} tone={tone} />
    </h2>
  );
}

/** Ícone do tipo de contato (V3 Administrativo). */
export function ContactIcon({ type, done }: { type: string; done?: boolean }) {
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const icon =
    type === "whatsapp" ? (
      <svg {...p}>
        <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" />
      </svg>
    ) : type === "email" ? (
      <svg {...p}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    ) : type === "reuniao_online" ? (
      <svg {...p}>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3" />
      </svg>
    ) : type === "visita" ? (
      <svg {...p}>
        <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ) : (
      <svg {...p}>
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
      </svg>
    );
  return <span className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]", done ? "bg-green-bg text-green" : "bg-line-2 text-[#e6d9f2]")}>{icon}</span>;
}

export function WarnIcon({ color = "#FF8A80" }: { color?: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 text-[13px] text-faint">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5h.01" />
      </svg>
      {children}
    </p>
  );
}
