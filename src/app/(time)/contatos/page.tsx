import Link from "next/link";
import { requireTeam, isManager } from "@/server/session";
import { today } from "@/lib/clock";
import { resolvePeriod } from "@/domain/period";
import { addDays, longDate, shortDate, weekdayShort, type ISODate } from "@/domain/dates";
import { getHolidays, initials } from "@/server/data/common";
import { clientPortfolio, clientsWithContacts, comparablePeriod, listContacts, mondayOf, personAgenda, teamPeople, type ContactRow } from "@/server/queries/clients";
import { canManageContact } from "@/server/services/contacts";
import { PeriodSelector } from "@/components/period";
import { Arrow, Avatar, Segmented, cx } from "@/components/ui";
import { LogForm, ResultForm, ScheduleForm } from "@/components/contatos/forms";
import { CONTACT_STATUS, CONTACT_TYPES, contactTypeLabel, personColor, plural, sinceLabel, type ContactStatus } from "@/components/contatos/labels";

export const metadata = { title: "Agenda de contatos · Clarity" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const STATUS_FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "realizado", label: "Realizados" },
  { value: "agendado", label: "Agendados" },
  { value: "nao_atendeu", label: "Não atendeu" },
  { value: "remarcado", label: "Remarcados" },
  { value: "cancelado", label: "Cancelados" },
] as const;

const TONE_CLS = { green: "bg-green-bg text-green", blue: "bg-blue-bg text-blue", red: "bg-red-bg text-red", yellow: "bg-yellow-bg text-yellow", neutral: "bg-line-2 text-muted" } as const;

function StatusPill({ status, late }: { status: ContactStatus; late?: boolean }) {
  if (late) return <span className="inline-block rounded-full bg-red-bg px-2.5 py-1 text-xs font-bold whitespace-nowrap text-red">Atrasado</span>;
  const s = CONTACT_STATUS[status];
  return <span className={cx("inline-block rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", TONE_CLS[s.tone])}>{s.label}</span>;
}

const wdm = (d: ISODate) => `${weekdayShort(d)}, ${shortDate(d)}`;

