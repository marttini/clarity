/**
 * Minha fila e Minhas horas (US-01, US-02, US-04, US-09, US-11, US-12, US-46).
 * Testa as Server Actions de verdade (sessão simulada) contra um banco próprio: clarity_test_eva_fila.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

const session = vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test_eva_fila";
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
  process.env.CLARITY_NOW = "2026-10-08T13:00:00-03:00";
  process.env.ODOO_MODE = "fake";
  return { current: null as unknown };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/session", () => ({
  requireTeam: vi.fn(async () => session.current),
  isManager: (p: { role: string }) => p.role === "administrador" || p.role === "gestor",
  isAdmin: (p: { role: string }) => p.role === "administrador",
  Forbidden: class extends Error {},
}));

import { migrateTestDb, truncateAll } from "./db";
import { and, eq } from "drizzle-orm";
import { db, pg, schema as s } from "@/db";
import { nationalHolidays } from "@/domain/dates";
import { launchAction } from "@/app/(time)/fila/actions";
import { convertAction, editEntryAction, justifyAction, requestChangeAction } from "@/app/(time)/horas/actions";
import { launcherOptions, monthRuler, provisioningToConvert } from "@/server/queries/fila";

async function ensureDb() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);
  const admin = (await import("postgres")).default(url.toString().replace(`/${name}`, "/postgres"), { max: 1, onnotice: () => {} });
  const [row] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!row) await admin.unsafe(`create database "${name}"`);
  await admin.end();
}

async function fixture() {
  await db.insert(s.holidays).values([2026].flatMap(nationalHolidays));
  const [fat, , interno, prov] = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 },
      { code: "bonificado", name: "Bonificado", builtin: true, sort: 2 },
      { code: "interno", name: "Interno", isInternal: true, builtin: true, sort: 3 },
      { code: "provisionamento", name: "Provisionamento", isProvisioning: true, builtin: true, sort: 4 },
    ])
    .returning();
  const [caio, maria, marttini] = await db
    .insert(s.people)
    .values([
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor" },
      { name: "Maria", email: "maria@sintesebrasil.com", role: "administrativo", isConsultor: false },
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false, canApproveHours: true },
    ])
    .returning();
  const [kari, sintese] = await db
    .insert(s.clients)
    .values([
      { name: "Kari-Kari Alimentos", color: "#F59A6B" },
      { name: "Síntese", isInternal: true },
    ])
    .returning();
  const [annual, internalAnnual] = await db
    .insert(s.annualProjects)
    .values([
      { clientId: kari.id, name: "Kari-Kari Alimentos 2026", year: 2026 },
      { clientId: sintese.id, name: "Síntese 2026", year: 2026 },
    ])
    .returning();
  const [broker, draft] = await db
    .insert(s.items)
    .values([
      { annualProjectId: annual.id, kind: "projeto", name: "Integração Broker", stage: "andamento" },
      { annualProjectId: annual.id, kind: "projeto", name: "Projeto novo", stage: "analise", scopeStatus: "rascunho" },
    ])
    .returning();
  const [task, sust, waiting, draftTask, meeting] = await db
    .insert(s.items)
    .values([
      { annualProjectId: annual.id, parentId: broker.id, kind: "tarefa", name: "Erro na importação", stage: "andamento" },
      { annualProjectId: annual.id, kind: "tarefa", name: "Sustentação mensal", stage: "andamento", isSustentacao: true },
      { annualProjectId: annual.id, kind: "tarefa", name: "Relatório extra", stage: "analise", outOfScope: true, clientApproval: "aguardando" },
      { annualProjectId: annual.id, parentId: draft.id, kind: "tarefa", name: "Levantamento", stage: "analise" },
      { annualProjectId: internalAnnual.id, kind: "tarefa", name: "Reuniões internas", stage: "andamento" },
    ])
    .returning();
  await db.insert(s.itemAssignees).values([{ itemId: task.id, personId: caio.id }]);
  const [reason] = await db.insert(s.absenceReasons).values({ name: "Liberação do gestor" }).returning();
  return { fat, interno, prov, caio, maria, marttini, task, sust, waiting, draftTask, meeting, reason };
}

let fx: Awaited<ReturnType<typeof fixture>>;

function form(v: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
}

beforeAll(async () => {
  await ensureDb();
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
  fx = await fixture();
  session.current = fx.caio;
});

afterAll(async () => {
  await pg.end();
});

describe("lançar pela fila (US-01, US-02, US-03)", () => {
  it("grava em nome de quem está logado, com a sustentação da tarefa, e entra na fila do Odoo", async () => {
    const r = await launchAction(null, form({ date: "2026-10-08", itemId: fx.sust.id, horas: "2h30", description: "Ajuste no broker", typeId: fx.fat.id, sust: "1", soId: "" }));
    expect(r?.ok).toBe(true);
    const [e] = await db.select().from(s.timeEntries);
    expect(e).toMatchObject({ personId: fx.caio.id, minutes: 150, isSustentacao: true, syncStatus: "pendente" });
    const q = await db.select().from(s.syncQueue).where(eq(s.syncQueue.entityId, e.id));
    expect(q).toHaveLength(1);
    expect(q[0].op).toBe("upsert");
  });

  it("Amanhã força Provisionamento, mesmo que o tipo enviado seja Faturável", async () => {
    const r = await launchAction(null, form({ date: "2026-10-09", itemId: fx.task.id, horas: "4:00", description: "Visita", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r?.ok).toBe(true);
    const [e] = await db.select().from(s.timeEntries);
    expect(e.typeId).toBe(fx.prov.id);
  });

  it("devolve os erros por campo (horas, descrição) sem gravar", async () => {
    const r = await launchAction(null, form({ date: "2026-10-08", itemId: fx.task.id, horas: "abc", description: "", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r?.ok).toBe(false);
    expect(r?.fields?.minutes).toBeTruthy();
    const r2 = await launchAction(null, form({ date: "2026-10-08", itemId: fx.task.id, horas: "1:00", description: "", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r2?.fields?.description).toBeTruthy();
    expect(await db.select().from(s.timeEntries)).toHaveLength(0);
  });

  it("demanda aguardando o cliente não recebe horas; Interno só no projeto Síntese", async () => {
    const r = await launchAction(null, form({ date: "2026-10-08", itemId: fx.waiting.id, horas: "1:00", description: "x", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r?.fields?.item).toMatch(/aguardando aprovação/);
    const r2 = await launchAction(null, form({ date: "2026-10-08", itemId: fx.task.id, horas: "1:00", description: "x", typeId: fx.interno.id, sust: "0", soId: "" }));
    expect(r2?.fields?.type).toMatch(/Síntese/);
    const r3 = await launchAction(null, form({ date: "2026-10-08", itemId: fx.meeting.id, horas: "0:30", description: "Reunião", typeId: fx.interno.id, sust: "0", soId: "" }));
    expect(r3?.ok).toBe(true);
  });

  it("administrativo não lança horas", async () => {
    session.current = fx.maria;
    const r = await launchAction(null, form({ date: "2026-10-08", itemId: fx.task.id, horas: "1:00", description: "x", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/consultores/);
    expect(await db.select().from(s.timeEntries)).toHaveLength(0);
  });

  it("opções do lançador: sem projetos em rascunho; demanda aguardando aparece desabilitada", async () => {
    const o = await launcherOptions(fx.caio.id, "2026-10-08");
    expect(o.tasks.find((t) => t.id === fx.draftTask.id)).toBeUndefined();
    expect(o.tasks.find((t) => t.id === fx.waiting.id)?.disabled).toMatch(/aguardando/);
    expect(o.tasks.find((t) => t.id === fx.task.id)?.mine).toBe(true);
  });
});

describe("editar, pedir alteração e converter (US-04, US-09, US-12)", () => {
  async function oldEntry(extra: Partial<typeof s.timeEntries.$inferInsert> = {}) {
    const [e] = await db
      .insert(s.timeEntries)
      .values({ personId: fx.caio.id, itemId: fx.task.id, date: "2026-10-02", minutes: 120, description: "Antigo", typeId: fx.fat.id, createdAt: new Date("2026-10-02T18:00:00-03:00"), ...extra })
      .returning();
    return e;
  }

  it("depois de 48 h a edição é bloqueada e vira pedido de alteração", async () => {
    const e = await oldEntry();
    const fields = { id: e.id, date: e.date, itemId: fx.task.id, horas: "1:00", description: "Corrigido", typeId: fx.fat.id, sust: "0", soId: "" };
    const r = await editEntryAction(null, form(fields));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/48 horas/);
    const noJust = await requestChangeAction(null, form({ ...fields, kind: "alterar", justification: "" }));
    expect(noJust?.fields?.justification).toBeTruthy();
    const ok = await requestChangeAction(null, form({ ...fields, kind: "alterar", justification: "Lancei 1 hora a mais." }));
    expect(ok?.ok).toBe(true);
    const [cr] = await db.select().from(s.changeRequests);
    expect(cr).toMatchObject({ status: "pendente", kind: "alterar" });
    expect((cr.newValues as { minutes: number }).minutes).toBe(60);
    const [after] = await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, e.id));
    expect(after).toMatchObject({ pendingChange: true, minutes: 120 });
  });

  it("dentro de 48 h edita direto e reenfileira", async () => {
    const [e] = await db
      .insert(s.timeEntries)
      .values({ personId: fx.caio.id, itemId: fx.task.id, date: "2026-10-08", minutes: 60, description: "Hoje", typeId: fx.fat.id, createdAt: new Date("2026-10-08T10:00:00-03:00") })
      .returning();
    const r = await editEntryAction(null, form({ id: e.id, date: e.date, itemId: fx.task.id, horas: "1:30", description: "Hoje", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r?.ok).toBe(true);
    const [after] = await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, e.id));
    expect(after.minutes).toBe(90);
  });

  it("converte provisionamento cuja data chegou em Faturável", async () => {
    const e = await oldEntry({ date: "2026-10-08", typeId: fx.prov.id, minutes: 240, description: "Reserva", createdAt: new Date("2026-10-03T09:00:00-03:00") });
    const pending = await provisioningToConvert(fx.caio.id, "2026-10-08", new Date("2026-10-08T13:00:00-03:00"));
    expect(pending.map((p) => p.id)).toEqual([e.id]);
    expect(pending[0].expired).toBe(false);
    const bad = await convertAction(null, form({ id: e.id, date: e.date, itemId: fx.task.id, horas: "3:00", description: "Feito", typeId: fx.prov.id, sust: "0", soId: "" }));
    expect(bad?.ok).toBe(false);
    const r = await convertAction(null, form({ id: e.id, date: e.date, itemId: fx.task.id, horas: "3:00", description: "Visita feita", typeId: fx.fat.id, sust: "0", soId: "" }));
    expect(r?.ok).toBe(true);
    const [after] = await db.select().from(s.timeEntries).where(eq(s.timeEntries.id, e.id));
    expect(after).toMatchObject({ typeId: fx.fat.id, minutes: 180, description: "Visita feita" });
    expect(after.convertedAt).not.toBeNull();
    const audit = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, e.id), eq(s.auditLog.action, "converter")));
    expect(audit).toHaveLength(1);
  });
});

describe("dias sem apontamento e justificativa (US-11)", () => {
  it("conta a sequência a partir do 1º dia e a justificativa sem comprovante falha", async () => {
    await db.insert(s.timeEntries).values({ personId: fx.caio.id, itemId: fx.task.id, date: "2026-10-05", minutes: 60, description: "x", typeId: fx.fat.id });
    const ruler = await monthRuler(fx.caio.id, "2026-10-08");
    expect(ruler.streak).toEqual(["2026-10-06", "2026-10-07"]);
    expect(ruler.days.find((d) => d.date === "2026-10-12")?.holiday).toBeTruthy();

    const r = await justifyAction(null, form({ date: "2026-10-06", reasonId: fx.reason.id }));
    expect(r?.ok).toBe(false);
    expect(r?.fields?.file).toMatch(/comprovante/);
    expect(await db.select().from(s.absenceJustifications)).toHaveLength(0);

    const file = new File(["print"], "print.png", { type: "image/png" });
    const ok = await justifyAction(null, form({ date: "2026-10-06", reasonId: fx.reason.id, file }));
    expect(ok?.ok).toBe(true);
    const [att] = await db.select().from(s.attachments);
    expect(att).toMatchObject({ ownerType: "justification", internal: true });
    const after = await monthRuler(fx.caio.id, "2026-10-08");
    expect(after.streak).toEqual(["2026-10-07"]);
  });
});
