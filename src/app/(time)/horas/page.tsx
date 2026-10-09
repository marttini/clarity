import Link from "next/link";
import type { Metadata } from "next";
import { requireTeam } from "@/server/session";
import { getHolidays, getSettings } from "@/server/data/common";
import { absenceReasons, dailyMinutes, launcherOptions, lastChangeByEntry, monthRuler, myChangeRequests, myEntries, type MyEntry } from "@/server/queries/fila";
import { loadJustifications } from "@/server/queries/analytics";
import { now as clockNow, today as clockToday } from "@/lib/clock";
import { resolvePeriod } from "@/domain/period";
import { addDays, eachDay, endOfMonth, formatMinutes, isWorkday, longDate, shortDate, startOfMonth, weekday, weekdayShort, type ISODate } from "@/domain/dates";
import { dayColor } from "@/domain/rules";
import { PeriodSelector } from "@/components/period";
import { Arrow, Segmented, cx } from "@/components/ui";
import { DAY_HEX, Legend, dayMonth } from "@/components/fila/bits";
import { EntryActions, JustifyForm } from "@/components/horas/entry-actions";

export const metadata: Metadata = { title: "Minhas horas" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
const validDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function href(sp: SP, patch: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return `/horas${s ? `?${s}` : ""}`;
}

const SYNC = {
  pendente: { label: "Pendente", cls: "bg-line-2 text-[#e6d9f2]" },
  enviado: { label: "Enviado", cls: "bg-green-bg text-green" },
  erro: { label: "Erro", cls: "bg-red-bg text-red" },
  nao_sincroniza: { label: "Só no Clarity", cls: "bg-line-2 text-muted" },
} as const;

const dtFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** US-06, US-04, US-09, US-11, US-12: meus apontamentos por dia, semana ou período. */
export default async function HoursPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireTeam();
  if (!me.isConsultor) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="h1">Minhas horas</h1>
        <p className="text-muted">
          Seu perfil não aponta horas. Seus contatos estão na <Link href="/fila">Minha fila</Link>.
        </p>
      </div>
    );
  }
  const sp = await searchParams;
  const t = clockToday();
  const nowAt = clockNow();
  const view = (["dia", "semana", "periodo"] as const).find((v) => v === one(sp, "v")) ?? "semana";
  const anchor = validDate(one(sp, "d")) ?? t;
  const monday = addDays(anchor, -((weekday(anchor) + 6) % 7));
  const period = resolvePeriod({ p: one(sp, "p"), de: one(sp, "de"), ate: one(sp, "ate") }, t);
  const range = view === "dia" ? { from: anchor, to: anchor } : view === "semana" ? { from: monday, to: addDays(monday, 6) } : { from: period.from, to: period.to };
  const clientId = validId(one(sp, "cliente"));
  const typeId = validId(one(sp, "tipo"));

  const settings = await getSettings();
  const [entries, holidays, just, daily, crs, reasons, ruler] = await Promise.all([
    myEntries(me.id, range, { clientId, typeId, settings }),
    getHolidays(),
    loadJustifications([me.id], { from: addDays(range.from < startOfMonth(t) ? range.from : startOfMonth(t), 0), to: range.to > endOfMonth(t) ? range.to : endOfMonth(t) }),
    dailyMinutes(me.id, range.from, range.to),
    myChangeRequests(me.id, nowAt, 30),
    absenceReasons(),
    monthRuler(me.id, t),
  ]);
  const [opts, changes] = await Promise.all([launcherOptions(me.id, t, { includeItemIds: [...new Set(entries.map((e) => e.itemId))] }), lastChangeByEntry(entries.map((e) => e.id))]);
  const justMap = new Map(just.map((j) => [j.date, j]));

  // Totais por tipo (provisionado à parte).
  const real = entries.filter((e) => !e.isProvisioning);
  const provEntries = entries.filter((e) => e.isProvisioning);
  const byType = new Map<string, { name: string; minutes: number }>();
  for (const e of real) byType.set(e.typeId, { name: e.typeName, minutes: (byType.get(e.typeId)?.minutes ?? 0) + e.minutes });
  const totalReal = real.reduce((a, e) => a + e.minutes, 0);
  const totalProv = provEntries.reduce((a, e) => a + e.minutes, 0);
  const sust = real.filter((e) => e.sust && !e.isInternal).reduce((a, e) => a + e.minutes, 0);

  // Dias mostrados: todos do intervalo na visão Dia/Semana; no Período, só dias com lançamento ou dias úteis passados.
  const days = eachDay(range.from, range.to).filter((d) => {
    const has = entries.some((e) => e.date === d);
    if (view === "periodo") return has || (isWorkday(d, holidays) && d <= t);
    return has || weekday(d) !== 0 && weekday(d) !== 6;
  });
  const first = ruler.first;
  const missingMonth = ruler.days.filter((d) => !d.future && !d.isToday && !d.holiday && d.minutes === 0 && !d.justified && (!first || d.date >= first)).map((d) => d.date);
  const justifiedMonth = ruler.justified.filter((j) => j.date >= startOfMonth(t));
  const filtered = !!clientId || !!typeId;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">Minhas horas</h1>
          <p className="text-[15px] text-muted">Edição livre por 48 h depois do lançamento. Depois disso, peça a alteração.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={[
              { value: "dia", label: "Dia" },
              { value: "semana", label: "Semana" },
              { value: "periodo", label: "Período" },
            ]}
            value={view}
            hrefFor={(v) => href(sp, { v })}
          />
          <Link href="/fila#lancar" className="btn-primary no-underline hover:text-on-accent">
            Lançar horas
          </Link>
        </div>
      </div>

      <section aria-label="Filtros" className="flex flex-wrap items-end gap-3">
        {view === "periodo" ? (
          <PeriodSelector value={period.key} from={period.from} to={period.to} />
        ) : (
          <nav aria-label={view === "dia" ? "Navegar entre dias" : "Navegar entre semanas"} className="flex flex-wrap items-center gap-2">
            <Link href={href(sp, { d: addDays(view === "dia" ? anchor : monday, view === "dia" ? -1 : -7) })} className="btn-ghost min-h-11 no-underline" aria-label={view === "dia" ? "Dia anterior" : "Semana anterior"}>
              <Arrow dir="right" className="rotate-180" />
            </Link>
            <span className="num min-w-[150px] text-center text-sm font-bold text-white">
              {view === "dia" ? cap(longDate(anchor)) : `${shortDate(monday)} a ${shortDate(addDays(monday, 6))}`}
            </span>
            <Link href={href(sp, { d: addDays(view === "dia" ? anchor : monday, view === "dia" ? 1 : 7) })} className="btn-ghost min-h-11 no-underline" aria-label={view === "dia" ? "Próximo dia" : "Próxima semana"}>
              <Arrow dir="right" />
            </Link>
            {(view === "dia" ? anchor !== t : monday !== addDays(t, -((weekday(t) + 6) % 7))) && (
              <Link href={href(sp, { d: null })} className="btn-quiet no-underline">
                {view === "dia" ? "Hoje" : "Esta semana"}
              </Link>
            )}
          </nav>
        )}
        <form method="get" action="/horas" className="ml-auto flex flex-wrap items-end gap-2">
          {(["v", "d", "p", "de", "ate"] as const).map((k) => (one(sp, k) ? <input key={k} type="hidden" name={k} value={one(sp, k)} /> : null))}
          <label className="flex flex-col gap-1">
            <span className="label">Cliente</span>
            <select name="cliente" defaultValue={clientId ?? ""} className="field min-h-10 w-auto py-1 text-sm">
              <option value="">Todos</option>
              {opts.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Tipo</span>
            <select name="tipo" defaultValue={typeId ?? ""} className="field min-h-10 w-auto py-1 text-sm">
              <option value="">Todos</option>
              {opts.types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-ghost min-h-10">Filtrar</button>
          {filtered && (
            <Link href={href(sp, { cliente: null, tipo: null })} className="btn-quiet no-underline">
              Limpar
            </Link>
          )}
        </form>
      </section>

      {view !== "dia" && (
        <section aria-label="Dias" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="h3 text-base">{view === "semana" ? "Semana, dia a dia" : `${cap(period.label)}, dia a dia`}</h2>
            <Legend />
          </div>
          <div className="overflow-x-auto pb-1">
            <ol className="m-0 flex list-none gap-1.5 p-0">
              {eachDay(range.from, range.to)
                .filter((d) => view === "semana" || weekday(d) !== 0)
                .filter((d) => weekday(d) !== 6 || (daily.get(d)?.minutes ?? 0) > 0 || view === "semana")
                .map((d) => {
                  const v = daily.get(d) ?? { minutes: 0, prov: 0, fat: 0 };
                  const work = isWorkday(d, holidays);
                  const past = d <= t;
                  const j = justMap.get(d);
                  const color = work && past ? (v.minutes === 0 && j ? "#15301F" : DAY_HEX[dayColor(v.minutes)]) : v.minutes > 0 ? DAY_HEX[dayColor(v.minutes)] : "#2A1B37";
                  return (
                    <li key={d} className="min-w-[60px] flex-1">
                      <Link
                        href={href(sp, { v: "dia", d })}
                        className={cx("flex flex-col items-center gap-1 rounded-[10px] border px-1 pt-2 pb-2.5 no-underline", d === t ? "border-accent bg-[#24142F]" : "border-line-2 bg-surface-2")}
                      >
                        <span className="text-[11px] text-muted">
                          {weekdayShort(d)} {d.slice(8)}
                        </span>
                        <span className="num text-sm font-bold text-white">{!work && !v.minutes ? "–" : !past && !v.minutes ? "–" : formatMinutes(v.minutes)}</span>
                        <span aria-hidden className="h-1 w-8 rounded-full" style={{ background: color }} />
                        {v.prov > 0 && <span className="num rounded border border-dashed border-accent px-1 text-[10px] text-accent-soft">+{formatMinutes(v.prov)}</span>}
                        {holidays.has(d) && <span className="text-[10px] text-faint">feriado</span>}
                        {j && !v.minutes && <span className="text-[10px] text-green">justif.</span>}
                      </Link>
                    </li>
                  );
                })}
            </ol>
          </div>
        </section>
      )}

      <section aria-label="Totais" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <span>
          <strong className="num text-lg text-white">{formatMinutes(totalReal)} h</strong> {view === "dia" ? "no dia" : view === "semana" ? "na semana" : "no período"}
          {filtered ? " (filtrado)" : ""}
        </span>
        {[...byType.values()].map((x) => (
          <span key={x.name}>
            {x.name} <strong className="num text-white">{formatMinutes(x.minutes)}</strong>
          </span>
        ))}
        {totalReal > 0 && (
          <span>
            Sustentação <strong className="num text-white">{formatMinutes(sust)}</strong>
          </span>
        )}
        {totalProv > 0 && (
          <span className="rounded-lg border border-dashed border-accent px-2 py-0.5 text-accent-soft">
            Provisionado à parte <strong className="num">{formatMinutes(totalProv)}</strong>
          </span>
        )}
      </section>

      <div className="flex flex-col gap-5">
        {days.length === 0 && <p className="rounded-2xl border border-line bg-surface px-4 py-8 text-center text-muted">Nenhum apontamento neste período.</p>}
        {groupWeeks(days, view === "periodo").map((w) => (
          <div key={w.key} className="flex flex-col gap-4">
            {view === "periodo" && w.days.length > 0 && (
              <h2 className="h3 flex flex-wrap items-baseline gap-2 border-b border-line pb-1.5 text-[15px]">
                Semana de {shortDate(w.key)}
                <span className="num text-sm font-semibold text-muted">{formatMinutes(entries.filter((e) => !e.isProvisioning && w.days.includes(e.date)).reduce((a, e) => a + e.minutes, 0))} h</span>
              </h2>
            )}
            {w.days.map((d) => {
              const list = entries.filter((e) => e.date === d);
              const realMin = list.filter((e) => !e.isProvisioning).reduce((a, e) => a + e.minutes, 0);
              const provMin = list.filter((e) => e.isProvisioning).reduce((a, e) => a + e.minutes, 0);
              const work = isWorkday(d, holidays);
              const j = justMap.get(d);
              const missing = work && d < t && realMin === 0 && !j && !filtered;
              return (
                <section key={d} aria-labelledby={`d-${d}`} className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1.5">
                    <span aria-hidden className="size-3 rounded-[3px]" style={{ background: work && d <= t ? (realMin === 0 && j ? "#3FA06C55" : DAY_HEX[dayColor(realMin)]) : "#2A1B37" }} />
                    <h2 id={`d-${d}`} className="m-0 text-[15px] font-bold text-white">
                      {cap(longDate(d))}
                      {d === t ? " · hoje" : ""}
                    </h2>
                    <span className="num text-sm font-bold text-white">{formatMinutes(realMin)} h</span>
                    {provMin > 0 && <span className="num rounded-md border border-dashed border-accent px-1.5 text-xs text-accent-soft">+{formatMinutes(provMin)} provisionado</span>}
                    {holidays.has(d) && <span className="rounded-full bg-line-2 px-2 py-0.5 text-xs font-bold text-muted">Feriado</span>}
                    {j && <span className="rounded-full bg-green-bg px-2 py-0.5 text-xs font-bold text-green">Dia justificado · {j.reason}</span>}
                    {missing && (
                      <Link href={`${href(sp, {})}#justificar`} className="rounded-full bg-red-bg px-2.5 py-0.5 text-xs font-bold text-red no-underline">
                        Sem apontamento · justificar
                      </Link>
                    )}
                  </div>
                  {list.length === 0 ? (
                    <p className="border-t border-line px-1 py-3 text-sm text-faint">{work ? (d > t ? "Dia futuro. Só Provisionamento." : "Nada lançado.") : "Fim de semana ou feriado."}</p>
                  ) : (
                    list.map((e) => <EntryRow key={e.id} e={e} today={t} nowAt={nowAt} change={changes.get(e.id) ?? null} opts={opts} />)
                  )}
                </section>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-[26px]">
        <section id="justificar" aria-labelledby="js" className="card flex min-w-0 flex-[1_1_420px] scroll-mt-6 flex-col gap-3.5 p-5">
          <h2 id="js" className="h3 text-base">
            Dias sem apontamento em {cap(longDate(t).split(" de ").at(-1)!)}
          </h2>
          {missingMonth.length ? (
            <>
              <p className="text-sm text-muted">
                {missingMonth.map(dayMonth).join(", ")}. Lance as horas ou justifique com comprovante (Liberação do gestor, Férias, Atestado...). Sem aprovação: o comprovante já tira o dia da regra dos {settings.missingDaysLimit} dias.
              </p>
              <JustifyForm days={missingMonth} reasons={reasons} defaultDate={missingMonth.at(-1)} />
            </>
          ) : (
            <p className="text-sm text-green">Nenhum dia útil sem apontamento neste mês.</p>
          )}
          {justifiedMonth.length > 0 && (
            <div className="flex flex-col">
              <h3 className="mb-1 text-[13px] font-bold text-muted">Justificados no mês</h3>
              {justifiedMonth.map((j) => (
                <div key={j.date} className="flex flex-wrap items-center gap-x-3 border-t border-line py-2 text-sm">
                  <span className="num w-12 font-bold text-white">{shortDate(j.date)}</span>
                  <span className="flex-1">
                    {j.reason}
                    {j.note ? ` · ${j.note}` : ""}
                  </span>
                  <a href={`/gestao/pendencias/comprovante/${j.attachmentId}`} target="_blank" rel="noreferrer" className="btn-quiet">
                    Ver comprovante
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="pedidos" aria-labelledby="pd" className="card flex min-w-0 flex-[1_1_420px] scroll-mt-6 flex-col p-5">
          <h2 id="pd" className="h3 mb-1.5 text-base">
            Pedidos de alteração
          </h2>
          {crs.length === 0 && <p className="text-sm text-faint">Nenhum pedido nos últimos 30 dias.</p>}
          {crs.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2.5">
              <Link href={href(sp, { v: "dia", d: c.date })} className="num w-12 text-sm font-bold text-white no-underline">
                {shortDate(c.date)}
              </Link>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                <span className="text-sm font-semibold">
                  {c.kind === "excluir" ? "Excluir" : "Alterar"} {formatMinutes(c.minutes)} h
                  {c.kind === "alterar" && c.newValues && typeof c.newValues.minutes === "number" && c.newValues.minutes !== c.minutes ? ` para ${formatMinutes(c.newValues.minutes as number)} h` : ""}
                </span>
                <span className="text-xs text-faint">{c.justification}</span>
                {c.status === "recusada" && <span className="text-xs font-semibold text-red">Motivo da recusa: {c.reason ?? "não informado"}</span>}
              </span>
              <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", c.status === "pendente" ? "bg-yellow-bg text-yellow" : c.status === "aprovada" ? "bg-green-bg text-green" : "bg-red-bg text-red")}>
                {c.status === "pendente" ? "Pendente" : c.status === "aprovada" ? `Aprovada${c.decider ? ` por ${c.decider.split(" ")[0]}` : ""}` : "Recusada"}
              </span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function validId(v?: string) {
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
}

function groupWeeks(days: ISODate[], byWeek: boolean) {
  if (!byWeek) return [{ key: "all", days }];
  const m = new Map<string, ISODate[]>();
  for (const d of days) {
    const mon = addDays(d, -((weekday(d) + 6) % 7));
    m.set(mon, [...(m.get(mon) ?? []), d]);
  }
  return [...m.entries()].reverse().map(([key, ds]) => ({ key, days: ds.reverse() }));
}

function EntryRow({
  e,
  today,
  nowAt,
  change,
  opts,
}: {
  e: MyEntry;
  today: ISODate;
  nowAt: Date;
  change: { status: "pendente" | "aprovada" | "recusada"; kind: "alterar" | "excluir"; reason: string | null } | null;
  opts: Awaited<ReturnType<typeof launcherOptions>>;
}) {
  const editable = nowAt.getTime() < e.editUntil.getTime();
  const sync = SYNC[e.syncStatus];
  return (
    <div className={cx("flex flex-wrap items-start gap-x-3.5 gap-y-2 border-t border-line px-1 py-3", e.isProvisioning && "bg-[#1C1018]")}>
      <span className="shrink-0 rounded-md px-[9px] py-1 text-xs font-extrabold" style={{ background: e.clientColor, color: "#1A0F22" }}>
        {e.clientName}
      </span>
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <Link href={`/projetos/${e.itemId}`} className="text-[15px] font-semibold text-white no-underline">
          {e.itemName}
        </Link>
        <span className="text-xs text-faint">{e.parentName ? `${e.annualName} › ${e.parentName}` : e.annualName}</span>
        <span className="text-sm text-ink">{e.description}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", e.isProvisioning ? "border border-dashed border-accent text-accent-soft" : e.countsForBonus ? "bg-[#3A1E12] text-accent-soft" : "bg-line-2 text-[#e6d9f2]")}>{e.typeName}</span>
          {e.sust && !e.isInternal && <span className="rounded-full bg-blue-bg px-2 py-0.5 text-[11px] font-bold text-blue">Sustentação</span>}
          {e.salesOrder && <span className="num rounded-full bg-line-2 px-2 py-0.5 text-[11px] text-muted">{e.salesOrder}</span>}
          {e.convertedAt && <span className="rounded-full bg-green-bg px-2 py-0.5 text-[11px] font-bold text-green">Convertido</span>}
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", sync.cls)} title="Situação no Odoo">
            Odoo: {sync.label}
          </span>
          {change && change.status !== "pendente" && (
            <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", change.status === "aprovada" ? "bg-green-bg text-green" : "bg-red-bg text-red")}>
              Alteração {change.status === "aprovada" ? "aprovada" : `recusada${change.reason ? `: ${change.reason}` : ""}`}
            </span>
          )}
        </div>
        {e.syncStatus === "erro" && e.syncError && <span className="text-xs font-semibold text-red">Erro no Odoo: {e.syncError}. A gestão pode reenviar.</span>}
        {editable && !e.pendingChange && <span className="text-[11px] text-faint">Editável até {dtFmt.format(e.editUntil).replace(",", " às")}</span>}
      </div>
      <span className="num w-16 shrink-0 pt-0.5 text-right text-[17px] font-bold text-white">{formatMinutes(e.minutes)}</span>
      <div className="flex min-w-0 shrink-0 justify-end max-sm:w-full sm:max-w-[560px]">
        <EntryActions
          entry={{ id: e.id, date: e.date, minutes: e.minutes, description: e.description, itemId: e.itemId, clientId: e.clientId, typeId: e.typeId, sust: e.sust, soId: e.salesOrderLineId, isProvisioning: e.isProvisioning }}
          opts={opts}
          today={today}
          editable={editable}
          pendingChange={e.pendingChange}
          canConvert={e.isProvisioning && e.date <= today}
        />
      </div>
    </div>
  );
}
