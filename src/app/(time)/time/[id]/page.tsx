import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { getClients, getPeople, getSettings, STAGES, stageIndex } from "@/server/data/common";
import {
  METRICS,
  buildComparison,
  contactsOf,
  deadlineChangesFor,
  entryList,
  evaluationsList,
  groupHours,
  groupTypes,
  itemTagsOf,
  last13Months,
  loadActivity,
  metricValue,
  metricsFor,
  monthLabel,
  monthlySeries,
  provisionedEntries,
  sumHours,
  type MetricKey,
} from "@/server/queries/analytics";
import { resolvePeriod } from "@/domain/period";
import { diffDays, endOfMonth, isWorkday, longDate, monthName, parseISO, shortDate, startOfMonth, toISODate, type ISODate } from "@/domain/dates";
import { consultantBand } from "@/domain/rules";
import { now, today } from "@/lib/clock";
import { PeriodSelector } from "@/components/period";
import { ClientChip, ClientSwatch, Empty, cx } from "@/components/ui";
import { BandChip, BandTrail, TYPE_COLOR, hm, initials, param, withQuery, type SP } from "@/components/time/bits";
import { ComparisonTable, fmtMetric } from "@/components/time/comparison-table";
import { MonthChart } from "@/components/time/month-chart";
import { MonthCalendar, type CalDay } from "@/components/time/month-calendar";
import { typeTone } from "@/components/time/entry-list";
import { DayLegend } from "@/components/time/bits";

export const metadata: Metadata = { title: "Ficha do consultor" };

const ROLE_LABEL: Record<string, string> = { administrador: "Administrador", gestor: "Gestor", consultor: "Consultor", administrativo: "Administrativo" };

