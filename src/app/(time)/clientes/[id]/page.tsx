import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireTeam, isManager } from "@/server/session";
import { today } from "@/lib/clock";
import { resolvePeriod } from "@/domain/period";
import { addDays, diffDays, formatMinutes, longDate, monthName, parseISO, shortDate, toISODate, type ISODate } from "@/domain/dates";
import { initials, STAGES, stageIndex } from "@/server/data/common";
import {
  clientAssignees,
  clientContactsSummary,
  clientCounts,
  clientDeadlineChanges,
  clientDemands,
  clientEntries,
  clientEvaluations,
  clientItemNames,
  clientOpenItems,
  clientPortfolio,
  clientTimeline,
  clientWorkItems,
  comparablePeriod,
  getClientHead,
  hhmm,
  mondayOf,
  situationLabel,
  teamPeople,
} from "@/server/queries/clients";
import { canManagePortal } from "@/server/services/clients";
import { PeriodSelector } from "@/components/period";
import { Arrow, Avatar, Badge, Segmented, cx } from "@/components/ui";
import { HealthChip, reasonsText } from "@/components/clientes/health";
import { TimelineDays, type ApontRow, type Day } from "@/components/clientes/timeline";
import { InternalForm, PortalAccess, ScheduleToggle, type PortalContact } from "@/components/clientes/client-forms";
import { HEALTH, SUST_COLOR, contactTypeLabel, entryTypeColor, personColor, plural, sinceLabel } from "@/components/contatos/labels";

type SP = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EV_KINDS = [
  ["todos", "Todos"],
  ["apont", "Apontamentos"],
  ["tarefa", "Tarefas concluídas"],
  ["coment", "Comentários do cliente"],
  ["contato", "Contatos"],
  ["etapa", "Mudanças de etapa"],
  ["prazo", "Prazos"],
  ["anexo", "Anexos"],
  ["demanda", "Demandas"],
] as const;
type EvKind = (typeof EV_KINDS)[number][0];

const TAG_TONE: Record<string, string> = {
  Crítico: "bg-red-bg text-red",
  "Não autorizado": "bg-red-bg text-red",
  "Ag. retorno cliente": "bg-yellow-bg text-yellow",
  "Pend. doc. cliente": "bg-yellow-bg text-yellow",
  Pausado: "bg-line-2 text-[#E6D9F2]",
};

const dateTimeShort = (at: Date, t: ISODate) => {
  const d = toISODate(at);
  const day = d === t ? "hoje" : d === addDays(t, -1) ? "ontem" : shortDate(d);
  return `${day}, ${hhmm(at)}`;
};

