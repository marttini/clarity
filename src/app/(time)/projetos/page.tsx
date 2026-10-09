import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireTeam } from "@/server/session";
import { today } from "@/lib/clock";
import { resolvePeriod, PERIOD_OPTIONS } from "@/domain/period";
import { addDays, addMonths, diffDays, monthName, parseISO, startOfMonth, endOfMonth, weekday, formatMinutes } from "@/domain/dates";
import { Empty, Segmented, cx } from "@/components/ui";
import { AutoSubmit, RememberFilters, StageMover } from "@/components/projetos/client";
import { Avatars, ClientTag, Due, ExtraBadge, Hours, Progress, STAGE_LIST, StageSegs, SustBadge, TagChip, VisibilityBadge, stageLabel } from "@/components/projetos/bits";
import { filterOptions, listItems, type Filters, type Row } from "./_data";
import { stageAction } from "./actions";

export const metadata = { title: "Projetos · Clarity" };

const VIEWS = [
  { value: "lista", label: "Lista" },
  { value: "kanban", label: "Kanban" },
  { value: "calendario", label: "Calendário" },
] as const;
type View = (typeof VIEWS)[number]["value"];
const KEYS = ["q", "c", "r", "e", "m", "s", "tipo", "meus", "p", "de", "ate", "conc", "v", "mes"] as const;

