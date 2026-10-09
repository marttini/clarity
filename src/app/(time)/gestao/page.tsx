import Link from "next/link";
import type { Metadata } from "next";
import { requireTeam, isManager } from "@/server/session";
import { getClients, getSettings, STAGES } from "@/server/data/common";
import { groupTypes, managementCounts, projectsByStage, sumHours, teamProgress, workload } from "@/server/queries/analytics";
import { resolvePeriod } from "@/domain/period";
import { longDate, shortDate } from "@/domain/dates";
import { now, today } from "@/lib/clock";
import { PeriodSelector } from "@/components/period";
import { cx } from "@/components/ui";
import { GoalLevels, Thermometer } from "@/components/gestao/thermometer";
import { PortfolioTable } from "@/components/gestao/portfolio-table";
import { WorkloadTable, sortWorkload } from "@/components/time/workload-table";
import { TYPE_COLOR, hm, param, thousands, withQuery, type SP } from "@/components/time/bits";

export const metadata: Metadata = { title: "A Síntese hoje" };

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "vermelho", label: "Só vermelhos" },
  { key: "contato", label: "Sem contato" },
  { key: "aguardando", label: "Aguardando cliente" },
  { key: "inativos", label: "Inativos" },
] as const;

/** US-47: resumo da gestão. Tela inicial de Marttini, Richard e Luiz. */
export default async function ManagementPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireTeam();
  if (!isManager(me)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="h1">A Síntese hoje</h1>
        <p className="text-muted">
          Esta tela é da gestão. A carga do time está em <Link href="/time">Time</Link> e as metas em <Link href="/ranking">Ranking</Link>.
        </p>
      </div>
    );
  }
  const sp = await searchParams;
  const t = today();
  const nowAt = now();
  const period = resolvePeriod({ p: param(sp, "p"), de: param(sp, "de"), ate: param(sp, "ate") }, t);
  const filter = FILTERS.find((f) => f.key === param(sp, "carteira"))?.key ?? "todos";
  const [settings, clients, team, counts, stages, wl] = await Promise.all([
    getSettings(),
    getClients(),
    teamProgress(period, t),
    managementCounts(t, nowAt),
    projectsByStage(),
    workload(period, t, nowAt),
  ]);
  const clientMap = new Map(clients.map((c) => [c.id, { name: c.name, color: c.color }]));
  const fat = team.total.fat;
  const next = team.goals.find((g) => fat < g.minutes) ?? team.goals.at(-1)!;
  const reachedProj = [...team.goals].reverse().find((g) => team.projection >= g.minutes);
  const maxDay = Math.max(1, ...team.days.map((d) => d.fat));
  const dailyGoal = team.goals[0] ? team.goals[0].minutes / Math.max(1, team.workdays) : 0;

  // Horas por tipo e sustentação x desenvolvimento no período (equipe toda).
  const pRows = wl.act.rows.filter((r) => r.date >= period.from && r.date <= period.to);
  const types = groupTypes(pRows, wl.act.kinds);
  const tot = sumHours(pRows, wl.act.kinds);
  const susPct = tot.sust + tot.dev ? Math.round((tot.sust / (tot.sust + tot.dev)) * 100) : 0;

  // Precisa de você.
  const red = counts.portfolio.filter((c) => c.health === "vermelho");
  const near = counts.report.filter((r) => r.currentStreak > 0).sort((a, b) => b.currentStreak - a.currentStreak);
  const oldest = counts.demands[0];
  const syncN = counts.sync.entries.length + counts.sync.items.length;
  const attention = [
    red.length && { n: red.length, tone: "red", what: red.length === 1 ? "Cliente no vermelho" : "Clientes no vermelho", detail: red.slice(0, 3).map((c) => c.name).join(", ") + (red.length > 3 ? "..." : ""), action: "Ver", href: withQuery("/gestao", sp, { carteira: "vermelho" }) + "#carteira" },
    counts.changes.length && { n: counts.changes.length, tone: "accent", what: "Pedidos de alteração de horas", detail: me.canApproveHours ? "aguardam você ou o outro aprovador" : "aguardam Marttini ou Richard", action: "Revisar", href: "/gestao/pendencias" },
    counts.demands.length && { n: counts.demands.length, tone: "yellow", what: "Demandas adicionais com o cliente", detail: oldest ? `a mais antiga parada há ${oldest.days} ${oldest.days === 1 ? "dia" : "dias"}` : "", action: "Cobrar", href: "/gestao/pendencias?aba=demandas" },
    near.length && {
      n: near.length,
      tone: near.some((r) => r.currentStreak >= settings.missingDaysLimit) ? "red" : "neutral",
      what: near.some((r) => r.currentStreak >= settings.missingDaysLimit) ? "Consultor na regra dos 3 dias" : "Consultor perto da regra dos 3 dias",
      detail: near
        .slice(0, 2)
        .map((r) => `${r.person.name.split(" ")[0]}: ${r.currentStreak} ${r.currentStreak === 1 ? "dia útil" : "dias úteis"} sem apontamento`)
        .join("; "),
      action: "Ver",
      href: "/gestao/pendencias?aba=dias",
    },
    counts.prov.length && { n: counts.prov.length, tone: "neutral", what: "Provisionamentos vencidos", detail: `${new Set(counts.prov.map((p) => p.personId)).size} consultor(es) ainda não converteram`, action: "Ver", href: "/gestao/pendencias?aba=provisionamentos" },
    counts.evals.length && { n: counts.evals.length, tone: "neutral", what: "Avaliações a publicar", detail: "ocultas até a gestão decidir", action: "Revisar", href: "/gestao/pendencias?aba=avaliacoes" },
    syncN && { n: syncN, tone: "red", what: "Erros de sincronização com o Odoo", detail: "registros recusados pelo Odoo", action: "Reenviar", href: "/gestao/pendencias?aba=sincronizacao" },
  ].filter(Boolean) as { n: number; tone: string; what: string; detail: string; action: string; href: string }[];
  const toneCls: Record<string, string> = { red: "bg-red-bg text-red", accent: "bg-accent text-on-accent", yellow: "bg-yellow-bg text-yellow", neutral: "bg-line-2 text-[#e6d9f2]" };

  const portfolio = counts.portfolio
    .filter((c) =>
      filter === "vermelho" ? c.health === "vermelho" : filter === "contato" ? c.reasons.some((x) => x.includes("contato")) : filter === "aguardando" ? c.waiting > 0 : filter === "inativos" ? !c.active : true,
    )
    .sort((a, b) => ["vermelho", "amarelo", "verde"].indexOf(a.health) - ["vermelho", "amarelo", "verde"].indexOf(b.health) || b.monthMinutes - a.monthMinutes);

  const sort = param(sp, "ordem") ?? "horas";
  const dir = param(sp, "dir") === "asc" ? "asc" : "desc";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">A Síntese hoje</h1>
          <p className="text-[15px] text-muted">
            {cap(longDate(t))}.{" "}
            {team.incomplete ? `Dia ${team.elapsed} de ${team.workdays} dias úteis ${period.key === "mes" ? "do mês" : "do período"}.` : `${cap(period.label)}: ${team.workdays} dias úteis.`}
          </p>
        </div>
        <PeriodSelector value={period.key} from={period.from} to={period.to} />
      </div>

      <div className="flex flex-wrap items-stretch gap-5">
        <section aria-labelledby="heq" className="card-strong flex min-w-0 flex-[3_1_520px] flex-col gap-4 px-[22px] py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 id="heq" className="h3">Horas faturáveis da equipe</h2>
            {team.incomplete && (
              <span className="text-[13px] font-semibold text-accent-soft">
                no ritmo atual, {thousands(team.projection / 60)} h {period.key === "mes" ? "no mês" : "no período"}
                {reachedProj ? `: ${reachedProj.name}` : ""}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-7">
            <Link href={`/time?${new URLSearchParams({ p: period.key, ...(period.key === "personalizado" ? { de: period.from, ate: period.to } : {}) })}`} className="flex items-baseline gap-2.5 no-underline">
              <span className="num text-[44px] font-bold !text-white">{thousands(fat / 60)}</span>
              <span className="text-[15px] text-muted">
                h de {thousands(next.minutes / 60)} {fat >= next.minutes ? `(${next.name} batida)` : `da ${next.name === "Cota" ? "cota" : next.name}`}
              </span>
            </Link>
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              <div className="flex h-16 items-end gap-1.5" aria-label="Horas faturáveis por dia útil">
                {team.days.slice(-23).map((d) => (
                  <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${shortDate(d.date)}: ${hm(d.fat)} h`}>
                    <span className="num text-[11px] text-muted">{Math.round(d.fat / 60)}</span>
                    <span className="w-full rounded-t" style={{ height: Math.max(2, Math.round((d.fat / maxDay) * 44)), background: d.fat >= dailyGoal ? "#F07A45" : "#7A5A9A" }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                {team.days.slice(-23).map((d) => (
                  <span key={d.date} className="min-w-0 flex-1 text-center text-[11px] text-faint">
                    {Number(d.date.slice(8))}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <Thermometer minutes={fat} projection={team.projection} goals={team.goals} size="lg" />
          <GoalLevels minutes={fat} projection={team.projection} goals={team.goals} />
          <p className="text-xs text-faint">Barra laranja: dia acima do ritmo da cota ({thousands(dailyGoal / 60)} h por dia útil). Só consultores e só horas faturáveis.</p>
        </section>

        <section aria-labelledby="atn" className="card flex min-w-0 flex-[2_1_360px] flex-col px-5 py-[18px]">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 id="atn" className="text-base font-bold text-white">Precisa de você</h2>
            <Link href="/gestao/pendencias" className="text-sm font-bold !text-accent-soft">
              Todas as pendências
            </Link>
          </div>
          {attention.length === 0 && <p className="border-t border-line py-4 text-sm text-muted">Nada pendente agora.</p>}
          {attention.map((a) => (
            <div key={a.what} className="flex items-center gap-3.5 border-t border-line py-2.5">
              <span className={cx("num flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[19px] font-bold", toneCls[a.tone])}>{a.n}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-sm text-white">{a.what}</strong>
                <span className="text-[13px] text-faint">{a.detail}</span>
              </div>
              <Link href={a.href} className="inline-flex min-h-11 items-center px-1 text-sm font-bold !text-accent-soft">
                {a.action}
              </Link>
            </div>
          ))}
        </section>
      </div>

      <div className="flex flex-wrap items-stretch gap-5">
        <section aria-labelledby="h-etapas" className="card flex min-w-0 flex-[1_1_300px] flex-col gap-2 px-5 py-[18px]">
          <h2 id="h-etapas" className="text-base font-bold text-white">Projetos por etapa</h2>
          {STAGES.map((st) => (
            <Link key={st.key} href={`/projetos?etapa=${st.key}`} className="flex min-h-10 items-center gap-3 border-t border-line no-underline">
              <span className="flex-1 text-sm">{st.label}</span>
              <span className="num text-[15px] font-bold !text-white">{stages[st.key] ?? 0}</span>
            </Link>
          ))}
        </section>
        <section aria-labelledby="h-tipos" className="card flex min-w-0 flex-[1_1_300px] flex-col gap-2 px-5 py-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="h-tipos" className="text-base font-bold text-white">Horas por tipo</h2>
            <span className="num text-[13px] text-muted">{hm(tot.tot)} h</span>
          </div>
          <div className="flex h-3.5 overflow-hidden rounded-full bg-line" aria-hidden>
            {types.map((x) => (
              <span key={x.typeId} style={{ width: `${(x.minutes / Math.max(1, tot.tot)) * 100}%`, background: TYPE_COLOR[x.kind] }} />
            ))}
          </div>
          {types.map((x) => (
            <Link key={x.typeId} href={withQuery("/time", { p: period.key }, { det: `tipo:${x.typeId}` }) + "#apontamentos"} className="flex min-h-10 items-center gap-2.5 border-t border-line no-underline">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: TYPE_COLOR[x.kind] }} />
              <span className="flex-1 text-sm">{x.name}</span>
              <span className="text-xs text-faint">{tot.tot ? Math.round((x.minutes / tot.tot) * 100) : 0}%</span>
              <span className="num w-16 text-right text-[13px] font-bold !text-white">{hm(x.minutes)}</span>
            </Link>
          ))}
        </section>
        <section aria-labelledby="h-sus" className="card flex min-w-0 flex-[1_1_300px] flex-col gap-2 px-5 py-[18px]">
          <h2 id="h-sus" className="text-base font-bold text-white">Sustentação x desenvolvimento</h2>
          <div className="flex h-3.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <span className="bg-blue" style={{ width: `${susPct}%` }} />
            <span className="bg-[#A897F5]" style={{ width: `${100 - susPct}%` }} />
          </div>
          {[
            { k: "1", label: "Sustentação", v: tot.sust, pct: susPct, c: "bg-blue" },
            { k: "0", label: "Desenvolvimento", v: tot.dev, pct: 100 - susPct, c: "bg-[#A897F5]" },
          ].map((x) => (
            <Link key={x.k} href={withQuery("/time", { p: period.key }, { det: `sust:${x.k}` }) + "#apontamentos"} className="flex min-h-10 items-center gap-2.5 border-t border-line no-underline">
              <span className={cx("h-2.5 w-2.5 rounded-[3px]", x.c)} />
              <span className="flex-1 text-sm">{x.label}</span>
              <span className="text-xs text-faint">{x.pct}%</span>
              <span className="num w-16 text-right text-[13px] font-bold !text-white">{hm(x.v)}</span>
            </Link>
          ))}
          <p className="text-xs text-faint">Horas internas ficam fora desta divisão.</p>
        </section>
      </div>

      <section id="carteira" aria-labelledby="cart" className="flex scroll-mt-6 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="cart" className="h2">Carteira de clientes</h2>
            <span className="text-sm text-muted">
              {counts.portfolio.filter((c) => c.health === "vermelho").length} no vermelho · {counts.portfolio.filter((c) => c.health === "amarelo").length} em atenção
            </span>
          </div>
          <div role="group" aria-label="Filtro da carteira" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={withQuery("/gestao", sp, { carteira: f.key === "todos" ? null : f.key }) + "#carteira"}
                scroll={false}
                aria-pressed={filter === f.key}
                className={cx("chip no-underline", filter === f.key ? "!border-white bg-white !text-on-accent" : "!text-[#e6d9f2]")}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        <PortfolioTable rows={portfolio} />
      </section>

      <section aria-labelledby="tm" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="tm" className="h2">Carga do time</h2>
          <Link href="/time" className="text-sm font-bold !text-accent-soft">
            Abrir carga do time
          </Link>
        </div>
        <WorkloadTable
          rows={sortWorkload(wl.rows, sort, dir)}
          week={wl.week}
          today={t}
          clientColors={clientMap}
          settings={settings}
          view="parede"
          sort={sort}
          dir={dir}
          hrefFor={(col, d) => withQuery("/gestao", sp, { ordem: col, dir: d })}
          periodLabel={period.key === "mes" ? "mês" : period.label}
        />
      </section>
    </>
  );
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
