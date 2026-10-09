import Link from "next/link";
import type { Settings } from "@/domain/rules";
import { consultantBand } from "@/domain/rules";
import { cx } from "@/components/ui";
import { fmtMetric } from "./comparison-table";

export type ChartBar = { key: string; label: string; aria: string; value: number | null; projection?: number | null; href: string; selected: boolean; current: boolean };

/** Gráfico de 12 meses de um indicador (US-33). Em horas faturáveis, mostra as linhas das faixas. */
export function MonthChart({ bars, kind, isFat, settings }: { bars: ChartBar[]; kind: "h" | "n" | "pct"; isFat: boolean; settings: Settings }) {
  const AH = 200;
  const vals = bars.flatMap((b) => [b.value ?? 0, b.projection ?? 0]);
  const top = isFat ? Math.max((settings.bands.extra + 20) * 60, ...vals) : Math.max(1, ...vals) * 1.2;
  const b = settings.bands;
  const lines = isFat
    ? [
        { v: b.quota, label: `Cota ${b.quota}`, strong: true },
        { v: b.band1, label: `Faixa 1 · ${b.band1}` },
        { v: b.band2, label: `Faixa 2 · ${b.band2}` },
        { v: b.band3, label: `Faixa 3 · ${b.band3}` },
        { v: b.extra, label: `Extra · ${b.extra}` },
      ]
    : [];
  return (
    <div className="overflow-x-auto">
      <div className="relative h-[250px] min-w-[600px]">
        {lines.map((l) => (
          <div
            key={l.v}
            className={cx("absolute inset-x-0 flex justify-end border-t-[1.5px] border-dashed", l.strong ? "border-accent" : "border-line-5")}
            style={{ bottom: Math.round(((l.v * 60) / top) * AH) + 20 }}
            aria-hidden
          >
            <span className={cx("-translate-y-1/2 bg-surface pl-1.5 text-[11px] font-bold whitespace-nowrap", l.strong ? "text-accent-soft" : "text-muted")}>{l.label}</span>
          </div>
        ))}
        <div className={cx("absolute inset-y-0 left-0 flex items-end gap-2", isFat ? "right-[92px]" : "right-0")}>
          {bars.map((bar) => {
            const h = bar.value === null ? 0 : Math.round((bar.value / top) * AH);
            const gh = bar.projection ? Math.round((bar.projection / top) * AH) : 0;
            const col = isFat ? ((bar.value ?? 0) >= b.quota * 60 || bar.current ? "#F07A45" : "#8E6BB0") : "#A897F5";
            return (
              <Link
                key={bar.key}
                href={bar.href}
                scroll={false}
                aria-label={bar.aria}
                aria-current={bar.selected ? "true" : undefined}
                className={cx("flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg pt-1 no-underline", bar.selected && "bg-[#21142c]")}
              >
                <span className="num text-[11px] whitespace-nowrap text-muted">{fmtMetric(kind, bar.value)}</span>
                <span className="relative block w-[70%]" style={{ height: AH }}>
                  {gh > h && <span className="absolute inset-x-0 bottom-0 rounded-t-md border-[1.5px] border-dashed border-accent-soft" style={{ height: gh }} />}
                  <span
                    className={cx("absolute inset-x-0 bottom-0 rounded-t-md", bar.selected && "outline-2 outline-offset-2 outline-white")}
                    style={{ height: Math.max(2, h), background: col }}
                  />
                </span>
                <span className={cx("text-xs", bar.current ? "font-extrabold text-accent-soft" : "font-semibold text-muted")}>{bar.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function bandLabel(minutes: number, settings: Settings) {
  return consultantBand(minutes, settings).label;
}
