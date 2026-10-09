import Link from "next/link";
import type { ReactNode } from "react";
import { consultantBand, dayColor, type BandKey, type DayColor, type Settings } from "@/domain/rules";
import { formatMinutes } from "@/domain/dates";
import { cx } from "@/components/ui";

/** Cores das faixas (V3). Nunca mostram R$. */
export const BAND_STYLE: Record<BandKey, string> = {
  abaixo: "bg-red-bg text-red",
  cota: "bg-line-2 text-[#e6d9f2]",
  faixa1: "bg-blue-bg text-blue",
  faixa2: "bg-green-bg text-green",
  faixa3: "bg-[#3a1e12] text-accent-soft",
};
export const BAND_FILL: Record<BandKey, string> = {
  abaixo: "#7A6A8C",
  cota: "#B6A7C6",
  faixa1: "#63BDEB",
  faixa2: "#6CCB98",
  faixa3: "#F07A45",
};

export function BandChip({ minutes, settings, prefix, className }: { minutes: number; settings: Settings; prefix?: string; className?: string }) {
  const b = consultantBand(minutes, settings);
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", BAND_STYLE[b.key], className)}>
      {prefix}
      {b.label}
      {b.extra ? " + extra" : ""}
    </span>
  );
}

/** "faltam 12:30 h para Faixa 2" */
export function nextBandText(minutes: number, settings: Settings): string {
  const b = consultantBand(minutes, settings);
  if (!b.next) return "acima do bônus extra";
  return `faltam ${formatMinutes(b.missingMinutes)} h para ${b.next.label === "Cota atingida" ? "a cota" : b.next.label} (${b.next.hours} h)`;
}

export const DAY_BG: Record<DayColor, string> = {
  vermelho: "bg-day-red",
  amarelo: "bg-day-yellow",
  azul: "bg-day-blue",
  verde: "bg-day-green",
};
export const DAY_LABEL: Record<DayColor, string> = {
  vermelho: "sem horas",
  amarelo: "até 4 h",
  azul: "4 a 6 h",
  verde: "acima de 6 h",
};

export function DayDot({ minutes, size = 10, title }: { minutes: number; size?: number; title?: string }) {
  const c = dayColor(minutes);
  return <span role="img" aria-label={title ?? `Média ${DAY_LABEL[c]}`} className={cx("inline-block shrink-0 rounded-[3px]", DAY_BG[c])} style={{ width: size, height: size }} />;
}

export function DayLegend({ provisioned }: { provisioned?: boolean }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {(Object.keys(DAY_LABEL) as DayColor[]).map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className={cx("inline-block h-2.5 w-2.5 rounded-[3px]", DAY_BG[c])} />
          {DAY_LABEL[c]}
        </span>
      ))}
      {provisioned && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-dashed border-accent" />
          provisionado
        </span>
      )}
    </div>
  );
}

const SCALE_H = 260;

/**
 * Trilho de faixa do consultor (60/90/140/175/240 h), só horas Faturáveis.
 * `projection` desenha a projeção do mês com borda tracejada.
 */
