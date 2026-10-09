import "server-only";
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { enqueueSync } from "../sync/enqueue";
import { notify } from "../notify";
import { getOdoo, OdooError, type OdooClient } from "./client";
import { deadlineToOdoo, minutesToHours, startToOdoo, textToHtml } from "./convert";
import { getOdooFields, STAGE_ODOO_NAMES, SYSTEM_TAGS, type OdooFields, type StageKey } from "./fields";

/**
 * Envio ao Odoo pela fila (US-05, US-21, US-39).
 * Cada item da fila é pego com FOR UPDATE SKIP LOCKED (dois cron rodando juntos não pegam o mesmo),
 * enviado e marcado como feito. Falha temporária: nova tentativa com espera crescente
 * (1, 2, 4, 8... até 60 min); depois de 8 tentativas, ou se o Odoo recusar os dados, vira erro
 * e o guardião técnico é avisado na hora.
 */

export const MAX_ATTEMPTS = 8;
/** Espera antes da próxima tentativa, em minutos: 1, 2, 4, 8, 16, 32, 60, 60. */
export function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}
/** Espera quando o envio depende de outro registro ainda não enviado (não conta como tentativa). */
const DEFER_MINUTES = 1;
/** Item preso em "processando" por mais tempo que isso volta para a fila (processo caiu no meio). */
const STUCK_MINUTES = 10;

type QueueRow = typeof s.syncQueue.$inferSelect;
type Entity = "time_entry" | "item" | "attachment";

/** Reagendar sem contar tentativa (ex.: a tarefa do apontamento ainda não chegou ao Odoo). */
class Defer extends Error {}
/** Erro do próprio Clarity (dados incompletos). `permanent` = não adianta tentar de novo sozinho. */
export class SyncError extends Error {
  constructor(
    message: string,
    public permanent = true,
  ) {
    super(message);
  }
}

type Done = { model: string; odooId?: number | null; message: string; status?: "enviado" | "nao_sincroniza" };

export type QueueSummary = { claimed: number; sent: number; deferred: number; retrying: number; failed: number; recovered: number };

export async function processQueue(opts: { limit?: number; now?: Date; odoo?: OdooClient } = {}): Promise<QueueSummary> {
  const at = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const sum: QueueSummary = { claimed: 0, sent: 0, deferred: 0, retrying: 0, failed: 0, recovered: 0 };

  const stuck = await db
    .update(s.syncQueue)
    .set({ status: "pendente", updatedAt: at })
    .where(and(eq(s.syncQueue.status, "processando"), lt(s.syncQueue.updatedAt, new Date(at.getTime() - STUCK_MINUTES * 60_000))))
    .returning({ id: s.syncQueue.id });
  sum.recovered = stuck.length;
  sum.recovered += await requeueOrphans(at);

  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: s.syncQueue.id })
      .from(s.syncQueue)
      .where(and(eq(s.syncQueue.status, "pendente"), lt(s.syncQueue.nextAttemptAt, new Date(at.getTime() + 1))))
      .orderBy(asc(s.syncQueue.nextAttemptAt), asc(s.syncQueue.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!rows.length) return [];
    return tx
      .update(s.syncQueue)
      .set({ status: "processando", updatedAt: at })
      .where(inArray(s.syncQueue.id, rows.map((r) => r.id)))
      .returning();
  });
  sum.claimed = claimed.length;
  if (!claimed.length) return sum;

  // Tarefas antes dos apontamentos; na ordem em que entraram na fila.
  const rank: Record<string, number> = { item: 0, attachment: 1, time_entry: 2 };
  claimed.sort((a, b) => (rank[a.entity] ?? 9) - (rank[b.entity] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime());

  let ctx: Ctx;
  try {
    ctx = new Ctx(opts.odoo ?? (await getOdoo()), await getOdooFields());
  } catch (e) {
    // Sem configuração: devolve tudo para a fila como tentativa falha.
    for (const row of claimed) await fail(row, e, at, sum);
    return sum;
  }

  for (const row of claimed) {
    try {
      const done = await handle(ctx, row);
      await succeed(row, done, at);
      sum.sent++;
    } catch (e) {
      if (e instanceof Defer) {
        await db
          .update(s.syncQueue)
          .set({ status: "pendente", nextAttemptAt: new Date(at.getTime() + DEFER_MINUTES * 60_000), lastError: e.message, updatedAt: at })
          .where(eq(s.syncQueue.id, row.id));
        sum.deferred++;
      } else await fail(row, e, at, sum);
    }
  }
  return sum;
}

