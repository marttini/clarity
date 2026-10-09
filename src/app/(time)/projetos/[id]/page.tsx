import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { today, now } from "@/lib/clock";
import { diffDays, formatMinutes, shortDate, toISODate } from "@/domain/dates";
import { initials } from "@/server/data/common";
import { canChangeDeadline, ItemError, loadItemCtx } from "@/server/services/items";
import { currentVersion, getDeliverables } from "@/server/services/scope";
import { Arrow, Empty, cx } from "@/components/ui";
import {
  Avatars,
  Due,
  ExtraBadge,
  FileKind,
  Panel,
  StageBar,
  SustBadge,
  TagChip,
  VisibilityBadge,
  personColor,
  relTime,
  stageLabel,
} from "@/components/projetos/bits";
import { AssigneesForm, DeadlineForm, Pop, StageMover, SustForm, TagsForm, UploadForm, VisibilityForm } from "@/components/projetos/client";
import { ApprovalForm, ChecklistForm, CommentItem, Composer, DetailsForm, ReclassifyForm, type CommentView } from "@/components/projetos/conversation";
import { itemHistory, peopleOf, workedByItem } from "../_data";
import {
  approvalAction,
  assigneesAction,
  checklistAction,
  commentAction,
  deadlineAction,
  deleteCommentAction,
  detailsAction,
  editCommentAction,
  reclassifyAction,
  stageAction,
  sustentacaoAction,
  tagsAction,
  uploadAction,
  visibilityAction,
} from "../actions";

export const metadata = { title: "Projeto · Clarity" };

