import "server-only";
import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { audit, type Tx } from "../audit";
import { enqueueSync } from "../sync/enqueue";
import { isManager, type TeamUser } from "../session";
import { ItemError, loadItemCtx } from "./items";

/**
 * Escopo do projeto (US-22, US-23, US-26).
 * Versão 0 = rascunho (editável, só no Clarity). Versões 1, 2, ... = confirmadas e congeladas.
 */

export type DeliverableInput = {
  /** Id de um entregável do rascunho (para manter o vínculo das tarefas planejadas). */
  id?: string | null;
  title: string;
  description?: string | null;
  estimateMinutes?: number | null;
  suggestedPersonId?: string | null;
};

export type ScopeDraftInput = {
  objective?: string | null;
  exclusions?: string[];
  assumptions?: string | null;
  deliverables: DeliverableInput[];
};

type Version = typeof s.scopeVersions.$inferSelect;
type Deliverable = typeof s.deliverables.$inferSelect;

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function getVersions(itemId: string, tx: Tx | typeof db = db) {
  return tx.select().from(s.scopeVersions).where(eq(s.scopeVersions.itemId, itemId)).orderBy(asc(s.scopeVersions.version));
}

export async function getDeliverables(versionIds: string[], tx: Tx | typeof db = db) {
  if (!versionIds.length) return [] as Deliverable[];
  return tx.select().from(s.deliverables).where(inArray(s.deliverables.scopeVersionId, versionIds)).orderBy(asc(s.deliverables.number));
}

/** Versão em vigor: a maior confirmada; sem nenhuma, o rascunho. */
export async function currentVersion(itemId: string, tx: Tx | typeof db = db): Promise<Version | null> {
  const [v] = await tx.select().from(s.scopeVersions).where(eq(s.scopeVersions.itemId, itemId)).orderBy(desc(s.scopeVersions.version)).limit(1);
  return v ?? null;
}

async function loadProject(id: string) {
  const ctx = await loadItemCtx(id);
  if (ctx.item.kind !== "projeto") throw new ItemError("Escopo vale só para projetos.");
  return ctx;
}

function sumMinutes(ds: { estimateMinutes?: number | null }[]) {
  return ds.reduce((a, d) => a + (d.estimateMinutes ?? 0), 0);
}

function validateDeliverables(ds: DeliverableInput[]) {
  for (const [i, d] of ds.entries()) {
    if (!txt(d.title)) throw new ItemError(`O entregável E${i + 1} está sem nome.`, { [`d${i}`]: "Dê um nome." });
    if (d.estimateMinutes != null && (!Number.isFinite(d.estimateMinutes) || d.estimateMinutes < 0))
      throw new ItemError(`Horas inválidas no entregável E${i + 1}.`, { [`d${i}`]: "Horas inválidas." });
  }
}

async function ensureDraft(tx: Tx, itemId: string, me: TeamUser) {
  const [v] = await tx.select().from(s.scopeVersions).where(and(eq(s.scopeVersions.itemId, itemId), eq(s.scopeVersions.version, 0)));
  if (v) return v;
  const [n] = await tx.insert(s.scopeVersions).values({ itemId, version: 0, updatedBy: me.id }).returning();
  return n;
}

/** US-22: salva o rascunho. Qualquer pessoa do time edita enquanto o projeto está em rascunho. */
export async function saveScopeDraft(me: TeamUser, projectId: string, input: ScopeDraftInput) {
  const { item } = await loadProject(projectId);
  if (item.scopeStatus !== "rascunho") throw new ItemError("O escopo já foi confirmado e está congelado. Mudanças só por nova versão.");
  validateDeliverables(input.deliverables);
  const exclusions = (input.exclusions ?? []).map(txt).filter(Boolean);
  return db.transaction(async (tx) => {
    const draft = await ensureDraft(tx, projectId, me);
    const before = { ...draft, deliverables: await getDeliverables([draft.id], tx) };
    const keep = new Set(input.deliverables.map((d) => d.id).filter(Boolean) as string[]);
    const removed = before.deliverables.filter((d) => !keep.has(d.id)).map((d) => d.id);
    if (removed.length) {
      // Tarefas planejadas ligadas a entregável removido perdem o vínculo.
      await tx.update(s.items).set({ deliverableId: null }).where(inArray(s.items.deliverableId, removed));
      await tx.delete(s.deliverables).where(inArray(s.deliverables.id, removed));
    }
    for (const [i, d] of input.deliverables.entries()) {
      const values = {
        number: i + 1,
        title: txt(d.title),
        description: txt(d.description) || null,
        estimateMinutes: d.estimateMinutes ?? null,
        suggestedPersonId: d.suggestedPersonId || null,
      };
      if (d.id && before.deliverables.some((x) => x.id === d.id)) await tx.update(s.deliverables).set(values).where(eq(s.deliverables.id, d.id));
      else await tx.insert(s.deliverables).values({ ...values, scopeVersionId: draft.id });
    }
    const [after] = await tx
      .update(s.scopeVersions)
      .set({
        objective: input.objective === undefined ? draft.objective : txt(input.objective) || null,
        exclusions,
        assumptions: input.assumptions === undefined ? draft.assumptions : txt(input.assumptions) || null,
        estimateMinutes: sumMinutes(input.deliverables),
        updatedBy: me.id,
        updatedAt: now(),
      })
      .where(eq(s.scopeVersions.id, draft.id))
      .returning();
    await audit(tx, {
      personId: me.id,
      entity: "scope",
      entityId: projectId,
      action: "editar_rascunho",
      before: { objective: before.objective, exclusions: before.exclusions, assumptions: before.assumptions, estimateMinutes: before.estimateMinutes, deliverables: before.deliverables.map((d) => d.title) },
      after: { objective: after.objective, exclusions: after.exclusions, assumptions: after.assumptions, estimateMinutes: after.estimateMinutes, deliverables: input.deliverables.map((d) => txt(d.title)) },
    });
    return after;
  });
}