export default async function ProjetosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireTeam();
  const raw = await searchParams;
  const sp: Record<string, string> = {};
  for (const k of KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v !== "") sp[k] = v;
  }
  // US-20: o filtro escolhido é lembrado entre visitas.
  if (!Object.keys(sp).length && raw.limpar === undefined) {
    const saved = (await cookies()).get("clarity_projetos")?.value;
    if (saved) redirect(`/projetos?${decodeURIComponent(saved)}`);
  }
  const query = new URLSearchParams(sp).toString();
  const hoje = today();
  const view: View = VIEWS.some((v) => v.value === sp.v) ? (sp.v as View) : "lista";
  const period = sp.p ? resolvePeriod({ p: sp.p, de: sp.de, ate: sp.ate }, hoje) : null;
  const filters: Filters = { ...sp, de: period?.from, ate: period?.to };
  // Calendário mostra o mês inteiro do prazo, inclusive concluídos.
  const month = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : startOfMonth(hoje);
  if (view === "calendario" && !period) {
    filters.de = startOfMonth(month);
    filters.ate = endOfMonth(month);
    filters.conc = "1";
  }
  if (view === "kanban") filters.conc = sp.conc ?? "0";
  const [rows, opts] = await Promise.all([listItems(filters, me.id), filterOptions()]);
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `/projetos?${s}` : "/projetos?limpar=1";
  };
  const active = ["q", "c", "r", "e", "m", "s", "tipo", "meus", "p", "conc"].some((k) => sp[k]);
  const projects = rows.filter((r) => r.kind === "projeto").length;
  const late = rows.filter((r) => r.deadline && r.deadline < hoje && r.stage !== "concluido").length;

  return (
    <>
      <RememberFilters query={query} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1 m-0">Projetos e tarefas</h1>
          <p className="m-0 text-[15px] text-muted">
            {rows.length} {rows.length === 1 ? "item" : "itens"} · {projects} {projects === 1 ? "projeto" : "projetos"}
            {late > 0 && (
              <>
                {" · "}
                <span className="font-bold text-red">{late} com prazo vencido</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/projetos/novo?tipo=tarefa" className="btn-ghost no-underline">
            Nova tarefa
          </Link>
          <Link href="/projetos/novo?tipo=projeto" className="btn-primary no-underline">
            Novo projeto
          </Link>
        </div>
      </div>

      <section aria-label="Filtros" className="flex flex-col gap-3">
        <AutoSubmit className="flex flex-wrap items-end gap-2.5">
          {sp.v && <input type="hidden" name="v" value={sp.v} />}
          {sp.meus && <input type="hidden" name="meus" value={sp.meus} />}
          {sp.mes && <input type="hidden" name="mes" value={sp.mes} />}
          <label className="flex min-w-[220px] flex-[2_1_240px] flex-col gap-1">
            <span className="label">Buscar por nome</span>
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Projeto, tarefa ou cliente" className="field" />
          </label>
          <Select name="c" label="Cliente" value={sp.c} options={opts.clients.map((c) => ({ value: c.id, label: c.name }))} />
          {!sp.meus && <Select name="r" label="Responsável" value={sp.r} options={opts.people.map((p) => ({ value: p.id, label: p.name }))} />}
          <Select name="e" label="Etapa" value={sp.e} options={STAGE_LIST.map((s) => ({ value: s.key, label: s.label }))} />
          <Select name="m" label="Marcador" value={sp.m} options={opts.tags.map((t) => ({ value: t.id, label: t.name }))} />
          <Select name="s" label="Sustentação" value={sp.s} all="Todas" options={[{ value: "1", label: "Só sustentação" }, { value: "0", label: "Sem sustentação" }]} />
          <Select name="tipo" label="Tipo" value={sp.tipo} all="Projetos e tarefas" options={[{ value: "projeto", label: "Projetos" }, { value: "tarefa", label: "Tarefas" }]} />
          <Select name="p" label="Prazo no período" value={sp.p} all="Qualquer prazo" options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          {sp.p === "personalizado" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="label">De</span>
                <input type="date" name="de" defaultValue={period?.from} className="field w-auto" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">Até</span>
                <input type="date" name="ate" defaultValue={period?.to} className="field w-auto" />
              </label>
            </>
          )}
          {view !== "calendario" && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm text-ink">
              <input type="checkbox" name="conc" value="1" defaultChecked={sp.conc === "1"} className="size-4" />
              Mostrar concluídos
            </label>
          )}
          <button className="btn-ghost">Filtrar</button>
        </AutoSubmit>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={[...VIEWS]} value={view} hrefFor={(v) => href({ v: v === "lista" ? null : v })} />
          <Link href={href({ meus: sp.meus ? null : "1", r: null })} aria-pressed={!!sp.meus} className="chip no-underline">
            Meus itens
          </Link>
          {period && <span className="text-sm text-muted">Prazo em {period.label}</span>}
          {active && (
            <Link href="/projetos?limpar=1" className="btn-quiet text-sm">
              Limpar filtros
            </Link>
          )}
        </div>
      </section>

      {view === "lista" && <ListView rows={rows} hoje={hoje} />}
      {view === "kanban" && <KanbanView rows={rows} hoje={hoje} showDone={sp.conc === "1"} doneHref={href({ conc: "1" })} />}
      {view === "calendario" && <CalendarView rows={rows} hoje={hoje} month={month} href={href} />}
    </>
  );
}

function Select({ name, label, value, options, all = "Todos" }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; all?: string }) {
  return (
    <label className="flex min-w-0 flex-[1_1_170px] flex-col gap-1">
      <span className="label">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="field">
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function pathOf(r: Row) {
  return r.parent ? `${r.annualName} › ${r.parent.name}` : `${r.annualName} · ${r.kind === "projeto" ? "projeto" : "tarefa simples"}`;
}

function Badges({ r, small }: { r: Row; small?: boolean }) {
  return (
    <>
      {r.kind === "projeto" && r.scopeStatus === "rascunho" && <span className={cx("inline-flex rounded-full bg-blue-bg font-bold text-blue", small ? "px-2 py-0.5 text-[11px]" : "px-[9px] py-[3px] text-xs")}>Rascunho</span>}
      {r.outOfScope && <ExtraBadge approval={r.clientApproval} small={small} />}
      {r.isSustentacao && <SustBadge small={small} />}
      {r.tags.map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} small={small} />
      ))}
    </>
  );
}