const AUDIT_LABEL: Record<string, string> = {
  criar: "criou o item",
  criar_demanda_adicional: "registrou a demanda adicional",
  editar: "editou os dados",
  etapa: "mudou a etapa",
  prazo: "mudou o prazo",
  marcadores: "mudou os marcadores",
  responsaveis: "mudou os responsáveis",
  visibilidade: "mudou a visibilidade ao cliente",
  aprovacao_externa: "registrou a aprovação do cliente (evidência anexada)",
  reclassificar: "reclassificou a demanda",
  incorporar_escopo: "incorporou a demanda ao escopo",
  editar_rascunho: "editou o rascunho do escopo",
  reuniao: "registrou uma reunião",
  remover_reuniao: "removeu uma reunião",
  confirmar: "confirmou o escopo",
  nova_versao: "gerou nova versão do escopo",
  aprovar_demanda: "aprovou a demanda pelo portal",
  recusar_demanda: "recusou a demanda pelo portal",
};

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
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
  const { item, parent, annual, client } = ctx;
  const hoje = today();
  const isProject = item.kind === "projeto";
  const project = isProject ? item : parent;
  const draft = project?.scopeStatus === "rascunho" && !!project;
  const manager = isManager(me);

  const tabs = isProject
    ? [
        { key: "escopo", label: "Escopo" },
        { key: "tarefas", label: "Tarefas" },
        { key: "demandas", label: "Demandas adicionais" },
        { key: "historico", label: "Histórico" },
      ]
    : [
        { key: "detalhes", label: "Detalhes" },
        { key: "historico", label: "Histórico" },
      ];
  const tab = tabs.some((t) => t.key === sp.aba) ? sp.aba! : tabs[0].key;
  const canal: "interno" | "cliente" = sp.canal === "cliente" ? "cliente" : "interno";

  // ---- dados ----
  const children = isProject
    ? await db.select().from(s.items).where(and(eq(s.items.parentId, id), eq(s.items.archived, false))).orderBy(asc(s.items.deadline), asc(s.items.name))
    : [];
  const ids = [id, ...children.map((c) => c.id)];
  const [worked, people, allTags, itemTagRows, deadlineRows, allPeople, version, attachments, canDeadline] = await Promise.all([
    workedByItem(ids),
    peopleOf(ids),
    db.select().from(s.tags).where(eq(s.tags.system, false)).orderBy(asc(s.tags.name)),
    db.select({ tagId: s.itemTags.tagId }).from(s.itemTags).where(eq(s.itemTags.itemId, id)),
    db
      .select({ d: s.deadlineChanges, by: s.people.name })
      .from(s.deadlineChanges)
      .leftJoin(s.people, eq(s.people.id, s.deadlineChanges.byPersonId))
      .where(eq(s.deadlineChanges.itemId, id))
      .orderBy(desc(s.deadlineChanges.at)),
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(eq(s.people.active, true)).orderBy(asc(s.people.name)),
    project ? currentVersion(project.id) : Promise.resolve(null),
    db
      .select({ a: s.attachments, by: s.people.name, contact: s.clientContacts.name })
      .from(s.attachments)
      .leftJoin(s.people, eq(s.people.id, s.attachments.uploadedByPersonId))
      .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.attachments.uploadedByContactId))
      .where(and(eq(s.attachments.ownerType, "item"), eq(s.attachments.ownerId, id)))
      .orderBy(desc(s.attachments.createdAt)),
    canChangeDeadline(me, id),
  ]);
  const deliverables = version ? await getDeliverables([version.id]) : [];
  const delivCode = new Map(deliverables.map((d) => [d.id, `E${d.number}`]));
  const myTags = allTags.filter((t) => itemTagRows.some((r) => r.tagId === t.id));
  const assignees = people.get(id) ?? [];
  const extras = children.filter((c) => c.outOfScope);
  const scopeWorked = (worked.get(id) ?? 0) + children.filter((c) => !c.outOfScope).reduce((a, c) => a + (worked.get(c.id) ?? 0), 0);
  const extraWorked = extras.reduce((a, c) => a + (worked.get(c.id) ?? 0), 0);
  const totalWorked = scopeWorked + extraWorked;
  const planned = item.plannedMinutes ?? (isProject ? version?.estimateMinutes ?? null : null);
  const openTasks = children.filter((c) => c.stage !== "concluido").length;
  const doneTasks = children.length - openTasks;

  // Conversa do canal escolhido
  const commentRows = await db
    .select({ c: s.comments, person: s.people.name, contact: s.clientContacts.name })
    .from(s.comments)
    .leftJoin(s.people, eq(s.people.id, s.comments.authorPersonId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.comments.authorContactId))
    .where(and(eq(s.comments.itemId, id), eq(s.comments.channel, canal), isNull(s.comments.deletedAt)))
    .orderBy(desc(s.comments.createdAt))
    .limit(60);
  const pendingClient = await db
    .select({ id: s.comments.id })
    .from(s.comments)
    .where(and(eq(s.comments.itemId, id), eq(s.comments.channel, "cliente"), isNotNull(s.comments.authorContactId), isNull(s.comments.answeredAt), isNull(s.comments.deletedAt)));
  const waitingIds = new Set(pendingClient.map((p) => p.id));
  const nowD = now();
  const comments: CommentView[] = commentRows.map(({ c, person, contact }) => ({
    id: c.id,
    who: person ?? (contact ? `${contact} · ${client.name}` : "Alguém"),
    when: relTime(c.createdAt, nowD),
    body: c.body,
    edited: !!c.editedAt,
    mine: c.authorPersonId === me.id,
    fromClient: !!c.authorContactId,
    waiting: waitingIds.has(c.id) ? `esperando resposta ${relTime(c.createdAt, nowD).replace(/^hoje, /, "desde ")}` : null,
  }));

  const tabHref = (k: string) => `/projetos/${id}?aba=${k}${canal === "cliente" ? "&canal=cliente" : ""}`;
  const canalHref = (k: string) => `/projetos/${id}?aba=${tab}${k === "cliente" ? "&canal=cliente" : ""}#conversa`;

  return (
    <>
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-sm text-faint">
        <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: client.color }} />
        <Link href={`/clientes/${client.id}`} className="font-semibold text-[#e6d9f2] no-underline">
          {client.name}
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/projetos?c=${client.id}`} className="text-faint no-underline hover:text-white">
          {annual.name}
        </Link>
        {parent && (
          <>
            <span aria-hidden>/</span>
            <Link href={`/projetos/${parent.id}?aba=tarefas`} className="text-[#e6d9f2] no-underline">
              {parent.name}
            </Link>
          </>
        )}
        <span aria-hidden>/</span>
        <span className="font-semibold text-white">{isProject ? "Projeto" : parent ? "Tarefa" : "Tarefa simples"}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
          <h1 className="h1 m-0 leading-[1.15]">{item.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <VisibilityBadge visible={item.visibleToClient} />
            {isProject && draft && <span className="rounded-full bg-blue-bg px-[11px] py-[5px] text-[13px] font-bold text-blue">Rascunho · ainda não está no Odoo</span>}
            {item.outOfScope && <ExtraBadge approval={item.clientApproval} />}
            {!isProject && parent?.scopeStatus === "confirmado" && !item.outOfScope && item.deliverableId && (
              <span className="num rounded-md bg-line-2 px-2 py-1 text-xs font-bold text-[#e6d9f2]">{delivCode.get(item.deliverableId) ?? "Entregável"}</span>
            )}
            {item.isSustentacao && <SustBadge />}
            {myTags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
            <Pop label="Marcadores" buttonClass="btn-quiet min-h-9 cursor-pointer text-sm">
              <TagsForm action={tagsAction} id={id} tags={allTags} selected={myTags.map((t) => t.id)} />
            </Pop>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-[22px]">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-faint">Responsáveis</span>
            <div className="flex items-center gap-2">
              <Avatars people={assignees} size={32} />
              <Pop label="Editar" align="right" buttonClass="btn-quiet min-h-9 cursor-pointer px-1 text-sm">
                <AssigneesForm action={assigneesAction} id={id} people={allPeople} selected={assignees.map((a) => a.id)} />
              </Pop>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-faint">Prazo</span>
            <span className="text-base font-bold text-white">
              <Due deadline={item.deadline} stage={item.stage} today={hoje} />
              {deadlineRows.length > 0 && <span className="text-xs font-semibold text-yellow"> · adiado {deadlineRows.length}×</span>}
            </span>
          </div>
          {canDeadline ? (
            <Pop label="Alterar prazo" align="right">
              <DeadlineForm action={deadlineAction} id={id} deadline={item.deadline} />
            </Pop>
          ) : (
            <span className="max-w-[180px] text-xs text-faint">Só o responsável ou a gestão alteram o prazo.</span>
          )}
        </div>
      </header>

      <section aria-label="Mudar etapa" className="flex flex-col gap-3">
        <StageBar stage={item.stage} draft={isProject && draft} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Mover para</span>
          <StageMover
            action={stageAction}
            id={id}
            stage={item.stage}
            openTasks={openTasks}
            disabled={isProject && draft ? "Em rascunho: confirme o escopo para mover pelas etapas." : undefined}
          />
          <div className="ml-auto flex flex-wrap gap-2">
            <Pop label="Visibilidade" align="right">
              <VisibilityForm
                action={visibilityAction}
                id={id}
                visible={item.visibleToClient}
                isProject={isProject}
                taskCount={children.length}
                locked={item.outOfScope ? "Demanda adicional fica sempre visível: o cliente precisa aprová-la." : undefined}
              />
            </Pop>
            <Pop label="Sustentação" align="right">
              <SustForm action={sustentacaoAction} id={id} value={item.isSustentacao} />
            </Pop>
            <Pop label="Editar dados" align="right">
              <DetailsForm
                action={detailsAction}
                id={id}
                item={{ name: item.name, description: item.description, startDate: item.startDate, planned: item.plannedMinutes ? formatMinutes(item.plannedMinutes) : "", isSustentacao: item.isSustentacao }}
              />
            </Pop>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-[26px]">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-4">
          <div role="tablist" aria-label={isProject ? "Seções do projeto" : "Seções da tarefa"} className="flex flex-wrap gap-1 self-start rounded-xl border border-line bg-surface-2 p-1">
            {tabs.map((t) => {
              const count = t.key === "tarefas" ? children.length : t.key === "demandas" ? extras.length : null;
              return (
                <Link
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  href={tabHref(t.key)}
                  scroll={false}
                  className={cx("inline-flex min-h-[38px] items-center rounded-[9px] px-3.5 text-sm font-semibold no-underline", tab === t.key ? "bg-line-2 text-white" : "text-muted hover:text-white")}
                >
                  {t.label}
                  {count !== null ? ` · ${count}` : ""}
                </Link>
              );
            })}
          </div>

          {tab === "escopo" && <ScopeTab projectId={id} draft={draft} version={version} deliverables={deliverables} tasks={children} manager={manager || me.canConfirmScope} />}
          {tab === "tarefas" && <TasksTab projectId={id} tasks={children} worked={worked} people={people} delivCode={delivCode} hoje={hoje} />}
          {tab === "demandas" && (
            <DemandsTab
              projectId={id}
              confirmed={!draft}
              extras={extras}
              worked={worked}
              hoje={hoje}
              manager={manager}
              deliverables={deliverables.map((d) => ({ id: d.id, label: `E${d.number} · ${d.title}` }))}
              total={extraWorked}
            />
          )}
          {tab === "detalhes" && (
            <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="m-0 text-sm font-bold text-muted">Descrição</h2>
                <p className="m-0 max-w-[70ch] text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{item.description || "Sem descrição."}</p>
              </div>
              {item.outOfScope && <DemandOrigin itemId={id} />}
              <div className="flex flex-col gap-1.5">
                <h2 className="m-0 text-sm font-bold text-muted">Checklist</h2>
                <ChecklistForm action={checklistAction} id={id} items={item.checklist} />
              </div>
            </section>
          )}
          {tab === "historico" && <HistoryTab itemId={id} />}
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Panel title="Horas">
            <div className="flex items-baseline gap-2">
              <span className="num text-[30px] font-bold text-white">{formatMinutes(totalWorked)}</span>
              <span className="text-sm text-muted">{planned ? `de ${formatMinutes(planned)} h previstas` : "sem horas previstas"}</span>
            </div>
            {isProject && (
              <>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-line-2" aria-hidden>
                  <div style={{ width: `${pct(scopeWorked, Math.max(planned ?? 0, totalWorked))}%`, background: "#A897F5" }} />
                  <div style={{ width: `${pct(extraWorked, Math.max(planned ?? 0, totalWorked))}%`, background: "#F07A45" }} />
                </div>
                <div className="flex flex-wrap gap-3.5 text-[13px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-[#A897F5]" aria-hidden />
                    Escopo <span className="num">{formatMinutes(scopeWorked)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-accent" aria-hidden />
                    Adicionais <span className="num">{formatMinutes(extraWorked)}</span>
                  </span>
                  {children.length > 0 && (
                    <span>
                      {doneTasks}/{children.length} tarefas concluídas
                    </span>
                  )}
                </div>
              </>
            )}
            {draft && <p className="m-0 text-xs text-faint">Horas de montagem de escopo não são apontadas.</p>}
          </Panel>

          <Panel title="Histórico de prazo">
            {deadlineRows.length === 0 ? (
              <p className="m-0 text-sm text-muted">Prazo nunca mudou.</p>
            ) : (
              deadlineRows.slice(0, 4).map(({ d, by }) => (
                <div key={d.id} className="flex flex-col gap-1 rounded-[10px] bg-[#2A2312] px-3.5 py-3">
                  <span className="text-sm">
                    <s className="text-muted">{d.oldDeadline ? shortDate(d.oldDeadline) : "sem prazo"}</s> <Arrow dir="right" className="inline text-muted" />{" "}
                    <strong className="text-white">{shortDate(d.newDeadline)}</strong>
                  </span>
                  <span className="text-[13px] text-[#E6D7AE]">
                    {d.reason} · {by ?? "Odoo"}, {relTime(d.at, nowD)}
                  </span>
                </div>
              ))
            )}
            {deadlineRows.length > 4 && (
              <Link href={tabHref("historico")} className="btn-quiet self-start text-sm">
                Ver todas as {deadlineRows.length} mudanças
              </Link>
            )}
          </Panel>

          <section id="conversa" aria-labelledby="conv" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-[18px]">
            <div className="flex items-center justify-between gap-2.5">
              <h2 id="conv" className="m-0 text-[15px] font-bold text-white">
                Conversa
              </h2>
              <div role="tablist" aria-label="Canal" className="flex gap-1 rounded-[10px] bg-bg p-[3px]">
                {(["interno", "cliente"] as const).map((k) => (
                  <Link
                    key={k}
                    role="tab"
                    aria-selected={canal === k}
                    href={canalHref(k)}
                    scroll={false}
                    className={cx(
                      "inline-flex min-h-[34px] items-center rounded-lg px-3 text-[13px] font-bold no-underline",
                      canal === k ? (k === "cliente" ? "bg-client-channel text-[#0B1A2C]" : "bg-line-2 text-white") : "text-muted hover:text-white",
                    )}
                  >
                    {k === "interno" ? "Interno" : "Cliente"}
                    {k === "cliente" && waitingIds.size > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] text-on-accent">{waitingIds.size}</span>}
                  </Link>
                ))}
              </div>
            </div>
            <Composer
              action={commentAction}
              id={id}
              channel={canal}
              disabledReason={canal === "cliente" && !item.visibleToClient ? "Este item é interno. Torne-o visível ao cliente para conversar com ele aqui." : undefined}
            />
            {comments.length === 0 ? (
              <p className="m-0 text-sm text-muted">{canal === "cliente" ? "Nenhuma mensagem com o cliente ainda." : "Nenhum comentário interno ainda."}</p>
            ) : (
              comments.map((c) => <CommentItem key={c.id} c={c} itemId={id} channel={canal} editAction={editCommentAction} deleteAction={deleteCommentAction} />)
            )}
          </section>

          <Panel title="Anexos">
            {attachments.length === 0 && <p className="m-0 text-sm text-muted">Nenhum anexo.</p>}
            {attachments.map(({ a, by, contact }) => (
              <div key={a.id} className="flex items-center gap-2.5 text-sm">
                <FileKind name={a.filename} />
                <a href={`/api/anexos/${a.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 font-semibold break-words text-accent-soft">
                  {a.filename}
                </a>
                <span className="shrink-0 text-right text-xs text-faint">
                  {a.version > 1 && <>v{a.version} · </>}
                  {a.internal ? "interno" : contact ? "cliente" : by?.split(" ")[0]}
                  <br />
                  {shortDate(toISODate(a.createdAt))}
                </span>
              </div>
            ))}
            <UploadForm action={uploadAction} id={id} compact />
            {draft && <p className="m-0 text-xs text-faint">Anexos de rascunho sobem ao Odoo na confirmação do escopo.</p>}
          </Panel>
        </aside>
      </div>
    </>
  );
}

