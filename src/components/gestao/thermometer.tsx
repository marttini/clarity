import { cx } from "@/components/ui";
import { thousands } from "@/components/time/bits";

const SHORT: Record<string, string> = { MetaMonkey: "Monkey", MetaCrazyMonkey: "Crazy" };

/** Termômetro da meta da equipe (US-50): faixas Cota, Meta, MetaMonkey e MetaCrazyMonkey, realizado e projeção. */
export function Thermometer({ minutes, projection, goals, size = "md" }: { minutes: number; projection: number; goals: { name: string; minutes: number }[]; size?: "md" | "lg" | "tv" }) {
  const max = Math.max(1, ...goals.map((g) => g.minutes));
  const pc = (v: number) => Math.min(100, (v / max) * 100);
  const tv = size === "tv";
  const bar = tv ? "h-4" : size === "lg" ? "h-3" : "h-2";
  return (
    <div className={cx("relative", tv ? "mx-1 h-[74px]" : size === "lg" ? "mx-1 h-[66px]" : "h-10")} role="img" aria-label={`Realizado ${thousands(minutes / 60)} h; projeção ${thousands(projection / 60)} h; ${goals.map((g) => `${g.name} ${thousands(g.minutes / 60)} h`).join(", ")}.`}>
      <div className={cx("absolute inset-x-0 top-1 rounded-full bg-line-2", bar)} />
      {projection > minutes && <div className={cx("absolute top-1 left-0 rounded-full bg-[#5a3a40]", bar)} style={{ width: `${pc(projection)}%` }} />}
      <div className={cx("absolute top-1 left-0 rounded-full bg-accent", bar)} style={{ width: `${pc(minutes)}%` }} />
      {goals.map((g, i) => {
        const last = i === goals.length - 1;
        return (
          <div
            key={g.name}
            className={cx("absolute top-0 flex flex-col gap-1", last ? "-translate-x-full items-end" : "-translate-x-1/2 items-center")}
            style={{ left: `${pc(g.minutes)}%` }}
          >
            <span className={cx("bg-muted", tv ? "h-6 w-[3px]" : size === "lg" ? "h-5 w-0.5" : "h-3 w-0.5")} />
            <span className={cx("flex-col whitespace-nowrap text-muted", tv ? "flex" : "hidden md:flex", last ? "items-end" : "items-center", tv ? "text-xl leading-tight" : "text-xs leading-tight", size === "md" && "md:flex-row gap-1 text-[11px]")}>
              <span className="font-bold text-ink">{SHORT[g.name] ?? g.name}</span>
              <span className="num">{thousands(g.minutes / 60)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Situação de cada faixa da equipe: batida, no ritmo para bater ou quanto falta. */
export function GoalLevels({ minutes, projection, goals }: { minutes: number; projection: number; goals: { name: string; minutes: number }[] }) {
  return (
    <div className="flex flex-wrap border-t border-line-2">
      {goals.map((g) => {
        const missing = Math.max(0, g.minutes - minutes);
        const st =
          minutes >= g.minutes
            ? { t: "batida", c: "text-green" }
            : projection >= g.minutes
              ? { t: `no ritmo para bater (faltam ${thousands(missing / 60)} h)`, c: "text-yellow" }
              : { t: `faltam ${thousands(missing / 60)} h; no ritmo, fica ${thousands((g.minutes - projection) / 60)} h abaixo`, c: "text-muted" };
        return (
          <div key={g.name} className="flex min-w-0 flex-[1_1_140px] flex-col gap-0.5 pt-3 pr-3">
            <span className="text-[13px] font-bold text-white">
              {g.name} <span className="num font-semibold text-muted">{thousands(g.minutes / 60)} h</span>
            </span>
            <span className={cx("text-xs leading-snug", st.c)}>{st.t}</span>
          </div>
        );
      })}
    </div>
  );
}
