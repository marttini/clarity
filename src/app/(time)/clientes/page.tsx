import Link from "next/link";
import { requireTeam } from "@/server/session";
import { today } from "@/lib/clock";
import { resolvePeriod } from "@/domain/period";
import { formatMinutes, shortDate } from "@/domain/dates";
import { STAGES } from "@/server/data/common";
import { clientPortfolio, comparablePeriod, situationLabel, syncPendencies, type PortfolioRow } from "@/server/queries/clients";
import { PeriodSelector } from "@/components/period";
import { Badge, Empty, Segmented, cx } from "@/components/ui";
import { Orbit, type OrbitClient } from "@/components/clientes/orbit";
import { ClickableRow } from "@/components/clientes/clickable-row";
import { HealthDot, reasonsText } from "@/components/clientes/health";
import { contactTypeLabel, plural, sinceLabel } from "@/components/contatos/labels";

export const metadata = { title: "Carteira de clientes · Clarity" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "vermelho", label: "Só vermelhos" },
  { value: "contato", label: "Sem contato" },
  { value: "aguardando", label: "Aguardando cliente" },
  { value: "inativos", label: "Inativos" },
] as const;
type FilterKey = (typeof FILTERS)[number]["value"];

function matches(r: PortfolioRow, f: FilterKey) {
  switch (f) {
    case "vermelho":
      return r.health === "vermelho";
    case "contato":
      return r.contactAlert;
    case "aguardando":
      return r.demandsAwaiting > 0;
    case "inativos":
      return !r.active;
    default:
      return true;
  }
}

const STAGE_BG = ["#2A1B37", "#33224A", "#3E2A5A", "#A897F5", "#1E4A33"];