/** US-22: histórico de reuniões do levantamento. */
export async function addMeeting(me: TeamUser, projectId: string, input: { date: string; title: string; participants?: string; summary?: string }) {
  await loadProject(projectId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw new ItemError("Informe a data da reunião.", { date: "Data inválida." });
  if (!txt(input.title)) throw new ItemError("Dê um título à reunião.", { title: "Título obrigatório." });
  return db.transaction(async (tx) => {
    const [m] = await tx
      .insert(s.meetings)
      .values({ itemId: projectId, date: input.date, title: txt(input.title), participants: txt(input.participants) || null, summary: txt(input.summary) || null, createdBy: me.id })
      .returning();
    await audit(tx, { personId: me.id, entity: "scope", entityId: projectId, action: "reuniao", after: m });
    return m;
  });
}

export async function removeMeeting(me: TeamUser, meetingId: string) {
  const [m] = await db.select().from(s.meetings).where(eq(s.meetings.id, meetingId));
  if (!m) throw new ItemError("Reunião não encontrada.");
  if (m.createdBy !== me.id && !isManager(me)) throw new ItemError("Só quem registrou a reunião ou a gestão podem removê-la.");
  await db.transaction(async (tx) => {
    await tx.delete(s.meetings).where(eq(s.meetings.id, meetingId));
    await audit(tx, { personId: me.id, entity: "scope", entityId: m.itemId, action: "remover_reuniao", before: m });
  });
}

/** O que falta para confirmar (mostrado na tela e checado no servidor). */
export function confirmChecks(draft: { estimateMinutes: number | null } | null, deliverables: { title: string; estimateMinutes: number | null }[]) {
  const named = deliverables.length > 0 && deliverables.every((d) => d.title.trim());
  const estimate = (draft?.estimateMinutes ?? 0) > 0 || sumMinutes(deliverables) > 0;
  return [
    { ok: deliverables.length > 0, text: deliverables.length > 0 ? `${deliverables.length} ${deliverables.length === 1 ? "entregável" : "entregáveis"}` : "Adicione ao menos um entregável" },
    { ok: named, text: named ? "Todos os entregáveis têm nome" : "Falta nome em algum entregável" },
    { ok: estimate, text: estimate ? "Estimativa de horas preenchida" : "Preencha a estimativa de horas" },
  ];
}

async function copyVersion(tx: Tx, from: Version, fromDeliverables: Deliverable[], values: Partial<Version> & { version: number }) {
  const [v] = await tx
    .insert(s.scopeVersions)
    .values({
      itemId: from.itemId,
      version: values.version,
      objective: values.objective ?? from.objective,
      exclusions: values.exclusions ?? from.exclusions,
      assumptions: values.assumptions ?? from.assumptions,
      estimateMinutes: values.estimateMinutes ?? from.estimateMinutes,
      reason: values.reason ?? null,
      confirmedBy: values.confirmedBy ?? null,
      confirmedAt: values.confirmedAt ?? null,
      updatedBy: values.updatedBy ?? null,
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();
  const map = new Map<string, string>();
  for (const d of fromDeliverables) {
    const [n] = await tx
      .insert(s.deliverables)
      .values({ scopeVersionId: v.id, number: d.number, title: d.title, description: d.description, estimateMinutes: d.estimateMinutes, suggestedPersonId: d.suggestedPersonId })
      .returning();
    map.set(d.id, n.id);
  }
  return { version: v, map };
}

/** Tarefas passam a apontar para os entregáveis da versão nova (mesmo número). */
async function relinkTasks(tx: Tx, projectId: string, map: Map<string, string>) {
  for (const [oldId, newId] of map) {
    await tx.update(s.items).set({ deliverableId: newId }).where(and(eq(s.items.parentId, projectId), eq(s.items.deliverableId, oldId)));
  }
}

/**
 * US-23: só quem tem can_confirm_scope (Marttini, Richard, Luiz). Exige um entregável e a estimativa.
 * O rascunho vira a versão 1, congelada; projeto e tarefas entram na fila do Odoo, e os anexos
 * do rascunho sobem junto.
 */
export async function confirmScope(me: TeamUser, projectId: string) {
  if (!me.canConfirmScope) throw new ItemError("Só Marttini, Richard e Luiz confirmam escopo.");
  const { item } = await loadProject(projectId);
  if (item.scopeStatus !== "rascunho") throw new ItemError("Este escopo já foi confirmado.");
  return db.transaction(async (tx) => {
    const draft = await ensureDraft(tx, projectId, me);
    const ds = await getDeliverables([draft.id], tx);
    const failed = confirmChecks(draft, ds).find((c) => !c.ok);
    if (failed) throw new ItemError(`Ainda não dá para confirmar: ${failed.text.toLowerCase()}.`);
    const estimate = draft.estimateMinutes && draft.estimateMinutes > 0 ? draft.estimateMinutes : sumMinutes(ds);
    const { version, map } = await copyVersion(tx, draft, ds, { version: 1, estimateMinutes: estimate, confirmedBy: me.id, confirmedAt: now(), updatedBy: me.id });
    await relinkTasks(tx, projectId, map);
    const [after] = await tx
      .update(s.items)
      .set({ scopeStatus: "confirmado", stage: "analise", plannedMinutes: item.plannedMinutes ?? estimate, syncStatus: "pendente", syncError: null, updatedAt: now() })
      .where(eq(s.items.id, projectId))
      .returning();
    // US-21/23: projeto e tarefas são criados no Odoo em Projetos em Análise/Aprovação.
    await enqueueSync(tx, "item", projectId, "upsert");
    const tasks = await tx.select().from(s.items).where(and(eq(s.items.parentId, projectId), eq(s.items.archived, false)));
    for (const t of tasks) {
      await tx.update(s.items).set({ syncStatus: "pendente", syncError: null }).where(eq(s.items.id, t.id));
      await enqueueSync(tx, "item", t.id, "upsert");
    }
    // Anexos do rascunho sobem na confirmação (US-39).
    const ownerIds = [projectId, ...tasks.map((t) => t.id)];
    const atts = await tx
      .select({ id: s.attachments.id })
      .from(s.attachments)
      .where(and(eq(s.attachments.ownerType, "item"), inArray(s.attachments.ownerId, ownerIds), eq(s.attachments.internal, false), isNull(s.attachments.odooAttachmentId)));
    for (const a of atts) await enqueueSync(tx, "attachment", a.id, "upsert");
    await audit(tx, { personId: me.id, entity: "scope", entityId: projectId, action: "confirmar", after: { version: 1, estimateMinutes: estimate, deliverables: ds.map((d) => d.title) } });
    return { item: after, version };
  });
}

export type NewVersionInput = ScopeDraftInput & {
  reason: string;
  /** Demandas fora do escopo incorporadas: cada uma ligada ao número do entregável na versão nova. */
  incorporate?: { taskId: string; deliverableNumber: number }[];
};

/** US-26: a gestão gera nova versão, com motivo; pode incorporar demandas adicionais. Versões anteriores ficam salvas. */
export async function newScopeVersion(me: TeamUser, projectId: string, input: NewVersionInput) {
  if (!isManager(me) && !me.canConfirmScope) throw new ItemError("Só a gestão gera nova versão do escopo.");
  if (!txt(input.reason)) throw new ItemError("Diga o motivo da nova versão.", { reason: "O motivo é obrigatório." });
  const { item } = await loadProject(projectId);
  if (item.scopeStatus !== "confirmado") throw new ItemError("Confirme o escopo antes de gerar nova versão.");
  if (!input.deliverables.length) throw new ItemError("A versão precisa de ao menos um entregável.");
  validateDeliverables(input.deliverables);
  const incorporate = input.incorporate ?? [];
  for (const inc of incorporate) {
    if (inc.deliverableNumber < 1 || inc.deliverableNumber > input.deliverables.length)
      throw new ItemError("Escolha o entregável de cada demanda incorporada.", { incorporate: "Entregável inválido." });
  }
  const tasks = incorporate.length
    ? await db.select().from(s.items).where(and(inArray(s.items.id, incorporate.map((i) => i.taskId)), eq(s.items.parentId, projectId), eq(s.items.outOfScope, true)))
    : [];
  if (tasks.length !== incorporate.length) throw new ItemError("Só demandas adicionais deste projeto podem ser incorporadas.");
  const [fora] = await db.select().from(s.tags).where(and(eq(s.tags.name, "Fora do escopo"), eq(s.tags.system, true)));

  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: max(s.scopeVersions.version) }).from(s.scopeVersions).where(eq(s.scopeVersions.itemId, projectId));
    const prev = await currentVersion(projectId, tx);
    const prevDs = prev ? await getDeliverables([prev.id], tx) : [];
    const estimate = sumMinutes(input.deliverables);
    const [nv] = await tx
      .insert(s.scopeVersions)
      .values({
        itemId: projectId,
        version: (v ?? 0) + 1,
        objective: txt(input.objective) || null,
        exclusions: (input.exclusions ?? []).map(txt).filter(Boolean),
        assumptions: txt(input.assumptions) || null,
        estimateMinutes: estimate,
        reason: txt(input.reason),
        confirmedBy: me.id,
        confirmedAt: now(),
        updatedBy: me.id,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    const byNumber = new Map<number, string>();
    const map = new Map<string, string>();
    for (const [i, d] of input.deliverables.entries()) {
      const [n] = await tx
        .insert(s.deliverables)
        .values({ scopeVersionId: nv.id, number: i + 1, title: txt(d.title), description: txt(d.description) || null, estimateMinutes: d.estimateMinutes ?? null, suggestedPersonId: d.suggestedPersonId || null })
        .returning();
      byNumber.set(i + 1, n.id);
      if (d.id && prevDs.some((p) => p.id === d.id)) map.set(d.id, n.id);
    }
    // Entregáveis removidos: as tarefas perdem o vínculo; mantidos: passam para a versão nova.
    for (const p of prevDs) if (!map.has(p.id)) await tx.update(s.items).set({ deliverableId: null }).where(and(eq(s.items.parentId, projectId), eq(s.items.deliverableId, p.id)));
    await relinkTasks(tx, projectId, map);
    for (const inc of incorporate) {
      const t = tasks.find((x) => x.id === inc.taskId)!;
      // Deixa de ser fora do escopo a partir desta versão; o histórico fica na auditoria.
      const [after] = await tx
        .update(s.items)
        .set({ outOfScope: false, deliverableId: byNumber.get(inc.deliverableNumber)!, updatedAt: now() })
        .where(eq(s.items.id, t.id))
        .returning();
      if (fora) await tx.delete(s.itemTags).where(and(eq(s.itemTags.itemId, t.id), eq(s.itemTags.tagId, fora.id)));
      await audit(tx, { personId: me.id, entity: "item", entityId: t.id, action: "incorporar_escopo", before: { outOfScope: true, clientApproval: t.clientApproval }, after: { outOfScope: false, version: nv.version, reason: txt(input.reason) } });
      await tx.update(s.items).set({ syncStatus: "pendente" }).where(eq(s.items.id, after.id));
      await enqueueSync(tx, "item", after.id, "upsert");
    }
    await tx.update(s.items).set({ plannedMinutes: estimate, syncStatus: "pendente", updatedAt: now() }).where(eq(s.items.id, projectId));
    await enqueueSync(tx, "item", projectId, "upsert");
    await audit(tx, {
      personId: me.id,
      entity: "scope",
      entityId: projectId,
      action: "nova_versao",
      before: prev ? { version: prev.version, estimateMinutes: prev.estimateMinutes } : null,
      after: { version: nv.version, estimateMinutes: estimate, reason: txt(input.reason), incorporated: incorporate.map((i) => i.taskId) },
    });
    return nv;
  });
}

export type VersionDiffRow = {
  number: number;
  a: { title: string; estimateMinutes: number | null } | null;
  b: { title: string; estimateMinutes: number | null } | null;
  change: "igual" | "novo" | "removido" | "alterado";
};

/** US-26: comparação lado a lado, por número do entregável. */
export function diffDeliverables(a: Deliverable[], b: Deliverable[]): VersionDiffRow[] {
  const n = Math.max(a.at(-1)?.number ?? 0, b.at(-1)?.number ?? 0, a.length, b.length);
  const rows: VersionDiffRow[] = [];
  for (let i = 1; i <= n; i++) {
    const x = a.find((d) => d.number === i) ?? null;
    const y = b.find((d) => d.number === i) ?? null;
    if (!x && !y) continue;
    const change = !x ? "novo" : !y ? "removido" : x.title === y.title && x.estimateMinutes === y.estimateMinutes ? "igual" : "alterado";
    rows.push({ number: i, a: x && { title: x.title, estimateMinutes: x.estimateMinutes }, b: y && { title: y.title, estimateMinutes: y.estimateMinutes }, change });
  }
  return rows;
}
