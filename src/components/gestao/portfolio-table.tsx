import Link from "next/link";
import type { PortfolioRow } from "@/server/queries/analytics";
import { cx, Empty } from "@/components/ui";
import { hm } from "@/components/time/bits";

export const HEALTH_DOT = { vermelho: "bg-day-red", amarelo: "bg-day-yellow", verde: "bg-day-green" } as const;
const STAGE_KEYS = ["analise", "estimativa", "alocacao", "andamento", "concluido"];
const STAGE_BG = ["#2A1B37", "#33224A", "#3E2A5A", "#A897F5", "#1E4A33"];
const STAGE_NAMES = ["Análise/Aprovação", "Estimativa", "Alocação", "Em andamento", "Concluído"];

export function contactText(r: PortfolioRow) {
  if (r.contactWorkdays === null) return "nenhum";
  if (r.contactWorkdays === 0) return "hoje";
  if (r.contactWorkdays === 1) return "ontem";
  return `${r.contactWorkdays} dias úteis`;
}

/** Carteira resumida (US-45, versão mínima até a carteira completa ficar pronta). */
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  return (
    <div className="table-wrap">
      {rows.length === 0 ? (
        <Empty>Nenhum cliente neste filtro.</Empty>
      ) : (
        <table className="tbl min-w-[900px]">
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Projetos por etapa</th>
              <th scope="col">Tarefas</th>
              <th scope="col">Adicionais</th>
              <th scope="col">Horas no mês</th>
              <th scope="col">Último contato</th>
              <th scope="col">Atenção</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <span role="img" aria-label={`Saúde: ${r.health}`} className={cx("h-3 w-3 shrink-0 rounded-full", HEALTH_DOT[r.health])} />
                    <span className="h-[18px] w-1 shrink-0 rounded-sm" style={{ background: r.color }} aria-hidden />
                    <Link href={`/clientes/${r.id}`} className="font-bold !text-white no-underline">
                      {r.name}
                    </Link>
                    {!r.active && <span className="rounded-full bg-line-2 px-2 py-0.5 text-[11px] font-bold text-muted">inativo</span>}
                  </div>
                </td>
                <td>
                  <div className="flex gap-1">
                    {STAGE_KEYS.map((k, i) => {
                      const n = r.stages[k] ?? 0;
                      return (
                        <span
                          key={k}
                          title={`${STAGE_NAMES[i]}: ${n}`}
                          className={cx("num inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-md text-xs font-bold", !n && "text-faint")}
                          style={{ background: n ? STAGE_BG[i] : "#170E20", color: n ? (i === 3 ? "#120A19" : "#EDE6F3") : undefined }}
                        >
                          {n || "–"}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="num">{r.openTasks}</td>
                <td>{r.waiting ? <span className="rounded-full bg-yellow-bg px-2.5 py-1 text-xs font-bold whitespace-nowrap text-yellow">{r.waiting} aguardando</span> : <span className="text-faint">—</span>}</td>
                <td className="num">{hm(r.monthMinutes)}</td>
                <td className={cx("whitespace-nowrap", r.reasons.some((x) => x.includes("contato")) ? "font-bold text-red" : "text-muted")}>{contactText(r)}</td>
                <td className="text-[13px] text-muted">{r.reasons.length ? r.reasons.join("; ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