export function BandTrail({ minutes, projection, settings, compact }: { minutes: number; projection?: number | null; settings: Settings; compact?: boolean }) {
  const b = settings.bands;
  const marks = [
    { v: b.quota, label: compact ? String(b.quota) : `Cota ${b.quota}` },
    { v: b.band1, label: compact ? String(b.band1) : `Faixa 1 · ${b.band1}` },
    { v: b.band2, label: compact ? String(b.band2) : `Faixa 2 · ${b.band2}` },
    { v: b.band3, label: compact ? String(b.band3) : `Faixa 3 · ${b.band3}` },
    { v: b.extra, label: compact ? String(b.extra) : `Extra · ${b.extra}` },
  ];
  const scale = Math.max(SCALE_H, b.extra + 20);
  const pc = (min: number) => Math.min(100, (min / 60 / scale) * 100);
  const key = consultantBand(minutes, settings).key;
  return (
    <div className={cx("relative", compact ? "h-[38px] w-[230px]" : "h-11 w-full")} aria-hidden>
      <div className={cx("absolute inset-x-0 rounded-full bg-line-2", compact ? "top-[9px] h-1.5" : "top-2 h-2.5")} />
      {projection != null && projection > minutes && (
        <div className="absolute top-1 left-0 h-[18px] rounded-full border-[1.5px] border-dashed border-accent-soft" style={{ width: `${pc(projection)}%` }} />
      )}
      <div
        className={cx("absolute left-0 rounded-full", compact ? "top-[9px] h-1.5" : "top-2 h-2.5")}
        style={{ width: `${pc(minutes)}%`, background: compact ? BAND_FILL[key] : "#F07A45" }}
      />
      {compact && (
        <div
          className="absolute top-[5px] h-3.5 w-3.5 -ml-[7px] rounded-full border-[3px] bg-white"
          style={{ left: `${pc(minutes)}%`, borderColor: BAND_FILL[key] }}
        />
      )}
      {marks.map((m) => (
        <div key={m.v} className={cx("absolute flex -translate-x-1/2 flex-col items-center gap-0.5", compact ? "top-[6px]" : "top-1")} style={{ left: `${(m.v / scale) * 100}%` }}>
          <span className={cx(compact ? "h-2.5 w-px bg-line-5" : "h-4 w-0.5 bg-muted")} />
          {compact ? (
            <span className="num text-[11px] whitespace-nowrap text-faint">{m.label}</span>
          ) : (
            <span className="text-[11px] font-semibold whitespace-nowrap text-muted">
              <span className="hidden md:inline">{m.label}</span>
              <span className="num md:hidden">{m.v}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Seta e variação de uma comparação. Verde = melhor, vermelho = pior, cinza = parecido ou sem juízo. */
export function CompareBadge({ verdict, text }: { verdict: string; text: string }) {
  if (verdict === "sem base") return <span className="text-xs text-faint">sem base</span>;
  const good = verdict === "melhor";
  const bad = verdict === "pior";
  const eq = verdict === "parecido";
  const up = !eq && text.trim().startsWith("+");
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-xs font-bold whitespace-nowrap",
        good ? "bg-green-bg text-green" : bad ? "bg-red-bg text-red" : "bg-line text-muted",
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={eq ? "M6 12h12" : up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} />
      </svg>
      {text}
    </span>
  );
}

export function CompareLegend() {
  return (
    <div className="flex flex-wrap gap-3.5 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8FD3AE" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 19V5M6 11l6-6 6 6" />
        </svg>
        melhor que a referência
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF8A80" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
        pior que a referência
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B6A7C6" strokeWidth="2.8" strokeLinecap="round" aria-hidden>
          <path d="M6 12h12" />
        </svg>
        parecido (até 5%) ou sem juízo
      </span>
    </div>
  );
}

/** Variação de posição no ranking (SVG, nunca seta unicode). */
export function PosDelta({ delta, size = 14 }: { delta: number | null; size?: number }) {
  if (delta === null) return <span className="text-xs text-faint">novo</span>;
  const label = delta > 0 ? `Subiu ${delta}` : delta < 0 ? `Desceu ${-delta}` : "Manteve a posição";
  return (
    <span role="img" aria-label={label} className={cx("num inline-flex items-center gap-1 font-bold", delta > 0 ? "text-green" : delta < 0 ? "text-red" : "text-faint")} style={{ fontSize: size - 1 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={delta > 0 ? "M12 19V5M6 11l6-6 6 6" : delta < 0 ? "M12 5v14M6 13l6 6 6-6" : "M6 12h12"} />
      </svg>
      {delta !== 0 ? Math.abs(delta) : ""}
    </span>
  );
}

/** Cabeçalho de coluna ordenável (link que troca ?ordem e ?dir). */
export function SortTh({ label, col, current, dir, hrefFor, className }: { label: ReactNode; col: string; current: string; dir: "asc" | "desc"; hrefFor: (col: string, dir: "asc" | "desc") => string; className?: string }) {
  const on = current === col;
  const nextDir = on ? (dir === "desc" ? "asc" : "desc") : "desc";
  return (
    <th scope="col" aria-sort={on ? (dir === "desc" ? "descending" : "ascending") : "none"} className={cx("!px-0.5 !py-1", className)}>
      <Link
        href={hrefFor(col, nextDir)}
        scroll={false}
        className={cx("inline-flex min-h-[38px] items-center gap-1 rounded-lg px-2 text-xs font-bold whitespace-nowrap no-underline", on ? "bg-line-2 !text-white" : "!text-faint hover:!text-white")}
      >
        {label}
        {on && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={dir === "desc" ? "M12 5v14M6 13l6 6 6-6" : "M12 19V5M6 11l6-6 6 6"} />
          </svg>
        )}
      </Link>
    </th>
  );
}

/** Monta um href preservando a query atual. */
export function withQuery(path: string, current: Record<string, string | string[] | undefined>, patch: Record<string, string | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (typeof v === "string") q.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function hm(min: number) {
  return formatMinutes(min);
}

/** Horas com milhar: 1.390 */
export function thousands(n: number) {
  return Math.round(n).toLocaleString("pt-BR");
}

export const TYPE_COLOR: Record<string, string> = { fat: "#F07A45", bon: "#63BDEB", int: "#9C93AE", outro: "#A897F5" };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : (parts[0]?.[1] ?? ""))).toUpperCase();
}

export type SP = Record<string, string | string[] | undefined>;
export function param(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}