function ListView({ rows, hoje }: { rows: Row[]; hoje: string }) {
  if (!rows.length) return <Empty>Nenhum item com esses filtros.</Empty>;
  return (
    <div className="table-wrap">
      <table className="tbl min-w-[980px]">
        <thead>
          <tr>
            <th scope="col" className="pl-4">Item</th>
            <th scope="col">Etapa</th>
            <th scope="col">Responsáveis</th>
            <th scope="col">Prazo</th>
            <th scope="col">Tarefas</th>
            <th scope="col">Horas</th>
            <th scope="col" className="pr-4">Cliente vê</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2">
              <td className="pl-4">
                <div className="flex min-w-0 items-start gap-3">
                  <ClientTag name={r.client.name} color={r.client.color} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/projetos/${r.id}`} className="text-[15px] font-semibold text-ink no-underline hover:text-white hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-faint">{pathOf(r)}</span>
                    {(r.tags.length > 0 || r.isSustentacao || r.outOfScope || r.scopeStatus === "rascunho") && (
                      <span className="flex flex-wrap gap-1.5">
                        <Badges r={r} small />
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td>
                <span className="flex flex-col gap-1.5">
                  <StageSegs stage={r.stage} />
                  <span className="text-xs text-muted">{stageLabel(r.stage)}</span>
                </span>
              </td>
              <td>
                <Avatars people={r.assignees} size={28} />
              </td>
              <td>
                <Due deadline={r.deadline} stage={r.stage} today={hoje} long />
              </td>
              <td>{r.kind === "projeto" ? <Progress done={r.tasksDone} total={r.tasksTotal} /> : <span className="text-sm text-faint">–</span>}</td>
              <td>
                <Hours worked={r.workedMinutes} planned={r.plannedMinutes} />
              </td>
              <td className="pr-4">
                <VisibilityBadge visible={r.visibleToClient} small />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KanbanView({ rows, hoje, showDone, doneHref }: { rows: Row[]; hoje: string; showDone: boolean; doneHref: string }) {
  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="grid min-w-[1180px] grid-cols-5 gap-3 px-1">
        {STAGE_LIST.map((st) => {
          const col = rows.filter((r) => r.stage === st.key);
          return (
            <section key={st.key} aria-labelledby={`col-${st.key}`} className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line bg-surface-2 p-2.5">
              <h2 id={`col-${st.key}`} className="m-0 flex items-center justify-between gap-2 px-1.5 pt-1 text-sm font-bold text-white">
                {st.label}
                <span className="num rounded-full bg-line-2 px-2 py-0.5 text-xs text-muted">{col.length}</span>
              </h2>
              {st.key === "concluido" && !showDone ? (
                <Link href={doneHref} className="btn-quiet justify-start text-sm">
                  Mostrar concluídos
                </Link>
              ) : col.length === 0 ? (
                <p className="m-0 px-1.5 py-3 text-sm text-faint">Nada aqui.</p>
              ) : (
                col.map((r) => (
                  <article key={r.id} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ClientTag name={r.client.name} color={r.client.color} />
                      <span className="ml-auto text-xs">
                        <Due deadline={r.deadline} stage={r.stage} today={hoje} long />
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link href={`/projetos/${r.id}`} className="text-[15px] leading-snug font-semibold text-ink no-underline hover:text-white hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-xs text-faint">{r.parent ? `› ${r.parent.name}` : r.kind === "projeto" ? "Projeto" : "Tarefa simples"}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badges r={r} small />
                      <VisibilityBadge visible={r.visibleToClient} small />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Avatars people={r.assignees} size={24} />
                      <span className="num text-xs text-muted">
                        {formatMinutes(r.workedMinutes)}
                        {r.plannedMinutes ? ` / ${formatMinutes(r.plannedMinutes)}` : ""}
                      </span>
                    </div>
                    {r.kind === "projeto" && r.tasksTotal > 0 && <Progress done={r.tasksDone} total={r.tasksTotal} />}
                    <StageMover
                      action={stageAction}
                      id={r.id}
                      stage={r.stage}
                      openTasks={r.tasksTotal - r.tasksDone}
                      compact
                      disabled={r.kind === "projeto" && r.scopeStatus === "rascunho" ? "Rascunho: confirme o escopo para mover." : undefined}
                    />
                  </article>
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CalendarView({ rows, hoje, month, href }: { rows: Row[]; hoje: string; month: string; href: (p: Record<string, string | null>) => string }) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lead = (weekday(first) + 6) % 7; // semana começa na segunda
  const start = addDays(first, -lead);
  const weeks = Math.ceil((lead + diffDays(last, first) + 1) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, Row[]>();
  for (const r of rows) if (r.deadline) (byDay.get(r.deadline) ?? byDay.set(r.deadline, []).get(r.deadline)!).push(r);
  const { y, m } = parseISO(first);
  const ym = (d: string) => d.slice(0, 7);
  const withItems = [...byDay.keys()].filter((d) => d >= first && d <= last).sort();
  return (
    <section aria-label="Calendário por prazo" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ mes: ym(addMonths(first, -1)) })} className="btn-ghost min-h-10 text-sm" aria-label="Mês anterior">
          Anterior
        </Link>
        <h2 className="h3 m-0 min-w-[150px] text-center">
          {monthName(m).charAt(0).toUpperCase() + monthName(m).slice(1)} de {y}
        </h2>
        <Link href={href({ mes: ym(addMonths(first, 1)) })} className="btn-ghost min-h-10 text-sm" aria-label="Próximo mês">
          Próximo
        </Link>
        {ym(first) !== ym(hoje) && (
          <Link href={href({ mes: null })} className="btn-quiet text-sm">
            Hoje
          </Link>
        )}
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
        <div className="grid grid-cols-7 border-b border-line text-xs font-bold text-faint">
          {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => (
            <span key={d} className="px-2.5 py-2">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const items = byDay.get(d) ?? [];
            const out = d < first || d > last;
            return (
              <div key={d} className={cx("flex min-h-[112px] min-w-0 flex-col gap-1 border-t border-l border-line p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0", out && "bg-bg/40")}>
                <span className={cx("num px-1 text-xs", d === hoje ? "self-start rounded-md bg-accent px-1.5 font-bold text-on-accent" : out ? "text-faint/60" : "text-muted")}>{parseISO(d).day}</span>
                {items.slice(0, 4).map((r) => {
                  const lateItem = r.stage !== "concluido" && d < hoje;
                  return (
                    <Link
                      key={r.id}
                      href={`/projetos/${r.id}`}
                      title={`${r.client.name} · ${r.name}`}
                      className={cx("flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs no-underline", lateItem ? "bg-red-bg text-red" : "bg-surface-3 text-ink hover:text-white")}
                    >
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: r.client.color }} />
                      <span className={cx("truncate", r.stage === "concluido" && "line-through opacity-70")}>{r.name}</span>
                    </Link>
                  );
                })}
                {items.length > 4 && <span className="px-1 text-[11px] text-muted">+{items.length - 4}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {/* Celular: agenda por dia */}
      <div className="flex flex-col gap-4 md:hidden">
        {withItems.length === 0 && <Empty>Nenhum prazo neste mês.</Empty>}
        {withItems.map((d) => (
          <div key={d} className="flex flex-col">
            <h3 className={cx("m-0 mb-1 text-sm font-bold", d === hoje ? "text-accent-soft" : "text-white")}>
              {String(parseISO(d).day).padStart(2, "0")}/{String(m).padStart(2, "0")}
            </h3>
            {(byDay.get(d) ?? []).map((r) => (
              <Link key={r.id} href={`/projetos/${r.id}`} className="flex min-h-12 items-center gap-2.5 border-t border-line py-2 text-ink no-underline">
                <ClientTag name={r.client.name} color={r.client.color} />
                <span className="min-w-0 flex-1 text-sm font-semibold">{r.name}</span>
                <Due deadline={r.deadline} stage={r.stage} today={hoje} />
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
