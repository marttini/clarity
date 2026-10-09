/**
 * Projetos, tarefas, escopo, demandas adicionais e comentários (US-14 a US-19, US-22 a US-27, US-39 a US-41).
 * Banco: clarity_test (ou TEST_DATABASE_URL), migrado e limpo antes de cada caso.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test";
  process.env.CLARITY_NOW = "2026-10-08T13:00:00-03:00";
  process.env.ODOO_MODE = "fake";
});

import { migrateTestDb, truncateAll } from "./db";
import { and, eq } from "drizzle-orm";
import { db, pg, schema as s } from "@/db";
import { createEntry, EntryError } from "@/server/services/entries";
import {
  changeDeadline,
  changeStage,
  createProject,
  createTask,
  ItemError,
  reclassifyDemand,
  registerExternalApproval,
  setVisibility,
} from "@/server/services/items";
import { confirmScope, newScopeVersion, saveScopeDraft, getVersions, getDeliverables } from "@/server/services/scope";
import { addComment, deleteComment, editComment, parseMentions } from "@/server/services/comments";

const TODAY = "2026-10-08";

async function fixture() {
  const [faturavel] = await db
    .insert(s.entryTypes)
    .values([{ code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 }])
    .returning();
  const tags = await db
    .insert(s.tags)
    .values([
      { name: "Projeto", system: true },
      { name: "Tarefa", system: true },
      { name: "Fora do escopo", system: true },
      { name: "Crítico", color: "#FF8A80" },
    ])
    .returning();
  const T = Object.fromEntries(tags.map((t) => [t.name, t]));
  const [marttini, richard, caio, helena, julia] = await db
    .insert(s.people)
    .values([
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false, canConfirmScope: true, canApproveHours: true },
      { name: "Richard", email: "richard@sintesebrasil.com", role: "gestor", canConfirmScope: true },
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor", slackUserId: "U-CAIO" },
      { name: "Helena Duarte", email: "helena@sintesebrasil.com", role: "consultor" },
      { name: "Júlia Prado", email: "julia@sintesebrasil.com", role: "consultor" },
    ])
    .returning();
  const [kari] = await db.insert(s.clients).values({ name: "Kari-Kari Alimentos", color: "#F59A6B" }).returning();
  const [annual] = await db.insert(s.annualProjects).values({ clientId: kari.id, name: "Kari-Kari Alimentos 2026", year: 2026, odooProjectId: 300 }).returning();
  const [carla] = await db
    .insert(s.clientContacts)
    .values({ clientId: kari.id, name: "Carla Mendes", email: "carla@karikari.com.br", portalAccess: true })
    .returning();
  return { faturavel, T, marttini, richard, caio, helena, julia, kari, annual, carla };
}

type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;

beforeAll(async () => {
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
  fx = await fixture();
});

afterAll(async () => {
  await pg.end();
});

const item = async (id: string) => (await db.select().from(s.items).where(eq(s.items.id, id)))[0];
const queued = async (entity: string, id: string) => db.select().from(s.syncQueue).where(and(eq(s.syncQueue.entity, entity), eq(s.syncQueue.entityId, id)));

async function draftProject() {
  return createProject(fx.caio, {
    clientId: fx.kari.id,
    name: "Integração Broker",
    assigneeIds: [fx.caio.id, fx.helena.id],
    deadline: "2026-11-30",
    plannedMinutes: 120 * 60,
    tagIds: [fx.T["Crítico"].id, fx.T["Projeto"].id],
  });
}

async function confirmedProject() {
  const p = await draftProject();
  await saveScopeDraft(fx.caio, p.id, {
    objective: "Automatizar a distribuição de pedidos.",
    exclusions: ["Integração com transportadoras"],
    deliverables: [
      { title: "Importação diária", estimateMinutes: 40 * 60, suggestedPersonId: fx.caio.id },
      { title: "Regras por filial", estimateMinutes: 30 * 60 },
    ],
  });
  await confirmScope(fx.richard, p.id);
  const [v1] = (await getVersions(p.id)).filter((v) => v.version === 1);
  const ds = await getDeliverables([v1.id]);
  return { p: await item(p.id), v1, ds };
}

describe("criar projeto e tarefa (US-14, US-15)", () => {
  it("projeto nasce rascunho, fora da fila do Odoo, com histórico de etapa e rascunho de escopo", async () => {
    const p = await draftProject();
    expect(p.kind).toBe("projeto");
    expect(p.scopeStatus).toBe("rascunho");
    expect(p.stage).toBe("analise");
    expect(p.syncStatus).toBe("nao_sincroniza");
    expect(p.visibleToClient).toBe(false);
    expect(p.annualProjectId).toBe(fx.annual.id);
    expect(await queued("item", p.id)).toHaveLength(0);
    const tags = await db.select().from(s.itemTags).where(eq(s.itemTags.itemId, p.id));
    expect(tags.map((t) => t.tagId)).toEqual([fx.T["Crítico"].id]); // etiqueta de sistema não entra como marcador
    expect(await db.select().from(s.stageHistory).where(eq(s.stageHistory.itemId, p.id))).toHaveLength(1);
    expect((await getVersions(p.id)).map((v) => v.version)).toEqual([0]);
  });

  it("nome, responsável e prazo são obrigatórios", async () => {
    await expect(createProject(fx.caio, { clientId: fx.kari.id, name: " ", assigneeIds: [fx.caio.id], deadline: "2026-11-30" })).rejects.toThrow(/nome/);
    await expect(createProject(fx.caio, { clientId: fx.kari.id, name: "X", assigneeIds: [], deadline: "2026-11-30" })).rejects.toThrow(/responsável/);
    await expect(createProject(fx.caio, { clientId: fx.kari.id, name: "X", assigneeIds: [fx.caio.id], deadline: null })).rejects.toThrow(/prazo/);
  });

  it("tarefa herda sustentação e visibilidade do projeto; subtarefa não tem subtarefa", async () => {
    const p = await draftProject();
    await db.update(s.items).set({ isSustentacao: true, visibleToClient: true }).where(eq(s.items.id, p.id));
    const t = await createTask(fx.caio, { parentId: p.id, name: "Ler arquivo", assigneeIds: [fx.caio.id] });
    expect(t.parentId).toBe(p.id);
    expect(t.isSustentacao).toBe(true);
    expect(t.visibleToClient).toBe(true);
    expect(t.syncStatus).toBe("nao_sincroniza"); // projeto em rascunho: nada vai ao Odoo
    expect(await queued("item", t.id)).toHaveLength(0);
    await expect(createTask(fx.caio, { parentId: t.id, name: "Neta", assigneeIds: [fx.caio.id] })).rejects.toThrow(/Subtarefa não tem subtarefa/);
  });

  it("tarefa simples vai para o projeto anual do ano corrente e entra na fila", async () => {
    await db.insert(s.annualProjects).values({ clientId: fx.kari.id, name: "Kari-Kari Alimentos 2025", year: 2025 });
    const t = await createTask(fx.helena, { clientId: fx.kari.id, name: "Ajuste no relatório", assigneeIds: [fx.helena.id], deadline: "2026-10-20" });
    expect(t.annualProjectId).toBe(fx.annual.id);
    expect(t.parentId).toBeNull();
    expect(await queued("item", t.id)).toHaveLength(1);
    const tags = await db.select().from(s.itemTags).where(eq(s.itemTags.itemId, t.id));
    expect(tags.map((x) => x.tagId)).toEqual([fx.T["Tarefa"].id]);
  });
});

describe("etapas e prazo (US-16, US-17, US-19)", () => {
  it("só o responsável ou a gestão mudam o prazo, sempre com motivo", async () => {
    const { p } = await confirmedProject();
    await expect(changeDeadline(fx.julia, p.id, "2026-12-15", "Cliente atrasou")).rejects.toThrow(/responsável pelo item ou a gestão/);
    await expect(changeDeadline(fx.caio, p.id, "2026-12-15", "  ")).rejects.toThrow(/motivo/);
    await changeDeadline(fx.caio, p.id, "2026-12-15", "Cliente atrasou o arquivo");
    await changeDeadline(fx.richard, p.id, "2026-12-20", "Férias coletivas do cliente");
    const hist = await db.select().from(s.deadlineChanges).where(eq(s.deadlineChanges.itemId, p.id));
    expect(hist.map((h) => [h.oldDeadline, h.newDeadline])).toEqual([
      ["2026-11-30", "2026-12-15"],
      ["2026-12-15", "2026-12-20"],
    ]);
    expect((await item(p.id)).deadline).toBe("2026-12-20");
    expect(await queued("item", p.id)).toHaveLength(1);
  });

  it("mudar prazo de rascunho não vai ao Odoo", async () => {
    const p = await draftProject();
    await changeDeadline(fx.caio, p.id, "2026-12-01", "Ajuste de agenda");
    expect(await queued("item", p.id)).toHaveLength(0);
  });

  it("rascunho não muda de etapa; concluir com tarefas abertas pede confirmação; histórico gravado", async () => {
    const d = await draftProject();
    await expect(changeStage(fx.caio, d.id, "andamento")).rejects.toThrow(/rascunho/);
    const { p, ds } = await confirmedProject();
    await createTask(fx.caio, { parentId: p.id, name: "Ler arquivo", assigneeIds: [fx.caio.id], deliverableId: ds[0].id });
    await changeStage(fx.caio, p.id, "andamento");
    const err = await changeStage(fx.caio, p.id, "concluido").catch((e) => e);
    expect(err).toBeInstanceOf(ItemError);
    expect(err.needsConfirm).toBe(true);
    await changeStage(fx.caio, p.id, "concluido", { confirmOpenTasks: true });
    const after = await item(p.id);
    expect(after.stage).toBe("concluido");
    expect(after.completedAt).not.toBeNull();
    const hist = await db.select().from(s.stageHistory).where(eq(s.stageHistory.itemId, p.id));
    expect(hist.map((h) => h.toStage)).toEqual(["analise", "andamento", "concluido"]);
  });

  it("tornar projeto visível pode levar as tarefas junto", async () => {
    const { p, ds } = await confirmedProject();
    const t = await createTask(fx.caio, { parentId: p.id, name: "Ler arquivo", assigneeIds: [fx.caio.id], deliverableId: ds[0].id });
    expect(t.visibleToClient).toBe(false);
    await setVisibility(fx.caio, p.id, true, { cascade: true });
    expect((await item(t.id)).visibleToClient).toBe(true);
  });
});

describe("escopo (US-22, US-23, US-26)", () => {
  it("só quem pode confirma; exige entregável; cria v1 congelada e põe projeto, tarefas e anexos na fila", async () => {
    const p = await draftProject();
    await expect(confirmScope(fx.richard, p.id)).rejects.toThrow(/entregável/);
    await saveScopeDraft(fx.caio, p.id, { objective: "Objetivo", deliverables: [{ title: "Importação", estimateMinutes: 600 }] });
    const t = await createTask(fx.caio, { parentId: p.id, name: "Planejada", assigneeIds: [fx.caio.id] });
    await expect(confirmScope(fx.caio, p.id)).rejects.toThrow(/Marttini, Richard e Luiz/);
    await confirmScope(fx.richard, p.id);
    const after = await item(p.id);
    expect(after.scopeStatus).toBe("confirmado");
    expect(after.syncStatus).toBe("pendente");
    const versions = await getVersions(p.id);
    const v1 = versions.find((v) => v.version === 1)!;
    expect(v1.confirmedBy).toBe(fx.richard.id);
    expect(v1.confirmedAt).not.toBeNull();
    expect(v1.estimateMinutes).toBe(600);
    expect(await queued("item", p.id)).toHaveLength(1);
    expect(await queued("item", t.id)).toHaveLength(1);
    await expect(saveScopeDraft(fx.caio, p.id, { deliverables: [{ title: "X" }] })).rejects.toThrow(/congelado/);
    await expect(confirmScope(fx.marttini, p.id)).rejects.toThrow(/já foi confirmado/);
  });

  it("nova versão exige motivo e incorpora demanda adicional", async () => {
    const { p, ds } = await confirmedProject();
    const dem = await createTask(fx.helena, {
      parentId: p.id,
      name: "Exportar divergências",
      assigneeIds: [fx.helena.id],
      outOfScope: true,
      requestedByContactId: fx.carla.id,
      requestedAt: TODAY,
      requestChannel: "Reunião",
    });
    const deliverables = [...ds.map((d) => ({ id: d.id, title: d.title, estimateMinutes: d.estimateMinutes })), { title: "Exportação de divergências", estimateMinutes: 600 }];
    await expect(newScopeVersion(fx.richard, p.id, { reason: "", deliverables })).rejects.toThrow(/motivo/);
    await expect(newScopeVersion(fx.caio, p.id, { reason: "Aditivo", deliverables })).rejects.toThrow(/gestão/);
    const v2 = await newScopeVersion(fx.richard, p.id, { reason: "Aditivo assinado", deliverables, incorporate: [{ taskId: dem.id, deliverableNumber: 3 }] });
    expect(v2.version).toBe(2);
    expect(v2.estimateMinutes).toBe(40 * 60 + 30 * 60 + 600);
    const d = await item(dem.id);
    expect(d.outOfScope).toBe(false);
    const v2ds = await getDeliverables([v2.id]);
    expect(d.deliverableId).toBe(v2ds[2].id);
    expect((await getVersions(p.id)).map((v) => v.version)).toEqual([0, 1, 2]);
  });
});

describe("demandas adicionais (US-24, US-27)", () => {
  async function demand() {
    const { p, ds } = await confirmedProject();
    const d = await createTask(fx.helena, {
      parentId: p.id,
      name: "Relatório de comissões",
      assigneeIds: [fx.helena.id],
      outOfScope: true,
      requestedByContactId: fx.carla.id,
      requestedAt: TODAY,
      requestChannel: "WhatsApp",
    });
    return { p, ds, d };
  }

  it("projeto confirmado pergunta o entregável; sem ele exige origem", async () => {
    const { p } = await confirmedProject();
    await expect(createTask(fx.caio, { parentId: p.id, name: "X", assigneeIds: [fx.caio.id] })).rejects.toThrow(/entregável/);
    await expect(createTask(fx.caio, { parentId: p.id, name: "X", assigneeIds: [fx.caio.id], outOfScope: true })).rejects.toThrow(/quem pediu/);
  });

  it("nasce aguardando, visível e marcada Fora do escopo, avisa o cliente e bloqueia apontamento", async () => {
    const { d } = await demand();
    expect(d.outOfScope).toBe(true);
    expect(d.clientApproval).toBe("aguardando");
    expect(d.visibleToClient).toBe(true);
    expect(d.requestChannel).toBe("WhatsApp");
    const tags = await db.select().from(s.itemTags).where(eq(s.itemTags.itemId, d.id));
    expect(tags.map((t) => t.tagId)).toContain(fx.T["Fora do escopo"].id);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.contactId, fx.carla.id));
    expect(notes.map((n) => n.event)).toEqual(["demanda_aguardando_cliente"]);
    const err = await createEntry(fx.helena, { itemId: d.id, date: TODAY, minutes: 60, description: "Fiz", typeId: fx.faturavel.id }).catch((e) => e);
    expect(err).toBeInstanceOf(EntryError);
    expect(err.message).toMatch(/aguardando aprovação do cliente/);
  });

  it("aprovação externa exige anexo; com o print libera o apontamento e avisa o responsável", async () => {
    const { d } = await demand();
    await expect(registerExternalApproval(fx.caio, d.id, null)).rejects.toThrow(/print/);
    const print = new File([new Uint8Array([137, 80, 78, 71])], "aprovacao-whatsapp.png", { type: "image/png" });
    await registerExternalApproval(fx.caio, d.id, print, "Carla aprovou no WhatsApp");
    const after = await item(d.id);
    expect(after.clientApproval).toBe("aprovada");
    expect(after.clientApprovalRegisteredBy).toBe(fx.caio.id);
    const [att] = await db.select().from(s.attachments).where(and(eq(s.attachments.ownerType, "approval"), eq(s.attachments.ownerId, d.id)));
    expect(att.internal).toBe(true);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.helena.id));
    expect(notes.map((n) => n.event)).toEqual(["demanda_decidida"]);
    const e = await createEntry(fx.helena, { itemId: d.id, date: TODAY, minutes: 60, description: "Fiz", typeId: fx.faturavel.id });
    expect(e.minutes).toBe(60);
    await expect(registerExternalApproval(fx.caio, d.id, print)).rejects.toThrow(/já foi decidida/);
  });

  it("só a gestão reclassifica, com motivo", async () => {
    const { d, ds } = await demand();
    await expect(reclassifyDemand(fx.caio, d.id, { outOfScope: false, deliverableId: ds[0].id, reason: "Era do E1" })).rejects.toThrow(/gestão/);
    await expect(reclassifyDemand(fx.richard, d.id, { outOfScope: false, deliverableId: ds[0].id, reason: "" })).rejects.toThrow(/motivo/);
    await reclassifyDemand(fx.richard, d.id, { outOfScope: false, deliverableId: ds[0].id, reason: "Faz parte da importação (E1)" });
    const after = await item(d.id);
    expect(after.outOfScope).toBe(false);
    expect(after.clientApproval).toBe("nao_se_aplica");
    expect(after.deliverableId).toBe(ds[0].id);
    const log = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, d.id), eq(s.auditLog.action, "reclassificar")));
    expect(log).toHaveLength(1);
    expect((log[0].after as { reason: string }).reason).toMatch(/E1/);
  });
});

describe("comentários (US-40, US-41)", () => {
  it("menção avisa a pessoa; editar marca editado; só o próprio autor", async () => {
    const { p } = await confirmedProject();
    expect(parseMentions("@helena olha isso e @Júlia Prado também", [fx.helena, fx.julia, fx.caio])).toEqual([fx.helena.id, fx.julia.id]);
    const c = await addComment(fx.caio, p.id, { channel: "interno", body: "@Helena o erro vem do campo de filial" });
    expect(c.mentions).toEqual([fx.helena.id]);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.helena.id));
    expect(notes.map((n) => n.event)).toEqual(["mencao"]);
    await expect(editComment(fx.helena, c.id, "outro texto")).rejects.toThrow(/próprios/);
    const ed = await editComment(fx.caio, c.id, "@Helena o erro vem do campo filial vazio");
    expect(ed.editedAt).not.toBeNull();
    await expect(deleteComment(fx.helena, c.id)).rejects.toThrow(/próprios/);
    await deleteComment(fx.caio, c.id);
  });

  it("canal Cliente exige item visível e confirmação; responder marca o comentário do cliente como respondido", async () => {
    const { p } = await confirmedProject();
    await expect(addComment(fx.caio, p.id, { channel: "cliente", body: "Oi", confirmClient: true })).rejects.toThrow(/interno/);
    await setVisibility(fx.caio, p.id, true);
    const [cli] = await db
      .insert(s.comments)
      .values({ itemId: p.id, channel: "cliente", authorContactId: fx.carla.id, body: "Conseguem olhar o erro hoje?" })
      .returning();
    await expect(addComment(fx.caio, p.id, { channel: "cliente", body: "Vamos olhar" })).rejects.toThrow(/será visto pelo cliente/);
    // comentário interno não responde o cliente
    await addComment(fx.caio, p.id, { channel: "interno", body: "Quem pega?" });
    expect((await db.select().from(s.comments).where(eq(s.comments.id, cli.id)))[0].answeredAt).toBeNull();
    await addComment(fx.caio, p.id, { channel: "cliente", body: "Carla, já estamos olhando.", confirmClient: true });
    expect((await db.select().from(s.comments).where(eq(s.comments.id, cli.id)))[0].answeredAt).not.toBeNull();
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.contactId, fx.carla.id));
    expect(notes.map((n) => n.event)).toEqual(["resposta_sintese"]);
  });
});
