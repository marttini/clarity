import Link from "next/link";
import type { Metadata } from "next";
import { eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { getEntryTypes, getSettings } from "@/server/data/common";
import { evaluationsList, loadJustifications, managementCounts, missingReport, monthLabel, recentDecisions } from "@/server/queries/analytics";
import { editDeadline } from "@/domain/rules";
import { addMonths, endOfMonth, longDate, shortDate, startOfDayInstant, startOfMonth, toISODate, weekdayShort, type ISODate } from "@/domain/dates";
import { now, today } from "@/lib/clock";
import { Avatar, ClientChip, ClientSwatch, Empty, cx } from "@/components/ui";
import { hm, initials, param, withQuery, type SP } from "@/components/time/bits";
import { ActionButtons, ApproveRefuse } from "@/components/gestao/action-buttons";
import { chargeClientAction, decideChangeAction, decideEvaluationAction, resendAction } from "./actions";

export const metadata: Metadata = { title: "Pendências da gestão" };

const TABS = [
  { key: "alteracoes", label: "Alterações de horas" },
  { key: "ausencias", label: "Ausências justificadas" },
  { key: "dias", label: "Dias sem apontamento" },
  { key: "provisionamentos", label: "Provisionamentos vencidos" },
  { key: "demandas", label: "Demandas com o cliente" },
  { key: "avaliacoes", label: "Avaliações a publicar" },
  { key: "sincronizacao", label: "Sincronização" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function ago(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "há menos de 1 h";
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** US-10, US-11, US-12 e afins: pendências da gestão, em abas com contagem. */
export default async function PendingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireTeam();
  if (!isManager(me)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="h1">Pendências da gestão</h1>
        <p className="text-muted">Só a gestão vê esta tela. Seus pedidos e avisos estão na <Link href="/fila">Minha fila</Link>.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const t = today();
  const nowAt = now();
  const tab: Tab = (TABS.find((x) => x.key === param(sp, "aba"))?.key ?? "alteracoes") as Tab;
  const mParam = param(sp, "mes");
  const month: ISODate = mParam && /^\d{4}-\d{2}$/.test(mParam) ? `${mParam}-01` : startOfMonth(t);
  const settings = await getSettings();
  const c = await managementCounts(t, nowAt);
  const counts: Record<Tab, number> = {
    alteracoes: c.changes.length,
    ausencias: c.monthJust.length,
    dias: c.report.filter((r) => r.missing.length > 0).length,
    provisionamentos: c.prov.length,
    demandas: c.demands.length,
    avaliacoes: c.evals.length,
    sincronizacao: c.sync.entries.length + c.sync.items.length,
  };
  const subtitle = counts.alteracoes
    ? `${counts.alteracoes} ${counts.alteracoes === 1 ? "pedido de alteração aguarda" : "pedidos de alteração aguardam"} decisão.`
    : "Nenhum pedido de alteração esperando.";
  const tabHref = (k: string) => withQuery("/gestao/pendencias", {}, { aba: k === "alteracoes" ? null : k, mes: mParam ?? null });
  const monthOptions = [0, 1, 2, 3, 4, 5].map((i) => addMonths(startOfMonth(t), -i));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Link href="/gestao" className="inline-flex min-h-9 w-fit items-center gap-1.5 text-sm font-semibold !text-accent-soft no-underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Voltar para A Síntese hoje
        </Link>
        <h1 className="h1">Pendências da gestão</h1>
        <p className="text-[15px] text-muted">
          {cap(longDate(t))}. {subtitle}
        </p>
      </div>

      <nav aria-label="Tipo de pendência" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {TABS.map((x) => {
          const on = x.key === tab;
          return (
            <Link
              key={x.key}
              href={tabHref(x.key)}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={cx("inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold no-underline", on ? "bg-line-2 !text-white" : "!text-muted hover:!text-white")}
            >
              {x.label}
              <span className={cx("num rounded-full px-2 py-0.5 text-xs", counts[x.key] ? (on ? "bg-accent text-on-accent" : "bg-line-3 text-white") : "bg-line text-faint")}>{counts[x.key]}</span>
            </Link>
          );
        })}
      </nav>

      {tab === "alteracoes" && <ChangesTab me={me} changes={c.changes} nowAt={nowAt} />}
      {tab === "ausencias" && <AbsencesTab month={month} options={monthOptions} />}
      {tab === "dias" && <MissingTab month={month} options={monthOptions} today={t} limit={settings.missingDaysLimit} />}
      {tab === "provisionamentos" && <ProvTab rows={c.prov} />}
      {tab === "demandas" && <DemandsTab rows={c.demands} />}
      {tab === "avaliacoes" && <EvaluationsTab />}
      {tab === "sincronizacao" && <SyncTab sync={c.sync} />}
    </>
  );
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function MonthPicker({ month, options, tab }: { month: ISODate; options: ISODate[]; tab: string }) {
  return (
    <div role="group" aria-label="Mês" className="flex flex-wrap gap-1.5">
      {options.map((m) => (
        <Link
          key={m}
          href={withQuery("/gestao/pendencias", {}, { aba: tab, mes: m.slice(0, 7) })}
          scroll={false}
          aria-pressed={m === month}
          className={cx("chip no-underline", m === month ? "!border-white bg-white !text-on-accent" : "!text-[#e6d9f2]")}
        >
          {cap(monthLabel(m, true))}
        </Link>
      ))}
    </div>
  );
}

// ---------- Alterações de horas (US-10) ----------

async function ChangesTab({ me, changes, nowAt }: { me: { canApproveHours: boolean }; changes: Awaited<ReturnType<typeof managementCounts>>["changes"]; nowAt: Date }) {
  const settings = await getSettings();
  const types = new Map((await getEntryTypes()).map((x) => [x.id, x]));
  const itemIds = new Set<string>();
  for (const r of changes) {
    itemIds.add(r.entry.itemId);
    const nv = (r.cr.newValues ?? {}) as Record<string, unknown>;
    if (typeof nv.itemId === "string") itemIds.add(nv.itemId);
  }
  const items = itemIds.size
    ? await db
        .select({ id: s.items.id, name: s.items.name, client: s.clients.name, color: s.clients.color })
        .from(s.items)
        .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
        .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
        .where(inArray(s.items.id, [...itemIds]))
    : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const approvers = await db.select({ name: s.people.name, can: s.people.canApproveHours }).from(s.people);
  const decided = await recentDecisions(startOfDayInstant(today()));

  const fieldsOf = (r: (typeof changes)[number]) => {
    const e = r.entry;
    const ov = { itemId: e.itemId, date: e.date, minutes: e.minutes, typeId: e.typeId, description: e.description, isSustentacao: e.isSustentacao, ...(r.cr.oldValues as Record<string, unknown>) };
    const nv = r.cr.kind === "excluir" ? null : { ...ov, ...((r.cr.newValues ?? {}) as Record<string, unknown>) };
    const fmt = (k: string, v: unknown) => {
      if (k === "minutes") return hm(Number(v));
      if (k === "date") return `${weekdayShort(String(v))}, ${shortDate(String(v))}`;
      if (k === "typeId") return types.get(String(v))?.name ?? "?";
      if (k === "itemId") return itemMap.get(String(v))?.name ?? "?";
      if (k === "isSustentacao") return v ? "Sim" : "Não";
      return String(v ?? "");
    };
    const rows: [string, string][] = [
      ["Horas", "minutes"],
      ["Data", "date"],
      ["Cliente", "client"],
      ["Tarefa", "itemId"],
      ["Tipo", "typeId"],
      ["Sustentação", "isSustentacao"],
      ["Descrição", "description"],
    ];
    return rows.map(([label, k]) => {
      if (k === "client") {
        const b = itemMap.get(String(ov.itemId));
        const a = nv ? itemMap.get(String(nv.itemId)) : null;
        return { label, before: b?.client ?? "?", after: nv ? (a?.client ?? "?") : "excluir", beforeColor: b?.color, afterColor: a?.color, changed: !nv || b?.client !== a?.client };
      }
      const before = fmt(k, (ov as Record<string, unknown>)[k]);
      const after = nv ? fmt(k, (nv as Record<string, unknown>)[k]) : "excluir";
      return { label, before, after, changed: before !== after, mono: k === "minutes" };
    });
  };

  return (
    <section aria-labelledby="h-alt" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="h-alt" className="h2">Alterações de horas</h2>
          <p className="text-sm text-muted">Depois de 48 h, um lançamento só muda com pedido aprovado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          Podem aprovar
          {approvers
            .filter((a) => a.can)
            .map((a) => (
              <span key={a.name} className="inline-flex items-center gap-1.5 rounded-full border border-line-3 py-1 pr-2.5 pl-1 font-bold text-[#e6d9f2]">
                <Avatar name={a.name} initials={initials(a.name)} size={22} />
                {a.name}
              </span>
            ))}
        </div>
      </div>
      {!me.canApproveHours && changes.length > 0 && <p className="rounded-xl bg-surface-3 px-4 py-3 text-sm text-muted">Você acompanha os pedidos; só Marttini e Richard decidem.</p>}
      {changes.length === 0 && (
        <div className="flex items-center gap-2.5 rounded-xl bg-green-bg px-4 py-3.5 font-semibold text-green">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12l5 5 9-10" />
          </svg>
          Nenhum pedido esperando. Tudo resolvido por hoje.
        </div>
      )}
      {changes.map((r) => {
        const deadline = editDeadline({ createdAt: r.entry.createdAt, date: r.entry.date, isProvisioning: !!types.get(r.entry.typeId)?.isProvisioning }, settings);
        return (
          <article key={r.cr.id} aria-label={`Pedido de ${r.person.name}`} className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={r.person.name} initials={initials(r.person.name)} size={36} />
              <div className="flex min-w-0 flex-1 flex-col">
                <strong className="text-white">{r.person.name}</strong>
                <span className="text-[13px] text-muted">
                  Lançamento de {weekdayShort(r.entry.date)}, {shortDate(r.entry.date)} · pedido {ago(nowAt.getTime() - r.cr.createdAt.getTime())}
                  {r.cr.kind === "excluir" ? " · pede para excluir" : ""}
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-bg px-2.5 py-1 text-xs font-bold text-yellow">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                passou das 48 h {ago(nowAt.getTime() - deadline.getTime())}
              </span>
            </div>
            <div className="flex flex-wrap gap-5">
              <div className="min-w-0 flex-[3_1_480px] overflow-x-auto">
                <table className="tbl min-w-[460px]">
                  <thead>
                    <tr>
                      <th scope="col">Campo</th>
                      <th scope="col">Antes</th>
                      <th scope="col">
                        <span className="sr-only">para</span>
                      </th>
                      <th scope="col">Depois</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldsOf(r).map((f) => (
                      <tr key={f.label} className={cx(!f.changed && "text-muted")}>
                        <th scope="row" className="!text-[13px] !font-semibold">{f.label}</th>
                        <td className={cx(f.mono && "num")}>
                          <span className="inline-flex items-center gap-1.5">
                            {"beforeColor" in f && f.beforeColor && <ClientSwatch color={f.beforeColor} />}
                            {f.before}
                          </span>
                        </td>
                        <td className="text-faint">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </td>
                        <td className={cx(f.mono && "num", f.changed && "font-bold text-white")}>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            {"afterColor" in f && f.afterColor && <ClientSwatch color={f.afterColor} />}
                            {f.after}
                            {f.changed && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-extrabold text-on-accent">mudou</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-3">
                <div className="flex flex-col gap-1 rounded-xl bg-surface-3 px-3.5 py-3">
                  <span className="text-xs font-bold text-faint">Justificativa</span>
                  <p className="text-sm">{r.cr.justification}</p>
                </div>
                {me.canApproveHours && <ApproveRefuse id={r.cr.id} action={decideChangeAction} />}
              </div>
            </div>
          </article>
        );
      })}
      {decided.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="h3">Resolvidos hoje</h3>
          <div className="table-wrap">
            <table className="tbl min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col">Consultor</th>
                  <th scope="col">Pedido</th>
                  <th scope="col">Decisão</th>
                  <th scope="col">Por</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((d) => (
                  <tr key={d.cr.id}>
                    <td>{d.person.name}</td>
                    <td className="text-muted">{d.cr.justification}</td>
                    <td>
                      <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", d.cr.status === "aprovada" ? "bg-green-bg text-green" : "bg-red-bg text-red")}>{d.cr.status === "aprovada" ? "Aprovada" : "Recusada"}</span>
                      {d.cr.decisionReason && <span className="mt-1 block text-xs text-muted">{d.cr.decisionReason}</span>}
                    </td>
                    <td>{d.decider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Ausências justificadas (US-11) ----------

async function AbsencesTab({ month, options }: { month: ISODate; options: ISODate[] }) {
  const rows = await loadJustifications(null, { from: month, to: endOfMonth(month) });
  const people = new Map((await db.select({ id: s.people.id, name: s.people.name }).from(s.people)).map((p) => [p.id, p.name]));
  const atts = rows.length ? await db.select({ id: s.attachments.id, filename: s.attachments.filename }).from(s.attachments).where(inArray(s.attachments.id, rows.map((r) => r.attachmentId))) : [];
  const files = new Map(atts.map((a) => [a.id, a.filename]));
  return (
    <section aria-labelledby="h-aus" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="h-aus" className="h2">Ausências justificadas</h2>
          <p className="text-sm text-muted">Não precisa de aprovação. Basta o comprovante. Os dias justificados não contam para a regra dos 3 dias.</p>
        </div>
        <MonthPicker month={month} options={options} tab="ausencias" />
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <Empty>Nenhuma ausência justificada em {monthLabel(month)}.</Empty>
        ) : (
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th scope="col">Consultor</th>
                <th scope="col">Dia</th>
                <th scope="col">Motivo</th>
                <th scope="col">Comprovante</th>
                <th scope="col">Registrado em</th>
                <th scope="col">Efeito</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.personId + r.date}>
                  <td>
                    <Link href={`/time/${r.personId}`} className="font-bold !text-white no-underline">
                      {people.get(r.personId)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">
                    {weekdayShort(r.date)}, {shortDate(r.date)}
                  </td>
                  <td>
                    <span className="font-semibold">{r.reason}</span>
                    {r.note && <span className="block text-[13px] text-muted">{r.note}</span>}
                  </td>
                  <td>
                    <a href={`/gestao/pendencias/comprovante/${r.attachmentId}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold !text-accent-soft">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />
                      </svg>
                      {files.get(r.attachmentId) ?? "comprovante"}
                    </a>
                  </td>
                  <td className="text-muted">{shortDate(toISODate(r.createdAt))}</td>
                  <td>
                    <span className="rounded-full bg-green-bg px-2.5 py-1 text-xs font-bold text-green">fora da regra dos 3 dias</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ---------- Dias sem apontamento: relatório mensal (US-11) ----------

async function MissingTab({ month, options, today: t, limit }: { month: ISODate; options: ISODate[]; today: ISODate; limit: number }) {
  const rows = await missingReport(month, t);
  const isCurrent = month === startOfMonth(t);
  return (
    <section aria-labelledby="h-dias" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="h-dias" className="h2">Dias sem apontamento</h2>
          <p className="text-sm text-muted">
            Relatório de {monthLabel(month)}. Dias úteis sem hora real (provisionamento não conta). {limit} dias úteis seguidos sem apontar e sem justificar = sem bônus no mês.
          </p>
        </div>
        <MonthPicker month={month} options={options} tab="dias" />
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th scope="col">Consultor</th>
              <th scope="col">Sem apontar</th>
              <th scope="col">Dias</th>
              <th scope="col">Justificados</th>
              <th scope="col">Maior sequência</th>
              <th scope="col">Bônus do mês</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.person.id}>
                <td>
                  <Link href={`/time/${r.person.id}?m=${month.slice(0, 7)}`} className="flex min-h-11 items-center gap-2.5 font-bold !text-white no-underline">
                    <Avatar name={r.person.name} initials={initials(r.person.name)} size={30} />
                    {r.person.name}
                  </Link>
                </td>
                <td className={cx("num font-bold", r.missing.length ? "text-red" : "text-ink")}>{r.missing.length}</td>
                <td className="text-[13px] text-muted">{r.missing.length ? r.missing.map(shortDate).join(", ") : "—"}</td>
                <td className="num">{r.justified.length}</td>
                <td className="num">{r.worstStreak}</td>
                <td>
                  {r.lostBonus ? (
                    <span className="rounded-full bg-red-bg px-2.5 py-1 text-xs font-bold text-red">Sem bônus no mês</span>
                  ) : isCurrent && r.currentStreak > 0 ? (
                    <span className="rounded-full bg-yellow-bg px-2.5 py-1 text-xs font-bold text-yellow">
                      Atenção: {r.currentStreak} de {limit} dias
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-bg px-2.5 py-1 text-xs font-bold text-green">Mantido</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Provisionamentos vencidos (US-12) ----------

function ProvTab({ rows }: { rows: Awaited<ReturnType<typeof managementCounts>>["prov"] }) {
  const byPerson = new Map<string, typeof rows>();
  for (const r of rows) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);
  return (
    <section aria-labelledby="h-prov" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-prov" className="h2">Provisionamentos vencidos</h2>
        <p className="text-sm text-muted">A data chegou e o consultor ainda não converteu em hora real. Depois de 48 h da data, só com pedido de alteração.</p>
      </div>
      {rows.length === 0 && <Empty>Nenhum provisionamento vencido.</Empty>}
      {[...byPerson.values()].map((list) => (
        <div key={list[0].personId} className="flex flex-col gap-2">
          <h3 className="flex flex-wrap items-center gap-2.5">
            <Link href={`/time/${list[0].personId}`} className="font-bold !text-white no-underline">
              {list[0].personName}
            </Link>
            <span className="text-[13px] text-muted">
              {list.length} {list.length === 1 ? "lançamento" : "lançamentos"} · {hm(list.reduce((a, r) => a + r.minutes, 0))} h
            </span>
          </h3>
          <div className="table-wrap">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th scope="col">Data provisionada</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Tarefa</th>
                  <th scope="col" className="text-right">Horas</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      {weekdayShort(r.date)}, {shortDate(r.date)}
                    </td>
                    <td>
                      <ClientChip name={r.clientName} color={r.clientColor} />
                    </td>
                    <td>
                      <Link href={`/projetos/${r.itemId}`} className="font-semibold no-underline">
                        {r.itemName}
                      </Link>
                      <span className="block text-[13px] text-muted">{r.description}</span>
                    </td>
                    <td className="num text-right font-bold text-white">{hm(r.minutes)}</td>
                    <td>
                      <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", r.expired ? "bg-red-bg text-red" : "bg-yellow-bg text-yellow")}>
                        {r.expired ? `prazo de 48 h encerrado` : `a converter · ${r.daysLate === 1 ? "1 dia" : `${r.daysLate} dias`}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------- Demandas adicionais aguardando o cliente ----------

function DemandsTab({ rows }: { rows: Awaited<ReturnType<typeof managementCounts>>["demands"] }) {
  return (
    <section aria-labelledby="h-dem" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-dem" className="h2">Demandas adicionais com o cliente</h2>
        <p className="text-sm text-muted">Pedidos fora do escopo. Só aceitam horas depois que o cliente aprova, pelo portal ou por print anexado.</p>
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <Empty>Nenhuma demanda parada com o cliente.</Empty>
        ) : (
          <table className="tbl min-w-[880px]">
            <thead>
              <tr>
                <th scope="col">Demanda</th>
                <th scope="col">Cliente</th>
                <th scope="col">Estimativa</th>
                <th scope="col">Enviada em</th>
                <th scope="col">Parada há</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/projetos/${d.parentId ?? d.id}?aba=demandas`} className="font-semibold !text-white no-underline">
                      {d.name}
                    </Link>
                    <span className="block text-xs text-faint">{d.parentName ? `Projeto ${d.parentName}` : d.annualName}</span>
                  </td>
                  <td>
                    <ClientChip name={d.clientName} color={d.clientColor} />
                  </td>
                  <td className="num">{d.planned ? `${hm(d.planned)} h` : "—"}</td>
                  <td className="whitespace-nowrap">{shortDate(d.since)}</td>
                  <td>
                    <span className={cx("num rounded-full px-2.5 py-1 text-xs font-bold", d.days >= 5 ? "bg-red-bg text-red" : "bg-yellow-bg text-yellow")}>{d.days === 1 ? "1 dia" : `${d.days} dias`}</span>
                  </td>
                  <td>
                    {d.charge ? (
                      <span className="text-[13px] text-green">
                        Cobrança com {d.charge.responsible.split(" ")[0]} · {shortDate(toISODate(d.charge.scheduledAt))}
                      </span>
                    ) : (
                      <ActionButtons id={d.id} action={chargeClientAction} buttons={[{ value: "cobrar", label: "Cobrar cliente", primary: true }]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[13px] text-faint">&ldquo;Cobrar cliente&rdquo; agenda um contato para a Maria no próximo dia útil, com o objetivo &ldquo;Cobrar aprovação da demanda&rdquo;.</p>
    </section>
  );
}

// ---------- Avaliações a publicar (US-33) ----------

function Dots({ v }: { v: number }) {
  return (
    <span role="img" aria-label={`${v} de 5`} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-2.5 w-2.5 rounded-full", i <= v ? "bg-accent" : "bg-line-3")} />
      ))}
    </span>
  );
}

async function EvaluationsTab() {
  const all = await evaluationsList();
  const pending = all.filter((e) => !e.ev.published && !e.ev.publishedAt);
  const decided = all.filter((e) => e.ev.publishedAt).slice(0, 8);
  return (
    <section aria-labelledby="h-aval" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-aval" className="h2">Avaliações dos clientes</h2>
        <p className="text-sm text-muted">Ficam ocultas até a gestão publicar. Publicadas, o time inteiro vê na ficha do consultor.</p>
      </div>
      {pending.length === 0 && <Empty>Nenhuma avaliação aguardando decisão.</Empty>}
      <div className="flex flex-wrap gap-4">
        {pending.map((e) => (
          <article key={e.ev.id} className="card flex min-w-0 flex-[1_1_360px] flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2">
                <ClientSwatch color={e.clientColor} />
                <strong className="text-white">{e.clientName}</strong>
              </span>
              <span className="text-[13px] text-muted">
                {e.contactName} · {shortDate(toISODate(e.ev.createdAt))}
              </span>
            </div>
            <span className="text-[13px] text-muted">
              Consultor: {e.consultantName ? <Link href={`/time/${e.ev.consultantId}`}>{e.consultantName}</Link> : "—"}
              {e.itemName ? ` · ${e.itemName}` : ""}
            </span>
            <div className="flex flex-col gap-1.5">
              {[
                ["Resultado", e.ev.scoreResult],
                ["Consultor", e.ev.scoreConsultant],
                ["Time", e.ev.scoreTeam],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center gap-3 text-sm">
                  <span className="w-[90px]">{k}</span>
                  <Dots v={v as number} />
                  <span className="num font-bold text-white">{v}</span>
                </div>
              ))}
            </div>
            {e.ev.comment && <p className="rounded-xl bg-surface-3 px-3.5 py-3 text-sm">&ldquo;{e.ev.comment}&rdquo;</p>}
            <ActionButtons
              id={e.ev.id}
              action={decideEvaluationAction}
              buttons={[
                { value: "publicar", label: "Publicar", primary: true },
                { value: "ocultar", label: "Manter oculta" },
              ]}
            />
          </article>
        ))}
      </div>
      {decided.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="h3">Decididas</h3>
          <div className="table-wrap">
            <table className="tbl min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Consultor</th>
                  <th scope="col">Situação</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {decided.map((e) => (
                  <tr key={e.ev.id}>
                    <td>{e.clientName}</td>
                    <td>{e.consultantName ?? "—"}</td>
                    <td>
                      <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", e.ev.published ? "bg-green-bg text-green" : "bg-line-2 text-[#e6d9f2]")}>{e.ev.published ? "Publicada" : "Mantida oculta (feedback)"}</span>
                    </td>
                    <td>
                      <ActionButtons id={e.ev.id} action={decideEvaluationAction} buttons={[{ value: "reabrir", label: "Desfazer" }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Sincronização (US-21) ----------

function SyncTab({ sync }: { sync: Awaited<ReturnType<typeof managementCounts>>["sync"] }) {
  const total = sync.entries.length + sync.items.length;
  return (
    <section aria-labelledby="h-sync" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-sync" className="h2">Sincronização com o Odoo</h2>
        <p className="text-sm text-muted">Registros que o Odoo recusou. Corrija a causa e reenvie; o envio passa pela fila.</p>
      </div>
      <div className="table-wrap">
        {total === 0 ? (
          <Empty>Nenhum erro de sincronização.</Empty>
        ) : (
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th scope="col">Registro</th>
                <th scope="col">Cliente</th>
                <th scope="col">Erro</th>
                <th scope="col">Desde</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sync.entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong className="text-white">Apontamento</strong>
                    <span className="block text-[13px] text-muted">
                      {e.who} · {hm(e.minutes)} em {shortDate(e.date)} · {e.item}
                    </span>
                  </td>
                  <td>
                    <ClientChip name={e.client} color={e.clientColor} />
                  </td>
                  <td className="text-[13px] text-red">{e.error ?? "Erro sem mensagem."}</td>
                  <td className="text-muted">{shortDate(toISODate(e.updatedAt))}</td>
                  <td>
                    <ActionButtons id={e.id} extra={{ entity: "time_entry" }} action={resendAction} buttons={[{ value: "reenviar", label: "Reenviar" }]} />
                  </td>
                </tr>
              ))}
              {sync.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/projetos/${e.id}`} className="font-bold !text-white no-underline">
                      {e.kind === "projeto" ? "Projeto" : "Tarefa"}: {e.name}
                    </Link>
                  </td>
                  <td>
                    <ClientChip name={e.client} color={e.clientColor} />
                  </td>
                  <td className="text-[13px] text-red">{e.error ?? "Erro sem mensagem."}</td>
                  <td className="text-muted">{shortDate(toISODate(e.updatedAt))}</td>
                  <td>
                    <ActionButtons id={e.id} extra={{ entity: "item" }} action={resendAction} buttons={[{ value: "reenviar", label: "Reenviar" }]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