/** US-33: ficha do consultor. Todo o time vê a ficha de todos; avaliações ocultas só a gestão vê. */
export default async function ConsultantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const me = await requireTeam();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [person] = await db.select().from(s.people).where(eq(s.people.id, id));
  if (!person) notFound();
  const t = today();
  const nowAt = now();
  const manager = isManager(me);
  const self = me.id === person.id;
  const canSeeReasons = manager || self;
  const path = `/time/${id}`;
  const href = (patch: Record<string, string | null>) => withQuery(path, sp, patch);

  const period = resolvePeriod({ p: param(sp, "p"), de: param(sp, "de"), ate: param(sp, "ate") }, t);
  const months = last13Months(t);
  const mParam = param(sp, "m");
  const calMonth = mParam && /^\d{4}-\d{2}$/.test(mParam) && months.includes(`${mParam}-01`) ? `${mParam}-01` : startOfMonth(t < period.to ? t : period.to);
  const metric = (METRICS.find((x) => x.key === param(sp, "ind"))?.key ?? "fat") as MetricKey;
  const clientFilter = param(sp, "cliente") ?? null;
  const wide = {
    from: [months[0], period.from, period.prev.from].sort()[0],
    to: [endOfMonth(t), period.to, endOfMonth(calMonth)].sort().at(-1)!,
  };

  const [settings, people, clients, act, evals, changes] = await Promise.all([
    getSettings(),
    getPeople(),
    getClients(),
    loadActivity([id], wide),
    evaluationsList({ consultantId: id }),
    deadlineChangesFor(id, period),
  ]);
  const clientMap = new Map(clients.map((c) => [c.id, c]));
  const ordered = [...people.filter((p) => p.isConsultor), ...people.filter((p) => !p.isConsultor)];
  const cur = metricsFor(act, id, period, t);
  const series = monthlySeries(act, id, t);
  const contacts = contactsOf(act, id, period, nowAt);
  const openTasks = act.items
    .filter((i) => i.kind === "tarefa" && i.assignees.includes(id) && i.stage !== "concluido" && !i.completedOn)
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const tags = await itemTagsOf(openTasks.map((i) => i.id));
  const tasksShown = clientFilter ? openTasks.filter((i) => i.clientId === clientFilter) : openTasks;
  const myClients = [...new Map(openTasks.map((i) => [i.clientId, { id: i.clientId, name: i.clientName, color: i.clientColor }])).values()];
  for (const r of act.rows) if (r.personId === id && r.date >= period.from && r.date <= period.to && !myClients.some((c) => c.id === r.clientId) && clientMap.get(r.clientId))
    myClients.push({ id: r.clientId, name: clientMap.get(r.clientId)!.name, color: clientMap.get(r.clientId)!.color });

  // Cabeçalho e faixa do mês (só Faturável).
  const monthNow = series.at(-1)!.m;
  const monthFat = monthNow.hours.fat;
  const monthProj = monthNow.elapsedWorkdays ? Math.round((monthFat / monthNow.elapsedWorkdays) * monthNow.workdays) : monthFat;
  const band = consultantBand(monthFat, settings);
  const projBand = consultantBand(monthProj, settings);
  const curMonthName = monthName(parseISO(t).m);

  // Comparação e gráfico.
  const cmp = buildComparison(act, id, period, t, series);
  const def = METRICS.find((x) => x.key === metric)!;
  const curPoint = series.at(-1)!;
  const curVal = metricValue(curPoint.m, metric);
  const projOut = def.additive && curVal !== null && curPoint.m.elapsedWorkdays ? Math.round((curVal / curPoint.m.elapsedWorkdays) * curPoint.m.workdays) : null;
  const chartMonths = series.slice(1);
  const selMonth = mParam && chartMonths.some((p) => p.month === `${mParam}-01`) ? `${mParam}-01` : curPoint.month;
  const bars = chartMonths.map((p) => {
    const v = p.exists ? metricValue(p.m, metric) : null;
    const isCur = p.month === curPoint.month;
    return {
      key: p.month,
      label: p.label,
      aria: `${monthLabel(p.month)}: ${fmtMetric(def.kind, v)}`,
      value: v,
      projection: isCur ? projOut : null,
      href: href({ m: p.month.slice(0, 7), dia: null }),
      selected: p.month === selMonth,
      current: isCur,
    };
  });
  const selPoint = series.find((p) => p.month === selMonth)!;
  const selVal = metricValue(selPoint.m, metric);
  let caption = `${cap(monthLabel(selMonth))}: ${fmtMetric(def.kind, selVal)}${def.kind === "h" ? " h" : ""}`;
  if (metric === "fat" && selVal !== null) caption += ` · ${consultantBand(selVal, settings).label}`;
  if (selMonth === curPoint.month && projOut !== null) caption += ` até hoje. Projeção do mês: ${fmtMetric(def.kind, projOut)}${metric === "fat" ? ` · ${consultantBand(projOut, settings).label}` : ""}.`;
  else caption += selPoint.lostBonus ? ". Regra dos 3 dias: sem bônus no mês." : ".";

  // Horas por cliente e tipo no período.
  const pRows = act.rows.filter((r) => r.personId === id && r.date >= period.from && r.date <= period.to);
  const byClient = [...groupHours(pRows, act.kinds, (r) => r.clientId).entries()].sort((a, b) => b[1].tot - a[1].tot);
  const maxC = Math.max(1, ...byClient.map(([, h]) => h.tot));
  const byType = groupTypes(pRows, act.kinds);
  const pTot = sumHours(pRows, act.kinds);

  // Calendário do mês selecionado.
  const calRange = { from: startOfMonth(calMonth), to: endOfMonth(calMonth) };
  const prov = await provisionedEntries({ range: calRange, personIds: [id] });
  const calDays = new Map<ISODate, CalDay>();
  const touch = (d: ISODate) => {
    let v = calDays.get(d);
    if (!v) calDays.set(d, (v = { real: 0, prov: 0, justified: false }));
    return v;
  };
  for (const r of act.rows) if (r.personId === id && r.date >= calRange.from && r.date <= calRange.to && act.kinds.get(r.typeId)?.kind !== "prov") touch(r.date).real += r.minutes;
  for (const p of prov) touch(p.date).prov += p.minutes;
  const myJust = act.justifications.filter((j) => j.personId === id);
  for (const j of myJust) if (j.date >= calRange.from && j.date <= calRange.to) touch(j.date).justified = true;
  const diaParam = param(sp, "dia");
  const selDay: ISODate = diaParam && /^\d{4}-\d{2}-\d{2}$/.test(diaParam) && diaParam >= calRange.from && diaParam <= calRange.to ? diaParam : t >= calRange.from && t <= calRange.to ? t : calRange.to;
  const dayEntries = await entryList({ from: selDay, to: selDay }, { personId: id, includeProvisioning: true });
  const dayJust = myJust.find((j) => j.date === selDay);
  const dayInfo = calDays.get(selDay);
  const dayReal = dayEntries.filter((e) => !e.isProvisioning).reduce((a, e) => a + e.minutes, 0);
  const isHoliday = act.holidays.has(selDay);
  let dayNote: { text: string; tone: "n" | "r" | "p" } = { text: "Nada lançado ou provisionado.", tone: "n" };
  if (isHoliday) dayNote = { text: "Feriado. Não conta como dia útil nem para a regra dos 3 dias.", tone: "n" };
  else if (dayJust) dayNote = { text: canSeeReasons ? `Dia justificado: ${dayJust.reason}${dayJust.note ? `. ${dayJust.note}` : ""}` : "Dia justificado.", tone: "n" };
  else if (selDay < t && !dayReal && person.isConsultor && isWorkday(selDay, act.holidays))
    dayNote = { text: "Sem apontamento e sem justificativa. Conta para a regra dos 3 dias úteis.", tone: "r" };
  else if (selDay === t) dayNote = { text: "Hoje. Lançamentos até agora; o dia ainda não fechou.", tone: "n" };
  else if (selDay > t && dayInfo?.prov) dayNote = { text: "Provisionado: reserva de agenda, invisível ao cliente e fora do faturamento.", tone: "p" };
  else if (dayReal) dayNote = { text: `${dayEntries.filter((e) => !e.isProvisioning).length} lançamento(s) neste dia.`, tone: "n" };

  // Avaliações: ocultas só para a gestão; o próprio e o time veem as publicadas.
  const visibleEvals = manager ? evals : evals.filter((e) => e.ev.published);
  const pendingEvals = evals.filter((e) => !e.ev.published && !e.ev.publishedAt);
  const published = evals.filter((e) => e.ev.published);
  const avgOf = (arr: typeof evals, k: "scoreResult" | "scoreConsultant" | "scoreTeam") => (arr.length ? arr.reduce((a, e) => a + e.ev[k], 0) / arr.length : null);
  const evalBase = manager ? evals : published;
  const parts = [
    { k: "Resultado", v: avgOf(evalBase, "scoreResult") },
    { k: "Consultor", v: avgOf(evalBase, "scoreConsultant") },
    { k: "Time", v: avgOf(evalBase, "scoreTeam") },
  ];
  const overall = evalBase.length ? parts.reduce((a, p) => a + (p.v ?? 0), 0) / 3 : null;

  const consultant = person.isConsultor;
  const periodRangeText = period.key === "personalizado" ? `${shortDate(period.from)} a ${shortDate(period.to)}` : cap(period.label);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Pessoa do time" className="flex flex-wrap gap-1.5">
          {ordered.map((p) => {
            const on = p.id === id;
            return (
              <Link
                key={p.id}
                href={withQuery(`/time/${p.id}`, sp, { cliente: null, dia: null })}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border pr-3.5 pl-1.5 text-sm font-bold no-underline",
                  on ? "border-white bg-white !text-on-accent hover:!text-on-accent" : "border-line-3 bg-surface !text-[#e6d9f2]",
                )}
              >
                <span className={cx("inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-[11px] font-extrabold", on ? "bg-accent text-on-accent" : "bg-line-2 text-white")}>{initials(p.name)}</span>
                {p.name.split(" ")[0]}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-2.5">
          <PeriodSelector value={period.key} from={period.from} to={period.to} />
          <span className="text-[13px] text-muted">{periodRangeText}</span>
        </div>
      </div>

      <section aria-labelledby="nome" className="card-strong flex flex-wrap items-stretch gap-x-9 gap-y-5 p-[22px]">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
          <div className="flex items-center gap-4">
            <span className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-accent text-lg font-extrabold text-on-accent">{initials(person.name)}</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 id="nome" className="font-display text-[28px] font-semibold tracking-[-0.02em] text-white">{person.name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="rounded-full bg-line-2 px-2.5 py-1 text-xs font-bold text-[#e6d9f2]">
                  {ROLE_LABEL[person.role]}
                  {person.isConsultor && person.role === "gestor" ? " e consultor" : ""}
                </span>
                <span>{consultant ? (person.canApproveHours ? "Aponta horas, entra em faixas e aprova pedidos" : "Aponta horas e entra em faixas") : "Recebe e registra contatos e tarefas de follow-up"}</span>
              </div>
            </div>
          </div>
          {myClients.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-muted">
                Atende {myClients.length} {myClients.length === 1 ? "cliente" : "clientes"} · clique para filtrar tarefas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {myClients.map((c) => {
                  const on = clientFilter === c.id;
                  return (
                    <Link
                      key={c.id}
                      href={href({ cliente: on ? null : c.id }) + "#tarefas"}
                      scroll={false}
                      aria-pressed={on}
                      className={cx(
                        "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold no-underline",
                        on ? "border-white bg-white !text-on-accent hover:!text-on-accent" : "border-line-5 !text-[#e6d9f2]",
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color }} />
                      {c.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {consultant && (
          <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 className="h3">Faixa de {curMonthName}</h2>
              <span className="text-[13px] text-faint">só horas faturáveis contam</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-2.5">
              <span className="inline-flex items-baseline gap-2">
                <span className="num text-[32px] font-bold text-white">{hm(monthFat)}</span>
                <span className="text-sm text-muted">h faturáveis até hoje</span>
              </span>
              <BandChip minutes={monthFat} settings={settings} className="!px-3 !text-[13px]" />
              {series.at(-1)!.lostBonus && <span className="rounded-full bg-red-bg px-3 py-1 text-[13px] font-bold text-red">sem bônus no mês</span>}
              <span className="text-[15px]">{band.next ? `Faltam ${hm(band.missingMinutes)} h para ${band.next.label === "Cota atingida" ? "a cota" : band.next.label} (${band.next.hours} h)` : "Acima do bônus extra"}</span>
            </div>
            <BandTrail minutes={monthFat} projection={monthProj} settings={settings} />
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2.5 w-[18px] shrink-0 rounded-[3px] border-[1.5px] border-dashed border-accent-soft" />
              No ritmo atual, fecha {curMonthName} com cerca de {Math.round(monthProj / 60)} h faturáveis: {projBand.label}.
            </p>
          </div>
        )}
      </section>

      {consultant && (
        <>
          <ComparisonTable cmp={cmp} selected={metric} hrefFor={(k) => href({ ind: k })} title={period.key === "mes" ? `${cap(curMonthName)} comparado` : `${cap(period.label)} comparado`} />

          <div className="flex flex-wrap items-stretch gap-[22px]">
            <section aria-labelledby="h-hist" className="card flex min-w-0 flex-[3_1_620px] flex-col gap-3.5 px-5 py-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="h-hist" className="text-base font-bold text-white">{def.label} nos últimos 12 meses</h2>
                <span className="text-xs text-faint">clique numa linha da tabela para trocar o indicador</span>
              </div>
              <MonthChart bars={bars} kind={def.kind} isFat={metric === "fat"} settings={settings} />
              <p className="rounded-[10px] bg-surface-3 px-3 py-2.5 text-sm">{caption}</p>
            </section>

            <section aria-labelledby="h-dist" className="card flex min-w-0 flex-[2_1_380px] flex-col gap-3.5 px-5 py-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="h-dist" className="text-base font-bold text-white">Horas por cliente</h2>
                <span className="text-xs text-faint">{period.label}</span>
              </div>
              <div className="flex flex-col gap-1">
                {byClient.length === 0 && <p className="py-3 text-sm text-muted">Nenhuma hora lançada neste período.</p>}
                {byClient.map(([cid, h]) => {
                  const c = clientMap.get(cid);
                  const on = clientFilter === cid;
                  return (
                    <Link
                      key={cid}
                      href={href({ cliente: on ? null : cid })}
                      scroll={false}
                      aria-pressed={on}
                      className={cx("flex min-h-11 items-center gap-3 rounded-[10px] px-2 no-underline", on ? "bg-line-2" : "hover:bg-line", clientFilter && !on && "opacity-50")}
                    >
                      <span className="w-[132px] shrink-0 truncate text-sm font-semibold">{c?.name ?? "?"}</span>
                      <span className="flex h-3.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                        <span className="h-full rounded-full" style={{ width: `${(h.tot / maxC) * 100}%`, background: c?.color }} />
                      </span>
                      <span className="num w-14 shrink-0 text-right text-[13px] font-bold text-white">{hm(h.tot)}</span>
                    </Link>
                  );
                })}
              </div>
              <h3 className="mt-1.5 text-sm font-bold text-white">Por tipo</h3>
              <div className="flex h-3.5 overflow-hidden rounded-full bg-line" aria-hidden>
                {byType.map((x) => (
                  <span key={x.typeId} style={{ width: `${(x.minutes / Math.max(1, pTot.tot)) * 100}%`, background: TYPE_COLOR[x.kind] }} />
                ))}
              </div>
              <div className="flex flex-col">
                {byType.map((x) => (
                  <div key={x.typeId} className="flex min-h-[34px] items-center gap-2.5 border-t border-line">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: TYPE_COLOR[x.kind] }} />
                    <span className="flex-1 text-sm">{x.name}</span>
                    <span className="text-xs text-faint">{pTot.tot ? Math.round((x.minutes / pTot.tot) * 100) : 0}%</span>
                    <span className="num w-14 text-right text-[13px] font-bold text-white">{hm(x.minutes)}</span>
                  </div>
                ))}
              </div>
              <p className="rounded-[10px] bg-blue-bg px-3 py-2.5 text-sm text-blue">
                Sustentação: {hm(pTot.sust)} h no período ({pTot.sust + pTot.dev ? Math.round((pTot.sust / (pTot.sust + pTot.dev)) * 100) : 0}% das horas fora do interno).
              </p>
            </section>
          </div>

          <div className="flex flex-wrap items-stretch gap-[22px]">
            <section aria-labelledby="h-cal" className="card flex min-w-0 flex-[3_1_560px] flex-col gap-3.5 px-5 py-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2.5">
                <h2 id="h-cal" className="text-base font-bold text-white">{cap(monthName(parseISO(calMonth).m))}, dia a dia</h2>
                <DayLegend provisioned />
              </div>
              <MonthCalendar month={calMonth} today={t} days={calDays} holidays={act.holidays} selected={selDay} hrefFor={(d) => href({ m: calMonth.slice(0, 7), dia: d }) + "#dia"} since={act.first.get(id)} />
            </section>
            <aside id="dia" aria-labelledby="h-dia" className="flex min-w-0 flex-[2_1_360px] scroll-mt-6 flex-col gap-2.5 rounded-2xl border border-line-2 bg-surface-2 px-5 py-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="h-dia" className="text-base font-bold text-white">{cap(longDate(selDay))}</h2>
                <span className="num text-[15px] font-bold text-white">{hm(dayEntries.reduce((a, e) => a + e.minutes, 0))}</span>
              </div>
              <p className={cx("rounded-[10px] px-3 py-2.5 text-sm", dayNote.tone === "r" ? "bg-red-bg text-red" : dayNote.tone === "p" ? "bg-[#1c1018] text-accent-soft" : "bg-surface-3 text-muted")}>
                {dayNote.text}
                {dayJust && canSeeReasons && (
                  <>
                    {" "}
                    <a href={`/gestao/pendencias/comprovante/${dayJust.attachmentId}`} className="font-bold !text-accent-soft">
                      Ver comprovante
                    </a>
                  </>
                )}
              </p>
              {dayEntries.map((e) => (
                <div key={e.id} className={cx("flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2", clientFilter && e.clientId !== clientFilter && "opacity-40")}>
                  <ClientChip name={e.clientName.split(" ")[0]} color={e.clientColor} />
                  <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-1">
                    <span className="text-sm font-semibold">{e.itemName}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", typeTone(e))}>{e.typeName}</span>
                      {e.sust && !e.isInternal && <span className="rounded-full bg-blue-bg px-2 py-0.5 text-[11px] font-bold text-blue">Sustentação</span>}
                    </div>
                  </div>
                  <span className="num text-sm font-bold text-white">{hm(e.minutes)}</span>
                </div>
              ))}
            </aside>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-start gap-[22px]">
        <section id="tarefas" aria-labelledby="h-tar" className="flex min-w-0 flex-[3_1_620px] scroll-mt-6 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="h-tar" className="font-display text-xl font-semibold text-white">{consultant ? "Tarefas abertas" : "Tarefas de follow-up"}</h2>
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", tasksShown.some((x) => x.deadline && x.deadline < t) ? "bg-red-bg text-red" : "bg-line-2 text-[#e6d9f2]")}>
              {tasksShown.length} {tasksShown.length === 1 ? "aberta" : "abertas"} · {tasksShown.filter((x) => x.deadline && x.deadline < t).length} atrasada{tasksShown.filter((x) => x.deadline && x.deadline < t).length === 1 ? "" : "s"}
            </span>
            {clientFilter && (
              <span className="inline-flex items-center gap-2 text-[13px] text-muted">
                só {clientMap.get(clientFilter)?.name}
                <Link href={href({ cliente: null })} scroll={false} className="btn-quiet border border-line-5 text-[13px]">
                  Limpar filtro
                </Link>
              </span>
            )}
          </div>
          <div className="table-wrap">
            {tasksShown.length === 0 ? (
              <Empty>{clientFilter ? "Nenhuma tarefa aberta para este cliente." : "Nenhuma tarefa aberta."}</Empty>
            ) : (
              <table className="tbl min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">Tarefa</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Prazo</th>
                    <th scope="col">Etapa</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksShown
                    .sort((a, b) => Number(!!b.deadline && b.deadline < t) - Number(!!a.deadline && a.deadline < t))
                    .map((i) => {
                      const late = !!i.deadline && i.deadline < t;
                      const due = !i.deadline ? "sem prazo" : i.deadline === t ? "hoje" : late ? (diffDays(t, i.deadline) === 1 ? "venceu ontem" : `venceu há ${diffDays(t, i.deadline)} dias`) : shortDate(i.deadline);
                      const si = stageIndex(i.stage);
                      return (
                        <tr key={i.id}>
                          <td>
                            <Link href={`/projetos/${i.id}`} className="flex flex-col gap-0.5 !text-ink no-underline">
                              <span className="font-semibold">{i.name}</span>
                              <span className="text-xs text-faint">{i.annualName}{i.parentName ? ` › ${i.parentName}` : " · tarefa simples"}</span>
                            </Link>
                            {((tags.get(i.id)?.length ?? 0) > 0 || i.isSustentacao || i.outOfScope) && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {i.outOfScope && <span className="rounded-full bg-[#3a1e12] px-2 py-0.5 text-[11px] font-bold text-accent-soft">Demanda adicional</span>}
                                {i.isSustentacao && <span className="rounded-full bg-blue-bg px-2 py-0.5 text-[11px] font-bold text-blue">Sustentação</span>}
                                {tags.get(i.id)?.map((tg) => (
                                  <span key={tg.name} className="rounded-full bg-line-2 px-2 py-0.5 text-[11px] font-bold text-[#e6d9f2]">{tg.name}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <ClientChip name={i.clientName} color={i.clientColor} />
                          </td>
                          <td className={cx("text-[13px] font-bold whitespace-nowrap", late ? "text-red" : due === "hoje" ? "text-yellow" : "text-muted")}>{due}</td>
                          <td>
                            <div className="flex flex-col gap-1">
                              <span className="text-[13px] whitespace-nowrap text-muted">{STAGES[si]?.label ?? i.stage}</span>
                              <div className="flex gap-[3px]" aria-hidden>
                                {[0, 1, 2, 3, 4].map((k) => (
                                  <span key={k} className="h-[5px] w-3.5 rounded-[3px]" style={{ background: k < si ? "#A897F5" : k === si ? "#F07A45" : "#2A1B37" }} />
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {consultant && (
          <section id="avaliacoes" aria-labelledby="h-ava" className="card flex min-w-0 flex-[2_1_360px] scroll-mt-6 flex-col gap-3.5 px-5 py-[18px]">
            <h2 id="h-ava" className="text-base font-bold text-white">Avaliações recebidas</h2>
            {manager &&
              (pendingEvals.length ? (
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl bg-yellow-bg px-3.5 py-3 text-yellow">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.1 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.1-1.5" />
                    <path d="M3 3l18 18" />
                  </svg>
                  <div className="flex flex-[1_1_200px] flex-col gap-0.5">
                    <strong className="text-sm">{pendingEvals.length === 1 ? "1 avaliação aguardando publicação" : `${pendingEvals.length} avaliações aguardando publicação`}</strong>
                    <span className="text-[13px] text-[#e8d9a8]">Ocultas para o consultor até a gestão publicar.</span>
                  </div>
                  <Link href="/gestao/pendencias?aba=avaliacoes" className="inline-flex min-h-11 items-center px-1 text-sm font-bold !text-yellow">
                    Revisar
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted">Nenhuma avaliação aguardando publicação.</p>
              ))}
            {evalBase.length === 0 ? (
              <p className="text-sm text-muted">{manager ? "Nenhuma avaliação recebida." : "Nenhuma avaliação publicada ainda."}</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2.5">
                  <span className="num text-[30px] font-bold text-white">{overall!.toFixed(1).replace(".", ",")}</span>
                  <span className="text-sm text-muted">
                    média de {evalBase.length} {evalBase.length === 1 ? "avaliação" : "avaliações"}
                    {manager && published.length !== evalBase.length ? ` (${published.length} publicada${published.length === 1 ? "" : "s"})` : ""}
                  </span>
                </div>
                <div className="flex flex-col">
                  {parts.map((p) => (
                    <div key={p.k} className="flex min-h-[38px] items-center gap-3 border-t border-line">
                      <span className="w-[90px] shrink-0 text-sm">{p.k}</span>
                      <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                        <span className="rounded-full bg-accent" style={{ width: `${((p.v ?? 0) / 5) * 100}%` }} />
                      </span>
                      <span className="num w-[34px] text-right text-[13px] font-bold text-white">{p.v?.toFixed(1).replace(".", ",")}</span>
                    </div>
                  ))}
                </div>
                <ul className="flex flex-col">
                  {visibleEvals.slice(0, 4).map((e) => (
                    <li key={e.ev.id} className="flex flex-col gap-1 border-t border-line py-2.5">
                      <span className="flex flex-wrap items-center gap-2 text-[13px]">
                        <ClientSwatch color={e.clientColor} />
                        <strong className="text-white">{e.clientName}</strong>
                        <span className="text-faint">{e.contactName} · {shortDate(toISODate(e.ev.createdAt))}</span>
                        {!e.ev.published && <span className="rounded-full bg-yellow-bg px-2 py-0.5 text-[11px] font-bold text-yellow">{e.ev.publishedAt ? "mantida oculta" : "oculta"}</span>}
                      </span>
                      {e.ev.comment && <p className="text-sm text-muted">&ldquo;{e.ev.comment}&rdquo;</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-[22px]">
        <section aria-labelledby="h-ct" className="card flex min-w-0 flex-[1_1_420px] flex-col gap-3 px-5 py-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="h-ct" className="text-base font-bold text-white">Contatos com clientes</h2>
            <span className="text-[13px] text-muted">
              <span className="num font-bold text-white">{contacts.done.length}</span> feitos · {period.label}
            </span>
          </div>
          {contacts.late.length > 0 && (
            <div className="flex flex-col">
              <h3 className="text-[13px] font-bold text-red">Atrasados</h3>
              {contacts.late.map((c) => (
                <ContactRow key={c.id} c={c} late />
              ))}
            </div>
          )}
          {contacts.upcoming.length > 0 && (
            <div className="flex flex-col">
              <h3 className="text-[13px] font-bold text-muted">Agendados</h3>
              {contacts.upcoming.slice(0, 5).map((c) => (
                <ContactRow key={c.id} c={c} />
              ))}
            </div>
          )}
          <div className="flex flex-col">
            <h3 className="text-[13px] font-bold text-muted">Feitos no período</h3>
            {contacts.done.length === 0 && <p className="py-2 text-sm text-muted">Nenhum contato registrado no período.</p>}
            {contacts.done.slice(0, 8).map((c) => (
              <ContactRow key={c.id} c={c} />
            ))}
          </div>
          <Link href="/contatos" className="text-sm font-bold !text-accent-soft">
            Abrir contatos
          </Link>
        </section>

        {consultant && (
          <section aria-labelledby="h-prz" className="card flex min-w-0 flex-[1_1_420px] flex-col gap-3 px-5 py-[18px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="h-prz" className="text-base font-bold text-white">Prazos reprogramados</h2>
              <span className="text-[13px] text-muted">
                prazos cumpridos: <span className="num font-bold text-white">{cur.pct === null ? "—" : `${cur.pct}%`}</span>
                {cur.deadlineTotal ? ` (${cur.deadlineMet} de ${cur.deadlineTotal})` : ""}
              </span>
            </div>
            {changes.length === 0 ? (
              <p className="text-sm text-muted">Nenhum prazo reprogramado no período.</p>
            ) : (
              <ul className="flex flex-col">
                {changes.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1 border-t border-line py-2.5">
                    <Link href={`/projetos/${c.itemId}`} className="text-sm font-semibold no-underline">
                      {c.item}
                    </Link>
                    <span className="num text-[13px] text-muted">
                      {c.old ? shortDate(c.old) : "sem prazo"} para {shortDate(c.new)} · {c.by ?? "Odoo"} em {shortDate(toISODate(c.at))}
                    </span>
                    <span className="text-[13px] text-ink">{c.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-1 text-[13px] font-bold text-muted">Dias sem apontamento no período</h3>
            <p className="text-sm">
              <span className="num font-bold text-white">{cur.missing.length}</span> sem justificativa ·{" "}
              <span className="num font-bold text-white">{cur.justified.length}</span> justificado{cur.justified.length === 1 ? "" : "s"}
              {cur.missing.length > 0 && <span className="text-muted"> ({cur.missing.slice(-6).map(shortDate).join(", ")})</span>}
            </p>
          </section>
        )}
      </div>
    </>
  );
}

function ContactRow({ c, late }: { c: { id: string; clientName: string; clientColor: string; scheduledAt: Date; objective: string; doneOn: string | null }; late?: boolean }) {
  const d = c.doneOn ?? toISODate(c.scheduledAt);
  return (
    <div className="flex min-h-11 items-center gap-2.5 border-t border-line py-1.5">
      <ClientSwatch color={c.clientColor} />
      <span className="min-w-0 flex-1 text-sm">
        <strong className="text-white">{c.clientName}</strong> <span className="text-muted">· {c.objective}</span>
      </span>
      <span className={cx("num text-[13px] whitespace-nowrap", late ? "font-bold text-red" : "text-muted")}>{shortDate(d)}</span>
    </div>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
