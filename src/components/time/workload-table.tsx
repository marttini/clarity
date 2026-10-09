import Link from "next/link";
import type { WorkloadRow } from "@/server/queries/analytics";
import type { Settings } from "@/domain/rules";
import { type ISODate, weekdayShort, shortDate } from "@/domain/dates";
import { Avatar, cx } from "@/components/ui";
import { BandChip, DayDot, SortTh, hm, initials, nextBandText } from "./bits";

export type WorkloadSort = "nome" | "horas" | "projetos" | "clientes" | "tarefas" | "atrasadas" | "aguardando" | "contatos";

export function sortWorkload(rows: WorkloadRow[], col: string, dir: "asc" | "desc") {
  const get: Record<WorkloadSort, (r: WorkloadRow) => number | string> = {
    nome: (r) => r.person.name,
    horas: (r) => r.hours.fat,
    projetos: (r) => r.projects,
    clientes: (r) => r.clients.length,
    tarefas: (r) => r.tasks,
    atrasadas: (r) => r.late,
    aguardando: (r) => r.waitingClient,
    contatos: (r) => r.contactsWeek + r.contactsLate,
  };
  const f = get[col as WorkloadSort] ?? get.horas;
  const k = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
    return c * k || a.person.name.localeCompare(b.person.name);
  });
}

/** Tabela de carga do time (US-44): parede da semana ou só números. */
export function WorkloadTable({
  rows,
  week,
  today,
  clientColors,
  settings,
  view,
  sort,
  dir,
  hrefFor,
  detailHref,
  periodLabel,
}: {
  rows: WorkloadRow[];
  week: ISODate[];
  today: ISODate;
  clientColors: Map<string, { name: string; color: string }>;
  settings: Settings;
  view: "parede" | "numeros";
  sort: string;
  dir: "asc" | "desc";
  hrefFor: (col: string, dir: "asc" | "desc") => string;
  detailHref?: (personId: string) => string;
  periodLabel: string;
}) {
  const wall = view === "parede";
  const th = (col: WorkloadSort, label: string) => <SortTh key={col} col={col} label={label} current={sort} dir={dir} hrefFor={hrefFor} />;
  return (
    <div className="table-wrap">
      <table className="tbl min-w-[1080px]">
        <thead>
          <tr>
            {th("nome", "Consultor")}
            <th scope="col">{wall ? `Semana por cliente (${shortDate(week[0])} a ${shortDate(week[4])})` : "Últimos dias úteis"}</th>
            {th("horas", `Horas faturáveis · ${periodLabel}`)}
            {th("clientes", "Clientes")}
            {th("projetos", "Projetos")}
            {th("tarefas", "Tarefas")}
            {th("atrasadas", "Atrasadas")}
            {th("aguardando", "Aguard. cliente")}
            {th("contatos", "Contatos da semana")}
            <th scope="col">Faixa do mês</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.person.id} className="hover:bg-surface-3">
              <td>
                <Link href={`/time/${r.person.id}`} className="flex min-h-11 items-center gap-2.5 no-underline">
                  <Avatar name={r.person.name} initials={initials(r.person.name)} size={32} />
                  <span className="flex flex-col">
                    <strong className="whitespace-nowrap text-white">{r.person.name}</strong>
                    {r.lostBonus ? (
                      <span className="text-xs font-bold text-red">sem bônus no mês</span>
                    ) : r.missingStreak > 0 ? (
                      <span className="text-xs font-semibold text-yellow">{r.missingStreak === 1 ? "1 dia útil sem apontar" : `${r.missingStreak} dias úteis sem apontar`}</span>
                    ) : null}
                  </span>
                </Link>
              </td>
              <td className="!py-2">
                <div className={cx("flex items-end gap-1", wall ? "w-[220px]" : "w-[150px]")}>
                  {r.week.map((d) => {
                    const past = d.date < today;
                    const empty = d.total === 0 && past;
                    const aria = `${weekdayShort(d.date)} ${shortDate(d.date)}: ${d.total ? hm(d.total) + " h" : past ? "sem horas" : "ainda não"}`;
                    return (
                      <div
                        key={d.date}
                        role="img"
                        aria-label={aria}
                        title={aria}
                        className={cx("flex flex-1 flex-col-reverse gap-px overflow-hidden rounded-[5px]", wall ? "h-12" : "h-3.5", empty ? "bg-red-bg" : "bg-surface-3")}
                      >
                        {wall
                          ? d.byClient.map((c) => (
                              <span key={c.clientId} style={{ flex: `0 0 ${Math.max(2, Math.round((Math.min(c.minutes, 600) / 600) * 48))}px`, background: clientColors.get(c.clientId)?.color ?? "#9C93AE" }} />
                            ))
                          : d.date <= today && (
                              <span
                                className={cx(
                                  "flex-1",
                                  d.total <= 0 ? "bg-day-red" : d.total < 240 ? "bg-day-yellow" : d.total <= 360 ? "bg-day-blue" : "bg-day-green",
                                )}
                              />
                            )}
                      </div>
                    );
                  })}
                </div>
              </td>
              <td>
                <Link href={detailHref ? detailHref(r.person.id) : `/time/${r.person.id}`} scroll={false} className="flex flex-col gap-0.5 no-underline">
                  <span className="num inline-flex items-center gap-2 font-bold text-white">
                    <DayDot minutes={r.avgFat} title={`Média faturável por dia útil: ${hm(r.avgFat)} h`} />
                    {hm(r.hours.fat)}
                  </span>
                  <span className="text-xs text-faint">{hm(r.avgFat)}/dia útil</span>
                </Link>
              </td>
              <td className="num">
                <span className="inline-flex items-center gap-1.5" title={r.clients.map((c) => c.name).join(", ")}>
                  {r.clients.length}
                  <span className="flex gap-0.5" aria-hidden>
                    {r.clients.slice(0, 6).map((c) => (
                      <span key={c.id} className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    ))}
                  </span>
                </span>
              </td>
              <td className="num">{r.projects}</td>
              <td className="num">{r.tasks}</td>
              <td className={cx("num font-bold", r.late ? "text-red" : "text-ink")}>{r.late}</td>
              <td className={cx("num", r.waitingClient ? "font-bold text-yellow" : "text-faint")}>{r.waitingClient}</td>
              <td>
                <span className="num">{r.contactsWeek}</span>
                {r.contactsLate > 0 && <span className="ml-2 text-xs font-bold text-red">{r.contactsLate} atrasado{r.contactsLate > 1 ? "s" : ""}</span>}
              </td>
              <td>
                <div className="flex flex-col items-start gap-1">
                  <BandChip minutes={r.monthFat} settings={settings} />
                  <span className="text-xs whitespace-nowrap text-muted">{nextBandText(r.monthFat, settings)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
