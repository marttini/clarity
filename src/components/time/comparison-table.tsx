import Link from "next/link";
import type { Comparison, MetricKey } from "@/server/queries/analytics";
import { cx } from "@/components/ui";
import { CompareBadge, CompareLegend, hm } from "./bits";

export function fmtMetric(kind: "h" | "n" | "pct", v: number | null): string {
  if (v === null) return "—";
  if (kind === "h") return hm(v);
  if (kind === "pct") return `${Math.round(v)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
}

/** Tabela de comparação da ficha (US-33): cada número contra mês anterior e médias de 3, 6 e 12 meses. */
export function ComparisonTable({ cmp, selected, hrefFor, title }: { cmp: Comparison; selected: MetricKey; hrefFor: (k: MetricKey) => string; title: string }) {
  return (
    <section aria-labelledby="h-cmp" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="h-cmp" className="h2">{title}</h2>
        <CompareLegend />
      </div>
      <p className="max-w-[980px] text-sm leading-relaxed text-muted">{cmp.note}</p>
      <div className="table-wrap">
        <table className="tbl min-w-[1080px]">
          <thead>
            <tr>
              <th scope="col">Indicador</th>
              <th scope="col" className="bg-surface-3 !text-white">{cmp.curHead}</th>
              {cmp.projHead && <th scope="col" className="bg-surface-3 !text-accent-soft">{cmp.projHead}</th>}
              {cmp.heads.map((h) => (
                <th key={h} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => {
              const on = r.key === selected;
              const href = hrefFor(r.key);
              return (
                <tr key={r.key} className={cx(on && "bg-[#21142c]")}>
                  <th scope="row" className="!px-2 !py-1 text-left">
                    <Link
                      href={href}
                      scroll={false}
                      aria-current={on ? "true" : undefined}
                      className={cx("flex min-h-10 flex-wrap items-baseline gap-1 rounded-lg px-2 text-sm no-underline", on ? "font-extrabold !text-white" : "font-semibold !text-ink")}
                    >
                      {r.label}
                      {r.hint && <span className="text-xs font-medium text-faint">· {r.hint}</span>}
                    </Link>
                  </th>
                  <td className="bg-surface-3 !py-1">
                    <Link href={href} scroll={false} className="num inline-flex min-h-10 items-center px-2 text-[15px] font-bold !text-white no-underline">
                      {fmtMetric(r.kind, r.current)}
                    </Link>
                  </td>
                  {cmp.projHead && (
                    <td className="bg-surface-3 !py-1">
                      <span className={cx("num inline-flex min-h-10 items-center px-2 text-[15px] font-bold", r.projection !== null ? "text-accent-soft" : "text-faint")}>
                        {r.projection !== null ? fmtMetric(r.kind, r.projection) : "—"}
                      </span>
                    </td>
                  )}
                  {r.cols.map((c, i) => (
                    <td key={i} className="!py-1">
                      <span
                        className="inline-flex min-h-10 items-center gap-2.5 px-2"
                        aria-label={`${cmp.heads[i]}: ${fmtMetric(r.kind, c.ref)}. Atual ${c.verdict}${c.deltaText ? ` (${c.deltaText})` : ""}.`}
                      >
                        <span className="num text-sm">{fmtMetric(r.kind, c.ref)}</span>
                        {c.ref !== null && <CompareBadge verdict={c.verdict} text={c.deltaText} />}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
