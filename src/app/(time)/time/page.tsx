import Link from "next/link";
import type { Metadata } from "next";
import { requireTeam } from "@/server/session";
import { getClients, getSettings } from "@/server/data/common";
import { entryList, groupHours, groupTypes, provisionedEntries, sumHours, workload } from "@/server/queries/analytics";
import { resolvePeriod } from "@/domain/period";
import { now, today } from "@/lib/clock";
import { PeriodSelector } from "@/components/period";
import { ClientSwatch, Empty, Segmented, cx } from "@/components/ui";
import { WorkloadTable, sortWorkload } from "@/components/time/workload-table";
import { EntryList } from "@/components/time/entry-list";
import { DayLegend, TYPE_COLOR, hm, param, withQuery, type SP } from "@/components/time/bits";

export const metadata: Metadata = { title: "Carga do time" };

/** US-44 + US-07: carga do time e horas da equipe em qualquer período. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireTeam();
  const sp = await searchParams;
  const t = today();
  const period = resolvePeriod({ p: param(sp, "p"), de: param(sp, "de"), ate: param(sp, "ate") }, t);
  const view = param(sp, "vista") === "numeros" ? "numeros" : "parede";
  const sort = param(sp, "ordem") ?? "horas";
  const dir = param(sp, "dir") === "asc" ? "asc" : "desc";
  const det = param(sp, "det");

  const [settings, clients, wl] = await Promise.all([getSettings(), getClients(), workload(period, t, now())]);
  const clientMap = new Map(clients.map((c) => [c.id, { name: c.name, color: c.color }]));
  const ids = wl.rows.map((r) => r.person.id);
  const rows = sortWorkload(wl.rows, sort, dir);

  // Totais do período (só realizado), por cliente, tipo e sustentação x desenvolvimento.
  const periodRows = wl.act.rows.filter((r) => r.date >= period.from && r.date <= period.to);
  const total = sumHours(periodRows, wl.act.kinds);
  const byClient = [...groupHours(periodRows, wl.act.kinds, (r) => r.clientId).entries()]
    .map(([id, h]) => ({ id, ...clientMap.get(id), h }))
    .sort((a, b) => b.h.tot - a.h.tot);
  const byType = groupTypes(periodRows, wl.act.kinds);
  const prov = await provisionedEntries({ range: period, personIds: ids });
  const provTotal = prov.reduce((a, p) => a + p.minutes, 0);
  const maxClient = Math.max(1, ...byClient.map((c) => c.h.tot));

  // Detalhe: apontamentos que compõem um total.
  let detail: { title: string; rows: Awaited<ReturnType<typeof entryList>> } | null = null;
  if (det) {
    const [kind, id] = det.split(":");
    const base = { from: period.from, to: period.to };
    if (kind === "pessoa" && id) {
      const name = wl.rows.find((r) => r.person.id === id)?.person.name ?? "Consultor";
      detail = { title: `Apontamentos de ${name}`, rows: await entryList(base, { personId: id }) };
    } else if (kind === "cliente" && id) detail = { title: `Apontamentos em ${clientMap.get(id)?.name ?? "cliente"}`, rows: await entryList(base, { clientId: id }) };
    else if (kind === "tipo" && id) detail = { title: `Apontamentos do tipo ${byType.find((x) => x.typeId === id)?.name ?? ""}`, rows: await entryList(base, { typeId: id }) };
    else if (kind === "sust") detail = { title: id === "1" ? "Apontamentos de sustentação" : "Apontamentos de desenvolvimento", rows: await entryList(base, { sust: id === "1" }) };
    else if (kind === "prov") detail = { title: "Horas provisionadas (fora do realizado)", rows: await entryList(base, { includeProvisioning: true }).then((r) => r.filter((x) => x.isProvisioning)) };
    else if (kind === "todos") detail = { title: "Todos os apontamentos do período", rows: await entryList(base) };
  }
  const detHref = (v: string) => withQuery("/time", sp, { det: v }) + "#apontamentos";
  const susPct = total.sust + total.dev ? Math.round((total.sust / (total.sust + total.dev)) * 100) : 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="h1">Carga do time</h1>
          <p className="text-[15px] text-muted">
            {wl.rows.length} consultores · {period.label}. Só horas faturáveis entram em faixas e metas.
          </p>
        </div>
        <PeriodSelector value={period.key} from={period.from} to={period.to} />
      </div>

      <section aria-labelledby="h-carga" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3.5">
            <h2 id="h-carga" className="h2">Por consultor</h2>
            <Segmented
              options={[
                { value: "parede", label: "Parede da semana" },
                { value: "numeros", label: "Só números" },
              ]}
              value={view}
              hrefFor={(v) => withQuery("/time", sp, { vista: v === "parede" ? null : v })}
            />
          </div>
          {view === "parede" ? (
            <div className="flex flex-wrap gap-2.5 text-xs text-muted">
              {byClient.slice(0, 10).map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color }} />
                  {c.name}
                </span>
              ))}
            </div>
          ) : (
            <DayLegend />
          )}
        </div>
        {rows.length === 0 ? (
          <Empty>Nenhum consultor ativo.</Empty>
        ) : (
          <WorkloadTable
            rows={rows}
            week={wl.week}
            today={t}
            clientColors={clientMap}
            settings={settings}
            view={view}
            sort={sort}
            dir={dir}
            hrefFor={(col, d) => withQuery("/time", sp, { ordem: col, dir: d })}
            detailHref={(pid) => detHref(`pessoa:${pid}`)}
            periodLabel={period.key === "mes" ? "mês" : period.label}
          />
        )}
        <p className="text-[13px] text-faint">
          A bolinha ao lado das horas usa a cor do dia aplicada à média faturável por dia útil. Clique no nome para abrir a ficha e nas horas para ver os apontamentos.
        </p>
      </section>

      <section aria-labelledby="h-totais" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="h-totais" className="h2">Horas do período</h2>
          <Link href={detHref("todos")} scroll={false} className="num text-sm font-bold !text-accent-soft">
            {hm(total.tot)} h realizadas
          </Link>
        </div>
        <div className="flex flex-wrap items-start gap-5">
          <div className="card flex min-w-0 flex-[3_1_480px] flex-col gap-2 p-5">
            <h3 className="h3">Por cliente</h3>
            {byClient.length === 0 && <p className="py-3 text-sm text-muted">Nenhuma hora lançada neste período.</p>}
            {byClient.map((c) => (
              <Link
                key={c.id}
                href={detHref(`cliente:${c.id}`)}
                scroll={false}
                className={cx("flex min-h-11 items-center gap-3 rounded-[10px] px-2 no-underline hover:bg-line", det === `cliente:${c.id}` && "bg-line-2")}
              >
                <span className="flex w-[150px] shrink-0 items-center gap-2 truncate text-sm font-semibold">
                  <ClientSwatch color={c.color ?? "#9C93AE"} />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="flex h-3.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span className="h-full" style={{ width: `${(c.h.fat / maxClient) * 100}%`, background: c.color }} />
                  <span className="h-full opacity-50" style={{ width: `${((c.h.tot - c.h.fat) / maxClient) * 100}%`, background: c.color }} />
                </span>
                <span className="num w-16 shrink-0 text-right text-[13px] font-bold text-white">{hm(c.h.tot)}</span>
                <span className="num hidden w-24 shrink-0 text-right text-xs text-faint sm:inline">{hm(c.h.fat)} fat.</span>
              </Link>
            ))}
          </div>
          <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-5">
            <div className="card flex flex-col gap-3 p-5">
              <h3 className="h3">Por tipo</h3>
              <div className="flex h-3.5 overflow-hidden rounded-full bg-line" aria-hidden>
                {byType.map((x) => (
                  <span key={x.typeId} style={{ width: `${(x.minutes / Math.max(1, total.tot)) * 100}%`, background: TYPE_COLOR[x.kind] ?? "#A897F5" }} />
                ))}
              </div>
              <div className="flex flex-col">
                {byType.map((x) => (
                  <Link key={x.typeId} href={detHref(`tipo:${x.typeId}`)} scroll={false} className="flex min-h-10 items-center gap-2.5 border-t border-line no-underline">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: TYPE_COLOR[x.kind] ?? "#A897F5" }} />
                    <span className="flex-1 text-sm">{x.name}</span>
                    <span className="text-xs text-faint">{total.tot ? Math.round((x.minutes / total.tot) * 100) : 0}%</span>
                    <span className="num w-16 text-right text-[13px] font-bold text-white">{hm(x.minutes)}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="card flex flex-col gap-2 p-5">
              <h3 className="h3">Sustentação x desenvolvimento</h3>
              <div className="flex h-3.5 overflow-hidden rounded-full bg-line" aria-hidden>
                <span className="bg-blue" style={{ width: `${susPct}%` }} />
                <span className="bg-[#A897F5]" style={{ width: `${100 - susPct}%` }} />
              </div>
              <Link href={detHref("sust:1")} scroll={false} className="flex min-h-10 items-center gap-2.5 border-t border-line no-underline">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-blue" />
                <span className="flex-1 text-sm">Sustentação</span>
                <span className="text-xs text-faint">{susPct}%</span>
                <span className="num w-16 text-right text-[13px] font-bold text-white">{hm(total.sust)}</span>
              </Link>
              <Link href={detHref("sust:0")} scroll={false} className="flex min-h-10 items-center gap-2.5 border-t border-line no-underline">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-[#A897F5]" />
                <span className="flex-1 text-sm">Desenvolvimento</span>
                <span className="text-xs text-faint">{100 - susPct}%</span>
                <span className="num w-16 text-right text-[13px] font-bold text-white">{hm(total.dev)}</span>
              </Link>
              <p className="text-xs text-faint">Horas internas ficam fora desta divisão.</p>
            </div>
            <Link href={detHref("prov")} scroll={false} className="flex min-h-12 items-center gap-3 rounded-[14px] border-[1.5px] border-dashed border-accent px-4 no-underline hover:bg-surface-3">
              <span className="flex-1 text-sm">
                <strong className="text-white">Provisionado à parte</strong>
                <span className="block text-xs text-muted">Reserva de agenda. Não soma no realizado nem nas metas.</span>
              </span>
              <span className="num text-[15px] font-bold text-accent-soft">{hm(provTotal)}</span>
            </Link>
          </div>
        </div>
      </section>

      {detail && <EntryList rows={detail.rows} title={detail.title} closeHref={withQuery("/time", sp, { det: null })} />}
    </>
  );
}
