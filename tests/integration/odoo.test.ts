/**
 * Integração com o Odoo contra o Odoo falso (US-05, US-21, US-28, US-31, US-32).
 * Banco: clarity_test (migrado e limpo antes de cada caso).
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
import { FakeOdoo, seedFakeFromDb } from "@/server/odoo/fake";
import { HttpOdooClient, OdooError, setOdoo, toOdooDatetime } from "@/server/odoo/client";
import { processQueue, MAX_ATTEMPTS, backoffMinutes } from "@/server/odoo/push";
import { pullFromOdoo } from "@/server/odoo/pull";
import { enqueueSync } from "@/server/sync/enqueue";
import { createEntry, deleteEntry, updateEntry } from "@/server/services/entries";
import { odooErrorFromResponse } from "@/server/odoo/client";

const TODAY = "2026-10-08";
const F = { type: "x_studio_tipo_de_apontamento", sust: "x_studio_sustentacao", cid: "x_studio_id_clarity", consultor: "x_studio_consultor" };

type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;
let fake: FakeOdoo;

async function fixture() {
  const [faturavel, bonificado] = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 },
      { code: "bonificado", name: "Bonificado", builtin: true, sort: 2 },
    ])
    .returning();
  const tags = await db
    .insert(s.tags)
    .values([
      { name: "Projeto", system: true, odooTagId: 101 },
      { name: "Tarefa", system: true, odooTagId: 102 },
      { name: "Fora do escopo", system: true, odooTagId: 103 },
      { name: "Crítico", odooTagId: 107 },
    ])
    .returning();
  const T = Object.fromEntries(tags.map((t) => [t.name, t]));
  const [admin, caio] = await db
    .insert(s.people)
    .values([
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false, odooEmployeeId: 1001, odooUserId: 2001, slackUserId: "U-MARTTINI" },
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor", odooEmployeeId: 1006, odooUserId: 2006 },
    ])
    .returning();
  const [kari] = await db.insert(s.clients).values({ name: "Kari-Kari Alimentos", odooPartnerId: 500, city: "Goiânia", state: "GO", color: "#F59A6B" }).returning();
  const [annual] = await db.insert(s.annualProjects).values({ clientId: kari.id, name: "Kari-Kari Alimentos 2026", year: 2026, odooProjectId: 300 }).returning();
  const old = new Date("2026-09-01T12:00:00Z");
  const [task] = await db
    .insert(s.items)
    .values({
      annualProjectId: annual.id,
      kind: "tarefa",
      name: "Sustentação mensal",
      stage: "andamento",
      startDate: "2026-09-01",
      deadline: "2026-10-30",
      isSustentacao: true,
      odooTaskId: 9000,
      syncStatus: "enviado",
      createdAt: old,
      updatedAt: old,
    })
    .returning();
  await db.insert(s.itemAssignees).values({ itemId: task.id, personId: caio.id });
  await db.insert(s.itemTags).values({ itemId: task.id, tagId: T.Tarefa.id });
  const [so] = await db.insert(s.salesOrderLines).values({ clientId: kari.id, odooSoLineId: 4000, orderName: "S01200", lineName: "Banco de horas" }).returning();
  return { faturavel, bonificado, T, admin, caio, kari, annual, task, so };
}

beforeAll(async () => {
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
  fx = await fixture();
  fake = new FakeOdoo();
  await seedFakeFromDb(fake);
  setOdoo(fake);
});

afterAll(async () => {
  setOdoo(null);
  await pg.end();
});

const entryInput = (over: Partial<Parameters<typeof createEntry>[1]> = {}) => ({
  itemId: fx.task.id,
  date: TODAY,
  minutes: 90,
  description: "Ajuste na rotina de importação",
  typeId: fx.faturavel.id,
  salesOrderLineId: fx.so.id,
  ...over,
});

const linesOf = (clarityId: string) => fake.all("account.analytic.line").filter((l) => l[F.cid] === clarityId);
const queueOf = async (entityId: string) => db.select().from(s.syncQueue).where(eq(s.syncQueue.entityId, entityId));
const entry = async (id: string) => (await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, id)))[0];
const item = async (id: string) => (await db.select().from(s.items).where(eq(s.items.id, id)))[0];

describe("fake Odoo", () => {
  it("espelha os ids do banco e responde como o JSON-2", async () => {
    const [t] = await fake.searchRead("project.task", [["id", "=", 9000]], ["name", "project_id", "user_ids", "stage_id", "tag_ids", F.sust, F.cid]);
    expect(t.project_id).toEqual([300, "Kari-Kari Alimentos 2026"]);
    expect(t.user_ids).toEqual([2006]);
    expect(t.stage_id).toEqual([expect.any(Number), "Em andamento"]);
    expect(t.tag_ids).toEqual([102]);
    expect(t[F.cid]).toBe(fx.task.id);
    // domínio com '|' e caminho relacional
    const r = await fake.searchRead("project.project", ["|", ["tag_ids.name", "=", "Novo modelo"], ["id", "=", -1]], ["id"]);
    expect(r.map((x) => x.id)).toEqual([300]);
    // arquivados somem por padrão
    await fake.write("project.task", [9000], { active: false });
    expect(await fake.searchRead("project.task", [["id", "=", 9000]], ["id"])).toHaveLength(0);
    expect(await fake.searchRead("project.task", [["id", "=", 9000]], ["id"], { context: { active_test: false } })).toHaveLength(1);
    // campo inexistente vira erro em português
    await expect(fake.searchRead("project.task", [], ["nao_existe"])).rejects.toThrow(/campo "nao_existe" não existe/);
  });

  it("traduz erros comuns do Odoo para português", () => {
    expect(odooErrorFromResponse(401, { name: "werkzeug.exceptions.Unauthorized", message: "Invalid apikey" }).message).toMatch(/chave de acesso/);
    expect(odooErrorFromResponse(404, { name: "odoo.exceptions.MissingError", message: "Record does not exist or has been deleted." }).kind).toBe("missing");
    expect(odooErrorFromResponse(422, { name: "odoo.exceptions.ValidationError", message: "Valor inválido" }).message).toMatch(/recusou os dados: Valor inválido/);
    expect(odooErrorFromResponse(503, "<html>maintenance</html>").kind).toBe("down");
    const e = odooErrorFromResponse(500, { name: "x", message: "boom" });
    expect(e).toBeInstanceOf(OdooError);
    expect(e.original).toContain("boom");
  });
});

describe("cliente HTTP JSON-2", () => {
  it("monta URL, cabeçalhos e argumentos nomeados; traduz erros", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const replies: [number, unknown][] = [
      [200, [{ id: 1, name: "X" }]],
      [200, [77]],
      [200, true],
      [200, true],
      [401, { name: "werkzeug.exceptions.Unauthorized", message: "Invalid apikey" }],
    ];
    const fetchMock = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      const [status, body] = replies.shift()!;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    const c = new HttpOdooClient({ url: "https://sintese.odoo.com/", apiKey: "k123", db: "sintese-main", fetch: fetchMock });
    await c.searchRead("project.task", [["id", "=", 1]], ["name"], { limit: 5, order: "id desc", context: { active_test: false } });
    expect(await c.create("account.analytic.line", { name: "a" })).toBe(77);
    await c.write("project.task", [1], { active: false });
    await c.unlink("account.analytic.line", [77]);
    expect(seen.map((x) => x.url)).toEqual([
      "https://sintese.odoo.com/json/2/project.task/search_read",
      "https://sintese.odoo.com/json/2/account.analytic.line/create",
      "https://sintese.odoo.com/json/2/project.task/write",
      "https://sintese.odoo.com/json/2/account.analytic.line/unlink",
    ]);
    const h = seen[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("bearer k123");
    expect(h["X-Odoo-Database"]).toBe("sintese-main");
    expect(h["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ domain: [["id", "=", 1]], fields: ["name"], limit: 5, order: "id desc", context: { active_test: false } });
    expect(JSON.parse(String(seen[1].init.body))).toEqual({ vals_list: [{ name: "a" }] });
    expect(JSON.parse(String(seen[2].init.body))).toEqual({ ids: [1], vals: { active: false } });
    expect(JSON.parse(String(seen[3].init.body))).toEqual({ ids: [77] });
    await expect(c.searchRead("res.partner", [], ["id"])).rejects.toMatchObject({ kind: "auth", status: 401 });
    const down = new HttpOdooClient({ url: "https://x", apiKey: "k", fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    await expect(down.searchRead("res.partner", [], ["id"])).rejects.toMatchObject({ kind: "down" });
  });
});

describe("envio de apontamentos (US-05)", () => {
  it("cria o apontamento no Odoo com os campos certos", async () => {
    const e = await createEntry(fx.caio, entryInput({ isSustentacao: true }));
    const sum = await processQueue();
    expect(sum).toMatchObject({ claimed: 1, sent: 1, failed: 0 });

    const lines = linesOf(e.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      employee_id: 1006,
      project_id: 300,
      task_id: 9000,
      date: TODAY,
      unit_amount: 1.5,
      name: "Ajuste na rotina de importação",
      so_line: 4000,
      [F.type]: "faturavel",
      [F.sust]: true,
      [F.cid]: e.id,
    });
    const after = await entry(e.id);
    expect(after.syncStatus).toBe("enviado");
    expect(after.syncError).toBeNull();
    expect(after.odooLineId).toBe(lines[0].id);
    expect((await queueOf(e.id))[0].status).toBe("feito");
    const logs = await db.select().from(s.syncLog).where(eq(s.syncLog.odooId, lines[0].id));
    expect(logs[0].direction).toBe("out");
  });

  it("reenvio não duplica (procura pelo ID Clarity) e edição atualiza a mesma linha", async () => {
    const e = await createEntry(fx.caio, entryInput());
    await processQueue();
    const lineId = (await entry(e.id)).odooLineId!;

    // Simula queda depois de criar no Odoo e antes de gravar o id no Clarity
    await db.update(s.timeEntries).set({ odooLineId: null }).where(eq(s.timeEntries.id, e.id));
    await enqueueSync(db, "time_entry", e.id, "upsert");
    await processQueue();
    expect(linesOf(e.id)).toHaveLength(1);
    expect((await entry(e.id)).odooLineId).toBe(lineId);

    await updateEntry(fx.caio, e.id, entryInput({ minutes: 120 }));
    await processQueue();
    expect(linesOf(e.id)).toHaveLength(1);
    expect(fake.get("account.analytic.line", lineId)!.unit_amount).toBe(2);
    expect(fake.calls.filter((c) => c.model === "account.analytic.line" && c.method === "create")).toHaveLength(1);
  });

  it("Odoo fora do ar: guarda, reagenda com espera e envia depois", async () => {
    const e = await createEntry(fx.caio, entryInput());
    fake.failNext(1, "down");
    const t0 = new Date();
    const first = await processQueue({ now: t0 });
    expect(first).toMatchObject({ claimed: 1, retrying: 1, sent: 0 });
    const [q] = await queueOf(e.id);
    expect(q.status).toBe("pendente");
    expect(q.attempts).toBe(1);
    expect(q.nextAttemptAt.getTime()).toBe(t0.getTime() + backoffMinutes(1) * 60_000);
    const pend = await entry(e.id);
    expect(pend.syncStatus).toBe("pendente");
    expect(pend.syncError).toMatch(/fora do ar/);
    expect(linesOf(e.id)).toHaveLength(0);

    // antes da hora, nada acontece
    expect((await processQueue({ now: new Date(t0.getTime() + 30_000) })).claimed).toBe(0);
    // depois da espera, envia
    const second = await processQueue({ now: new Date(t0.getTime() + 61_000) });
    expect(second.sent).toBe(1);
    expect(linesOf(e.id)).toHaveLength(1);
    expect((await entry(e.id)).syncStatus).toBe("enviado");
    expect((await entry(e.id)).syncError).toBeNull();
  });

  it(`depois de ${MAX_ATTEMPTS} tentativas vira erro e avisa o guardião técnico na hora`, async () => {
    const e = await createEntry(fx.caio, entryInput());
    fake.failNext(MAX_ATTEMPTS, "down");
    let t = Date.now();
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await processQueue({ now: new Date(t) });
      t += backoffMinutes(i) * 60_000;
    }
    const [q] = await queueOf(e.id);
    expect(q.status).toBe("erro");
    expect(q.attempts).toBe(MAX_ATTEMPTS);
    const after = await entry(e.id);
    expect(after.syncStatus).toBe("erro");
    expect(after.syncError).toMatch(/fora do ar/);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.event, "erro_sincronizacao"));
    expect(notes).toHaveLength(1);
    expect(notes[0].personId).toBe(fx.admin.id);
    const out = await db.select().from(s.outbox).where(eq(s.outbox.notificationId, notes[0].id));
    expect(out[0].target).toBe("U-MARTTINI");
    expect((await db.select().from(s.syncLog).where(eq(s.syncLog.level, "error"))).length).toBe(1);
  });

  it("Odoo recusa os dados: erro na hora, com motivo em português", async () => {
    fake.touch("project.task", 9000, { active: false });
    const e = await createEntry(fx.caio, entryInput());
    const sum = await processQueue();
    expect(sum.failed).toBe(1);
    const after = await entry(e.id);
    expect(after.syncStatus).toBe("erro");
    expect(after.syncError).toMatch(/arquivad/);
  });

  it("tipo Bonificado nunca leva pedido de venda", async () => {
    // mesmo se um pedido de venda ficou gravado (dado antigo), o envio manda so_line = false
    const [e] = await db
      .insert(s.timeEntries)
      .values({ personId: fx.caio.id, itemId: fx.task.id, date: TODAY, minutes: 60, description: "Cortesia", typeId: fx.bonificado.id, salesOrderLineId: fx.so.id })
      .returning();
    await enqueueSync(db, "time_entry", e.id, "upsert");
    await processQueue();
    const [line] = linesOf(e.id);
    expect(line.so_line).toBe(false);
    expect(line[F.type]).toBe("bonificado");
    // e o serviço também não deixa gravar
    await expect(createEntry(fx.caio, entryInput({ typeId: fx.bonificado.id }))).rejects.toThrow(/não aceita pedido de venda/);
  });

  it("exclusão no Clarity apaga a linha no Odoo", async () => {
    const e = await createEntry(fx.caio, entryInput());
    await processQueue();
    const lineId = (await entry(e.id)).odooLineId!;
    await deleteEntry(fx.caio, e.id);
    await processQueue();
    expect(fake.get("account.analytic.line", lineId)).toBeUndefined();
    expect((await entry(e.id)).syncStatus).toBe("enviado");
    // reenviar a exclusão não quebra
    await enqueueSync(db, "time_entry", e.id, "delete");
    expect((await processQueue()).sent).toBe(1);
  });
});

describe("envio de projetos e tarefas (US-21)", () => {
  async function newItem(over: Partial<typeof s.items.$inferInsert> = {}) {
    const [it] = await db
      .insert(s.items)
      .values({ annualProjectId: fx.annual.id, kind: "projeto", name: "Integração Broker", stage: "alocacao", startDate: "2026-10-01", deadline: "2026-10-20", plannedMinutes: 120 * 60, description: "Integrar o broker.\n\nFase 1 & 2", ...over })
      .returning();
    return it;
  }

  it("cria tarefa com etapa, etiquetas, responsáveis e prazo em UTC; o apontamento espera a tarefa", async () => {
    const proj = await newItem();
    await db.insert(s.itemAssignees).values({ itemId: proj.id, personId: fx.caio.id });
    await db.insert(s.itemTags).values({ itemId: proj.id, tagId: fx.T["Crítico"].id });
    const child = await newItem({ kind: "tarefa", parentId: proj.id, name: "Mapeamento", outOfScope: true, clientApproval: "aprovada", plannedMinutes: null, description: null });
    // apontamento entra na fila antes das tarefas
    const [e] = await db.insert(s.timeEntries).values({ personId: fx.caio.id, itemId: child.id, date: TODAY, minutes: 30, description: "Levantamento", typeId: fx.faturavel.id }).returning();
    await enqueueSync(db, "time_entry", e.id, "upsert");
    await enqueueSync(db, "item", child.id, "upsert");
    await enqueueSync(db, "item", proj.id, "upsert");

    const t0 = new Date();
    const r1 = await processQueue({ now: t0 });
    // o filho espera o pai na mesma rodada; o apontamento espera o filho
    expect(r1.sent).toBe(1);
    expect(r1.deferred).toBe(2);
    await processQueue({ now: new Date(t0.getTime() + 61_000) });
    await processQueue({ now: new Date(t0.getTime() + 122_000) });

    const p = await item(proj.id);
    const c = await item(child.id);
    expect(p.syncStatus).toBe("enviado");
    expect(c.syncStatus).toBe("enviado");
    const tp = fake.get("project.task", p.odooTaskId!)!;
    const stage = fake.get("project.task.type", tp.stage_id as number)!;
    expect(stage.name).toBe("Alocação de recursos");
    expect(tp).toMatchObject({
      name: "Integração Broker",
      project_id: 300,
      parent_id: false,
      user_ids: [2006],
      planned_date_begin: "2026-10-01 03:00:00",
      date_deadline: "2026-10-21 02:59:59",
      allocated_hours: 120,
      description: "<p>Integrar o broker.</p><p>Fase 1 &amp; 2</p>",
      [F.sust]: false,
      [F.cid]: proj.id,
    });
    expect(tp.tag_ids).toEqual(expect.arrayContaining([101, 107]));
    const tc = fake.get("project.task", c.odooTaskId!)!;
    expect(tc.parent_id).toBe(p.odooTaskId);
    expect(tc.tag_ids).toEqual([103]); // subtarefa não leva Projeto/Tarefa; leva Fora do escopo
    expect(linesOf(e.id)[0].task_id).toBe(c.odooTaskId);
  });

  it("rascunho (e tarefa de projeto em rascunho) não sincroniza", async () => {
    const draft = await newItem({ scopeStatus: "rascunho", syncStatus: "nao_sincroniza" });
    const child = await newItem({ kind: "tarefa", parentId: draft.id, name: "Catálogo" });
    await enqueueSync(db, "item", draft.id, "upsert");
    await enqueueSync(db, "item", child.id, "upsert");
    const sum = await processQueue();
    expect(sum.sent).toBe(2);
    expect(fake.calls.filter((c) => c.model === "project.task" && c.method !== "search_read")).toHaveLength(0);
    expect((await item(draft.id)).syncStatus).toBe("nao_sincroniza");
    expect((await item(child.id)).syncStatus).toBe("nao_sincroniza");
    expect((await item(child.id)).odooTaskId).toBeNull();
  });

  it("excluir/arquivar no Clarity arquiva no Odoo, nunca apaga", async () => {
    await db.update(s.items).set({ archived: true }).where(eq(s.items.id, fx.task.id));
    await enqueueSync(db, "item", fx.task.id, "delete");
    await processQueue();
    const t = fake.get("project.task", 9000);
    expect(t).toBeDefined();
    expect(t!.active).toBe(false);
    expect(fake.calls.some((c) => c.model === "project.task" && c.method === "unlink")).toBe(false);
  });
});

describe("leitura do Odoo (US-28, US-31, US-32)", () => {
  it("traz cliente, contatos, projeto anual, funcionário (Consultor = falso), tarefas e pedidos", async () => {
    const empresa = fake.insert("res.partner", { name: "Nova Indústria Ltda", is_company: true, vat: "11.222.333/0001-44", city: "Anápolis", state_id: 72, phone: "(62) 3333-0000" });
    fake.insert("res.partner", { name: "Ana Souza", parent_id: empresa, email: "ana@nova.com.br", function: "Gerente" });
    fake.insert("res.partner", { name: "Endereço de cobrança", parent_id: empresa, type: "invoice" });
    const proj = fake.insert("project.project", { name: "Nova Indústria 2026", partner_id: empresa, tag_ids: [100], date_start: "2026-01-01" });
    fake.insert("project.project", { name: "Projeto sem cliente 2026", tag_ids: [100] });
    fake.insert("project.project", { name: "Modelo antigo", partner_id: empresa }); // sem a etiqueta Novo modelo
    fake.insert("res.users", { id: 2050, name: "Lia Campos", login: "lia@sintesebrasil.com" });
    fake.insert("hr.employee", { id: 1050, name: "Lia Campos", work_email: "Lia@sintesebrasil.com", job_title: "Assistente", user_id: 2050, [F.consultor]: false });
    const pai = fake.insert("project.task", { name: "Implantação fiscal", project_id: proj, tag_ids: [101], stage_id: 14, user_ids: [2050], date_deadline: "2026-11-01 02:59:59", allocated_hours: 40 });
    fake.insert("project.task", { name: "Cadastro de NCM", project_id: proj, parent_id: pai, stage_id: 11 });
    const order = fake.insert("sale.order", { name: "S09999", partner_id: empresa, state: "sale" });
    fake.insert("sale.order.line", { name: "Banco de horas\nDetalhe", order_id: order });

    const sum = await pullFromOdoo();
    expect(sum.errors).toEqual([]);

    const [cli] = await db.select().from(s.clients).where(eq(s.clients.odooPartnerId, empresa));
    expect(cli).toMatchObject({ name: "Nova Indústria Ltda", cnpj: "11.222.333/0001-44", city: "Anápolis", state: "GO", phone: "(62) 3333-0000" });
    expect(cli.color).toBe("#A897F5"); // segundo cliente: segunda cor da paleta
    const contacts = await db.select().from(s.clientContacts).where(eq(s.clientContacts.clientId, cli.id));
    expect(contacts.map((c) => c.name)).toEqual(["Ana Souza"]);
    expect(contacts[0].jobTitle).toBe("Gerente");
    const [ap] = await db.select().from(s.annualProjects).where(eq(s.annualProjects.odooProjectId, proj));
    expect(ap).toMatchObject({ clientId: cli.id, year: 2026 });
    expect(await db.select().from(s.annualProjects)).toHaveLength(2);

    const [lia] = await db.select().from(s.people).where(eq(s.people.odooEmployeeId, 1050));
    expect(lia).toMatchObject({ name: "Lia Campos", email: "lia@sintesebrasil.com", role: "consultor", isConsultor: false, active: true, odooUserId: 2050 });

    const items = await db.select().from(s.items).where(eq(s.items.annualProjectId, ap.id));
    const p = items.find((i) => i.name === "Implantação fiscal")!;
    const c = items.find((i) => i.name === "Cadastro de NCM")!;
    expect(p).toMatchObject({ kind: "projeto", stage: "andamento", deadline: "2026-10-31", plannedMinutes: 2400, syncStatus: "enviado", scopeStatus: "confirmado" });
    expect(c).toMatchObject({ kind: "tarefa", parentId: p.id, stage: "analise" });
    const assignees = await db.select().from(s.itemAssignees).where(eq(s.itemAssignees.itemId, p.id));
    expect(assignees.map((a) => a.personId)).toEqual([lia.id]);

    const [so] = await db.select().from(s.salesOrderLines).where(eq(s.salesOrderLines.clientId, cli.id));
    expect(so).toMatchObject({ orderName: "S09999", lineName: "Banco de horas", active: true });

    const pend = await db.select().from(s.syncLog).where(eq(s.syncLog.level, "pendencia"));
    expect(pend.map((x) => x.message).join()).toMatch(/Projeto sem cliente 2026.*sem cliente/);
    expect(sum.pending).toBe(1);

    // segunda leitura: incremental, nada novo e a pendência não se repete
    const again = await pullFromOdoo();
    expect(again.clients.created + again.projects.created + again.items.created + again.people.created).toBe(0);
    expect(await db.select().from(s.syncLog).where(eq(s.syncLog.level, "pendencia"))).toHaveLength(1);
    const st = await db.select().from(s.syncState);
    expect(st.map((x) => x.model).sort()).toEqual(["hr.employee", "project.project", "project.task", "res.partner", "sale.order.line"]);
  });

  it("funcionário arquivado no Odoo perde o acesso; Consultor vem do campo do Studio", async () => {
    await pullFromOdoo();
    fake.touch("hr.employee", 1006, { active: false }, new Date(Date.now() + 120_000));
    fake.touch("hr.employee", 1001, { [F.consultor]: true }, new Date(Date.now() + 120_000));
    await pullFromOdoo();
    const [caio] = await db.select().from(s.people).where(eq(s.people.id, fx.caio.id));
    const [adm] = await db.select().from(s.people).where(eq(s.people.id, fx.admin.id));
    expect(caio.active).toBe(false);
    expect(adm.isConsultor).toBe(true);
    expect(adm.role).toBe("administrador"); // perfil não vem do Odoo
  });

  it("conflito: vale a alteração mais recente e a outra fica no log", async () => {
    await pullFromOdoo(); // primeira leitura completa

    // 1) Clarity alterado depois do Odoo: fica o Clarity
    const now = Date.now();
    await db.update(s.items).set({ name: "Sustentação mensal (Clarity)", updatedAt: new Date(now) }).where(eq(s.items.id, fx.task.id));
    fake.touch("project.task", 9000, { name: "Sustentação (Odoo antigo)" }, new Date(now - 10 * 60_000));
    // a leitura incremental só vê o que mudou depois da última; força reler
    await db.delete(s.syncState).where(eq(s.syncState.model, "project.task"));
    const r1 = await pullFromOdoo();
    expect(r1.conflicts).toBe(1);
    expect((await item(fx.task.id)).name).toBe("Sustentação mensal (Clarity)");
    const conflicts = await db.select().from(s.syncLog).where(and(eq(s.syncLog.level, "conflito"), eq(s.syncLog.odooId, 9000)));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toMatch(/Mantida a versão do Clarity/);
    // a versão do Clarity volta para a fila para chegar ao Odoo
    expect((await queueOf(fx.task.id)).some((q) => q.status === "pendente")).toBe(true);

    // 2) Odoo alterado depois: vale o Odoo, e o envio antigo na fila é cancelado
    const later = new Date(now + 10 * 60_000);
    fake.touch("project.task", 9000, { name: "Sustentação (Odoo novo)", stage_id: 15 }, later);
    const r2 = await pullFromOdoo();
    expect(r2.items.updated).toBe(1);
    const it = await item(fx.task.id);
    expect(it.name).toBe("Sustentação (Odoo novo)");
    expect(it.stage).toBe("concluido");
    expect(it.completedAt).not.toBeNull();
    expect(it.updatedAt.toISOString()).toBe(new Date(toOdooDatetime(later).replace(" ", "T") + "Z").toISOString());
    expect((await queueOf(fx.task.id)).every((q) => q.status !== "pendente")).toBe(true);
    const hist = await db.select().from(s.stageHistory).where(eq(s.stageHistory.itemId, fx.task.id));
    expect(hist.map((h) => h.toStage)).toContain("concluido");
  });
});

describe("rotina /api/cron/sync", () => {
  it("exige o CRON_SECRET e devolve o resumo", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/cron/sync/route");
    process.env.CRON_SECRET = "segredo-teste";
    try {
      const denied = await GET(new NextRequest("http://localhost/api/cron/sync"));
      expect(denied.status).toBe(401);
      await createEntry(fx.caio, entryInput());
      const ok = await GET(new NextRequest("http://localhost/api/cron/sync", { headers: { authorization: "Bearer segredo-teste" } }));
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.ok).toBe(true);
      expect(body.push.sent).toBe(1);
      expect(body.pull.errors).toEqual([]);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
