"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { PERIOD_OPTIONS, type PeriodKey } from "@/domain/period";
import { cx } from "./ui";

/** Seletor de período que preserva os outros filtros da URL. */
export function PeriodSelector({ value, from, to }: { value: PeriodKey; from: string; to: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const href = (p: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(sp.toString());
    q.set("p", p);
    if (p !== "personalizado") {
      q.delete("de");
      q.delete("ate");
    }
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `${path}?${q.toString()}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Período" className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-surface-2 p-[3px]">
        {PERIOD_OPTIONS.map((o) => (
          <Link
            key={o.value}
            role="tab"
            aria-selected={o.value === value}
            href={href(o.value, o.value === "personalizado" ? { de: from, ate: to } : {})}
            scroll={false}
            className={cx("inline-flex min-h-10 items-center rounded-lg px-3 text-[13px] font-bold no-underline", o.value === value ? "bg-line-2 text-white" : "text-muted hover:text-white")}
          >
            {o.label}
          </Link>
        ))}
      </div>
      {value === "personalizado" && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            router.push(href("personalizado", { de: String(f.get("de")), ate: String(f.get("ate")) }), { scroll: false });
          }}
        >
          <label className="sr-only" htmlFor="de">De</label>
          <input id="de" name="de" type="date" defaultValue={from} className="field min-h-9 w-auto py-1 text-sm" />
          <span className="text-faint">a</span>
          <label className="sr-only" htmlFor="ate">Até</label>
          <input id="ate" name="ate" type="date" defaultValue={to} className="field min-h-9 w-auto py-1 text-sm" />
          <button className="btn-ghost min-h-9 text-sm">Aplicar</button>
        </form>
      )}
    </div>
  );
}
