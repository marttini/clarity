import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { today, now } from "@/lib/clock";
import { formatMinutes, shortDate, toISODate } from "@/domain/dates";
import { initials } from "@/server/data/common";
import { ItemError, loadItemCtx } from "@/server/services/items";
import { confirmChecks, diffDeliverables, getDeliverables, getVersions } from "@/server/services/scope";
import { cx } from "@/components/ui";
import { FileKind, hoursText, personColor, relTime, stageLabel } from "@/components/projetos/bits";
import { UploadForm } from "@/components/projetos/client";
import { ConfirmScope, MeetingForm, RemoveMeeting, ScopeEditor } from "@/components/projetos/scope-editor";
import { confirmScopeAction, meetingAction, removeMeetingAction, saveScopeAction, uploadAction } from "../../actions";

export const metadata = { title: "Escopo · Clarity" };

const fmtH = (m: number | null) => (m ? (m % 60 ? `${formatMinutes(m)} h` : `${m / 60} h`) : "0 h");
const dateBr = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

const SCOPE_AUDIT: Record<string, string> = {
  editar_rascunho: "editou o rascunho",
  reuniao: "registrou uma reunião",
  remover_reuniao: "removeu uma reunião",
  confirmar: "confirmou o escopo. Enviado ao Odoo.",
  nova_versao: "gerou nova versão",
};

