import Link from "next/link";
import type { Metadata } from "next";
import { requireTeam } from "@/server/session";
import { getSettings } from "@/server/data/common";
import { ranking, teamProgress, type MonthPoint, type RankCriterion } from "@/server/queries/analytics";
import { resolvePeriod } from "@/domain/period";
import { consultantBand } from "@/domain/rules";
import { monthName, parseISO } from "@/domain/dates";
import { today } from "@/lib/clock";
import { Segmented, cx } from "@/components/ui";
import { Thermometer, GoalLevels } from "@/components/gestao/thermometer";
import { BAND_FILL, BAND_STYLE, BandTrail, PosDelta, hm, initials, param, thousands, withQuery, type SP } from "@/components/time/bits";

export const metadata: Metadata = { title: "Ranking e metas" };

const PERIODS = [
  { value: "mes", label: "Mês" },
  { value: "trimestre", label: "Trimestre" },
  { value: "ano", label: "Ano" },
] as const;
const CRITS = [
  { value: "h", label: "Horas faturáveis" },
  { value: "p", label: "Prazos cumpridos" },
  { value: "c", label: "Contatos" },
] as const;

/** US-48 e US-50: ranking dos consultores e termômetro da meta. Só consultores; nada de R$. */
export default async function RankingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireTeam();
  const sp = await searchParams;
  const t = today();
  const perKey = PERIODS.find((p) => p.value === param(sp, "p"))?.value ?? "mes";
  const crit = (CRITS.find((c) => c.value === param(sp, "crit"))?.value ?? "h") as RankCriterion;
  const period = resolvePeriod({ p: perKey }, t);
  const [settings, rk, team] = await Promise.all([getSettings(), ranking(period, crit, t), teamProgress(period, t)]);
  const rows = rk.rows;
  const sel = rows.find((r) => r.person.id === param(sp, "sel")) ?? rows[0];
  const href = (patch: Record<string, string | null>) => withQuery("/ranking", sp, patch);
  const valTxt = (r: (typeof rows)[number]) => (crit === "h" ? hm(r.fat) : crit === "p" ? (r.pct === null ? "—" : `${r.pct}%`) : `${r.contacts} ${r.contacts === 1 ? "contato" : "contatos"}`);
  const curMonth = monthName(parseISO(t).m);
  const subtitle =
    perKey === "mes"
      ? `${cap(period.label)}, até hoje (dia ${team.elapsed} de ${team.workdays} dias úteis).`
      : perKey === "trimestre"
        ? `${cap(period.label)}. Metas do trimestre = metas do mês × 3.`
        : `${period.label}, até hoje. Metas anuais = metas do mês × 12.`;
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
  const bandHead = perKey === "mes" ? "Faixa do mês" : "Faixa (média mensal)";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="h1">Ranking e metas</h1>
          <p className="text-[15px] text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented options={[...PERIODS]} value={perKey} hrefFor={(v) => href({ p: v === "mes" ? null : v })} />
          <Segmented options={[...CRITS]} value={crit} hrefFor={(v) => href({ crit: v === "h" ? null : v })} />
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-5">
        <section aria-labelledby="term" className="card-strong flex min-w-0 flex-[3_1_560px] flex-col gap-[18px] px-[22px] py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 id="term" className="h3">Horas faturáveis do time</h2>
            {team.incomplete && <span className="text-[13px] font-semibold text-accent-soft">no ritmo atual, {thousands(team.projection / 60)} h {perKey === "mes" ? "no mês" : perKey === "ano" ? "no ano" : "no trimestre"}</span>}
          </div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="num text-[44px] font-bold text-white">{thousands(team.total.fat / 60)}</span>
            <span className="text-[15px] text-muted">h faturáveis de {team.consultants} consultores</span>
          </div>
          <Thermometer minutes={team.total.fat} projection={team.projection} goals={team.goals} size="lg" />
          <GoalLevels minutes={team.total.fat} projection={team.projection} goals={team.goals} />
        </section>

        <section aria-labelledby="pod" className="card flex min-w-0 flex-[2_1_400px] flex-col gap-3.5 px-5 pt-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pod" className="text-base font-bold text-white">Pódio</h2>
            <span className="text-[13px] text-faint">{CRITS.find((c) => c.value === crit)!.label.toLowerCase()}</span>
          </div>
          <div className="flex flex-1 items-end gap-3">
            {podium.map((r) => {
              const first = r.pos === 1;
              const on = sel?.person.id === r.person.id;
              return (
                <Link
                  key={r.person.id}
                  href={href({ sel: r.person.id })}
                  scroll={false}
                  aria-label={`${r.pos}º lugar: ${r.person.name}, ${valTxt(r)}`}
                  aria-current={on ? "true" : undefined}
                  className="flex min-w-0 flex-1 flex-col items-center gap-2.5 no-underline"
                >
                  <span
                    className={cx("flex items-center justify-center rounded-full border-2 bg-line-2 font-extrabold text-white", first ? "h-14 w-14 border-accent text-xl" : "h-[46px] w-[46px] border-line-3 text-base")}
                  >
                    {initials(r.person.name)}
                  </span>
                  <span className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                    <strong className="text-sm whitespace-nowrap !text-white">{r.person.name}</strong>
                    <span className="num text-lg font-bold !text-white">{valTxt(r)}</span>
                  </span>
                  <span
                    className={cx("flex w-full items-start justify-center rounded-t-xl pt-2.5", on ? "outline-2 -outline-offset-2 outline-white" : "")}
                    style={{ height: first ? 120 : r.pos === 2 ? 88 : 64, background: first ? "#F07A45" : r.pos === 2 ? "#3A2550" : "#2A1B37" }}
                  >
                    <span className={cx("font-display text-2xl font-semibold", first ? "!text-on-accent" : "!text-white")}>{r.pos}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="rk" className="flex min-w-0 flex-[3_1_760px] flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 id="rk" className="h2">Classificação · {CRITS.find((c) => c.value === crit)!.label.toLowerCase()}</h2>
            <span className="inline-flex items-center gap-2 text-[13px] text-muted">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              Só horas faturáveis contam para faixas. Valores do bônus não aparecem.
            </span>
          </div>
          <div className="table-wrap">
            <table className="tbl min-w-[980px]">
              <thead>
                <tr>
                  <th scope="col">Pos.</th>
                  <th scope="col">vs {period.prev.label}</th>
                  <th scope="col">Consultor</th>
                  <th scope="col" className={cx(crit === "h" && "!text-white")}>Horas faturáveis</th>
                  <th scope="col" className={cx(crit === "p" && "!text-white")}>Prazos cumpridos</th>
                  <th scope="col" className={cx(crit === "c" && "!text-white")}>Contatos</th>
                  <th scope="col">Trilho da faixa</th>
                  <th scope="col">{bandHead}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = sel?.person.id === r.person.id;
                  const b = consultantBand(r.bandMinutes, settings);
                  const label = perKey === "mes" && b.key === "abaixo" && team.incomplete ? "Rumo à cota" : b.label;
                  return (
                    <tr key={r.person.id} className={cx(on && "bg-surface-3")}>
                      <td className={cx("font-display text-base font-semibold", r.pos <= 3 ? "text-white" : "text-muted")}>{r.pos}º</td>
                      <td>
                        <PosDelta delta={r.prevPos === null ? null : r.prevPos - r.pos} />
                      </td>
                      <td>
                        <Link href={href({ sel: r.person.id })} scroll={false} aria-current={on ? "true" : undefined} className="flex min-h-11 items-center gap-2.5 !text-white no-underline">
                          <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-line-2 text-[11px] font-extrabold", r.pos === 1 ? "border-accent" : "border-line-3")}>{initials(r.person.name)}</span>
                          <span className="flex flex-col">
                            <strong className="whitespace-nowrap">{r.person.name}</strong>
                            {r.lostBonus && <span className="text-xs font-bold text-red">sem bônus no mês</span>}
                          </span>
                        </Link>
                      </td>
                      <td className={cx("num whitespace-nowrap", crit === "h" ? "text-[15px] font-bold text-white" : "text-muted")}>{hm(r.fat)}</td>
                      <td className={cx("num whitespace-nowrap", crit === "p" ? "text-[15px] font-bold text-white" : "text-muted")}>
                        {r.pct === null ? "—" : `${r.pct}%`}
                        {r.dlTotal > 0 && <span className="font-sans text-xs text-faint"> ({r.met} de {r.dlTotal})</span>}
                      </td>
                      <td className={cx("num", crit === "c" ? "text-[15px] font-bold text-white" : "text-muted")}>{r.contacts}</td>
                      <td className="!py-2">
                        <BandTrail minutes={r.bandMinutes} settings={settings} compact />
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", perKey === "mes" && b.key === "abaixo" && team.incomplete ? "bg-line text-muted" : BAND_STYLE[b.key])}>{label}</span>
                          <span className="max-w-[150px] text-xs text-muted">{b.next ? `faltam ${hm(b.missingMinutes)} h para ${b.next.label === "Cota atingida" ? "a cota" : b.next.label}` : "faixa máxima"}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-faint">
            Posição anterior: {period.prev.label}, pelo mesmo critério. Empate desempata por horas faturáveis. &ldquo;Sem bônus no mês&rdquo;: 3 dias úteis seguidos sem apontar e sem justificar em {curMonth}.
          </p>
        </section>

        {sel && <Summary row={sel} settings={settings} t={t} />}
      </div>
    </>
  );
}

function Summary({ row, settings, t }: { row: Awaited<ReturnType<typeof ranking>>["rows"][number]; settings: Awaited<ReturnType<typeof getSettings>>; t: string }) {
  const series = row.series;
  const cur = series.at(-1)!;
  const hist = series.slice(0, -1).reverse().filter((p) => p.exists);
  const proj = cur.m.elapsedWorkdays ? Math.round((cur.m.hours.fat / cur.m.elapsedWorkdays) * cur.m.workdays) : cur.m.hours.fat;
  const pb = consultantBand(proj, settings);
  const b = consultantBand(cur.m.hours.fat, settings);
  const avg = (list: MonthPoint[], f: (p: MonthPoint) => number | null) => {
    const v = list.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
  };
  const metrics: { k: string; f: (p: MonthPoint) => number | null; fmt: (v: number) => string; projV: number | null; better: 1 | -1 }[] = [
    { k: "Horas faturáveis", f: (p) => p.m.hours.fat, fmt: hm, projV: proj, better: 1 },
    { k: "Prazos cumpridos", f: (p) => p.m.pct, fmt: (v) => `${Math.round(v)}%`, projV: null, better: 1 },
    { k: "Contatos", f: (p) => p.m.contacts, fmt: (v) => String(Math.round(v)), projV: cur.m.elapsedWorkdays ? Math.round((cur.m.contacts / cur.m.elapsedWorkdays) * cur.m.workdays) : null, better: 1 },
  ];
  const heads = ["Atual", "Anterior", "Média 3", "Média 6", "Média 12"];
  const last5 = series.slice(-5);
  const maxBar = Math.max(1, ...last5.map((p) => p.m.hours.fat), proj);
  return (
    <aside aria-labelledby="selName" className="flex min-w-0 flex-[1_1_340px] flex-col gap-[18px] rounded-[18px] border border-line-2 bg-surface-2 p-[22px]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-line-2 text-sm font-extrabold text-white">{initials(row.person.name)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="selName" className="font-display text-[19px] font-semibold text-white">{row.person.name}</h2>
          <span className="text-[13px] text-muted">
            {row.pos}º lugar{row.prevPos ? ` · era ${row.prevPos}º` : ""}
          </span>
        </div>
        <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", BAND_STYLE[b.key])}>{b.label}</span>
      </div>
      <p className="rounded-xl border border-line-2 bg-surface-3 px-3.5 py-3 text-sm leading-relaxed">
        {row.lostBonus
          ? `Sem bônus em ${monthName(parseISO(t).m)}: caiu na regra dos 3 dias. `
          : ""}
        No ritmo atual, fecha {monthName(parseISO(t).m)} com cerca de {Math.round(proj / 60)} h faturáveis: {pb.label}.
        {b.next ? ` Faltam ${hm(b.missingMinutes)} h para ${b.next.label === "Cota atingida" ? "a cota" : b.next.label}.` : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[300px] border-collapse text-[13px]">
          <thead>
            <tr className="text-xs text-faint">
              <th scope="col" className="pb-2 text-left" />
              {heads.map((h) => (
                <th key={h} scope="col" className="px-1 pb-2 text-right font-bold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const curV = m.f(cur);
              const cmpV = m.projV ?? curV;
              const refs = [hist[0] ? m.f(hist[0]) : null, avg(hist.slice(0, 3), m.f), avg(hist.slice(0, 6), m.f), avg(hist.slice(0, 12), m.f)];
              return (
                <tr key={m.k} className="border-t border-line-2">
                  <th scope="row" className="py-2.5 pr-1.5 text-left font-semibold text-muted">
                    {m.k}
                  </th>
                  <td className="num px-1 text-right font-bold whitespace-nowrap text-white">
                    {curV === null ? "—" : m.fmt(curV)}
                    {m.projV !== null && <span className="block text-[11px] font-semibold text-accent-soft">proj. {m.fmt(m.projV)}</span>}
                  </td>
                  {refs.map((r, i) => {
                    const tone = r === null || cmpV === null ? "text-muted" : Math.abs(cmpV - r) <= Math.abs(r) * 0.05 ? "text-muted" : (cmpV > r) === (m.better > 0) ? "text-green" : "text-red";
                    return (
                      <td key={i} className={cx("num px-1 text-right", tone)}>
                        {r === null ? "—" : m.fmt(r)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1.5 text-xs text-faint">Verde: a projeção do mês supera a referência. Vermelho: fica abaixo.</p>
      </div>
      <div className="flex flex-col gap-2" aria-label="Horas faturáveis por mês">
        <span className="text-[13px] font-bold text-white">Horas faturáveis por mês</span>
        {last5.map((p) => {
          const isCur = p === cur;
          const k = consultantBand(p.m.hours.fat, settings).key;
          return (
            <div key={p.month} className="flex items-center gap-2.5">
              <span className="w-[104px] shrink-0 text-xs text-muted">{isCur ? `${p.label} (até hoje)` : p.label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full" style={{ width: `${(p.m.hours.fat / maxBar) * 100}%`, background: isCur ? "#F07A45" : BAND_FILL[k] }} />
              </div>
              <span className="num w-12 shrink-0 text-right text-xs font-bold text-white">{hm(p.m.hours.fat)}</span>
            </div>
          );
        })}
      </div>
      <Link href={`/time/${row.person.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-5 font-bold !text-accent-soft no-underline">
        Abrir ficha
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </aside>
  );
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
