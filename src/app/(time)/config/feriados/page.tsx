import Link from "next/link";
import { and, asc, gte, lte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { today } from "@/lib/clock";
import { nationalHolidays, weekdayShort } from "@/domain/dates";
import { Badge, cx } from "@/components/ui";
import { ActionForm } from "@/components/config/forms";
import { fullDate } from "@/components/portal/format";
import { requireAdminPage } from "../_guard";
import { addHolidayAction, generateHolidaysAction, removeHolidayAction } from "../actions";

export const metadata = { title: "Feriados · Configurações" };

/** Feriados não contam como dia útil para metas, regra dos 3 dias, prazos e avisos. */
export default async function Feriados({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  await requireAdminPage();
  const t = today();
  const cur = Number(t.slice(0, 4));
  const sp = await searchParams;
  const year = Number(sp.ano) >= 2000 && Number(sp.ano) <= 2100 ? Number(sp.ano) : cur;
  const rows = await db
    .select()
    .from(s.holidays)
    .where(and(gte(s.holidays.date, `${year}-01-01`), lte(s.holidays.date, `${year}-12-31`)))
    .orderBy(asc(s.holidays.date));
  const national = new Set(nationalHolidays(year).map((h) => h.date));
  const missing = nationalHolidays(year).filter((h) => !rows.some((r) => r.date === h.date)).length;
  const next = rows.find((r) => r.date >= t)?.date;
  return (
    <section aria-labelledby="h-f" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="h-f" className="h2">
            Feriados de {year}
          </h2>
          <p className="text-sm text-muted">Não contam como dia útil para metas, regra dos 3 dias, prazos e avisos.</p>
        </div>
        <div role="tablist" aria-label="Ano" className="flex gap-1 rounded-[10px] border border-line bg-surface-2 p-[3px]">
          {[cur - 1, cur, cur + 1].map((y) => (
            <Link key={y} role="tab" aria-selected={y === year} href={`/config/feriados?ano=${y}`} className={cx("num inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-bold no-underline", y === year ? "bg-line-2 !text-white" : "!text-muted")}>
              {y}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <ActionForm action={generateHolidaysAction} className="card flex min-w-0 flex-[1_1_300px] flex-col gap-3 p-5">
          <h3 className="h3">Feriados nacionais</h3>
          <p className="text-sm text-muted">{missing ? `${missing} feriado${missing > 1 ? "s" : ""} nacional${missing > 1 ? "is" : ""} de ${year} ainda fora da lista.` : `Todos os feriados nacionais de ${year} já estão na lista.`}</p>
          <input type="hidden" name="year" value={year} />
          <button className="btn-ghost self-start" disabled={!missing}>
            Gerar feriados nacionais de {year}
          </button>
        </ActionForm>
        <ActionForm action={addHolidayAction} resetOnOk className="card flex min-w-0 flex-[2_1_420px] flex-wrap items-end gap-3 p-5">
          <h3 className="h3 basis-full">Adicionar feriado local ou ponto facultativo</h3>
          <label className="flex flex-col gap-1.5">
            <span className="label">Data</span>
            <input type="date" name="date" required min={`${year}-01-01`} max={`${year}-12-31`} className="field num w-[170px]" />
          </label>
          <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
            <span className="label">Nome</span>
            <input name="name" required maxLength={80} placeholder="Ex.: Aniversário de Goiânia" className="field" />
          </label>
          <button className="btn-primary">Adicionar</button>
        </ActionForm>
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[560px]">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Dia</th>
              <th scope="col">Feriado</th>
              <th scope="col">Tipo</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.date} className={cx(h.date < t && "opacity-70", h.date === next && "bg-surface-3")}>
                <td className="num text-white">{fullDate(h.date)}</td>
                <td className="text-muted">{weekdayShort(h.date)}</td>
                <td className="text-white">
                  {h.name}
                  {h.date === next && (
                    <Badge tone="accent" className="ml-2">
                      próximo
                    </Badge>
                  )}
                </td>
                <td>{national.has(h.date) ? <Badge>Nacional</Badge> : <Badge tone="yellow">Local ou facultativo</Badge>}</td>
                <td className="text-right">
                  <ActionForm action={removeHolidayAction} confirm={`Remover ${h.name} (${fullDate(h.date)})? O dia volta a contar como dia útil.`} className="flex flex-col items-end gap-1" statusClassName="text-xs">
                    <input type="hidden" name="date" value={h.date} />
                    <button className="btn-quiet min-h-10 text-sm">Remover</button>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-8 text-center text-muted">Nenhum feriado cadastrado para {year}. Gere os nacionais acima.</p>}
      </div>
    </section>
  );
}