export default async function EscopoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireTeam();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let ctx;
  try {
    ctx = await loadItemCtx(id);
  } catch (e) {
    if (e instanceof ItemError) notFound();
    throw e;
  }
  const { item, annual, client } = ctx;
  if (item.kind !== "projeto") notFound();
  const draft = item.scopeStatus === "rascunho";
  const versions = await getVersions(id);
  const allDs = await getDeliverables(versions.map((v) => v.id));
  const draftV = versions.find((v) => v.version === 0) ?? null;
  const confirmed = versions.filter((v) => v.version > 0);
  const current = draft ? draftV : confirmed.at(-1) ?? null;
  const ds = current ? allDs.filter((d) => d.scopeVersionId === current.id) : [];
  const [people, meetings, docs, audits, confirmers, extras] = await Promise.all([
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(eq(s.people.active, true)).orderBy(asc(s.people.name)),
    db.select().from(s.meetings).where(eq(s.meetings.itemId, id)).orderBy(desc(s.meetings.date)),
    db
      .select({ a: s.attachments, by: s.people.name, contact: s.clientContacts.name })
      .from(s.attachments)
      .leftJoin(s.people, eq(s.people.id, s.attachments.uploadedByPersonId))
      .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.attachments.uploadedByContactId))
      .where(and(eq(s.attachments.ownerType, "item"), eq(s.attachments.ownerId, id)))
      .orderBy(desc(s.attachments.createdAt)),
    db
      .select({ a: s.auditLog, by: s.people.name })
      .from(s.auditLog)
      .leftJoin(s.people, eq(s.people.id, s.auditLog.actorPersonId))
      .where(and(eq(s.auditLog.entity, "scope"), eq(s.auditLog.entityId, id)))
      .orderBy(desc(s.auditLog.at))
      .limit(30),
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(and(eq(s.people.canConfirmScope, true), eq(s.people.active, true))).orderBy(asc(s.people.name)),
    db.select().from(s.items).where(and(eq(s.items.parentId, id), eq(s.items.outOfScope, true), eq(s.items.archived, false))),
  ]);
  const personName = (pid: string | null) => people.find((p) => p.id === pid)?.name ?? "—";
  const checks = confirmChecks(draftV, ds);
  const canConfirm = me.canConfirmScope && checks.every((c) => c.ok);
  const total = ds.reduce((a, d) => a + (d.estimateMinutes ?? 0), 0) || current?.estimateMinutes || 0;
  const step = draft ? 0 : extras.length ? 2 : 1;
  const nowD = now();
  const manager = isManager(me) || me.canConfirmScope;

  // US-26: comparação lado a lado
  const va = confirmed.find((v) => String(v.version) === sp.a);
  const vb = confirmed.find((v) => String(v.version) === sp.b);
  const diff = va && vb ? diffDeliverables(allDs.filter((d) => d.scopeVersionId === va.id), allDs.filter((d) => d.scopeVersionId === vb.id)) : null;

  return (
    <>
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-sm text-faint">
        <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: client.color }} />
        <Link href={`/clientes/${client.id}`} className="font-semibold text-[#e6d9f2] no-underline">
          {client.name}
        </Link>
        <span aria-hidden>/</span>
        <span>{annual.name}</span>
        <span aria-hidden>/</span>
        <Link href={`/projetos/${id}`} className="text-[#e6d9f2] no-underline">
          {item.name}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-semibold text-white">Escopo</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-7 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          <h1 className="h1 m-0 leading-[1.15]">{item.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-line-2 px-[11px] py-[5px] text-[13px] font-semibold text-[#e6d9f2]">Etapa: {stageLabel(item.stage)}</span>
            <span className={cx("rounded-full px-[11px] py-[5px] text-[13px] font-bold", draft ? "bg-blue-bg text-blue" : "bg-green-bg text-green")}>
              {draft ? "Ainda não está no Odoo" : `No Odoo: tarefa-mãe em ${annual.name}`}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-faint">Total estimado</span>
          <span className="num text-lg font-bold text-white">{fmtH(total)}</span>
        </div>
      </div>

      <ol aria-label="Situação do escopo" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {[
          ["Rascunho", "Só no Clarity. Pode editar à vontade."],
          ["Confirmado", "Vai para o Odoo e vira o Escopo v1, congelado."],
          ["Demandas adicionais", "Todo pedido novo depois da confirmação."],
        ].map(([title, desc], i) => {
          const done = i < step;
          const cur = i === step;
          return (
            <li key={title} aria-current={cur ? "step" : undefined} className={cx("flex min-w-0 flex-[1_1_260px] items-start gap-3 rounded-[14px] border px-4 py-3.5", cur ? "border-accent bg-surface-3" : "border-line bg-surface")}>
              <span className={cx("num flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", done ? "bg-day-green text-bg" : cur ? "bg-accent text-on-accent" : "bg-line-2 text-muted")}>
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong className={cx("text-[15px]", cur || done ? "text-white" : "text-muted")}>{title}</strong>
                <span className="text-[13px] text-muted">{desc}</span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[3_1_620px] flex-col gap-5">
          {diff && va && vb && (
            <section aria-labelledby="cmp" className="flex flex-col gap-3 rounded-2xl border border-line-4 bg-surface-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="cmp" className="m-0 text-base font-bold text-white">
                  Comparando v{va.version} e v{vb.version}
                </h2>
                <Link href={`/projetos/${id}/escopo`} className="btn-quiet text-sm">
                  Fechar comparação
                </Link>
              </div>
              {vb.reason && <p className="m-0 text-sm text-muted">Motivo da v{vb.version}: {vb.reason}</p>}
              <div className="table-wrap">
                <table className="tbl min-w-[560px]">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">v{va.version}</th>
                      <th scope="col">v{vb.version}</th>
                      <th scope="col">Mudança</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((r) => (
                      <tr key={r.number}>
                        <td className="num font-bold">E{r.number}</td>
                        <td className={cx(r.change === "removido" && "text-red line-through")}>
                          {r.a ? (
                            <>
                              {r.a.title} <span className="num text-faint">{fmtH(r.a.estimateMinutes)}</span>
                            </>
                          ) : (
                            <span className="text-faint">–</span>
                          )}
                        </td>
                        <td className={cx(r.change === "novo" && "text-green")}>
                          {r.b ? (
                            <>
                              {r.b.title} <span className="num text-faint">{fmtH(r.b.estimateMinutes)}</span>
                            </>
                          ) : (
                            <span className="text-faint">–</span>
                          )}
                        </td>
                        <td className="text-muted">{r.change}</td>
                      </tr>
                    ))}
                    <tr>
                      <td />
                      <td className="num font-bold">{fmtH(va.estimateMinutes)}</td>
                      <td className="num font-bold">{fmtH(vb.estimateMinutes)}</td>
                      <td className="text-muted">total</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[va, vb].map((v) => (
                  <div key={v.id} className="flex flex-col gap-1.5 rounded-xl bg-surface-2 p-3 text-sm">
                    <strong className="text-white">v{v.version}</strong>
                    <span className="text-muted">Objetivo: {v.objective || "—"}</span>
                    <span className="text-muted">Não incluso: {v.exclusions.join("; ") || "—"}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {draft ? (
            <>
              <p role="note" className="m-0 flex items-center gap-3 rounded-xl bg-blue-bg px-4 py-3 text-sm leading-[1.45] text-blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="shrink-0">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6M12 7.5v.5" />
                </svg>
                <span>
                  Horas de montagem de escopo não são apontadas. As horas gastas para montar este escopo <strong className="text-white">não são lançadas neste projeto</strong>. Só comece a apontar depois da confirmação.
                </span>
              </p>
              <ScopeEditor
                action={saveScopeAction}
                id={id}
                people={people}
                mode="rascunho"
                initial={{
                  objective: current?.objective ?? "",
                  assumptions: current?.assumptions ?? "",
                  exclusions: current?.exclusions ?? [],
                  deliverables: ds.map((d) => ({ id: d.id, title: d.title, description: d.description ?? "", hours: hoursText(d.estimateMinutes), person: d.suggestedPersonId ?? "" })),
                }}
              />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] border border-[#2B5A3E] bg-green-bg px-[18px] py-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8FD3AE" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-0.5">
                  <strong className="text-base text-white">
                    Escopo v{current?.version} · confirmado por {personName(current?.confirmedBy ?? null)} em {current?.confirmedAt ? dateBr(current.confirmedAt) : "—"}
                  </strong>
                  <span className="text-sm text-green">Enviado ao Odoo. Os itens abaixo estão travados.</span>
                </div>
              </div>
              <div role="note" className="flex flex-wrap items-center gap-3 rounded-xl bg-yellow-bg px-4 py-3.5 text-sm leading-[1.45] text-yellow">
                <span className="flex-[1_1_320px]">
                  A partir de agora, todo pedido novo do cliente vira <strong className="text-white">demanda adicional</strong>. Ela só aceita horas depois que o cliente aprovar.
                </span>
                <Link href={`/projetos/novo?tipo=tarefa&pai=${id}&adicional=1`} className="btn-primary no-underline">
                  Nova demanda adicional
                </Link>
              </div>
              <section aria-labelledby="hit" className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-2 bg-surface-3 px-5 py-3.5">
                  <h2 id="hit" className="m-0 text-base font-bold text-white">
                    Itens do Escopo v{current?.version}
                  </h2>
                  <span className="text-[13px] text-muted">
                    {ds.length} {ds.length === 1 ? "item" : "itens"}
                  </span>
                </div>
                <div className="flex flex-col px-5 pt-1.5 pb-4">
                  {current?.objective && <p className="m-0 border-b border-line py-3.5 text-[15px] leading-relaxed text-ink">{current.objective}</p>}
                  {ds.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-start gap-x-3.5 gap-y-2 border-b border-line py-3.5">
                      <span className="num mt-1 flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-line-2 text-[13px] font-bold text-white">E{d.number}</span>
                      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-[3px]">
                        <strong className="text-[15px] text-white">{d.title}</strong>
                        {d.description && <span className="text-sm text-muted">{d.description}</span>}
                      </div>
                      <span className="num w-20 shrink-0 pt-2 text-right text-[15px] font-bold text-white">{fmtH(d.estimateMinutes)}</span>
                      <span className="flex w-[170px] shrink-0 items-center gap-2 pt-1">
                        {d.suggestedPersonId && (
                          <span className="flex size-[26px] items-center justify-center rounded-full text-[10px] font-extrabold text-bg" style={{ background: personColor(d.suggestedPersonId) }} aria-hidden>
                            {initials(personName(d.suggestedPersonId))}
                          </span>
                        )}
                        <span className="text-[13px] text-ink">{d.suggestedPersonId ? personName(d.suggestedPersonId) : "sem sugestão"}</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-end pt-3.5">
                    <span className="flex items-baseline gap-2.5">
                      <span className="text-sm text-muted">Total estimado</span>
                      <span className="num text-2xl font-bold text-white">{fmtH(total)}</span>
                    </span>
                  </div>
                </div>
              </section>
              <section className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-base font-bold text-white">Fora do escopo</h2>
                  <span className="text-[13px] text-muted">o que não está incluso, combinado com o cliente</span>
                </div>
                <ul className="m-0 flex list-none flex-col p-0">
                  {(current?.exclusions ?? []).map((x) => (
                    <li key={x} className="flex min-h-11 items-center gap-3 border-t border-line text-sm">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF8A80" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M8 12h8" />
                      </svg>
                      {x}
                    </li>
                  ))}
                  {!current?.exclusions.length && <li className="text-sm text-muted">Nada registrado.</li>}
                </ul>
                {current?.assumptions && (
                  <>
                    <h3 className="m-0 pt-2 text-sm font-bold text-muted">Premissas e responsabilidades do cliente</h3>
                    <p className="m-0 text-sm whitespace-pre-wrap text-ink">{current.assumptions}</p>
                  </>
                )}
              </section>
              <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 text-base font-bold text-white">Demandas adicionais</h2>
                  <span className="text-[13px] text-muted">Faturável por padrão</span>
                </div>
                {extras.length === 0 && <p className="m-0 text-sm text-muted">Nenhuma demanda adicional ainda.</p>}
                {extras.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line py-3">
                    <Link href={`/projetos/${e.id}`} className="min-w-0 flex-[1_1_260px] text-sm font-bold text-white no-underline hover:underline">
                      {e.name}
                    </Link>
                    <span
                      className={cx(
                        "rounded-full px-[11px] py-[5px] text-[13px] font-bold whitespace-nowrap",
                        e.clientApproval === "aprovada" ? "bg-green-bg text-green" : e.clientApproval === "recusada" ? "bg-red-bg text-red" : "bg-yellow-bg text-yellow",
                      )}
                    >
                      {e.clientApproval === "aprovada" ? "Aprovada" : e.clientApproval === "recusada" ? "Recusada" : "Aguardando o cliente · horas bloqueadas"}
                    </span>
                  </div>
                ))}
                {extras.length > 0 && (
                  <Link href={`/projetos/${id}?aba=demandas`} className="btn-quiet self-start px-0 text-sm">
                    Gerenciar demandas
                  </Link>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-[2_1_360px] flex-col gap-5">
          <section aria-labelledby="hcf" className="flex flex-col gap-3.5 rounded-[18px] border border-line-4 bg-surface-3 px-5 py-[18px]">
            <h2 id="hcf" className="m-0 text-base font-bold text-white">
              Confirmação
            </h2>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-muted">Quem pode confirmar</span>
              {confirmers.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <span className="flex size-[30px] items-center justify-center rounded-full text-[10px] font-extrabold text-bg" style={{ background: personColor(c.id) }} aria-hidden>
                    {initials(c.name)}
                  </span>
                  <span className="text-sm font-semibold text-ink">{c.name}</span>
                  {c.id === me.id && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-on-accent">você</span>}
                </div>
              ))}
            </div>
            {draft ? (
              <>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {checks.map((c) => (
                    <li key={c.text} className="flex items-center gap-2.5 text-sm">
                      <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-full", c.ok ? "bg-green-bg text-green" : "border-2 border-red bg-red-bg")}>
                        {c.ok && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12l5 5 9-10" />
                          </svg>
                        )}
                      </span>
                      <span className={c.ok ? "text-ink" : "text-red"}>{c.text}</span>
                    </li>
                  ))}
                </ul>
                {me.canConfirmScope ? (
                  <ConfirmScope action={confirmScopeAction} id={id} enabled={canConfirm} />
                ) : (
                  <p className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">Só Marttini, Richard e Luiz confirmam o escopo. Salve o rascunho e avise um deles.</p>
                )}
                <span className="text-[13px] leading-[1.45] text-muted">
                  Ao confirmar, o projeto é criado no Odoo dentro de {annual.name} e este escopo vira a <strong className="text-white">versão 1</strong>, que não muda mais. Confira se salvou o rascunho antes.
                </span>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1 rounded-xl bg-green-bg px-3.5 py-3">
                  <strong className="text-sm text-green">
                    Escopo v{current?.version} · {personName(current?.confirmedBy ?? null)}, {current?.confirmedAt ? dateBr(current.confirmedAt) : ""}
                  </strong>
                  <span className="text-[13px] text-green">
                    {fmtH(total)} em {ds.length} {ds.length === 1 ? "item" : "itens"}
                  </span>
                </div>
                {manager && (
                  <Link href={`/projetos/${id}/escopo/nova-versao`} className="btn-ghost no-underline">
                    Gerar nova versão
                  </Link>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="hlv" className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface px-5 py-[18px]">
            <h2 id="hlv" className="m-0 text-base font-bold text-white">
              Levantamento
            </h2>
            <span className="text-[13px] text-muted">Reuniões</span>
            {meetings.length === 0 && <p className="m-0 text-sm text-faint">Nenhuma reunião registrada.</p>}
            {meetings.map((m) => (
              <div key={m.id} className="flex gap-3 border-t border-line py-2">
                <span className="num w-[46px] shrink-0 text-[13px] text-muted">{shortDate(m.date)}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="text-sm text-white">{m.title}</strong>
                  <span className="text-[13px] text-faint">{[m.participants, m.summary].filter(Boolean).join(" · ")}</span>
                </div>
                {(m.createdBy === me.id || isManager(me)) && <RemoveMeeting action={removeMeetingAction} id={id} meetingId={m.id} label={m.title} />}
              </div>
            ))}
            <MeetingForm action={meetingAction} id={id} today={today()} />
            <span className="pt-1.5 text-[13px] text-muted">Documentos</span>
            {docs.length === 0 && <p className="m-0 text-sm text-faint">Nenhum documento anexado.</p>}
            {docs.map(({ a, by, contact }) => (
              <div key={a.id} className="flex items-center gap-3 border-t border-line py-2">
                <FileKind name={a.filename} />
                <div className="flex min-w-0 flex-col gap-px">
                  <a href={`/api/anexos/${a.id}`} target="_blank" rel="noopener" className="text-sm font-semibold break-words text-accent-soft">
                    {a.filename}
                  </a>
                  <span className="text-xs text-faint">
                    {contact ? `${contact} (cliente)` : by} · {shortDate(toISODate(a.createdAt))}
                    {a.version > 1 ? ` · v${a.version}` : ""}
                    {a.internal ? " · interno" : ""}
                  </span>
                </div>
              </div>
            ))}
            <UploadForm action={uploadAction} id={id} compact />
          </section>

          <section aria-labelledby="hhs" className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface px-5 py-[18px]">
            <h2 id="hhs" className="m-0 mb-1 text-base font-bold text-white">
              Histórico de versões
            </h2>
            {confirmed.length >= 2 && (
              <form method="get" className="flex flex-wrap items-end gap-2 pb-2">
                <label className="label flex flex-col gap-1">
                  Comparar
                  <select name="a" defaultValue={sp.a ?? String(confirmed.at(-2)!.version)} className="field w-auto">
                    {confirmed.map((v) => (
                      <option key={v.id} value={v.version}>
                        v{v.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label flex flex-col gap-1">
                  com
                  <select name="b" defaultValue={sp.b ?? String(confirmed.at(-1)!.version)} className="field w-auto">
                    {confirmed.map((v) => (
                      <option key={v.id} value={v.version}>
                        v{v.version}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-ghost">Comparar lado a lado</button>
              </form>
            )}
            <ol className="m-0 flex list-none flex-col p-0">
              {audits.map(({ a, by }) => {
                const after = (a.after ?? {}) as { version?: number; reason?: string };
                const ver = a.action === "confirmar" ? "Escopo v1" : a.action === "nova_versao" ? `Escopo v${after.version}` : draft || a.at < (confirmed[0]?.confirmedAt ?? nowD) ? "Rascunho" : "Levantamento";
                return (
                  <li key={a.id} className="flex gap-3 border-t border-line py-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-bg" style={{ background: personColor(by ?? "x") }} aria-hidden>
                      {initials(by ?? "?")}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm text-ink">
                        <strong className="text-white">{by ?? "Sistema"}</strong> {SCOPE_AUDIT[a.action] ?? a.action}
                        {after.reason ? `: ${after.reason}` : ""}
                      </span>
                      <span className="text-xs text-faint">{relTime(a.at, nowD)}</span>
                    </div>
                    <span className={cx("self-start rounded-full px-2 py-0.5 text-[11px] font-bold", ver.startsWith("Escopo") ? "bg-green-bg text-green" : "bg-line-2 text-muted")}>{ver}</span>
                  </li>
                );
              })}
              {confirmed
                .filter((v) => !audits.some(({ a }) => a.action === (v.version === 1 ? "confirmar" : "nova_versao") && (a.after as { version?: number })?.version === v.version))
                .reverse()
                .map((v) => (
                  <li key={v.id} className="flex gap-3 border-t border-line py-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-bg" style={{ background: personColor(personName(v.confirmedBy)) }} aria-hidden>
                      {initials(personName(v.confirmedBy))}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm text-ink">
                        <strong className="text-white">{personName(v.confirmedBy)}</strong> {v.version === 1 ? "confirmou o escopo" : `gerou a versão ${v.version}`}
                        {v.reason ? `: ${v.reason}` : ""}
                      </span>
                      <span className="text-xs text-faint">{v.confirmedAt ? dateBr(v.confirmedAt) : ""}</span>
                    </div>
                    <span className="self-start rounded-full bg-green-bg px-2 py-0.5 text-[11px] font-bold text-green">Escopo v{v.version}</span>
                  </li>
                ))}
              {audits.length === 0 && confirmed.length === 0 && <li className="text-sm text-muted">Nada ainda.</li>}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
