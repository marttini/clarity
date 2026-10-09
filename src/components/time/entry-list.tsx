import Link from "next/link";
import type { entryList } from "@/server/queries/analytics";
import { shortDate, weekdayShort } from "@/domain/dates";
import { ClientChip, Empty, cx } from "@/components/ui";
import { hm } from "./bits";

type Row = Awaited<ReturnType<typeof entryList>>[number];

export function typeTone(r: { isProvisioning: boolean; isInternal: boolean; countsForBonus: boolean; typeCode: string }) {
  if (r.isProvisioning) return "bg-[#3a1e12] text-accent-soft";
  if (r.countsForBonus) return "bg-line-2 text-[#e6d9f2]";
  if (r.isInternal) return "bg-line text-muted";
  return "bg-blue-bg text-blue";
}

/** Lista de apontamentos que compõem um total (US-07: clique no total abre os apontamentos). */
export function EntryList({ rows, title, closeHref, limit = 300 }: { rows: Row[]; title: string; closeHref: string; limit?: number }) {
  const total = rows.reduce((a, r) => a + r.minutes, 0);
  return (
    <section id="apontamentos" aria-labelledby="h-apont" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="h-apont" className="h2">{title}</h2>
          <span className="num text-sm font-bold text-white">{hm(total)} h</span>
          <span className="text-sm text-muted">{rows.length} lançamento{rows.length === 1 ? "" : "s"}</span>
        </div>
        <Link href={closeHref} scroll={false} className="btn-ghost text-sm">
          Fechar
        </Link>
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <Empty>Nenhum apontamento neste filtro.</Empty>
        ) : (
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Consultor</th>
                <th scope="col">Cliente</th>
                <th scope="col">Tarefa e descrição</th>
                <th scope="col">Tipo</th>
                <th scope="col" className="text-right">Horas</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-muted">
                    {weekdayShort(r.date)} {shortDate(r.date)}
                  </td>
                  <td className="whitespace-nowrap">
                    <Link href={`/time/${r.personId}`}>{r.personName}</Link>
                  </td>
                  <td>
                    <ClientChip name={r.clientName} color={r.clientColor} />
                  </td>
                  <td className="min-w-0">
                    <Link href={`/projetos/${r.itemId}`} className="font-semibold no-underline">
                      {r.parentName ? `${r.parentName} › ` : ""}
                      {r.itemName}
                    </Link>
                    <p className="text-[13px] text-muted">{r.description}</p>
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", typeTone(r))}>{r.typeName}</span>
                      {r.sust && !r.isInternal && <span className="rounded-full bg-blue-bg px-2 py-0.5 text-[11px] font-bold text-blue">Sustentação</span>}
                    </span>
                  </td>
                  <td className="num text-right font-bold text-white">{hm(r.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > limit && <p className="px-4 py-3 text-sm text-muted">Mostrando os {limit} mais recentes. Reduza o período para ver todos.</p>}
      </div>
    </section>
  );
}