function dayLabel(d: ISODate, t: ISODate) {
  const { day, m } = parseISO(d);
  const mon = monthName(m).slice(0, 3);
  if (d === t) return `Hoje, ${day} ${mon}`;
  if (d === addDays(t, -1)) return `Ontem, ${day} ${mon}`;
  const w = longDate(d).split(",")[0];
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}, ${day} ${mon}`;
}

function cmpMinutes(a: number, b: number, label: string) {
  if (a === b) return { text: `igual a ${label}`, cls: "text-faint" };
  return { text: `${a > b ? "+" : "−"}${formatMinutes(Math.abs(a - b))} vs ${label}`, cls: a > b ? "text-green" : "text-yellow" };
}
function cmpCount(a: number, b: number, label: string) {
  if (a === b) return `igual a ${label}`;
  return `${a > b ? "+" : "−"}${Math.abs(a - b)} vs ${label}`;
}

function Card({ title, children, action, id, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} aria-label={typeof title === "string" ? title : undefined} className={cx("card flex min-w-0 scroll-mt-6 flex-col gap-3 px-5 py-[18px]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-base font-bold text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function ClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const me = await requireTeam();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const head = await getClientHead(id);
  if (!head) notFound();
  const { client, contacts, annuals } = head;
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const t = today();
  const year = Number(t.slice(0, 4));
  const period = resolvePeriod({ p: str("p"), de: str("de"), ate: str("ate") }, t);
  const { cur, prev, prevLabel } = comparablePeriod(period, t);
  const ev = (EV_KINDS.some((k) => k[0] === str("ev")) ? str("ev") : "todos") as EvKind;
  const ht = str("ht") ?? "";
  const dayLimit = Math.max(6, Math.min(200, Number(str("dias")) || 6));
  const demTab = (["aguardando", "aprovada", "recusada"].includes(str("dem") ?? "") ? str("dem") : undefined) as "aguardando" | "aprovada" | "recusada" | undefined;
  const manager = isManager(me);
  const weeksFrom = addDays(mondayOf(t), -63);

  const [portfolio, eCur, ePrev, eWeeks, timeline, names, cCur, cPrev, work, demands, evals, changes, assignees, contactSum, people, openItems] = await Promise.all([
    clientPortfolio(t, cur, { clientIds: [id] }),
    clientEntries(id, cur),
    clientEntries(id, prev),
    clientEntries(id, { from: weeksFrom, to: addDays(mondayOf(t), 6) }),
    clientTimeline(id, cur),
    clientItemNames(id),
    clientCounts(id, cur),
    clientCounts(id, prev),
    clientWorkItems(id),
    clientDemands(id),
    clientEvaluations(id, year),
    clientDeadlineChanges(id),
    clientAssignees(id),
    clientContactsSummary(id),
    teamPeople(),
    clientOpenItems(id),
  ]);
  const row = portfolio[0];

  // ---------- Números ----------
  const sum = (list: typeof eCur, f?: (e: (typeof eCur)[number]) => boolean) => list.filter((e) => !f || f(e)).reduce((a, e) => a + e.minutes, 0);
  const total = sum(eCur);
  const totalPrev = sum(ePrev);
  const sust = sum(eCur, (e) => e.sust);
  const sustPrev = sum(ePrev, (e) => e.sust);
  const typeMap = new Map<string, { code: string; name: string; minutes: number }>();
  for (const e of eCur) {
    const x = typeMap.get(e.typeCode) ?? { code: e.typeCode, name: e.typeName, minutes: 0 };
    x.minutes += e.minutes;
    typeMap.set(e.typeCode, x);
  }
  const types = [...typeMap.values()].sort((a, b) => b.minutes - a.minutes);
  const overdueNow = row?.overdueTasks ?? 0;
  const awaiting = demands.filter((d) => d.approval === "aguardando");

  const qs = (patch: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/clientes/${id}?${q.toString()}${hash}`;
  };

  const hoursCmp = cmpMinutes(total, totalPrev, prevLabel);
  const last = row?.lastContact ?? null;
  const kpis = [
    { v: formatMinutes(sust), label: "em sustentação", cmp: cmpMinutes(sust, sustPrev, prevLabel).text, href: qs({ ev: "apont", ht: "sust", dias: null }, "#linha"), alert: false },
    { v: String(cCur.done), label: cCur.done === 1 ? "tarefa concluída" : "tarefas concluídas", cmp: cmpCount(cCur.done, cPrev.done, prevLabel), href: qs({ ev: "tarefa", ht: null, dias: null }, "#linha"), alert: false },
    { v: String(overdueNow), label: overdueNow === 1 ? "tarefa atrasada" : "tarefas atrasadas", cmp: `${cCur.overdueAtStart === 1 ? "era 1" : `eram ${cCur.overdueAtStart}`} no início do período`, href: "#projetos", alert: overdueNow > 0 },
    { v: String(cCur.demands), label: cCur.demands === 1 ? "demanda adicional criada" : "demandas adicionais criadas", cmp: awaiting.length ? `${awaiting.length} aguardando o cliente` : cmpCount(cCur.demands, cPrev.demands, prevLabel), href: qs({ dem: "aguardando" }, "#demandas"), alert: false, warn: awaiting.length > 0 },
    { v: last ? sinceLabel(row!.workdaysSinceContact) : "nunca", label: "último contato", cmp: last ? `${shortDate(last.date)} · ${contactTypeLabel(last.type).toLowerCase()}` : "nenhum registro", href: "#contatos", alert: !!row?.contactAlert },
  ];

  // ---------- Linha do tempo ----------
  const htOk = (e: (typeof eCur)[number]) => !ht || (ht === "sust" ? e.sust : e.typeCode === ht);
  const dayMap = new Map<string, Day>();
  const getDay = (d: string) => {
    let x = dayMap.get(d);
    if (!x) {
      x = { date: d, label: dayLabel(d, t), minutes: 0, entries: [], events: [] };
      dayMap.set(d, x);
    }
    return x;
  };
  for (const e of eCur) {
    const d = getDay(e.date);
    d.minutes += e.minutes;
    if ((ev === "todos" || ev === "apont") && htOk(e)) {
      const n = names[e.itemId];
      d.entries.push({ id: e.id, person: e.person, color: personColor(e.personId), initials: initials(e.person), item: n?.name ?? "Item", parent: n?.parent ?? null, itemId: e.itemId, type: e.typeName, typeCode: e.typeCode, sust: e.sust, minutes: e.minutes } satisfies ApontRow);
    }
  }
  if (ev !== "apont")
    for (const x of timeline) if (ev === "todos" || ev === x.kind) getDay(toISODate(x.at)).events.push({ ...x, time: hhmm(x.at) });
  const allDays = [...dayMap.values()].filter((d) => d.entries.length || d.events.length).sort((a, b) => b.date.localeCompare(a.date));
  const days = allDays.slice(0, dayLimit);
  const rest = allDays.length - days.length;
  const daysWithEntries = new Set(eCur.map((e) => e.date)).size;
  const evCount = (k: EvKind) => (k === "apont" ? daysWithEntries : timeline.filter((x) => x.kind === k).length);
  const totalEvents = timeline.length;

  // ---------- Horas por consultor e semana ----------
  const byPerson = new Map<string, { id: string; name: string; minutes: number; fat: number }>();
  for (const e of eCur) {
    const x = byPerson.get(e.personId) ?? { id: e.personId, name: e.person, minutes: 0, fat: 0 };
    x.minutes += e.minutes;
    if (e.typeCode === "faturavel") x.fat += e.minutes;
    byPerson.set(e.personId, x);
  }
  const bars = [...byPerson.values()].sort((a, b) => b.minutes - a.minutes);
  const maxBar = Math.max(1, ...bars.map((b) => b.minutes));
  const weeks = Array.from({ length: 10 }, (_, i) => {
    const st = addDays(weeksFrom, i * 7);
    const end = addDays(st, 6);
    const m = eWeeks.filter((e) => e.date >= st && e.date <= end).reduce((a, e) => a + e.minutes, 0);
    return { st, m, on: end >= cur.from && st <= cur.to };
  });
  const maxWeek = Math.max(1, ...weeks.map((w) => w.m));

  // Consultores envolvidos: responsáveis por itens abertos + quem apontou no período.
  const involved = new Map<string, { id: string; name: string }>();
  for (const a of assignees) involved.set(a.id, a);
  for (const b of bars) involved.set(b.id, { id: b.id, name: b.name });

  // ---------- Projetos ----------
  const workSorted = [...work].sort((a, b) => Number(a.stage === "concluido") - Number(b.stage === "concluido") || stageIndex(b.stage) - stageIndex(a.stage) || a.name.localeCompare(b.name, "pt-BR"));
  const projects = work.filter((w) => w.kind === "projeto");

  // ---------- Demandas ----------
  const demGroups = { aguardando: demands.filter((d) => d.approval === "aguardando"), aprovada: demands.filter((d) => d.approval === "aprovada"), recusada: demands.filter((d) => d.approval === "recusada") };
  const dem = demTab ?? (demGroups.aguardando.length ? "aguardando" : demGroups.aprovada.length ? "aprovada" : "aguardando");

  // ---------- Contatos ----------
  const next = contactSum.upcoming[0];
  const clientOpt = [{ id: client.id, name: client.name, color: client.color, contacts: contacts.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })) }];
  const portal: PortalContact[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    jobTitle: c.jobTitle,
    active: c.active,
    portalAccess: c.portalAccess,
    invited: c.portalInvitedAt ? shortDate(toISODate(c.portalInvitedAt)) : null,
    revoked: c.portalRevokedAt ? shortDate(toISODate(c.portalRevokedAt)) : null,
    lastAccess: c.lastAccessAt ? dateTimeShort(c.lastAccessAt, t) : null,
  }));
  const mainPeople = contacts.filter((c) => c.active).slice(0, 3);
  const currentAnnual = annuals.find((a) => a.year === year);
  const odooData = [client.cnpj && `CNPJ ${client.cnpj}`, [client.street, client.city && `${client.city}${client.state ? `/${client.state}` : ""}`, client.zip].filter(Boolean).join(", "), client.phone, client.email].filter(Boolean) as string[];
  const z = row ? HEALTH[row.health] : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-sm text-faint">
          <Link href={`/clientes?p=${period.key}`} className="font-semibold text-[#E6D9F2]! no-underline">
            Clientes
          </Link>
          <span aria-hidden>/</span>
          <span className="font-semibold text-white">{client.name}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-muted">
            {period.label}
            {cur.to !== period.to ? ` até ${shortDate(cur.to)}` : ""}
          </span>
          <PeriodSelector value={period.key} from={period.from} to={period.to} />
        </div>
      </div>

      {/* Cabeçalho */}
      <section aria-labelledby="cname" className="flex flex-wrap items-start gap-x-9 gap-y-5 rounded-[18px] border border-line-2 bg-surface-2 px-6 py-[22px]">
        <div className="flex min-w-0 flex-[2_1_460px] flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-3.5">
            <span aria-hidden className="size-[18px] shrink-0 rounded-[5px]" style={{ background: client.color }} />
            <h1 id="cname" className="h1">
              {client.name}
            </h1>
            {row && <HealthChip health={row.health} />}
            {row && (row.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="neutral">{situationLabel(row)}</Badge>)}
          </div>
          {row && z && (
            <p className="text-[15px] leading-normal" style={{ color: z.fg }}>
              {reasonsText(row.reasons, row.health)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span>Projetos anuais</span>
            {annuals.length === 0 && <span className="text-faint">nenhum no Odoo</span>}
            {annuals.map((a) => (
              <Link
                key={a.id}
                href={`/projetos?cliente=${client.id}&ano=${a.year}`}
                className={cx("inline-flex min-h-9 items-center gap-2 rounded-full border px-3 font-bold no-underline", a.year === year ? "border-line-5 text-white!" : "border-line-3 text-muted!")}
              >
                {a.year}
                {a.year === year && <span className="text-xs font-semibold text-accent-soft">atual</span>}
              </Link>
            ))}
            {row && (
              <Link href="#projetos" className="text-muted!">
                {plural(row.openTasks, "tarefa aberta", "tarefas abertas")} · <span className={row.overdueTasks ? "font-bold text-red" : ""}>{plural(row.overdueTasks, "atrasada", "atrasadas")}</span>
              </Link>
            )}
          </div>
          {odooData.length > 0 && (
            <p className="text-[13px] text-faint">
              <span className="font-semibold text-muted">Dados do Odoo (só leitura):</span> {odooData.join(" · ")}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
          <h2 className="text-sm font-bold text-muted">Contatos principais</h2>
          {mainPeople.length === 0 && <p className="text-sm text-faint">Nenhum contato no Odoo.</p>}
          {mainPeople.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <Avatar name={p.name} initials={initials(p.name)} size={34} />
              <div className="flex min-w-0 flex-col">
                <strong className="text-sm text-white">{p.name}</strong>
                <span className="text-[13px] [overflow-wrap:anywhere] text-faint">{[p.jobTitle, p.email].filter(Boolean).join(" · ") || "sem e-mail"}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2.5">
          <h2 className="text-sm font-bold text-muted">Consultores envolvidos</h2>
          {involved.size === 0 && <p className="text-sm text-faint">Ninguém no período.</p>}
          {[...involved.values()].map((p) => {
            const b = byPerson.get(p.id);
            return (
              <Link key={p.id} href={`/time/${p.id}`} className="flex items-center gap-2.5 no-underline">
                <Avatar name={p.name} initials={initials(p.name)} size={30} color={personColor(p.id)} />
                <span className="text-sm font-semibold text-ink">{p.name}</span>
                <span className="text-[13px] text-faint">{b ? `${formatMinutes(b.minutes)} h no período` : "sem horas no período"}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Números do período */}
      <section aria-label="Números do período" className="flex flex-wrap rounded-2xl border border-line bg-surface">
        <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-2.5 border-line px-5 py-4 sm:border-r">
          <Link href={qs({ ev: "apont", ht: null, dias: null }, "#linha")} className="flex min-h-11 flex-wrap items-baseline gap-2.5 no-underline">
            <span className="num text-[30px] font-bold text-white">{formatMinutes(total)}</span>
            <span className="text-sm text-muted">horas no período</span>
            <span className={cx("text-[13px] font-semibold", hoursCmp.cls)}>{hoursCmp.text}</span>
          </Link>
          <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-line-2">
            {types.map((ty, i) => (
              <span key={ty.code} className="h-full" style={{ width: `${total ? (ty.minutes / total) * 100 : 0}%`, background: entryTypeColor(ty.code, i) }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...types.map((ty, i) => ({ key: ty.code, label: ty.name, m: ty.minutes, color: entryTypeColor(ty.code, i) })), { key: "sust", label: "Sustentação", m: sust, color: SUST_COLOR }].map((x) => (
              <Link
                key={x.key}
                href={qs({ ev: "apont", ht: ht === x.key ? null : x.key, dias: null }, "#linha")}
                aria-current={ht === x.key ? "true" : undefined}
                className={cx("chip gap-1.5 no-underline", ht === x.key && "border-white! bg-white! text-on-accent!")}
              >
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: x.color }} />
                {x.label}
                <span className={cx("num font-bold", ht === x.key ? "text-on-accent" : "text-white")}>{formatMinutes(x.m)}</span>
              </Link>
            ))}
          </div>
        </div>
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="flex min-w-0 flex-[1_1_150px] flex-col gap-1 border-t border-line px-[18px] py-4 no-underline sm:border-t-0 sm:border-r last:border-r-0">
            <span className={cx("num text-2xl font-bold", k.alert ? "text-red" : "warn" in k && k.warn ? "text-yellow" : "text-white")}>{k.v}</span>
            <span className="text-[13px] font-semibold text-ink">{k.label}</span>
            <span className="text-xs text-faint">{k.cmp}</span>
          </Link>
        ))}
      </section>

      <div className="flex flex-wrap items-start gap-[22px]">
        {/* O que aconteceu */}
        <section id="linha" aria-labelledby="tlh" className="card flex min-w-0 flex-[3_1_600px] scroll-mt-6 flex-col gap-3.5 px-[22px] py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="tlh" className="font-display text-xl font-semibold text-white">
              O que aconteceu
            </h2>
            <span className="text-[13px] text-muted">
              {plural(allDays.length, "dia com atividade", "dias com atividade")} · {plural(totalEvents, "evento", "eventos")} e {plural(eCur.length, "apontamento", "apontamentos")}
            </span>
          </div>
          <nav aria-label="Filtrar eventos" className="flex flex-wrap gap-1.5">
            {EV_KINDS.map(([k, label]) => (
              <Link
                key={k}
                href={qs({ ev: k, dias: null, ht: k === "apont" ? (ht || null) : null }, "#linha")}
                scroll={false}
                aria-current={ev === k ? "true" : undefined}
                className={cx("chip gap-1.5 no-underline", ev === k && "border-white! bg-white! text-on-accent!")}
              >
                {label}
                {k !== "todos" && <span className="num text-xs opacity-85">{evCount(k)}</span>}
              </Link>
            ))}
          </nav>
          {ht && (ev === "apont" || ev === "todos") && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] bg-surface-3 px-3 py-2 text-[13px] text-muted">
              <span>
                Mostrando só apontamentos: <strong className="text-white">{ht === "sust" ? "Sustentação" : (types.find((x) => x.code === ht)?.name ?? ht)}</strong>
              </span>
              <Link href={qs({ ht: null }, "#linha")} scroll={false} className="btn-ghost min-h-8 rounded-lg px-2.5 text-[13px] font-bold text-accent-soft! no-underline">
                Limpar
              </Link>
            </div>
          )}
          {days.length ? <TimelineDays days={days} showEntries={ev === "todos" || ev === "apont"} /> : <p className="p-6 text-center text-muted">Nada deste tipo no período.</p>}
          {rest > 0 && (
            <Link href={qs({ dias: String(dayLimit + 6) }, "#linha")} scroll={false} className="btn-ghost self-start text-accent-soft! no-underline">
              Mostrar mais {Math.min(6, rest)} dias ({rest} restantes)
            </Link>
          )}
        </section>

        <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-[22px]">
          <Card title="Horas por consultor">
            {bars.length === 0 && <p className="text-sm text-muted">Ninguém apontou neste período.</p>}
            {bars.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5">
                <Avatar name={b.name} initials={initials(b.name)} size={30} color={personColor(b.id)} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <Link href={`/time/${b.id}`} className="font-semibold text-ink! no-underline">
                      {b.name}
                    </Link>
                    <span className="text-faint">{formatMinutes(b.fat)} faturáveis</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-line-2">
                    <div className="h-full rounded-full" style={{ width: `${((b.minutes / maxBar) * 100).toFixed(1)}%`, background: client.color }} />
                  </div>
                </div>
                <span className="num min-w-[52px] text-right font-bold text-white">{formatMinutes(b.minutes)}</span>
              </div>
            ))}
            <h3 className="mt-2 text-sm font-bold text-muted">Por semana</h3>
            <div className="flex h-[92px] items-end gap-1.5" role="img" aria-label={`Horas por semana nas últimas 10 semanas: ${weeks.map((w) => `${shortDate(w.st)} ${formatMinutes(w.m)}`).join(", ")}`}>
              {weeks.map((w) => (
                <div key={w.st} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[10px] text-muted">{Math.round(w.m / 60)}</span>
                  <span className="w-full rounded-t" style={{ height: Math.max(2, Math.round((w.m / maxWeek) * 62)), background: w.on ? client.color : "#3A2550" }} />
                </div>
              ))}
            </div>
            <div className="flex gap-1.5" aria-hidden>
              {weeks.map((w) => (
                <span key={w.st} className={cx("min-w-0 flex-1 text-center text-[10px]", w.on ? "font-bold text-white" : "text-faint")}>
                  {shortDate(w.st)}
                </span>
              ))}
            </div>
            <span className="text-xs text-faint">Semanas que começam na data indicada. Em destaque: dentro do período escolhido.</span>
          </Card>

          <Card id="contatos" title="Contatos" action={<span className="text-xs text-faint">alerta após 5 dias úteis sem contato</span>}>
            <div className={cx("flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-3", next ? "bg-surface-3" : row?.active ? "bg-red-bg" : "bg-surface-3")}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs text-muted">Próximo contato</span>
                <strong className={cx("text-sm", next && next.date < t ? "text-red" : "text-white")}>
                  {next
                    ? `${next.date === t ? "Hoje" : dayLabel(next.date, t).split(",")[0]}, ${shortDate(next.date)} · ${next.time} · ${contactTypeLabel(next.type)}${next.with ? ` com ${next.with}` : ""} · ${next.responsible}${next.date < t ? " (atrasado)" : ""}`
                    : "Nada agendado. Agende para sair do alerta."}
                </strong>
              </div>
              <ScheduleToggle
                clients={clientOpt}
                people={people.map((p) => ({ id: p.id, name: p.name, role: p.role }))}
                items={openItems.map((i) => ({ id: i.id, name: i.name, clientId: client.id }))}
                meId={me.id}
                clientId={client.id}
                today={t}
              />
            </div>
            {contactSum.history.map((c) => (
              <Link key={c.id} href={`/contatos?sel=${c.id}`} className="flex gap-3 border-t border-line py-2 no-underline">
                <span className="num w-[52px] shrink-0 text-[13px] text-muted">{shortDate(c.date)}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm text-ink">
                    <strong className="text-white">{contactTypeLabel(c.type)}</strong> · {c.responsible}
                    {c.with ? ` com ${c.with}` : ""}
                    {c.status === "nao_atendeu" && <span className="ml-2 text-xs font-bold text-red">não atendeu</span>}
                  </span>
                  {(c.summary || c.nextStep) && (
                    <span className="text-[13px] text-faint">
                      {c.summary}
                      {c.nextStep ? ` Próximo passo: ${c.nextStep}` : ""}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            {contactSum.history.length === 0 && <p className="border-t border-line pt-2 text-sm text-muted">Nenhum contato registrado ainda.</p>}
            <Link href={`/contatos?v=lista&cliente=${client.id}&p=ano`} className="btn-quiet self-start text-sm no-underline">
              Ver histórico completo <Arrow dir="right" />
            </Link>
          </Card>
        </div>
      </div>

      {/* Projetos por etapa */}
      <section id="projetos" aria-labelledby="hpj" className="flex scroll-mt-6 flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="hpj" className="font-display text-xl font-semibold text-white">
            Projetos por etapa
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((st) => (
              <span key={st.key} className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-[11px] py-[5px] text-[13px] text-muted">
                <span className="num font-bold text-white">{projects.filter((p) => p.stage === st.key).length}</span>
                {st.label}
              </span>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          {workSorted.length === 0 ? (
            <p className="p-6 text-center text-muted">Nenhum projeto ou tarefa neste cliente.</p>
          ) : (
            <table className="tbl min-w-[980px]">
              <thead>
                <tr>
                  <th scope="col" className="pl-4!">Projeto ou tarefa</th>
                  <th scope="col">Etapa</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Escopo x realizado</th>
                  <th scope="col">Prazo</th>
                  <th scope="col" className="pr-4!">Responsáveis</th>
                </tr>
              </thead>
              <tbody>
                {workSorted.map((w) => {
                  const si = stageIndex(w.stage);
                  const closed = w.stage === "concluido";
                  const late = !closed && !!w.deadline && w.deadline < t;
                  const over = !!w.estimate && w.done > w.estimate;
                  return (
                    <tr key={w.id}>
                      <td className="pl-4!">
                        <Link href={`/projetos/${w.id}`} className="font-bold text-white! no-underline hover:underline">
                          {w.name}
                        </Link>
                        <span className="block text-xs text-faint">
                          {w.kind === "projeto" ? "Projeto" : "Tarefa"}
                          {w.isSust ? " · Sustentação" : ""}
                          {w.year !== year ? ` · ${w.year}` : ""}
                        </span>
                      </td>
                      <td className="min-w-[200px]">
                        <div className="flex flex-col gap-1.5">
                          <div aria-hidden className="flex gap-[3px]">
                            {STAGES.map((st, i) => (
                              <span key={st.key} className="h-2 flex-1 rounded-[3px]" style={{ background: i < si ? "#7A5A9A" : i === si ? (closed ? "#3FA06C" : "#F07A45") : "#2A1B37" }} />
                            ))}
                          </div>
                          <span className="text-xs text-muted">{STAGES[si]?.long}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {w.scopeStatus === "rascunho" && <span className="rounded-full bg-blue-bg px-2.5 py-[3px] text-xs font-bold text-blue">Escopo em rascunho</span>}
                          {w.tags.map((tg) => (
                            <span key={tg} className={cx("rounded-full px-2.5 py-[3px] text-xs font-bold whitespace-nowrap", TAG_TONE[tg] ?? "bg-line-2 text-[#E6D9F2]")}>
                              {tg}
                            </span>
                          ))}
                          {!w.tags.length && w.scopeStatus !== "rascunho" && <span className="rounded-full border border-line-3 px-2.5 py-[3px] text-xs font-semibold text-faint">{closed ? "Entregue" : "Normal"}</span>}
                        </div>
                      </td>
                      <td className="min-w-[220px]">
                        <div className="flex flex-col gap-[5px]">
                          {w.estimate ? (
                            <span className={cx("num text-[13px]", over ? "text-yellow" : "text-ink")}>
                              {formatMinutes(w.done)} de {formatMinutes(w.estimate)} h{over ? ` · ${formatMinutes(w.done - w.estimate)} h acima` : ""}
                            </span>
                          ) : (
                            <span className="text-[13px] text-faint">{w.scopeStatus === "rascunho" ? "escopo ainda não confirmado" : `${formatMinutes(w.done)} h realizadas, sem estimativa`}</span>
                          )}
                          <div className="h-1.5 overflow-hidden rounded-full bg-line-2">
                            <div className="h-full rounded-full" style={{ width: `${w.estimate ? Math.min(100, (w.done / w.estimate) * 100).toFixed(0) : 0}%`, background: over ? "#E9B320" : closed ? "#3FA06C" : "#A897F5" }} />
                          </div>
                        </div>
                      </td>
                      <td className={cx("whitespace-nowrap", late ? "font-bold text-red" : "text-muted")}>{w.deadline ? shortDate(w.deadline) : "a definir"}</td>
                      <td className="pr-4!">
                        <div className="flex">
                          {w.people.map((p, i) => (
                            <span key={p.id} className={cx("rounded-full border-2 border-surface", i > 0 && "-ml-1.5")}>
                              <Avatar name={p.name} initials={initials(p.name)} size={28} color={personColor(p.id)} />
                            </span>
                          ))}
                          {!w.people.length && <span className="text-faint">–</span>}
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

      <div className="flex flex-wrap items-start gap-[22px]">
        <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-[22px]">
          <Card
            id="demandas"
            title="Demandas adicionais"
            action={
              <Segmented
                options={[
                  { value: "aguardando", label: `Aguardando cliente · ${demGroups.aguardando.length}` },
                  { value: "aprovada", label: `Aprovadas · ${demGroups.aprovada.length}` },
                  { value: "recusada", label: `Recusadas · ${demGroups.recusada.length}` },
                ]}
                value={dem}
                hrefFor={(v) => qs({ dem: v }, "#demandas")}
              />
            }
          >
            {demGroups[dem].map((d) => {
              const since = diffDays(t, toISODate(d.createdAt));
              const who = d.approver ?? "o cliente";
              const evidence =
                d.approval === "aguardando"
                  ? `Enviada ao cliente em ${shortDate(toISODate(d.createdAt))}`
                  : d.approval === "aprovada"
                    ? `Aprovada por ${who}${d.approvalAt ? ` em ${shortDate(toISODate(d.approvalAt))}` : ""}`
                    : `Recusada por ${who}${d.approvalAt ? ` em ${shortDate(toISODate(d.approvalAt))}` : ""}${d.reason ? `: ${d.reason}` : ""}`;
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line py-3">
                  <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-[3px]">
                    <Link href={`/projetos/${d.id}`} className="text-sm font-bold text-white! no-underline hover:underline">
                      {d.name}
                    </Link>
                    <span className="text-[13px] text-faint">{[d.parent, d.requester && `pedida por ${d.requester}`, d.requestedAt && shortDate(d.requestedAt)].filter(Boolean).join(" · ")}</span>
                    <span className="text-[13px] text-muted">{evidence}</span>
                  </div>
                  {d.minutes ? <span className="num text-[13px] text-ink">{formatMinutes(d.minutes)} h</span> : null}
                  <span
                    className={cx(
                      "rounded-full px-[11px] py-[5px] text-[13px] font-bold whitespace-nowrap",
                      d.approval === "aguardando" ? "bg-yellow-bg text-yellow" : d.approval === "aprovada" ? "bg-green-bg text-green" : "bg-red-bg text-red",
                    )}
                  >
                    {d.approval === "aguardando" ? `parada há ${plural(since, "dia", "dias")}` : d.approval === "aprovada" ? "pode apontar" : "não apontar"}
                  </span>
                </div>
              );
            })}
            {demGroups[dem].length === 0 && <p className="border-t border-line py-4 text-sm text-muted">Nenhuma demanda nesta situação.</p>}
            <p className="text-xs text-faint">Demanda adicional só aceita horas depois que o cliente aprova, pelo portal ou com print anexado.</p>
          </Card>

          <Card id="prazos" title="Reprogramações de prazo" action={<span className="text-xs text-faint">{plural(changes.length, "mudança", "mudanças")}</span>}>
            {changes.length === 0 ? (
              <p className="text-sm text-muted">Nenhum prazo reprogramado neste cliente.</p>
            ) : (
              <ul className="flex flex-col">
                {changes.slice(0, 12).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line py-2.5">
                    <span className="num w-[52px] shrink-0 text-[13px] text-muted">{shortDate(toISODate(c.at))}</span>
                    <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                      <Link href={`/projetos/${c.itemId}`} className="text-sm font-bold text-white! no-underline hover:underline">
                        {c.item}
                      </Link>
                      <span className="text-[13px] text-muted">Motivo: {c.reason}</span>
                    </div>
                    <span className="num inline-flex items-center gap-1.5 text-[13px] text-ink">
                      {c.from ? shortDate(c.from) : "sem prazo"} <Arrow dir="right" /> {shortDate(c.to)}
                    </span>
                    <span className="text-xs text-faint">{c.who ?? "Odoo"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-[22px]">
          <Card title="Avaliações do cliente">
            {evals.n === 0 ? (
              <p className="text-sm text-muted">Nenhuma avaliação publicada ainda.</p>
            ) : (
              (
                [
                  ["Resultado", evals.result],
                  ["Consultor", evals.consultant],
                  ["Time", evals.team],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="w-[82px] shrink-0 text-sm text-ink">{label}</span>
                  <div aria-hidden className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span key={i} className="size-3.5 rounded-full" style={{ background: (v ?? 0) >= i - 0.25 ? "#F07A45" : (v ?? 0) >= i - 0.75 ? "#8A4A35" : "#2A1B37" }} />
                    ))}
                  </div>
                  <span className="num font-bold text-white">{v === null ? "–" : v.toFixed(1).replace(".", ",")}</span>
                </div>
              ))
            )}
            <span className="text-[13px] text-faint">Médias das avaliações publicadas · {plural(evals.nYear, "avaliação", "avaliações")} em {year}</span>
            {manager && evals.pending > 0 && (
              <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-yellow-bg px-3 py-2.5 text-sm text-yellow">
                <strong className="flex-[1_1_180px]">{plural(evals.pending, "avaliação aguardando publicação", "avaliações aguardando publicação")}</strong>
                <Link href="/gestao/pendencias" className="inline-flex min-h-11 items-center font-bold text-yellow!">
                  Revisar e publicar
                </Link>
              </div>
            )}
          </Card>

          <Card title="Acessos ao portal">
            <PortalAccess clientId={client.id} contacts={portal} canManage={canManagePortal(me)} />
          </Card>

          <Card title="Dados internos" action={<span className="text-xs text-faint">só no Clarity, nunca no portal</span>}>
            <InternalForm clientId={client.id} erp={client.erp} notes={client.internalNotes} canEdit={manager} />
          </Card>
        </div>
      </div>
      {!currentAnnual && <p className="text-sm text-yellow">Este cliente não tem projeto anual de {year} no Odoo.</p>}
    </>
  );
}
