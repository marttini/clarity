/**
 * Portal do cliente (US-19, US-23, US-25, US-27, US-41, US-42, avaliações, convites).
 * Prova o isolamento entre clientes e que nada interno chega ao cliente.
 * Banco: TEST_DATABASE_URL (padrão clarity_test), migrado e limpo antes de cada caso.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test";
  process.env.CLARITY_NOW = "2026-10-08T13:00:00-03:00";
  process.env.NOTIFY_MODE = "dry-run";
});

import { migrateTestDb, truncateAll } from "./db";
import { and, eq } from "drizzle-orm";
import { db, pg, schema as s } from "@/db";
import type { ClientUser } from "@/server/session";
import {
  attachmentForDownload,
  decideDemand,
  evaluate,
  getVisibleItem,
  hoursByItem,
  inviteColleagues,
  itemThread,
  listDemands,
  myEvaluations,
  pendingEvaluations,
  portalFiles,
  postComment,
  visibleItems,
  confirmedScope,
  PortalError,
} from "@/server/services/portal";
import { createEntry, EntryError } from "@/server/services/entries";

type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;

const old = new Date("2026-09-01T12:00:00Z");

async function fixture() {
  const [faturavel, bonificado, interno, provisionamento] = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 },
      { code: "bonificado", name: "Bonificado", builtin: true, sort: 2 },
      { code: "interno", name: "Interno", isInternal: true, builtin: true, sort: 3 },
      { code: "provisionamento", name: "Provisionamento", isProvisioning: true, builtin: true, sort: 4 },
    ])
    .returning();
  const [admin, gestor, caio] = await db
    .insert(s.people)
    .values([
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false, slackUserId: "U0MARTTINI", createdAt: old },
      { name: "Richard", email: "richard@sintesebrasil.com", role: "gestor", isConsultor: true, createdAt: old },
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor", slackUserId: "U0CAIO", createdAt: old },
    ])
    .returning();
  const [kari, brava, sintese] = await db
    .insert(s.clients)
    .values([
      { name: "Kari-Kari", color: "#F59A6B", internalNotes: "NOTA INTERNA KARI" },
      { name: "Brava", color: "#A897F5" },
      { name: "Síntese", isInternal: true },
    ])
    .returning();
  const [carla, rogerio, marcos, paula] = await db
    .insert(s.clientContacts)
    .values([
      { clientId: kari.id, name: "Carla Mendes", email: "carla@kari.com.br", portalAccess: true },
      { clientId: kari.id, name: "Rogério Alves", email: "rogerio@kari.com.br" },
      { clientId: kari.id, name: "Marcos Lima", email: "marcos@kari.com.br", portalAccess: true },
      { clientId: brava.id, name: "Paula Brandão", email: "paula@brava.com.br", portalAccess: true },
    ])
    .returning();
  const [kAnnual, bAnnual, sAnnual] = await db
    .insert(s.annualProjects)
    .values([
      { clientId: kari.id, name: "Kari 2026", year: 2026 },
      { clientId: brava.id, name: "Brava 2026", year: 2026 },
      { clientId: sintese.id, name: "Síntese 2026", year: 2026 },
    ])
    .returning();
  const mk = async (v: Partial<typeof s.items.$inferInsert> & { annualProjectId: string; name: string; kind: "projeto" | "tarefa" }) =>
    (await db.insert(s.items).values({ stage: "andamento", createdAt: old, updatedAt: old, ...v }).returning())[0];
  const kProj = await mk({ annualProjectId: kAnnual.id, kind: "projeto", name: "Integração Broker", visibleToClient: true, deadline: "2026-11-30" });
  const kTask = await mk({ annualProjectId: kAnnual.id, kind: "tarefa", parentId: kProj.id, name: "Regras de distribuição", visibleToClient: true });
  const kHidden = await mk({ annualProjectId: kAnnual.id, kind: "tarefa", parentId: kProj.id, name: "Ajuste interno secreto", visibleToClient: false });
  const kDone = await mk({ annualProjectId: kAnnual.id, kind: "tarefa", parentId: kProj.id, name: "Importação diária", visibleToClient: true, stage: "concluido", completedAt: new Date("2026-09-30T15:00:00Z") });
  const kDemand = await mk({
    annualProjectId: kAnnual.id,
    kind: "tarefa",
    parentId: kProj.id,
    name: "Exportar divergências",
    visibleToClient: true,
    outOfScope: true,
    clientApproval: "aguardando",
    requestedByContactId: rogerio.id,
    requestedAt: "2026-10-05",
    stage: "analise",
  });
  const kDraft = await mk({ annualProjectId: kAnnual.id, kind: "projeto", name: "Projeto em rascunho", visibleToClient: true, scopeStatus: "rascunho", stage: "analise" });
  const bProj = await mk({ annualProjectId: bAnnual.id, kind: "projeto", name: "Projeto Brava", visibleToClient: true });
  const sTask = await mk({ annualProjectId: sAnnual.id, kind: "tarefa", name: "Interno Síntese", visibleToClient: true });
  for (const it of [kProj, kTask, kHidden, kDone, kDemand, bProj]) await db.insert(s.itemAssignees).values({ itemId: it.id, personId: caio.id });

  // Horas: Faturável, Bonificado, Provisionamento (futuro) e um Faturável em tarefa invisível.
  await db.insert(s.timeEntries).values([
    { personId: caio.id, itemId: kTask.id, date: "2026-10-06", minutes: 120, description: "a", typeId: faturavel.id },
    { personId: caio.id, itemId: kTask.id, date: "2026-10-07", minutes: 30, description: "b", typeId: bonificado.id },
    { personId: caio.id, itemId: kTask.id, date: "2026-10-20", minutes: 480, description: "c", typeId: provisionamento.id },
    { personId: caio.id, itemId: kHidden.id, date: "2026-10-07", minutes: 600, description: "d", typeId: faturavel.id },
    { personId: caio.id, itemId: sTask.id, date: "2026-10-07", minutes: 60, description: "e", typeId: interno.id },
    { personId: caio.id, itemId: bProj.id, date: "2026-10-07", minutes: 240, description: "f", typeId: faturavel.id },
  ]);
  // Comentários: canal Interno nunca aparece.
  await db.insert(s.comments).values([
    { itemId: kTask.id, channel: "interno", authorPersonId: caio.id, body: "COMENTÁRIO INTERNO" },
    { itemId: kTask.id, channel: "cliente", authorPersonId: caio.id, body: "Olá Carla, seguimos." },
    { itemId: kTask.id, channel: "cliente", authorContactId: carla.id, body: "Obrigada!" },
  ]);
  await db.insert(s.attachments).values([
    { ownerType: "item", ownerId: kTask.id, filename: "publico.pdf", storagePath: "x/publico.pdf", sizeBytes: 10, mime: "application/pdf" },
    { ownerType: "item", ownerId: kTask.id, filename: "interno.pdf", storagePath: "x/interno.pdf", sizeBytes: 10, mime: "application/pdf", internal: true },
    { ownerType: "item", ownerId: kHidden.id, filename: "oculto.pdf", storagePath: "x/oculto.pdf", sizeBytes: 10, mime: "application/pdf" },
    { ownerType: "item", ownerId: bProj.id, filename: "brava.pdf", storagePath: "x/brava.pdf", sizeBytes: 10, mime: "application/pdf" },
    { ownerType: "justification", ownerId: caio.id, filename: "atestado.pdf", storagePath: "x/atestado.pdf", sizeBytes: 10, mime: "application/pdf", internal: true },
  ]);
  // Avaliação de outro contato (Marcos) não pode aparecer para a Carla.
  await db.insert(s.evaluations).values({ clientId: kari.id, itemId: kDone.id, contactId: marcos.id, scoreResult: 2, scoreConsultant: 2, scoreTeam: 2, comment: "AVALIAÇÃO DO MARCOS" });

  const asContact = (c: typeof carla, client: typeof kari): ClientUser => ({ ...c, clientName: client.name });
  return {
    faturavel,
    bonificado,
    interno,
    provisionamento,
    admin,
    gestor,
    caio,
    kari,
    brava,
    carla: asContact(carla, kari),
    paula: asContact(paula, brava),
    rogerio,
    marcos,
    kProj,
    kTask,
    kHidden,
    kDone,
    kDemand,
    kDraft,
    bProj,
    sTask,
  };
}

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

describe("isolamento entre clientes", () => {
  it("o contato só vê itens visíveis da própria empresa, sem rascunho", async () => {
    const ids = (await visibleItems(fx.carla)).map((i) => i.id).sort();
    expect(ids).toEqual([fx.kProj.id, fx.kTask.id, fx.kDone.id, fx.kDemand.id].sort());
    const brava = (await visibleItems(fx.paula)).map((i) => i.id);
    expect(brava).toEqual([fx.bProj.id]);
  });

  it("item de outro cliente, invisível ou do projeto interno é 'não encontrado'", async () => {
    for (const id of [fx.bProj.id, fx.kHidden.id, fx.kDraft.id, fx.sTask.id, "nao-e-uuid"]) await expect(getVisibleItem(fx.carla, id)).rejects.toBeInstanceOf(PortalError);
    await expect(postComment(fx.carla, fx.bProj.id, "oi")).rejects.toBeInstanceOf(PortalError);
    await expect(postComment(fx.carla, fx.kHidden.id, "oi")).rejects.toBeInstanceOf(PortalError);
    await expect(decideDemand(fx.paula, fx.kDemand.id, true)).rejects.toBeInstanceOf(PortalError);
    await expect(evaluate(fx.paula, { itemId: fx.kDone.id, result: 5, consultant: 5, team: 5 })).rejects.toBeInstanceOf(PortalError);
    await expect(itemThread(fx.paula, fx.kTask.id)).rejects.toBeInstanceOf(PortalError);
    await expect(confirmedScope(fx.paula, fx.kProj.id)).rejects.toBeInstanceOf(PortalError);
  });

  it("horas: só Faturável e Bonificado de itens visíveis; nunca Provisionamento, Interno ou item oculto", async () => {
    const rows = await hoursByItem(fx.carla, "2026-10-08");
    expect(rows).toEqual([{ itemId: fx.kTask.id, faturavel: 120, bonificado: 30 }]);
    const brava = await hoursByItem(fx.paula, "2026-10-08");
    expect(brava).toEqual([{ itemId: fx.bProj.id, faturavel: 240, bonificado: 0 }]);
  });

  it("mensagens: canal Interno e anexos internos nunca aparecem", async () => {
    const t = await itemThread(fx.carla, fx.kTask.id);
    const text = JSON.stringify(t);
    expect(text).not.toContain("COMENTÁRIO INTERNO");
    expect(text).not.toContain("interno.pdf");
    expect(t.filter((x) => x.kind === "comment")).toHaveLength(2);
    expect(t.find((x) => x.kind === "file")).toMatchObject({ filename: "publico.pdf" });
  });

  it("arquivos: só anexos não internos de itens visíveis do próprio cliente", async () => {
    const files = (await portalFiles(fx.carla)).map((f) => f.filename);
    expect(files).toEqual(["publico.pdf"]);
    const all = await db.select().from(s.attachments);
    const by = (n: string) => all.find((a) => a.filename === n)!.id;
    expect(await attachmentForDownload(fx.carla, by("publico.pdf"))).not.toBeNull();
    for (const n of ["interno.pdf", "oculto.pdf", "brava.pdf", "atestado.pdf"]) expect(await attachmentForDownload(fx.carla, by(n))).toBeNull();
  });

  it("avaliações de outros contatos nunca aparecem", async () => {
    expect(await myEvaluations(fx.carla)).toEqual([]);
    const pend = await pendingEvaluations(fx.carla);
    expect(pend.map((p) => p.id)).toEqual([fx.kDone.id]);
  });

  it("demandas: lista só as do cliente, com quem pediu", async () => {
    const d = await listDemands(fx.carla);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: fx.kDemand.id, status: "aguardando", requestedBy: "Rogério Alves", project: "Integração Broker" });
    expect(await listDemands(fx.paula)).toEqual([]);
  });
});

describe("demanda adicional (US-27)", () => {
  it("aprovar pelo portal registra quem e quando e libera o apontamento", async () => {
    const input = { itemId: fx.kDemand.id, date: "2026-10-08", minutes: 60, description: "Planilha", typeId: fx.faturavel.id };
    await expect(createEntry(fx.caio, input)).rejects.toBeInstanceOf(EntryError);
    await decideDemand(fx.carla, fx.kDemand.id, true);
    const [it] = await db.select().from(s.items).where(eq(s.items.id, fx.kDemand.id));
    expect(it.clientApproval).toBe("aprovada");
    expect(it.clientApprovalByContactId).toBe(fx.carla.id);
    expect(it.clientApprovalAt?.toISOString()).toBe(new Date("2026-10-08T16:00:00Z").toISOString());
    const e = await createEntry(fx.caio, input);
    expect(e.minutes).toBe(60);
    const n = await db.select().from(s.notifications).where(and(eq(s.notifications.personId, fx.caio.id), eq(s.notifications.event, "demanda_decidida")));
    expect(n).toHaveLength(1);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, fx.kDemand.id));
    expect(audits.some((a) => a.actorContactId === fx.carla.id && a.action === "cliente_aprovar")).toBe(true);
    await expect(decideDemand(fx.carla, fx.kDemand.id, false, "mudei de ideia")).rejects.toThrow("já foi decidida");
  });

  it("recusar exige motivo e mantém o apontamento bloqueado", async () => {
    await expect(decideDemand(fx.carla, fx.kDemand.id, false, "  ")).rejects.toThrow("motivo");
    await decideDemand(fx.carla, fx.kDemand.id, false, "Fica para 2027");
    const [it] = await db.select().from(s.items).where(eq(s.items.id, fx.kDemand.id));
    expect(it.clientApproval).toBe("recusada");
    expect(it.clientApprovalReason).toBe("Fica para 2027");
    await expect(createEntry(fx.caio, { itemId: fx.kDemand.id, date: "2026-10-08", minutes: 60, description: "x", typeId: fx.faturavel.id })).rejects.toThrow("recusou");
  });
});

describe("mensagens e arquivos do cliente (US-41, US-42)", () => {
  it("comentário vai para o canal Cliente e avisa os responsáveis", async () => {
    await postComment(fx.carla, fx.kTask.id, "O arquivo chegou?");
    const cs = await db.select().from(s.comments).where(eq(s.comments.body, "O arquivo chegou?"));
    expect(cs[0]).toMatchObject({ channel: "cliente", authorContactId: fx.carla.id, itemId: fx.kTask.id });
    const n = await db.select().from(s.notifications).where(eq(s.notifications.event, "comentario_cliente"));
    expect(n.map((x) => x.personId)).toEqual([fx.caio.id]);
    const ob = await db.select().from(s.outbox);
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({ channel: "slack_dm", target: "U0CAIO" });
  });

  it("anexo no comentário: executável bloqueado, limite de 25 MB", async () => {
    const exe = new File([new Uint8Array([1, 2, 3])], "virus.exe", { type: "application/octet-stream" });
    await expect(postComment(fx.carla, fx.kTask.id, "veja", exe)).rejects.toThrow("executáveis");
    const big = { name: "grande.pdf", size: 26 * 1024 * 1024, type: "application/pdf", arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
    await expect(postComment(fx.carla, fx.kTask.id, "veja", big)).rejects.toThrow("25 MB");
    const ok = new File([new TextEncoder().encode("print do erro")], "print.png", { type: "image/png" });
    await postComment(fx.carla, fx.kTask.id, "segue o print", ok);
    const atts = await db.select().from(s.attachments).where(eq(s.attachments.filename, "print.png"));
    expect(atts[0]).toMatchObject({ ownerType: "item", ownerId: fx.kTask.id, internal: false, uploadedByContactId: fx.carla.id });
  });
});

describe("avaliação", () => {
  it("nasce oculta e avisa a gestão", async () => {
    const ev = await evaluate(fx.carla, { itemId: fx.kDone.id, result: 5, consultant: 4, team: 5, comment: "Ótimo" });
    expect(ev.published).toBe(false);
    expect(ev.consultantId).toBe(fx.caio.id);
    const n = await db.select().from(s.notifications).where(eq(s.notifications.event, "avaliacao_recebida"));
    expect(n.map((x) => x.personId).sort()).toEqual([fx.admin.id, fx.gestor.id].sort());
    await expect(evaluate(fx.carla, { itemId: fx.kDone.id, result: 5, consultant: 5, team: 5 })).rejects.toThrow("já avaliou");
    await expect(evaluate(fx.carla, { itemId: fx.kTask.id, result: 5, consultant: 5, team: 5 })).rejects.toThrow("concluída");
    await expect(evaluate(fx.marcos as unknown as ClientUser, { itemId: fx.kDone.id, result: 0, consultant: 5, team: 5 })).rejects.toThrow();
  });
});

describe("convidar colegas", () => {
  it("só convida contatos que já existem neste cliente", async () => {
    const r = await inviteColleagues(fx.carla, "rogerio@kari.com.br, novo@kari.com.br; paula@brava.com.br marcos@kari.com.br xx");
    const by = Object.fromEntries(r.map((x) => [x.email, x.status]));
    expect(by).toEqual({
      "rogerio@kari.com.br": "convidado",
      "novo@kari.com.br": "nao_cadastrado",
      "paula@brava.com.br": "nao_cadastrado",
      "marcos@kari.com.br": "ja_tem_acesso",
      xx: "invalido",
    });
    const [rog] = await db.select().from(s.clientContacts).where(eq(s.clientContacts.id, fx.rogerio.id));
    expect(rog.portalAccess).toBe(true);
    const ob = await db.select().from(s.outbox).where(eq(s.outbox.channel, "email"));
    expect(ob.map((o) => o.target)).toEqual(["rogerio@kari.com.br"]);
  });
});
