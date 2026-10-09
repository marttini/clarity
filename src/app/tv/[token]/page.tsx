import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getClients, getSettings } from "@/server/data/common";
import { portfolioLite, ranking, teamProgress, validTvToken, workload } from "@/server/queries/analytics";
import { resolvePeriod } from "@/domain/period";
import { consultantBand } from "@/domain/rules";
import { longDate, monthName, parseISO } from "@/domain/dates";
import { now, today } from "@/lib/clock";
import { cx } from "@/components/ui";
import { Thermometer } from "@/components/gestao/thermometer";
import { HEALTH_DOT, contactText } from "@/components/gestao/portfolio-table";
import { BAND_FILL, BAND_STYLE, hm, initials, thousands } from "@/components/time/bits";
import { TvShell } from "@/components/tv/tv-shell";

export const metadata: Metadata = { title: "Modo TV", robots: { index: false, follow: false } };

/**
 * US-49: modo TV. Link próprio, sem login, só leitura e revogável pela gestão.
 * Não mostra R$ nem avaliações.
 */
export default async function TvPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tv = await validTvToken(token);
  if (!tv) notFound();
  const t = today();
  const nowAt = now();
  const period = resolvePeriod({ p: "mes" }, t);
  const [settings, clients, team, rk, wl, portfolio] = await Promise.all([
    getSettings(),
    getClients(),
    teamProgress(period, t),
    ranking(period, "h", t),
    workload(period, t, nowAt),
    portfolioLite(t),
  ]);
  const month = monthName(parseISO(t).m);
  const reached = [...team.goals].reverse().find((g) => team.projection >= g.minutes);
  const clientColor = new Map(clients.map((c) => [c.id, c.color]));
  const SCALE = Math.max(260, settings.bands.extra + 20);
  const pc = (min: number) => Math.min(100, (min / 60 / SCALE) * 100);
  const ticks = [settings.bands.quota, settings.bands.band1, settings.bands.band2, settings.bands.band3, settings.bands.extra];

  const header = (
    <>
      <section aria-label="Meta do time" className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-[18px] border border-line-4 bg-surface-3 px-7 pt-[18px] pb-3.5">
        <div className="flex items-baseline gap-4">
          <span className="num text-5xl leading-none font-bold text-white">{thousands(team.total.fat / 60)}</span>
          <span className="text-2xl text-muted">h faturáveis do time em {month}</span>
          <span className="ml-auto text-2xl font-bold text-accent-soft">
            no ritmo, {thousands(team.projection / 60)} h{reached ? `: ${reached.name} batida` : ""}
          </span>
        </div>
        <Thermometer minutes={team.total.fat} projection={team.projection} goals={team.goals} size="tv" />
      </section>
      <section aria-label="Horas hoje" className="flex w-[300px] shrink-0 flex-col justify-center gap-2 rounded-[18px] border border-line bg-surface px-6 py-[18px]">
        <span className="text-[22px] font-bold text-white">Horas hoje</span>
        <span className="num text-5xl leading-none font-bold text-white">{hm(team.todayMinutes)}</span>
        <span className="text-xl text-muted">
          {team.appointedToday} de {team.consultants} consultores já apontaram
        </span>
      </section>
    </>
  );

  const rankScene = (
    <section aria-labelledby="tvRank" className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-baseline gap-6">
        <h1 id="tvRank" className="font-display text-[40px] font-semibold tracking-[-0.02em] text-white">
          Ranking de {month}
        </h1>
        <span className="text-[22px] text-muted">
          horas faturáveis até hoje · {cap(longDate(t))} · dia {team.elapsed} de {team.workdays} dias úteis
        </span>
      </div>
      <div className="flex flex-1 flex-col rounded-[18px] border border-line bg-surface px-7 py-1">
        {rk.rows.slice(0, 8).map((r) => {
          const b = consultantBand(r.fat, settings);
          const mv = r.prevPos === null ? 0 : r.prevPos - r.pos;
          return (
            <div key={r.person.id} className={cx("flex flex-1 items-center gap-6", r.pos > 1 && "border-t border-line")}>
              <span className={cx("w-14 font-display text-[34px] font-semibold", r.pos <= 3 ? "text-white" : "text-muted")}>{r.pos}º</span>
              <span role="img" aria-label={mv > 0 ? `Subiu ${mv}` : mv < 0 ? `Desceu ${-mv}` : "Manteve"} className={cx("num inline-flex w-14 items-center gap-1 text-2xl font-bold", mv > 0 ? "text-green" : mv < 0 ? "text-red" : "text-faint")}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={mv > 0 ? "M12 19V5M6 11l6-6 6 6" : mv < 0 ? "M12 5v14M6 13l6 6 6-6" : "M6 12h12"} />
                </svg>
                {mv ? Math.abs(mv) : ""}
              </span>
              <span className={cx("flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] bg-line-2 text-xl font-extrabold text-white", r.pos === 1 ? "border-accent" : "border-line-3")}>{initials(r.person.name)}</span>
              <strong className="w-[300px] shrink-0 truncate text-[30px] text-white">{r.person.name}</strong>
              <div className="relative h-11 min-w-0 flex-1" aria-hidden>
                <div className="absolute inset-x-0 top-3 h-2.5 rounded-full bg-line-2" />
                <div className="absolute top-3 left-0 h-2.5 rounded-full" style={{ width: `${pc(r.fat)}%`, background: BAND_FILL[b.key] }} />
                {ticks.map((v) => (
                  <div key={v} className="absolute top-2 flex -translate-x-1/2 flex-col items-center gap-0.5" style={{ left: `${(v / SCALE) * 100}%` }}>
                    <span className="h-4 w-0.5 bg-line-5" />
                    <span className="num text-base text-faint">{v}</span>
                  </div>
                ))}
              </div>
              <span className="num w-[150px] shrink-0 text-right text-[38px] font-bold text-white">{hm(r.fat)}</span>
              <span className="flex w-[340px] shrink-0 flex-col items-start gap-1">
                <span className={cx("rounded-full px-3.5 py-1 text-lg font-bold", r.lostBonus ? "bg-red-bg text-red" : b.key === "abaixo" && team.incomplete ? "bg-line text-muted" : BAND_STYLE[b.key])}>
                  {r.lostBonus ? "Sem bônus no mês" : b.key === "abaixo" && team.incomplete ? "Rumo à cota" : b.label}
                </span>
                <span className="text-lg text-muted">{b.next ? `faltam ${hm(b.missingMinutes)} h para ${b.next.label === "Cota atingida" ? "a cota" : b.next.label}` : "faixa máxima"}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );

  const loadRows = [...wl.rows].sort((a, b) => b.hours.fat - a.hours.fat).slice(0, 8);
  const loadScene = (
    <section aria-labelledby="tvLoad" className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-baseline gap-6">
        <h1 id="tvLoad" className="font-display text-[40px] font-semibold tracking-[-0.02em] text-white">
          Carga do time
        </h1>
        <span className="text-[22px] text-muted">semana por cliente · tarefas abertas e atrasadas · contatos da semana</span>
      </div>
      <div className="flex flex-1 flex-col rounded-[18px] border border-line bg-surface px-7 py-1">
        <div className="flex items-center gap-6 pt-3.5 pb-2.5 text-lg font-bold text-faint">
          <span className="w-[380px]">Consultor</span>
          <span className="w-[420px]">Semana (seg a sex)</span>
          <span className="w-[170px] text-right">Horas no mês</span>
          <span className="w-[150px] text-right">Tarefas</span>
          <span className="w-[150px] text-right">Atrasadas</span>
          <span className="w-[150px] text-right">Clientes</span>
          <span className="flex-1 text-right">Contatos</span>
        </div>
        {loadRows.map((r) => (
          <div key={r.person.id} className="flex flex-1 items-center gap-6 border-t border-line">
            <span className="flex w-[380px] items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-line-2 text-lg font-extrabold text-white">{initials(r.person.name)}</span>
              <span className="flex flex-col">
                <strong className="truncate text-[28px] text-white">{r.person.name}</strong>
                {r.missingStreak > 0 && <span className="text-lg font-semibold text-yellow">{r.missingStreak === 1 ? "1 dia útil sem apontar" : `${r.missingStreak} dias úteis sem apontar`}</span>}
              </span>
            </span>
            <div className="flex h-[64px] w-[420px] items-end gap-1.5" aria-hidden>
              {r.week.map((d) => (
                <div key={d.date} className={cx("flex h-full flex-1 flex-col-reverse gap-px overflow-hidden rounded-md", d.total === 0 && d.date < t ? "bg-red-bg" : "bg-surface-3")}>
                  {d.byClient.map((c) => (
                    <span key={c.clientId} style={{ flex: `0 0 ${Math.max(3, Math.round((Math.min(c.minutes, 600) / 600) * 64))}px`, background: clientColor.get(c.clientId) ?? "#9C93AE" }} />
                  ))}
                </div>
              ))}
            </div>
            <span className="num w-[170px] text-right text-[32px] font-bold text-white">{hm(r.hours.fat)}</span>
            <span className="num w-[150px] text-right text-[32px] font-bold text-white">{r.tasks}</span>
            <span className={cx("num w-[150px] text-right text-[32px] font-bold", r.late ? "text-red" : "text-white")}>{r.late}</span>
            <span className="num w-[150px] text-right text-[32px] font-bold text-white">{r.clients.length}</span>
            <span className="num flex-1 text-right text-[32px] font-bold text-white">
              {r.contactsWeek}
              {r.contactsLate > 0 && <span className="ml-2 font-sans text-lg text-red">{r.contactsLate === 1 ? "1 atrasado" : `${r.contactsLate} atrasados`}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );

  const order = { vermelho: 0, amarelo: 1, verde: 2 } as const;
  const cl = [...portfolio].filter((c) => c.active).sort((a, b) => order[a.health] - order[b.health] || b.monthMinutes - a.monthMinutes).slice(0, 8);
  const count = (h: keyof typeof order) => portfolio.filter((c) => c.active && c.health === h).length;
  const clientScene = (
    <section aria-labelledby="tvCart" className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-center gap-6">
        <h1 id="tvCart" className="font-display text-[40px] font-semibold tracking-[-0.02em] text-white">
          Carteira de clientes
        </h1>
        <div className="flex gap-3">
          {(
            [
              ["vermelho", "agir agora", "bg-red-bg text-red"],
              ["amarelo", "atenção", "bg-yellow-bg text-yellow"],
              ["verde", "em dia", "bg-green-bg text-green"],
            ] as const
          ).map(([h, label, cls]) => (
            <span key={h} className={cx("inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xl font-bold", cls)}>
              <span className={cx("h-3.5 w-3.5 rounded-full", HEALTH_DOT[h])} />
              {count(h)} {label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col rounded-[18px] border border-line bg-surface px-7 py-1">
        <div className="flex items-center gap-6 pt-3.5 pb-2.5 text-lg font-bold text-faint">
          <span className="w-[420px]">Cliente</span>
          <span className="flex-1">Situação</span>
          <span className="w-[170px] text-right">Em andamento</span>
          <span className="w-[170px] text-right">Horas no mês</span>
          <span className="w-[210px] text-right">Último contato</span>
        </div>
        {cl.map((c) => (
          <div key={c.id} className="flex flex-1 items-center gap-6 border-t border-line">
            <div className="flex w-[420px] min-w-0 items-center gap-4">
              <span role="img" aria-label={`Saúde: ${c.health}`} className={cx("h-5 w-5 shrink-0 rounded-full", HEALTH_DOT[c.health])} />
              <span className="h-8 w-1.5 shrink-0 rounded-sm" style={{ background: c.color }} aria-hidden />
              <strong className="truncate text-[32px] text-white">{c.name}</strong>
            </div>
            <span className={cx("min-w-0 flex-1 truncate text-[22px]", c.health === "vermelho" ? "text-red" : c.health === "amarelo" ? "text-yellow" : "text-muted")}>{c.reasons[0] ? cap(c.reasons[0]) : "Tudo em dia"}</span>
            <span className="num w-[170px] text-right text-[32px] font-bold text-white">{c.stages.andamento ?? 0}</span>
            <span className="num w-[170px] text-right text-[32px] font-bold text-white">{hm(c.monthMinutes)}</span>
            <span className={cx("w-[210px] text-right text-[26px] font-semibold", c.reasons.some((x) => x.includes("contato")) ? "text-red" : "text-ink")}>{contactText(c)}</span>
          </div>
        ))}
      </div>
    </section>
  );

  return <TvShell header={header} scenes={[rankScene, loadScene, clientScene]} labels={["Ranking", "Carga do time", "Clientes"]} dateLabel={longDate(t)} footerNote={`Gestão à vista · ${tv.label} · atualiza a cada minuto`} />;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