export default async function ContatosPage({ searchParams }: { searchParams: SP }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const t = today();
  const period = resolvePeriod({ p: str("p"), de: str("de"), ate: str("ate") }, t);
  const { cur } = comparablePeriod(period, t);
  const view = str("v") === "lista" ? "lista" : "semana";
  const weekOff = Math.max(-52, Math.min(52, Number(str("sem")) || 0));
  const mon = addDays(mondayOf(t), weekOff * 7);
  const wdays = [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
  const status = (STATUS_FILTERS.some((f) => f.value === str("st")) ? str("st") : "todos") as (typeof STATUS_FILTERS)[number]["value"];
  const clientF = str("cliente");
  const personF = str("pessoa");
  const typeF = CONTACT_TYPES.some((x) => x.value === str("tipo")) ? str("tipo") : undefined;
  const mode = str("modo") === "agendar" ? "agendar" : "registrar";
  const selId = str("sel");
  const agendaPerson = personF ?? me.id;

  const [people, clients, holidays, inPeriod, week, listed, selected, portfolio, agenda] = await Promise.all([
    teamPeople(),
    clientsWithContacts(),
    getHolidays(),
    listContacts({ range: cur }),
    listContacts({ range: { from: wdays[0], to: wdays[4] }, order: "asc" }),
    view === "lista"
      ? listContacts({ range: period, clientId: clientF, personId: personF, type: typeF, status: status === "todos" ? undefined : [status] })
      : Promise.resolve([] as ContactRow[]),
    selId && /^[0-9a-f-]{36}$/i.test(selId) ? listContacts({ id: selId }) : Promise.resolve([] as ContactRow[]),
    clientPortfolio(t, cur),
    personAgenda(agendaPerson, t),
  ]);
  const sel = selected[0];
  const agendaName = people.find((p) => p.id === agendaPerson)?.name ?? me.name;
  const nRealized = inPeriod.filter((c) => c.status === "realizado").length;
  const nScheduled = inPeriod.filter((c) => c.status === "agendado").length;
  const nMissed = inPeriod.filter((c) => c.status === "nao_atendeu").length;
  const active = portfolio.filter((r) => r.active);
  const alerts = active.filter((r) => r.contactAlert).length;
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.name, role: p.role }));

  const qs = (patch: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/contatos?${q.toString()}${hash}`;
  };
  const filterChip = (on: boolean) => cx("chip gap-1.5 no-underline", on && "border-white! bg-white! text-on-accent!");

  const summary = [
    { n: nRealized, label: nRealized === 1 ? "contato realizado" : "contatos realizados", href: qs({ v: "lista", st: "realizado" }, "#agenda"), red: false },
    { n: nScheduled, label: nScheduled === 1 ? "agendado" : "agendados", href: qs({ v: "lista", st: "agendado" }, "#agenda"), red: false },
    { n: nMissed, label: nMissed === 1 ? "não atendeu" : "não atenderam", href: qs({ v: "lista", st: "nao_atendeu" }, "#agenda"), red: nMissed > 0 },
    { n: alerts, label: alerts === 1 ? "cliente com alerta agora" : "clientes com alerta agora", href: "#cadencia", red: alerts > 0 },
  ];

  const itemOf = (c: ContactRow) => {
    const late = c.status === "agendado" && c.date < t;
    const look =
      c.status === "realizado"
        ? "bg-surface-3 border border-line-3"
        : c.status === "agendado" && !late
          ? "border border-dashed border-faint"
          : c.status === "nao_atendeu" || late
            ? "bg-red-bg border border-red-bg"
            : "border border-line-2 opacity-70";
    return (
      <Link
        key={c.id}
        href={qs({ sel: c.id }, "#sel")}
        scroll={false}
        aria-label={`${c.client}, ${c.time}, ${contactTypeLabel(c.type)}, ${late ? "atrasado" : CONTACT_STATUS[c.status].label.toLowerCase()}, por ${c.responsible}`}
        aria-current={selId === c.id ? "true" : undefined}
        className={cx("flex min-h-11 w-full flex-col gap-0.5 rounded-[10px] px-2 py-1.5 text-left no-underline", look, selId === c.id && "outline-2 outline-offset-1 outline-white")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: c.color }} />
          <span className="truncate text-[13px] font-bold text-white">{c.client}</span>
        </span>
        <span className={cx("truncate text-xs", c.status === "nao_atendeu" || late ? "text-red" : "text-muted")}>
          {c.time} · {contactTypeLabel(c.type)}
        </span>
      </Link>
    );
  };

  const realizedByClient = (id: string) => inPeriod.filter((c) => c.clientId === id && c.status === "realizado").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-sm text-faint">
            <Link href="/clientes" className="font-semibold text-[#E6D9F2]! no-underline">
              Clientes
            </Link>
            <span aria-hidden>/</span>
            <span className="font-semibold text-white">Agenda de contatos</span>
          </nav>
          <h1 className="h1">Agenda de contatos</h1>
          <p className="text-[15px] text-muted">Cadência semanal com cada cliente ativo. {longDate(t).charAt(0).toUpperCase() + longDate(t).slice(1)}.</p>
        </div>
        <PeriodSelector value={period.key} from={period.from} to={period.to} />
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[15px] text-muted">
        <strong className="mr-1.5 text-white">
          {period.label.charAt(0).toUpperCase() + period.label.slice(1)}
          {cur.to !== period.to ? ` até ${shortDate(cur.to)}` : ""}
        </strong>
        {summary.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="px-1 text-line-5">
                ·
              </span>
            )}
            <Link href={s.href} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-ink! no-underline">
              <span className={cx("num text-[17px] font-bold underline underline-offset-[3px]", s.red ? "text-red" : "text-accent-soft")}>{s.n}</span>
              {s.label}
            </Link>
          </span>
        ))}
      </div>

      {/* US-35: atrasados, hoje e próximos 7 dias */}
      <section aria-labelledby="minha" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="minha" className="h2">
            {agendaPerson === me.id ? "Minha agenda" : `Agenda de ${agendaName}`}
          </h2>
          <form className="flex items-center gap-2" action="/contatos">
            {Object.entries(sp).map(([k, v]) => (typeof v === "string" && k !== "pessoa" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <label htmlFor="ag-person" className="label">
              Pessoa
            </label>
            <select id="ag-person" name="pessoa" defaultValue={agendaPerson} className="field min-h-10 w-auto py-1 text-sm">
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn-ghost min-h-10 text-sm">Ver</button>
          </form>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["Atrasados", agenda.late, "text-red"],
              ["Hoje", agenda.today, "text-white"],
              ["Próximos 7 dias", agenda.next, "text-white"],
            ] as const
          ).map(([label, list, cls]) => (
            <div key={label} className="card flex min-w-0 flex-col gap-1 p-4">
              <h3 className={cx("flex items-center gap-2 text-[15px] font-bold", cls)}>
                {label} <span className="num text-sm text-muted">{list.length}</span>
              </h3>
              {list.length === 0 && <p className="py-1 text-sm text-faint">{label === "Atrasados" ? "Nenhum contato atrasado." : "Nada agendado."}</p>}
              {list.map((c) => (
                <Link key={c.id} href={qs({ sel: c.id }, "#sel")} scroll={false} className="flex items-start gap-2.5 border-t border-line py-2 no-underline">
                  <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-[3px]" style={{ background: c.color }} />
                  <span className="flex min-w-0 flex-col">
                    <strong className="text-sm text-white">{c.client}</strong>
                    <span className={cx("text-[13px]", label === "Atrasados" ? "text-red" : "text-muted")}>
                      {label === "Hoje" ? c.time : `${wdm(c.date)} ${c.time}`} · {contactTypeLabel(c.type)}
                      {c.with ? ` com ${c.with}` : ""}
                    </span>
                    <span className="truncate text-xs text-faint">{c.objective}</span>
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <section id="agenda" aria-labelledby="ag" className="flex min-w-0 flex-[5_1_760px] scroll-mt-6 flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3.5">
              <h2 id="ag" className="h2">
                Contatos do time
              </h2>
              <Segmented
                options={[
                  { value: "semana", label: "Semana" },
                  { value: "lista", label: "Lista" },
                ]}
                value={view}
                hrefFor={(v) => qs({ v })}
              />
            </div>
            {view === "semana" && (
              <div className="flex items-center gap-1.5">
                <Link href={qs({ sem: String(weekOff - 1) })} scroll={false} aria-label="Semana anterior" className="flex size-10 items-center justify-center rounded-[10px] border border-line-5 text-[#E6D9F2]!">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </Link>
                <span className="min-w-[150px] text-center text-sm font-bold text-white">
                  {shortDate(wdays[0])} a {shortDate(wdays[4])}
                </span>
                <Link href={qs({ sem: String(weekOff + 1) })} scroll={false} aria-label="Próxima semana" className="flex size-10 items-center justify-center rounded-[10px] border border-line-5 text-[#E6D9F2]!">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
            )}
          </div>

          {view === "semana" ? (
            <>
              <div className="table-wrap">
                <table className="tbl min-w-[860px] table-fixed">
                  <colgroup>
                    <col className="w-[212px]" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col" className="pl-3.5!">
                        Pessoa
                      </th>
                      {wdays.map((d) => (
                        <th key={d} scope="col" className={cx(d === t && "rounded-t-[10px] bg-surface-3 text-white!")}>
                          <span className="inline-flex items-center gap-1.5">
                            {wdm(d)}
                            {holidays.has(d) && " · feriado"}
                            {d === t && <span className="rounded-full bg-accent px-[7px] py-px text-[11px] font-extrabold text-on-accent">hoje</span>}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => {
                      const mine = week.filter((c) => c.responsibleId === p.id && c.status !== "cancelado" && c.status !== "remarcado");
                      const f = mine.filter((c) => c.status === "realizado").length;
                      const a = mine.filter((c) => c.status === "agendado").length;
                      return (
                        <tr key={p.id}>
                          <th scope="row" className="pl-3.5! text-left align-top font-normal">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={p.name} initials={initials(p.name)} size={32} color={p.role === "administrativo" ? "#EDC75A" : personColor(p.id)} />
                              <div className="flex min-w-0 flex-col">
                                <Link href={qs({ v: "lista", pessoa: p.id, st: "todos" })} className="truncate text-sm font-bold text-white! no-underline">
                                  {p.name}
                                </Link>
                                {!p.isConsultor && <span className="text-xs text-faint">{p.role === "administrativo" ? "Administrativo" : "Gestão"}</span>}
                                <span className="text-xs text-muted">{mine.length ? `${plural(f, "feito", "feitos")} · ${plural(a, "agendado", "agendados")}` : "Nada nesta semana"}</span>
                              </div>
                            </div>
                          </th>
                          {wdays.map((d) => (
                            <td key={d} className={cx("px-[5px]! py-1.5! align-top", d === t ? "bg-surface-3" : holidays.has(d) && "bg-[#150C1E]")}>
                              <div className="flex flex-col gap-[5px]">{mine.filter((c) => c.date === d).map(itemOf)}</div>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3.5 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-[3px] border border-line-5 bg-surface-3" />
                  Realizado
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-[3px] border border-dashed border-faint" />
                  Agendado
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-[3px] bg-red-bg" />
                  Não atendeu ou atrasado
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {STATUS_FILTERS.map((f) => (
                  <Link key={f.value} href={qs({ st: f.value })} scroll={false} aria-current={status === f.value ? "true" : undefined} className={filterChip(status === f.value)}>
                    {f.label}
                  </Link>
                ))}
              </div>
              <form action="/contatos" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="v" value="lista" />
                {(["p", "de", "ate", "st"] as const).map((k) => (str(k) ? <input key={k} type="hidden" name={k} value={str(k)} /> : null))}
                <label className="flex flex-col gap-1">
                  <span className="label">Cliente</span>
                  <select name="cliente" defaultValue={clientF ?? ""} className="field min-h-10 w-auto py-1 text-sm">
                    <option value="">Todos</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">Pessoa</span>
                  <select name="pessoa" defaultValue={personF ?? ""} className="field min-h-10 w-auto py-1 text-sm">
                    <option value="">Todas</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">Tipo</span>
                  <select name="tipo" defaultValue={typeF ?? ""} className="field min-h-10 w-auto py-1 text-sm">
                    <option value="">Todos</option>
                    {CONTACT_TYPES.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-ghost min-h-10 text-sm">Filtrar</button>
                {(clientF || personF || typeF) && (
                  <Link href={qs({ cliente: null, pessoa: null, tipo: null })} className="btn-quiet text-sm no-underline">
                    Limpar filtros
                  </Link>
                )}
              </form>
              <div className="table-wrap">
                {listed.length === 0 ? (
                  <p className="p-7 text-center text-muted">Nenhum contato neste filtro.</p>
                ) : (
                  <table className="tbl min-w-[880px]">
                    <thead>
                      <tr>
                        <th scope="col" className="pl-3.5!">Quando</th>
                        <th scope="col">Cliente</th>
                        <th scope="col">Tipo</th>
                        <th scope="col">Com quem</th>
                        <th scope="col">Por</th>
                        <th scope="col">Resumo e próximo passo</th>
                        <th scope="col" className="pr-3.5!">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listed.map((c) => (
                        <tr key={c.id} className={cx(selId === c.id && "bg-line")}>
                          <td className="num pl-3.5! text-[13px] whitespace-nowrap">
                            <Link href={qs({ sel: c.id }, "#sel")} scroll={false} className="text-ink! no-underline hover:underline">
                              {wdm(c.date)} {c.time}
                            </Link>
                          </td>
                          <td>
                            <Link href={`/clientes/${c.clientId}`} className="inline-flex items-center gap-2 font-bold whitespace-nowrap text-white! no-underline">
                              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: c.color }} />
                              {c.client}
                            </Link>
                          </td>
                          <td className="text-muted">{contactTypeLabel(c.type)}</td>
                          <td>{c.with ?? <span className="text-faint">–</span>}</td>
                          <td className="whitespace-nowrap">{c.responsible}</td>
                          <td className="min-w-[220px]">
                            <span className="block text-ink">{c.summary ?? (c.status === "agendado" ? `Objetivo: ${c.objective}` : c.reason ? `Motivo: ${c.reason}` : "–")}</span>
                            {c.nextStep && <span className="block text-[13px] text-muted">Próximo: {c.nextStep}</span>}
                          </td>
                          <td className="pr-3.5!">
                            <StatusPill status={c.status} late={c.status === "agendado" && c.date < t} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="text-[13px] text-faint">Contatos ficam só no Clarity: não vão ao Odoo e não aparecem no portal.</p>
            </div>
          )}

          {sel && (
            <div id="sel" aria-live="polite" className="flex scroll-mt-6 flex-col gap-4 rounded-2xl border border-line-2 bg-surface-2 px-[18px] py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden className="size-3 rounded-[3px]" style={{ background: sel.color }} />
                    <strong className="text-[15px] text-white">
                      <Link href={`/clientes/${sel.clientId}`} className="text-white! no-underline hover:underline">
                        {sel.client}
                      </Link>{" "}
                      · {contactTypeLabel(sel.type)}
                      {sel.with ? ` com ${sel.with}` : ""}
                    </strong>
                    <StatusPill status={sel.status} late={sel.status === "agendado" && sel.date < t} />
                  </div>
                  <span className="text-sm text-muted">
                    {wdm(sel.date)}, {sel.time} · por {sel.responsible}
                    {sel.createdBy !== sel.responsible ? ` · agendado por ${sel.createdBy}` : ""}
                    {sel.relatedItem && (
                      <>
                        {" "}
                        ·{" "}
                        <Link href={`/projetos/${sel.relatedItemId}`} className="text-muted!">
                          {sel.relatedItem}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="text-sm text-ink">{sel.status === "agendado" ? `Objetivo: ${sel.objective}` : sel.summary}</span>
                  {sel.nextStep && <span className="text-sm text-muted">Próximo passo: {sel.nextStep}</span>}
                  {sel.reason && <span className="text-sm text-muted">Motivo: {sel.reason}</span>}
                </div>
                <Link href={qs({ sel: null })} scroll={false} className="btn-quiet text-sm no-underline">
                  Fechar
                </Link>
              </div>
              {sel.status === "agendado" && (
                <ResultForm key={sel.id} contactId={sel.id} people={peopleOpts} meId={me.id} today={t} canManage={canManageContact(me, sel)} />
              )}
            </div>
          )}
        </section>

        <section id="form" aria-labelledby="fm" className="flex min-w-0 flex-[2_1_360px] scroll-mt-6 flex-col gap-4 rounded-[18px] border border-line-4 bg-surface-3 p-5">
          <h2 id="fm" className="sr-only">
            Registrar ou agendar contato
          </h2>
          <Segmented
            options={[
              { value: "registrar", label: "Registrar contato" },
              { value: "agendar", label: "Agendar contato" },
            ]}
            value={mode}
            hrefFor={(v) => qs({ modo: v }, "#form")}
          />
          {mode === "registrar" ? (
            <LogForm key={`log-${clientF ?? ""}`} clients={clients} people={peopleOpts} meId={me.id} defaultClientId={clientF} today={t} />
          ) : (
            <ScheduleForm key={`sch-${clientF ?? ""}`} clients={clients} people={peopleOpts} meId={me.id} defaultClientId={clientF} defaultDate={t} />
          )}
        </section>
      </div>

      {/* US-37: cadência */}
      <section id="cadencia" aria-labelledby="cad" className="flex scroll-mt-6 flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 id="cad" className="h2">
            Cadência semanal
          </h2>
          <span className="text-[13px] text-faint">Clientes ativos (com horas nos últimos 6 meses). Alerta com 5 dias úteis sem contato.</span>
        </div>
        <div className="table-wrap">
          {active.length === 0 ? (
            <p className="p-6 text-center text-muted">Nenhum cliente ativo.</p>
          ) : (
            <table className="tbl min-w-[1000px]">
              <thead>
                <tr>
                  <th scope="col" className="pl-4!">Cliente</th>
                  <th scope="col">Último contato</th>
                  <th scope="col">Próximo agendado</th>
                  <th scope="col">Realizados no período</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="relative pr-4!">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...active]
                  .sort((a, b) => (b.workdaysSinceContact ?? 999) - (a.workdaysSinceContact ?? 999))
                  .map((r) => {
                    const wd = r.workdaysSinceContact;
                    const st = r.contactAlert
                      ? { text: wd === null ? "Nenhum contato registrado" : `${wd} dias úteis sem contato`, cls: "bg-red-bg text-red" }
                      : wd === 4
                        ? { text: "Alerta amanhã", cls: "bg-yellow-bg text-yellow" }
                        : { text: "Em dia", cls: "bg-green-bg text-green" };
                    const n = realizedByClient(r.id);
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="pl-4!">
                          <Link href={`/clientes/${r.id}`} className="inline-flex items-center gap-2.5 font-bold whitespace-nowrap text-white! no-underline">
                            <span aria-hidden className="size-3 rounded-[3px]" style={{ background: r.color }} />
                            {r.name}
                          </Link>
                        </td>
                        <td>
                          <span className={cx("block font-semibold", r.contactAlert ? "text-red" : "text-ink")}>
                            {r.lastContact ? `${shortDate(r.lastContact.date)} · ${sinceLabel(wd) === "hoje" || sinceLabel(wd) === "ontem" ? sinceLabel(wd) : `há ${sinceLabel(wd)}`}` : "Sem contato registrado"}
                          </span>
                          {r.lastContact && (
                            <span className="text-xs text-faint">
                              {contactTypeLabel(r.lastContact.type)} · {r.lastContact.by}
                            </span>
                          )}
                        </td>
                        <td>
                          {r.nextContact ? (
                            <Link href={qs({ sel: r.nextContact.id }, "#sel")} scroll={false} className={cx("no-underline", r.nextContact.overdue ? "font-bold text-red!" : "text-ink!")}>
                              {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(r.nextContact.at).replace(".", "")} · {r.nextContact.responsible}
                            </Link>
                          ) : (
                            <span className={cx("font-bold", r.contactAlert ? "text-red" : "text-yellow")}>Nada agendado</span>
                          )}
                        </td>
                        <td>
                          <Link href={qs({ v: "lista", cliente: r.id, st: "realizado", pessoa: null, tipo: null }, "#agenda")} className="num px-2 text-[15px] font-bold text-accent-soft! underline underline-offset-[3px]">
                            {n}
                          </Link>
                        </td>
                        <td>
                          <span className={cx("inline-block rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", st.cls)}>{st.text}</span>
                        </td>
                        <td className="pr-4!">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Link href={qs({ modo: "registrar", cliente: r.id }, "#form")} className="btn-ghost min-h-10 rounded-[10px] px-3 text-sm no-underline">
                              Registrar
                            </Link>
                            <Link
                              href={qs({ modo: "agendar", cliente: r.id }, "#form")}
                              className={cx("min-h-10 rounded-[10px] px-3 text-sm no-underline", r.nextContact ? "btn-ghost" : "btn-primary text-on-accent! hover:text-on-accent!")}
                            >
                              Agendar
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
        {isManager(me) && alerts > 0 && (
          <p className="inline-flex items-center gap-1.5 text-[13px] text-faint">
            A gestão recebe estes alertas no resumo diário das 8h <Arrow dir="right" /> <Link href="/gestao">Gestão</Link>
          </p>
        )}
      </section>
    </>
  );
}