/**
 * Registro marcado "pendente" sem nada na fila (ex.: gravado por script ou fila perdida)
 * volta para a fila, para nenhum apontamento ficar sem envio.
 */
async function requeueOrphans(at: Date): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into sync_queue (entity, entity_id, op, next_attempt_at)
    select 'time_entry', e.id, case when e.deleted_at is null then 'upsert' else 'delete' end, ${at.toISOString()}::timestamptz
      from time_entries e
     where e.sync_status = 'pendente'
       and not exists (select 1 from sync_queue q where q.entity = 'time_entry' and q.entity_id = e.id and q.status in ('pendente', 'processando'))
    union all
    select 'item', i.id, case when i.archived then 'delete' else 'upsert' end, ${at.toISOString()}::timestamptz
      from items i
     where i.sync_status = 'pendente'
       and not exists (select 1 from sync_queue q where q.entity = 'item' and q.entity_id = i.id and q.status in ('pendente', 'processando'))
    returning id`);
  return rows.length;
}

/** Reenviar pelo gestor (US-05): volta o registro para a fila com a operação certa. */
export async function resend(entity: "time_entry" | "item", entityId: string) {
  await db.transaction(async (tx) => {
    if (entity === "time_entry") {
      const [e] = await tx.select().from(s.timeEntries).where(eq(s.timeEntries.id, entityId));
      if (!e) throw new SyncError("Apontamento não encontrado.");
      await tx.update(s.timeEntries).set({ syncStatus: "pendente", syncError: null }).where(eq(s.timeEntries.id, entityId));
      await enqueueSync(tx, "time_entry", entityId, e.deletedAt ? "delete" : "upsert");
    } else {
      const [it] = await tx.select().from(s.items).where(eq(s.items.id, entityId));
      if (!it) throw new SyncError("Item não encontrado.");
      await tx.update(s.items).set({ syncStatus: "pendente", syncError: null }).where(eq(s.items.id, entityId));
      await enqueueSync(tx, "item", entityId, it.archived ? "delete" : "upsert");
    }
  });
}

// ---------- Resultado ----------

async function stillPending(entity: string, entityId: string, exceptId: string) {
  const rows = await db
    .select({ id: s.syncQueue.id })
    .from(s.syncQueue)
    .where(and(eq(s.syncQueue.entity, entity), eq(s.syncQueue.entityId, entityId), eq(s.syncQueue.status, "pendente"), ne(s.syncQueue.id, exceptId)));
  return rows.length > 0;
}

async function setEntityStatus(entity: string, id: string, status: "pendente" | "enviado" | "erro" | "nao_sincroniza", error: string | null) {
  if (entity === "time_entry") await db.update(s.timeEntries).set({ syncStatus: status, syncError: error }).where(eq(s.timeEntries.id, id));
  else if (entity === "item") await db.update(s.items).set({ syncStatus: status, syncError: error }).where(eq(s.items.id, id));
}

async function succeed(row: QueueRow, done: Done, at: Date) {
  await db.update(s.syncQueue).set({ status: "feito", lastError: null, updatedAt: at }).where(eq(s.syncQueue.id, row.id));
  // Se o registro mudou de novo enquanto enviávamos, continua "pendente" até o próximo envio.
  if (!(await stillPending(row.entity, row.entityId, row.id))) await setEntityStatus(row.entity, row.entityId, done.status ?? "enviado", null);
  await log("out", done.model, done.odooId ?? null, done.message, "info");
}

function friendly(e: unknown): { message: string; permanent: boolean; original: string } {
  if (e instanceof OdooError) return { message: e.message, permanent: !e.retryable, original: e.original };
  if (e instanceof SyncError) return { message: e.message, permanent: e.permanent, original: e.message };
  const original = e instanceof Error ? e.message : String(e);
  return { message: "Erro inesperado ao enviar ao Odoo. O Clarity tenta de novo automaticamente.", permanent: false, original };
}

async function fail(row: QueueRow, e: unknown, at: Date, sum: QueueSummary) {
  const { message, permanent, original } = friendly(e);
  const attempts = row.attempts + 1;
  const model = row.entity === "time_entry" ? "account.analytic.line" : row.entity === "item" ? "project.task" : "ir.attachment";
  if (permanent || attempts >= MAX_ATTEMPTS) {
    await db.update(s.syncQueue).set({ status: "erro", attempts, lastError: `${message} [${original}]`, updatedAt: at }).where(eq(s.syncQueue.id, row.id));
    await setEntityStatus(row.entity, row.entityId, "erro", message);
    await log("out", model, null, `Erro ao enviar ${label(row)} (${attempts} tentativa${attempts > 1 ? "s" : ""}): ${message} [${original}]`, "error");
    await warnGuardian(row, message);
    sum.failed++;
    return;
  }
  const next = new Date(at.getTime() + backoffMinutes(attempts) * 60_000);
  await db.update(s.syncQueue).set({ status: "pendente", attempts, nextAttemptAt: next, lastError: `${message} [${original}]`, updatedAt: at }).where(eq(s.syncQueue.id, row.id));
  await setEntityStatus(row.entity, row.entityId, "pendente", message);
  await log("out", model, null, `Falha ao enviar ${label(row)} (tentativa ${attempts} de ${MAX_ATTEMPTS}); nova tentativa às ${next.toISOString()}: ${original}`, "warn");
  sum.retrying++;
}

function label(row: QueueRow) {
  const what = row.entity === "time_entry" ? "apontamento" : row.entity === "item" ? "tarefa" : "anexo";
  return `${what} ${row.entityId}${row.op === "delete" ? " (exclusão)" : ""}`;
}

/** Erro de sincronização avisa o guardião técnico (perfil Administrador) na hora, fora do horário comercial também. */
async function warnGuardian(row: QueueRow, message: string) {
  const admins = await db.select().from(s.people).where(and(eq(s.people.role, "administrador"), eq(s.people.active, true)));
  let detail = "";
  if (row.entity === "time_entry") {
    const [e] = await db
      .select({ date: s.timeEntries.date, person: s.people.name })
      .from(s.timeEntries)
      .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
      .where(eq(s.timeEntries.id, row.entityId));
    if (e) detail = `Apontamento de ${e.person} em ${e.date.split("-").reverse().join("/")}. `;
  } else if (row.entity === "item") {
    const [it] = await db.select({ name: s.items.name }).from(s.items).where(eq(s.items.id, row.entityId));
    if (it) detail = `Item "${it.name}". `;
  }
  for (const a of admins)
    await notify(db, {
      event: "erro_sincronizacao",
      to: { personId: a.id, slackUserId: a.slackUserId },
      title: "Erro de sincronização com o Odoo",
      body: `${detail}${message}`,
      link: "/config/integracao",
      urgent: true,
      dedupeKey: `sync-erro:${row.id}`,
    });
}

export async function log(direction: "in" | "out", model: string, odooId: number | null, message: string, level: string) {
  await db.insert(s.syncLog).values({ direction, model, odooId, message: message.slice(0, 2000), level });
}

// ---------- Contexto com caches por execução ----------

class Ctx {
  private stages = new Map<string, number>();
  constructor(
    public odoo: OdooClient,
    public F: OdooFields,
  ) {}

  async stageId(stage: StageKey): Promise<number> {
    const name = STAGE_ODOO_NAMES[stage];
    const hit = this.stages.get(name);
    if (hit) return hit;
    const [r] = await this.odoo.searchRead("project.task.type", [["name", "=", name]], ["id"], { limit: 1 });
    if (!r) throw new SyncError(`A etapa "${name}" não existe no Odoo. Crie a etapa com este nome exato e envie de novo.`);
    this.stages.set(name, r.id);
    return r.id;
  }

  /** Etiquetas pelo nome. Marcadores que faltam são criados; as de sistema precisam existir. */
  async tagIds(names: string[]): Promise<number[]> {
    if (!names.length) return [];
    const found = await this.odoo.searchRead("project.tags", [["name", "in", names]], ["id", "name"]);
    const byName = new Map(found.map((t) => [String(t.name), t.id]));
    const system = new Set<string>(Object.values(SYSTEM_TAGS));
    const out: number[] = [];
    for (const n of names) {
      let id = byName.get(n);
      if (!id) {
        if (system.has(n)) throw new SyncError(`A etiqueta "${n}" não existe no Odoo. Crie a etiqueta de tarefa com este nome exato e envie de novo.`);
        id = await this.odoo.create("project.tags", { name: n });
        await log("out", "project.tags", id, `Etiqueta "${n}" criada no Odoo.`, "info");
      }
      out.push(id);
      await db.update(s.tags).set({ odooTagId: id }).where(and(eq(s.tags.name, n)));
    }
    return out;
  }

  /** Procura pelo ID Clarity (inclusive arquivados) para nunca duplicar. */
  async findByClarityId(model: string, clarityId: string): Promise<number | null> {
    const ctx = model === "project.task" ? { active_test: false } : undefined;
    const [r] = await this.odoo.searchRead(model, [[this.F.clarityId, "=", clarityId]], ["id"], { limit: 1, context: ctx });
    return r?.id ?? null;
  }

  /** Grava no id conhecido; se ele sumiu do Odoo, procura pelo ID Clarity; se não achar, cria. */
  async upsert(model: string, knownId: number | null, clarityId: string, vals: Record<string, unknown>): Promise<{ id: number; created: boolean }> {
    if (knownId) {
      try {
        await this.odoo.write(model, [knownId], vals);
        return { id: knownId, created: false };
      } catch (e) {
        if (!(e instanceof OdooError && e.kind === "missing")) throw e;
      }
    }
    const existing = await this.findByClarityId(model, clarityId);
    if (existing) {
      await this.odoo.write(model, [existing], vals);
      return { id: existing, created: false };
    }
    return { id: await this.odoo.create(model, vals), created: true };
  }
}

// ---------- Envio por tipo ----------

async function handle(ctx: Ctx, row: QueueRow): Promise<Done> {
  switch (row.entity as Entity) {
    case "time_entry":
      return row.op === "delete" ? deleteEntry(ctx, row.entityId) : upsertEntry(ctx, row.entityId);
    case "item":
      return row.op === "delete" ? archiveItem(ctx, row.entityId) : upsertItem(ctx, row.entityId);
    case "attachment":
      return pushAttachment(ctx, row.entityId);
    default:
      throw new SyncError(`Tipo de registro desconhecido na fila: ${row.entity}.`);
  }
}

const parentItem = alias(s.items, "parent_item");

/** Garante que o item está na fila (para o apontamento poder seguir depois). */
async function ensureItemQueued(itemId: string) {
  const open = await db
    .select({ id: s.syncQueue.id })
    .from(s.syncQueue)
    .where(and(eq(s.syncQueue.entity, "item"), eq(s.syncQueue.entityId, itemId), inArray(s.syncQueue.status, ["pendente", "processando"])));
  if (!open.length) await enqueueSync(db, "item", itemId, "upsert");
}

function isDraft(item: { kind: string; scopeStatus: string }, parentScope: string | null) {
  return (item.kind === "projeto" && item.scopeStatus === "rascunho") || parentScope === "rascunho";
}

// --- Apontamento → account.analytic.line ---

async function upsertEntry(ctx: Ctx, id: string): Promise<Done> {
  const [r] = await db
    .select({ e: s.timeEntries, type: s.entryTypes, person: s.people, item: s.items, parentScope: parentItem.scopeStatus, annual: s.annualProjects, so: s.salesOrderLines })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .leftJoin(parentItem, eq(parentItem.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .leftJoin(s.salesOrderLines, eq(s.salesOrderLines.id, s.timeEntries.salesOrderLineId))
    .where(eq(s.timeEntries.id, id));
  if (!r) return { model: "account.analytic.line", message: `Apontamento ${id} não existe mais no Clarity; nada a enviar.` };
  if (r.e.deletedAt) return deleteEntry(ctx, id);

  if (isDraft(r.item, r.parentScope)) throw new SyncError("A tarefa deste apontamento está em rascunho e não existe no Odoo. Mova o apontamento para uma tarefa confirmada.");
  if (!r.item.odooTaskId) {
    if (r.item.syncStatus === "erro")
      throw new SyncError(`A tarefa "${r.item.name}" ainda não foi criada no Odoo: ${r.item.syncError ?? "erro no envio"}`, false);
    await ensureItemQueued(r.item.id);
    throw new Defer(`Aguardando a tarefa "${r.item.name}" ser criada no Odoo.`);
  }
  if (!r.annual.odooProjectId) throw new SyncError(`O projeto anual "${r.annual.name}" não está ligado a um projeto do Odoo.`);

  let employeeId = r.person.odooEmployeeId;
  if (!employeeId) {
    const [emp] = await ctx.odoo.searchRead("hr.employee", [["work_email", "=ilike", r.person.email]], ["id"], { limit: 1 });
    if (!emp) throw new SyncError(`${r.person.name} não tem funcionário no Odoo com o e-mail ${r.person.email}. Cadastre no Odoo e envie de novo.`);
    employeeId = emp.id;
    await db.update(s.people).set({ odooEmployeeId: employeeId }).where(eq(s.people.id, r.person.id));
  }

  const F = ctx.F;
  const vals: Record<string, unknown> = {
    employee_id: employeeId,
    project_id: r.annual.odooProjectId,
    task_id: r.item.odooTaskId,
    date: r.e.date,
    unit_amount: minutesToHours(r.e.minutes),
    name: r.e.description,
    // US-08: só tipo que aceita pedido leva so_line; nos outros, false explícito para o Odoo não preencher sozinho.
    so_line: r.type.acceptsSalesOrder && r.so ? r.so.odooSoLineId : false,
    [F.entryType]: r.type.code,
    [F.sustentacao]: r.e.isSustentacao,
    [F.clarityId]: r.e.id,
  };
  const { id: lineId, created } = await ctx.upsert("account.analytic.line", r.e.odooLineId, r.e.id, vals);
  if (lineId !== r.e.odooLineId) await db.update(s.timeEntries).set({ odooLineId: lineId }).where(eq(s.timeEntries.id, id));
  return { model: "account.analytic.line", odooId: lineId, message: `Apontamento ${id} ${created ? "criado" : "atualizado"} no Odoo.` };
}

async function deleteEntry(ctx: Ctx, id: string): Promise<Done> {
  const [e] = await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, id));
  const ids = new Set<number>();
  if (e?.odooLineId) ids.add(e.odooLineId);
  const byClarity = await ctx.findByClarityId("account.analytic.line", id);
  if (byClarity) ids.add(byClarity);
  for (const lineId of ids) {
    try {
      await ctx.odoo.unlink("account.analytic.line", [lineId]);
    } catch (err) {
      if (!(err instanceof OdooError && err.kind === "missing")) throw err;
    }
  }
  return { model: "account.analytic.line", odooId: e?.odooLineId ?? byClarity, message: ids.size ? `Apontamento ${id} excluído do Odoo.` : `Apontamento ${id} não estava no Odoo; nada a excluir.` };
}

// --- Item → project.task ---

async function loadItem(id: string) {
  const [r] = await db
    .select({ item: s.items, parent: parentItem, annual: s.annualProjects })
    .from(s.items)
    .leftJoin(parentItem, eq(parentItem.id, s.items.parentId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(eq(s.items.id, id));
  return r;
}

async function upsertItem(ctx: Ctx, id: string): Promise<Done> {
  const r = await loadItem(id);
  if (!r) return { model: "project.task", message: `Item ${id} não existe mais no Clarity; nada a enviar.` };
  const { item, parent, annual } = r;
  if (isDraft(item, parent?.scopeStatus ?? null))
    return { model: "project.task", message: `Item ${id} em rascunho: não vai ao Odoo.`, status: "nao_sincroniza" };
  if (item.archived) return archiveItem(ctx, id);
  if (parent && !parent.odooTaskId) {
    if (parent.syncStatus === "erro") throw new SyncError(`O projeto "${parent.name}" ainda não foi criado no Odoo: ${parent.syncError ?? "erro no envio"}`, false);
    await ensureItemQueued(parent.id);
    throw new Defer(`Aguardando o projeto "${parent.name}" ser criado no Odoo.`);
  }
  if (!annual.odooProjectId) throw new SyncError(`O projeto anual "${annual.name}" não está ligado a um projeto do Odoo.`);

  const tagRows = await db
    .select({ name: s.tags.name })
    .from(s.itemTags)
    .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
    .where(eq(s.itemTags.itemId, id));
  const names = new Set<string>();
  if (!item.parentId) names.add(item.kind === "projeto" ? SYSTEM_TAGS.projeto : SYSTEM_TAGS.tarefa);
  if (item.outOfScope) names.add(SYSTEM_TAGS.foraDoEscopo);
  for (const t of tagRows) if (t.name !== SYSTEM_TAGS.projeto && t.name !== SYSTEM_TAGS.tarefa) names.add(t.name);

  const users = await db
    .select({ uid: s.people.odooUserId, name: s.people.name })
    .from(s.itemAssignees)
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .where(eq(s.itemAssignees.itemId, id));
  const noUser = users.filter((u) => !u.uid).map((u) => u.name);
  if (noUser.length) await log("out", "project.task", item.odooTaskId, `Item ${id}: ${noUser.join(", ")} sem usuário no Odoo; não entram como responsáveis lá.`, "warn");

  const F = ctx.F;
  const vals: Record<string, unknown> = {
    name: item.name,
    project_id: annual.odooProjectId,
    parent_id: parent?.odooTaskId ?? false,
    user_ids: [[6, 0, users.map((u) => u.uid).filter((x): x is number => !!x)]],
    // O Odoo só usa o início planejado junto com o prazo.
    planned_date_begin: item.deadline ? startToOdoo(item.startDate) : false,
    date_deadline: deadlineToOdoo(item.deadline),
    allocated_hours: item.plannedMinutes ? minutesToHours(item.plannedMinutes) : 0,
    stage_id: await ctx.stageId(item.stage),
    tag_ids: [[6, 0, await ctx.tagIds([...names])]],
    description: textToHtml(item.description),
    active: true,
    [F.sustentacao]: item.isSustentacao,
    [F.clarityId]: item.id,
  };
  const { id: taskId, created } = await ctx.upsert("project.task", item.odooTaskId, item.id, vals);
  if (taskId !== item.odooTaskId) await db.update(s.items).set({ odooTaskId: taskId }).where(eq(s.items.id, id));
  return { model: "project.task", odooId: taskId, message: `Item "${item.name}" ${created ? "criado" : "atualizado"} no Odoo.` };
}

/** Projeto ou tarefa excluído/arquivado no Clarity é arquivado no Odoo, nunca apagado. */
async function archiveItem(ctx: Ctx, id: string): Promise<Done> {
  const r = await loadItem(id);
  let taskId = r?.item.odooTaskId ?? null;
  if (!taskId) taskId = await ctx.findByClarityId("project.task", id);
  if (!taskId) return { model: "project.task", message: `Item ${id} não estava no Odoo; nada a arquivar.` };
  try {
    await ctx.odoo.write("project.task", [taskId], { active: false });
  } catch (e) {
    if (!(e instanceof OdooError && e.kind === "missing")) throw e;
    return { model: "project.task", odooId: taskId, message: `Tarefa ${taskId} já não existia no Odoo.` };
  }
  return { model: "project.task", odooId: taskId, message: `Item ${r?.item.name ?? id} arquivado no Odoo.` };
}

// --- Anexo → ir.attachment (US-39) ---

async function pushAttachment(ctx: Ctx, id: string): Promise<Done> {
  const [a] = await db.select().from(s.attachments).where(eq(s.attachments.id, id));
  if (!a) return { model: "ir.attachment", message: `Anexo ${id} não existe mais; nada a enviar.` };
  if (a.odooAttachmentId) return { model: "ir.attachment", odooId: a.odooAttachmentId, message: `Anexo ${id} já estava no Odoo.` };
  if (a.ownerType !== "item") return { model: "ir.attachment", message: `Anexo ${id} (${a.ownerType}) fica só no Clarity.` };
  const r = await loadItem(a.ownerId);
  if (!r) return { model: "ir.attachment", message: `O item do anexo ${id} não existe mais.` };
  if (isDraft(r.item, r.parent?.scopeStatus ?? null)) return { model: "ir.attachment", message: `Anexo ${id} de item em rascunho: sobe na confirmação do escopo.` };
  if (!r.item.odooTaskId) {
    await ensureItemQueued(r.item.id);
    throw new Defer(`Aguardando a tarefa "${r.item.name}" ser criada no Odoo.`);
  }
  const { getFile } = await import("../storage");
  const data = await getFile(a.storagePath);
  const name = a.version > 1 ? a.filename.replace(/(\.[^.]+)?$/, ` (v${a.version})$1`) : a.filename;
  const attId = await ctx.odoo.create("ir.attachment", {
    name,
    res_model: "project.task",
    res_id: r.item.odooTaskId,
    datas: data.toString("base64"),
    mimetype: a.mime,
  });
  await db.update(s.attachments).set({ odooAttachmentId: attId }).where(eq(s.attachments.id, id));
  return { model: "ir.attachment", odooId: attId, message: `Anexo "${a.filename}" enviado à tarefa ${r.item.odooTaskId} no Odoo.` };
}