function pct(a: number, b: number) {
  return b > 0 ? Math.min(100, (a / b) * 100) : 0;
}

type ItemRow = typeof s.items.$inferSelect;

function lines(t: string | null) {
  return (t ?? "")
    .split(/\n+/)
    .map((x) => x.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

async function ScopeTab({
  projectId,
  draft,
  version,
  deliverables,
  tasks: children,
  manager,
}: {
  projectId: string;
  draft: boolean;
  version: typeof s.scopeVersions.$inferSelect | null;
  deliverables: (typeof s.deliverables.$inferSelect)[];
  tasks: ItemRow[];
  manager: boolean;
}) {
  const [meetings, confirmer] = await Promise.all([
    db.select().from(s.meetings).where(eq(s.meetings.itemId, projectId)).orderBy(asc(s.meetings.date)),
    version?.confirmedBy ? db.select({ name: s.people.name }).from(s.people).where(eq(s.people.id, version.confirmedBy)) : Promise.resolve([]),
  ]);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-surface-3 px-5 py-3.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F7B08C" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {draft ? <path d="M4 20h4L19 9l-4-4L4 16v4z" /> : <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>}
        </svg>
        <strong className="text-[15px] text-white">{draft ? "Escopo em rascunho" : `Escopo v${version?.version} · congelado`}</strong>
        {!draft && version?.confirmedAt && (
          <span className="text-[13px] text-muted">
            confirmado por {confirmer[0]?.name ?? "—"} em {shortDate(toISODate(version.confirmedAt))}/{version.confirmedAt.getFullYear()}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={`/projetos/${projectId}/escopo`} className={cx(draft ? "btn-primary" : "btn-ghost", "min-h-[38px] text-sm no-underline")}>
            {draft ? "Montar escopo" : "Ver escopo e versões"}
          </Link>
          {!draft && manager && (
            <Link href={`/projetos/${projectId}/escopo/nova-versao`} className="btn-ghost min-h-[38px] text-sm no-underline">
              Gerar nova versão
            </Link>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-[22px] p-5">
        {draft && (
          <p role="note" className="m-0 rounded-xl bg-blue-bg px-4 py-3 text-sm text-blue">
            As horas gastas para montar este escopo <strong className="text-white">não são lançadas neste projeto</strong>. Só comece a apontar depois da confirmação.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 text-sm font-bold text-muted">Objetivo</h2>
          <p className="m-0 max-w-[70ch] text-base leading-[1.55] text-ink">{version?.objective || "Ainda sem objetivo."}</p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-sm font-bold text-muted">Entregáveis</h2>
          {deliverables.length === 0 && <p className="m-0 text-sm text-muted">Nenhum entregável ainda.</p>}
          {deliverables.map((d) => {
            const ts = children.filter((c) => c.deliverableId === d.id);
            const done = ts.filter((t) => t.stage === "concluido").length;
            const p = ts.length ? Math.round((done / ts.length) * 100) : 0;
            return (
              <div key={d.id} className="flex items-center gap-3.5 rounded-[10px] bg-surface-2 px-3 py-2.5">
                <span className="num flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-line-2 text-[13px] font-bold text-white">E{d.number}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[15px] font-semibold">{d.title}</span>
                  <div className="h-[5px] overflow-hidden rounded-full bg-line-2" aria-hidden>
                    <div className="h-full" style={{ width: `${p}%`, background: p === 100 ? "#57C08A" : "#A897F5" }} />
                  </div>
                </div>
                <span className="text-right text-[13px] whitespace-nowrap text-muted">
                  {ts.length ? `${done}/${ts.length} ${ts.length === 1 ? "tarefa" : "tarefas"}` : "sem tarefas"}
                  <br />
                  <span className="num">{d.estimateMinutes ? `${formatMinutes(d.estimateMinutes)} h` : ""}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
          <div className="flex flex-col gap-2 rounded-xl border border-[#5A2420] bg-[#2A1215] p-4">
            <h2 className="m-0 text-sm font-bold text-red">Não está incluído</h2>
            {version?.exclusions.length ? (
              <ul className="m-0 pl-[18px] text-sm leading-relaxed text-[#F2D6D2]">
                {version.exclusions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-[#F2D6D2]">Nada registrado.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-line-2 bg-surface-2 p-4">
            <h2 className="m-0 text-sm font-bold text-muted">Premissas e responsabilidades do cliente</h2>
            {lines(version?.assumptions ?? null).length ? (
              <ul className="m-0 pl-[18px] text-sm leading-relaxed text-ink">
                {lines(version?.assumptions ?? null).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-muted">Nada registrado.</p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <h2 className="m-0 text-sm font-bold text-muted">Reuniões registradas</h2>
          {meetings.length === 0 && <p className="m-0 text-sm text-muted">Nenhuma reunião registrada.</p>}
          {meetings.map((m) => (
            <div key={m.id} className="flex gap-3.5 border-b border-line pb-2.5">
              <span className="num w-14 shrink-0 text-[13px] font-bold text-accent-soft">{shortDate(m.date)}</span>
              <div className="flex flex-1 flex-col gap-0.5">
                <strong className="text-sm">{m.title}</strong>
                <span className="text-[13px] text-faint">{[m.participants, m.summary].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TasksTab({
  projectId,
  tasks,
  worked,
  people,
  delivCode,
  hoje,
}: {
  projectId: string;
  tasks: ItemRow[];
  worked: Map<string, number>;
  people: Map<string, { id: string; name: string; initials: string }[]>;
  delivCode: Map<string, string>;
  hoje: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Link href={`/projetos/novo?tipo=tarefa&pai=${projectId}`} className="btn-primary no-underline">
          Nova tarefa
        </Link>
      </div>
      {tasks.length === 0 ? (
        <Empty>Este projeto ainda não tem tarefas.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl min-w-[680px] text-sm">
            <thead>
              <tr>
                <th scope="col" className="pl-4">Tarefa</th>
                <th scope="col">Entregável</th>
                <th scope="col">Etapa</th>
                <th scope="col">Responsáveis</th>
                <th scope="col">Horas</th>
                <th scope="col" className="pr-4">Prazo</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className="pl-4">
                    <Link href={`/projetos/${t.id}`} className="font-semibold text-ink no-underline hover:text-white hover:underline">
                      {t.name}
                    </Link>
                    {!t.visibleToClient && <span className="ml-2 text-xs text-faint">interno</span>}
                  </td>
                  <td>
                    {t.outOfScope ? (
                      <span className="rounded-full bg-[#3A1E12] px-[9px] py-[3px] text-xs font-bold whitespace-nowrap text-accent-soft">Demanda adicional</span>
                    ) : t.deliverableId && delivCode.get(t.deliverableId) ? (
                      <span className="num rounded-md bg-line-2 px-[9px] py-[3px] text-xs font-bold text-[#e6d9f2]">{delivCode.get(t.deliverableId)}</span>
                    ) : (
                      <span className="text-xs text-faint">–</span>
                    )}
                  </td>
                  <td className="text-muted">{stageLabel(t.stage)}</td>
                  <td>
                    <Avatars people={people.get(t.id) ?? []} size={24} />
                  </td>
                  <td className="num">{formatMinutes(worked.get(t.id) ?? 0)}</td>
                  <td className="pr-4">
                    <Due deadline={t.deadline} stage={t.stage} today={hoje} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function DemandsTab({
  projectId,
  confirmed,
  extras,
  worked,
  hoje,
  manager,
  deliverables,
  total,
}: {
  projectId: string;
  confirmed: boolean;
  extras: ItemRow[];
  worked: Map<string, number>;
  hoje: string;
  manager: boolean;
  deliverables: { id: string; label: string }[];
  total: number;
}) {
  const contactIds = extras.flatMap((e) => [e.requestedByContactId, e.clientApprovalByContactId]).filter(Boolean) as string[];
  const personIds = extras.map((e) => e.clientApprovalRegisteredBy).filter(Boolean) as string[];
  const [contacts, persons, evidences] = await Promise.all([
    contactIds.length ? db.select({ id: s.clientContacts.id, name: s.clientContacts.name }).from(s.clientContacts).where(inArray(s.clientContacts.id, contactIds)) : [],
    personIds.length ? db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(inArray(s.people.id, personIds)) : [],
    extras.length
      ? db
          .select({ id: s.attachments.id, ownerId: s.attachments.ownerId, filename: s.attachments.filename })
          .from(s.attachments)
          .where(and(eq(s.attachments.ownerType, "approval"), inArray(s.attachments.ownerId, extras.map((e) => e.id))))
      : [],
  ]);
  const name = (id: string | null, list: { id: string; name: string }[]) => list.find((x) => x.id === id)?.name;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#5A2E1C] bg-[#2A1810] px-[18px] py-3.5">
        <span className="flex-[1_1_320px] text-sm leading-[1.45] text-[#F7D2BF]">
          <strong className="text-white">{confirmed ? "Pedido fora dos entregáveis do escopo vira demanda adicional." : "Depois da confirmação do escopo, pedido fora dos entregáveis vira demanda adicional."}</strong> Só aceita horas depois que o cliente aprova, e é
          Faturável por padrão.
        </span>
        {confirmed && (
          <Link href={`/projetos/novo?tipo=tarefa&pai=${projectId}&adicional=1`} className="btn-primary min-h-[42px] no-underline">
            Nova demanda adicional
          </Link>
        )}
      </div>
      {extras.length > 0 && (
        <p className="m-0 text-sm text-muted">
          Horas das demandas adicionais, somadas à parte: <strong className="num text-white">{formatMinutes(total)}</strong>
        </p>
      )}
      {extras.length === 0 && <Empty>Nenhuma demanda adicional neste projeto.</Empty>}
      {extras.map((e) => {
        const since = e.requestedAt ?? toISODate(e.createdAt);
        const days = Math.max(0, diffDays(hoje, since));
        const ev = evidences.find((x) => x.ownerId === e.id);
        const badge =
          e.clientApproval === "aprovada"
            ? { cls: "bg-green-bg text-green", text: ev ? "Aprovada · print anexado" : "Aprovada pelo portal" }
            : e.clientApproval === "recusada"
              ? { cls: "bg-red-bg text-red", text: "Recusada pelo cliente" }
              : { cls: "bg-yellow-bg text-yellow", text: `Aguardando o cliente · ${days} ${days === 1 ? "dia" : "dias"}` };
        const w = worked.get(e.id) ?? 0;
        return (
          <article key={e.id} className="flex flex-wrap items-center gap-3.5 rounded-[14px] border border-line bg-surface px-[18px] py-4">
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
              <Link href={`/projetos/${e.id}`} className="text-[15px] font-bold text-white no-underline hover:underline">
                {e.name}
              </Link>
              <span className="text-[13px] text-faint">
                Pedido por {name(e.requestedByContactId, contacts) ?? "—"} em {e.requestedAt ? shortDate(e.requestedAt) : "—"}
                {e.requestChannel ? ` · ${e.requestChannel}` : ""}
                {e.clientApproval === "aprovada" &&
                  (e.clientApprovalRegisteredBy
                    ? ` · aprovação registrada por ${name(e.clientApprovalRegisteredBy, persons)}`
                    : e.clientApprovalByContactId
                      ? ` · aprovada por ${name(e.clientApprovalByContactId, contacts)}`
                      : "")}
                {e.clientApproval === "recusada" && e.clientApprovalReason ? ` · motivo: ${e.clientApprovalReason}` : ""}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={cx("rounded-full px-[11px] py-[5px] text-[13px] font-bold whitespace-nowrap", badge.cls)}>{badge.text}</span>
              <span className="text-[13px] text-muted">
                {e.clientApproval === "aguardando" ? (
                  "Apontamento bloqueado até aprovar"
                ) : (
                  <>
                    <span className="num">{formatMinutes(w)}</span> h apontadas · Faturável
                  </>
                )}
              </span>
              {ev && (
                <a href={`/api/anexos/${ev.id}`} target="_blank" rel="noopener" className="text-xs text-accent-soft">
                  Ver evidência
                </a>
              )}
            </div>
            {(e.clientApproval === "aguardando" || manager) && (
              <div className="flex w-full flex-wrap justify-end gap-2">
                {e.clientApproval === "aguardando" && (
                  <Pop label="Registrar aprovação recebida" align="right" buttonClass="btn-ghost min-h-10 cursor-pointer text-sm text-accent-soft">
                    <ApprovalForm action={approvalAction} id={e.id} projectId={projectId} />
                  </Pop>
                )}
                {manager && deliverables.length > 0 && (
                  <Pop label="Reclassificar" align="right" buttonClass="btn-ghost min-h-10 cursor-pointer text-sm">
                    <ReclassifyForm action={reclassifyAction} id={e.id} projectId={projectId} deliverables={deliverables} current="adicional" />
                  </Pop>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

async function DemandOrigin({ itemId }: { itemId: string }) {
  const [row] = await db
    .select({ i: s.items, contact: s.clientContacts.name })
    .from(s.items)
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.items.requestedByContactId))
    .where(eq(s.items.id, itemId));
  if (!row) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-[#2A1810] px-4 py-3 text-sm text-[#F7D2BF]">
      <strong className="text-white">Demanda adicional</strong>
      <span>
        Pedido por {row.contact ?? "—"} em {row.i.requestedAt ? shortDate(row.i.requestedAt) : "—"}
        {row.i.requestChannel ? ` · ${row.i.requestChannel}` : ""}.
      </span>
      <span>
        {row.i.clientApproval === "aguardando"
          ? "Aguardando aprovação do cliente: as horas só entram depois."
          : row.i.clientApproval === "aprovada"
            ? "Aprovada: as horas podem ser lançadas."
            : "Recusada pelo cliente."}
      </span>
      {row.i.parentId && (
        <Link href={`/projetos/${row.i.parentId}?aba=demandas`} className="btn-quiet self-start px-0 text-sm">
          Ver demandas do projeto
        </Link>
      )}
    </div>
  );
}

async function HistoryTab({ itemId }: { itemId: string }) {
  const { stages, deadlines, audits } = await itemHistory(itemId);
  type Ev = { at: Date; who: string; what: string; kind: "etapa" | "prazo" | "audit" };
  const evs: Ev[] = [
    ...stages.map(({ h, by }) => ({
      at: h.at,
      who: by ?? "Odoo",
      what: h.fromStage ? `mudou a etapa de ${stageLabel(h.fromStage)} para ${stageLabel(h.toStage)}` : `criou em ${stageLabel(h.toStage)}`,
      kind: "etapa" as const,
    })),
    ...deadlines.map(({ d, by }) => ({
      at: d.at,
      who: by ?? "Odoo",
      what: `mudou o prazo de ${d.oldDeadline ? shortDate(d.oldDeadline) : "sem prazo"} para ${shortDate(d.newDeadline)}: ${d.reason}`,
      kind: "prazo" as const,
    })),
    ...audits
      .filter(({ a }) => !["etapa", "prazo", "criar"].includes(a.action))
      .map(({ a, by, contact }) => {
        const after = (a.after ?? {}) as Record<string, unknown>;
        const reason = typeof after.reason === "string" ? `: ${after.reason}` : "";
        return { at: a.at, who: by ?? contact ?? "Sistema", what: (AUDIT_LABEL[a.action] ?? a.action) + reason, kind: "audit" as const };
      }),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
  const nowD = now();
  if (!evs.length) return <Empty>Sem histórico ainda.</Empty>;
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-3">
      <ol className="m-0 flex list-none flex-col p-0">
        {evs.map((e, i) => (
          <li key={i} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
            <span
              className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-bg"
              style={{ background: personColor(e.who) }}
              aria-hidden
            >
              {initials(e.who)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm text-ink">
                <strong className="text-white">{e.who}</strong> {e.what}
              </span>
              <span className="text-xs text-faint">{relTime(e.at, nowD)}</span>
            </div>
            <span
              className={cx(
                "self-start rounded-full px-2 py-0.5 text-[11px] font-bold",
                e.kind === "etapa" ? "bg-line-2 text-muted" : e.kind === "prazo" ? "bg-yellow-bg text-yellow" : "bg-line-2 text-muted",
              )}
            >
              {e.kind === "etapa" ? "Etapa" : e.kind === "prazo" ? "Prazo" : "Auditoria"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