export default async function ClientesPage({ searchParams }: { searchParams: SP }) {
  await requireTeam();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const t = today();
  const period = resolvePeriod({ p: str("p"), de: str("de"), ate: str("ate") }, t);
  const { cur } = comparablePeriod(period, t);
  const view = str("v") === "tabela" ? "tabela" : "orbita";
  const filter = (FILTERS.some((f) => f.value === str("f")) ? str("f") : "todos") as FilterKey;

  const [rows, pend] = await Promise.all([clientPortfolio(t, cur), syncPendencies()]);
  const openPend = pend.filter((p) => !p.resolved && p.model === "project.project").length;
  const shown = rows.filter((r) => matches(r, filter));
  const active = rows.filter((r) => r.active).length;

  const qs = (patch: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    for (const [k, v] of Object.entries(patch)) q.set(k, v);
    return `/clientes?${q.toString()}`;
  };

  const orbit: OrbitClient[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    health: r.health,
    active: r.active,
    why: r.active ? reasonsText(r.reasons, r.health) : `${situationLabel(r)}. ${reasonsText(r.reasons, r.health)}`,
    minutes: r.minutes.total,
    match: matches(r, filter),
    facts: [
      { v: formatMinutes(r.minutes.total), k: "horas no período" },
      { v: String(r.stages.andamento), k: r.stages.andamento === 1 ? "projeto em andamento" : "projetos em andamento" },
      { v: String(r.openTasks), k: r.openTasks === 1 ? "tarefa aberta" : "tarefas abertas" },
      { v: sinceLabel(r.workdaysSinceContact), k: "último contato", alert: r.contactAlert },
    ],
  }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="h1">Carteira de clientes</h1>
          <p className="text-[15px] text-muted">
            {plural(rows.length, "cliente", "clientes")} · {plural(active, "ativo", "ativos")} · horas de {period.label}
            {cur.to !== period.to ? ` até ${shortDate(cur.to)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {openPend > 0 && (
            <Link href="/clientes/pendencias" className="no-underline">
              <Badge tone="yellow">{plural(openPend, "pendência do Odoo", "pendências do Odoo")}</Badge>
            </Link>
          )}
          <Link href="/contatos" className="btn-ghost min-h-11 text-sm no-underline">
            Agenda de contatos
          </Link>
          <PeriodSelector value={period.key} from={period.from} to={period.to} />
        </div>
      </div>

      <section aria-labelledby="cart" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3.5">
            <h2 id="cart" className="h2">
              Clientes
            </h2>
            <Segmented
              options={[
                { value: "orbita", label: "Órbita" },
                { value: "tabela", label: "Tabela" },
              ]}
              value={view}
              hrefFor={(v) => qs({ v })}
            />
          </div>
          <nav aria-label="Filtros rápidos" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const n = f.value === "todos" ? rows.length : rows.filter((r) => matches(r, f.value)).length;
              const on = f.value === filter;
              return (
                <Link
                  key={f.value}
                  href={qs({ f: f.value })}
                  scroll={false}
                  aria-current={on ? "true" : undefined}
                  className={cx("chip gap-1.5 no-underline", on && "border-white! bg-white! text-on-accent!")}
                >
                  {f.label}
                  <span className="num text-xs opacity-80">{n}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {rows.length === 0 ? (
          <Empty>Nenhum cliente ainda. Os clientes vêm do Odoo (projetos anuais com a etiqueta Novo modelo).</Empty>
        ) : view === "orbita" ? (
          <>
            <Orbit clients={orbit} initial={shown[0]?.id} />
            <p className="text-xs text-faint">Centro: agir agora. Tamanho: horas no período. Apagados: fora do filtro ou inativos.</p>
          </>
        ) : shown.length === 0 ? (
          <div className="table-wrap">
            <Empty>Nenhum cliente neste filtro.</Empty>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl min-w-[1080px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-4!">Cliente</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Projetos por etapa</th>
                    <th scope="col">Tarefas abertas</th>
                    <th scope="col">Adicionais</th>
                    <th scope="col">Horas no período</th>
                    <th scope="col">Último contato</th>
                    <th scope="col">Próximo contato</th>
                    <th scope="col" className="pr-4!">Atenção</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <ClickableRow key={r.id} href={`/clientes/${r.id}?p=${period.key}`}>
                      <td className="pl-4!">
                        <div className="flex items-center gap-2.5">
                          <HealthDot health={r.health} />
                          <span aria-hidden className="h-[18px] w-1 shrink-0 rounded-sm" style={{ background: r.color }} />
                          <Link href={`/clientes/${r.id}?p=${period.key}`} className="font-bold whitespace-nowrap text-white! no-underline">
                            {r.name}
                          </Link>
                        </div>
                      </td>
                      <td>{r.active ? <span className="text-muted">Ativo</span> : <Badge tone="neutral">{situationLabel(r)}</Badge>}</td>
                      <td>
                        <div className="flex gap-1" aria-label={STAGES.map((st) => `${st.label}: ${r.stages[st.key]}`).join(", ")}>
                          {STAGES.map((st, i) => {
                            const n = r.stages[st.key];
                            return (
                              <span
                                key={st.key}
                                title={st.long}
                                aria-hidden
                                className="num inline-flex size-[26px] items-center justify-center rounded-md text-xs font-bold"
                                style={{ background: n ? STAGE_BG[i] : "#170E20", color: n ? (i === 3 ? "#120A19" : "#EDE6F3") : "#8C7E9B" }}
                              >
                                {n || "–"}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap">
                        {r.openTasks}
                        {r.overdueTasks > 0 && <span className="ml-2 text-xs font-bold text-red">{r.overdueTasks} atrasada{r.overdueTasks > 1 ? "s" : ""}</span>}
                      </td>
                      <td>{r.demandsAwaiting ? <Badge tone="yellow">{r.demandsAwaiting} aguardando</Badge> : <span className="text-faint">–</span>}</td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <span className="num font-bold text-white">{formatMinutes(r.minutes.total)}</span>
                          {r.minutes.byType.length > 0 && (
                            <span className="text-xs whitespace-nowrap text-faint">{r.minutes.byType.map((b) => `${b.name} ${formatMinutes(b.minutes)}`).join(" · ")}</span>
                          )}
                        </div>
                      </td>
                      <td className={cx("whitespace-nowrap", r.contactAlert ? "font-bold text-red" : "text-muted")}>
                        {r.lastContact ? sinceLabel(r.workdaysSinceContact) : "nunca"}
                        {r.lastContact && <span className="block text-xs font-normal text-faint">{shortDate(r.lastContact.date)} · {contactTypeLabel(r.lastContact.type).toLowerCase()}</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {r.nextContact ? (
                          <span className={r.nextContact.overdue ? "font-bold text-red" : "text-ink"}>
                            {formatWhen(r.nextContact.at)}
                            <span className="block text-xs font-normal text-faint">{r.nextContact.responsible}</span>
                          </span>
                        ) : (
                          <span className={r.active ? "font-bold text-yellow" : "text-faint"}>Nada agendado</span>
                        )}
                      </td>
                      <td className="pr-4! text-[13px] text-muted">{r.health === "verde" && r.active ? "–" : reasonsText(r.reasons, r.health) || "–"}</td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-faint">Etapas: {STAGES.map((st) => st.label).join(" · ")}. Clique na linha para abrir a ficha do cliente.</p>
          </>
        )}
      </section>
    </>
  );
}

function formatWhen(at: Date) {
  const d = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(at);
  return d.replace(",", " ·");
}
