/**
 * Análise do time e gestão à vista (US-07, US-11, US-33, US-48, US-49, US-50).
 * Banco próprio (clarity_test_eva_gestao por padrão) para não disputar com outros módulos.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test_eva_gestao";
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
  process.env.CLARITY_NOW = "2026-10-08T13:00:00-03:00";
  process.env.ODOO_MODE = "fake";
});

import { migrateTestDb, truncateAll } from "./db";
import { eq } from "drizzle-orm";
import { db, pg, schema as s } from "@/db";
import { nationalHolidays } from "@/domain/dates";
import { resolvePeriod } from "@/domain/period";
import {
  buildComparison,
  entryList,
  hoursBreakdown,
  loadActivity,
  monthlySeries,
  ranking,
  teamProgress,
  validTvToken,
  workload,
  last13Months,
} from "@/server/queries/analytics";
import { chargeClientForDemand, decideEvaluation, ManagementError } from "@/server/services/management";

const TODAY = "2026-10-08";

async function ensureDb() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);
  const admin = (await import("postgres")).default(url.toString().replace(`/${name}`, "/postgres"), { max: 1, onnotice: () => {} });
  const [row] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!row) await admin.unsafe(`create database "${name}"`);
  await admin.end();
}

async function fixture() {
  await db.insert(s.holidays).values([2025, 2026].flatMap(nationalHolidays));
  const [fat, bon, , prov] = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 },
      { code: "bonificado", name: "Bonificado", builtin: true, sort: 2 },
      { code: "interno", name: "Interno", isInternal: true, builtin: true, sort: 3 },
      { code: "provisionamento", name: "Provisionamento", isProvisioning: true, builtin: true, sort: 4 },
    ])
    .returning();
  const [marttini, caio, julia, maria, otavio] = await db
    .insert(s.people)
    .values([
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false, canApproveHours: true },
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor" },
      { name: "Júlia Prado", email: "julia@sintesebrasil.com", role: "consultor" },
      { name: "Maria", email: "maria@sintesebrasil.com", role: "administrativo", isConsultor: false },
      { name: "Otávio Reis", email: "otavio@sintesebrasil.com", role: "consultor", active: false },
    ])
    .returning();
  const [kari] = await db.insert(s.clients).values({ name: "Kari-Kari", color: "#F59A6B" }).returning();
  const [annual] = await db.insert(s.annualProjects).values({ clientId: kari.id, name: "Kari-Kari 2026", year: 2026 }).returning();
  const [task, demand] = await db
    .insert(s.items)
    .values([
      { annualProjectId: annual.id, kind: "tarefa", name: "Sustentação", stage: "andamento", isSustentacao: true, deadline: "2026-10-06" },
      { annualProjectId: annual.id, kind: "tarefa", name: "Relatório extra", stage: "analise", outOfScope: true, clientApproval: "aguardando", requestedAt: "2026-10-02" },
    ])
    .returning();
  await db.insert(s.itemAssignees).values([{ itemId: task.id, personId: caio.id }]);
  const E = (personId: string, date: string, minutes: number, typeId: string, extra: Partial<typeof s.timeEntries.$inferInsert> = {}) => ({
    personId,
    itemId: task.id,
    date,
    minutes,
    description: "x",
    typeId,
    isSustentacao: true,
    syncStatus: "enviado" as const,
    ...extra,
  });
  await db.insert(s.timeEntries).values([
    E(caio.id, "2026-09-01", 600, fat.id),
    E(caio.id, "2026-10-01", 360, fat.id),
    E(caio.id, "2026-10-02", 120, bon.id, { isSustentacao: false }),
    E(caio.id, "2026-10-05", 240, fat.id, { deletedAt: new Date("2026-10-05T20:00:00Z") }), // excluído
    E(caio.id, "2026-10-09", 180, prov.id), // provisionado
    E(caio.id, "2026-10-01", 60, prov.id), // provisionamento vencido, não convertido
    E(julia.id, "2026-10-01", 600, fat.id),
    E(julia.id, "2026-10-02", 480, fat.id),
    E(julia.id, "2026-10-05", 480, fat.id),
    E(julia.id, "2026-10-06", 480, fat.id),
    E(julia.id, "2026-10-07", 480, fat.id),
    E(julia.id, "2026-09-01", 300, fat.id),
    E(marttini.id, "2026-10-01", 1200, fat.id), // não consultor: fora do ranking e da equipe
    E(otavio.id, "2026-10-01", 900, fat.id), // desligado: fora do ranking
  ]);
  const [contact] = await db.insert(s.clientContacts).values({ clientId: kari.id, name: "Carla" }).returning();
  const [ev] = await db.insert(s.evaluations).values({ clientId: kari.id, contactId: contact.id, consultantId: caio.id, scoreResult: 5, scoreConsultant: 5, scoreTeam: 4 }).returning();
  await db.insert(s.tvTokens).values([
    { token: "tv-ok", label: "TV" },
    { token: "tv-revogado", label: "TV antiga", revokedAt: new Date("2026-10-01T12:00:00Z") },
  ]);
  return { fat, prov, marttini, caio, julia, maria, task, demand, ev };
}

let fx: Awaited<ReturnType<typeof fixture>>;

beforeAll(async () => {
  await ensureDb();
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
  fx = await fixture();
});

afterAll(async () => {
  await pg.end();
});

const OCT = { from: "2026-10-01", to: "2026-10-31" };

describe("horas por tipo (US-07)", () => {
  it("excluem Provisionamento e apontamentos excluídos", async () => {
    const h = await hoursBreakdown(OCT, { personIds: [fx.caio.id] });
    expect(h.total.fat).toBe(360);
    expect(h.total.bon).toBe(120);
    expect(h.total.tot).toBe(480);
    expect(h.byType.map((t) => t.name)).toEqual(["Faturável", "Bonificado"]);
    expect(h.total.sust).toBe(360);
    expect(h.total.dev).toBe(120);
    expect(h.byDay.has("2026-10-05")).toBe(false);
    expect(h.byDay.has("2026-10-09")).toBe(false);
    // A lista de detalhe também não traz provisionado nem excluído, a menos que se peça.
    expect((await entryList(OCT, { personId: fx.caio.id })).map((e) => e.minutes).sort()).toEqual([120, 360]);
    const withProv = await entryList(OCT, { personId: fx.caio.id, includeProvisioning: true });
    expect(withProv.filter((e) => e.isProvisioning)).toHaveLength(2);
  });
});

describe("ranking e metas (US-48, US-50)", () => {
  it("entra só consultor ativo, ordenado por horas faturáveis, com variação de posição", async () => {
    const period = resolvePeriod({ p: "mes" }, TODAY);
    const { rows } = await ranking(period, "h", TODAY);
    expect(rows.map((r) => r.person.name)).toEqual(["Júlia Prado", "Caio Ramos"]);
    expect(rows[0].fat).toBe(2520);
    expect(rows[1].prevPos).toBe(1); // em setembro Caio tinha mais horas
    expect(rows[1].pos).toBe(2);
  });

  it("a equipe soma só consultores", async () => {
    const team = await teamProgress(resolvePeriod({ p: "mes" }, TODAY), TODAY);
    expect(team.total.fat).toBe(360 + 2520);
    expect(team.goals.map((g) => g.minutes)).toEqual([1280 * 60, 1500 * 60, 1725 * 60, 2000 * 60]);
    expect(team.elapsed).toBe(6);
    expect(team.workdays).toBe(21); // 12/out é feriado
    expect(team.projection).toBe(Math.round((2880 / 6) * 21));
  });

  it("trimestre escala as metas por 3", async () => {
    const team = await teamProgress(resolvePeriod({ p: "trimestre" }, TODAY), TODAY);
    expect(team.goals[0].minutes).toBe(1280 * 60 * 3);
  });
});

describe("ficha do consultor (US-33, US-11)", () => {
  it("compara o mês atual (com projeção) com o mês anterior e as médias", async () => {
    const months = last13Months(TODAY);
    const act = await loadActivity([fx.caio.id], { from: months[0], to: "2026-10-31" });
    const series = monthlySeries(act, fx.caio.id, TODAY);
    expect(series).toHaveLength(13);
    const cmp = buildComparison(act, fx.caio.id, resolvePeriod({ p: "mes" }, TODAY), TODAY, series);
    const fat = cmp.rows.find((r) => r.key === "fat")!;
    expect(fat.current).toBe(360);
    expect(fat.projection).toBe(Math.round((360 * 21) / 6));
    expect(cmp.heads[0]).toBe("Setembro");
    expect(fat.cols[0].ref).toBe(600);
    expect(fat.cols[0].verdict).toBe("melhor"); // projeção 1260 > 600
    // Atrasadas: menor é melhor; 1 tarefa com prazo vencido em 06/10.
    expect(cmp.rows.find((r) => r.key === "late")!.current).toBe(1);
    // Média por dia útil não tem projeção.
    expect(cmp.rows.find((r) => r.key === "avg")!.projection).toBeNull();
  });

  it("regra dos 3 dias: 5, 6 e 7/out sem hora real (o excluído não conta) = sem bônus no mês", async () => {
    const act = await loadActivity([fx.caio.id, fx.julia.id], { from: "2026-09-01", to: "2026-10-31" });
    expect(monthlySeries(act, fx.caio.id, TODAY).at(-1)!.lostBonus).toBe(true);
    expect(monthlySeries(act, fx.julia.id, TODAY).at(-1)!.lostBonus).toBe(false);
    // Justificar um dos dias quebra a sequência.
    await db.insert(s.absenceReasons).values({ name: "Férias" });
    const [reason] = await db.select().from(s.absenceReasons);
    await db.insert(s.absenceJustifications).values({ personId: fx.caio.id, date: "2026-10-06", reasonId: reason.id, attachmentId: fx.caio.id });
    const act2 = await loadActivity([fx.caio.id], { from: "2026-09-01", to: "2026-10-31" });
    const cur = monthlySeries(act2, fx.caio.id, TODAY).at(-1)!;
    expect(cur.lostBonus).toBe(false);
    expect(cur.m.justified).toEqual(["2026-10-06"]);
  });

  it("carga do time traz só consultores ativos", async () => {
    const { rows } = await workload(resolvePeriod({ p: "mes" }, TODAY), TODAY, new Date("2026-10-08T16:00:00Z"));
    expect(rows.map((r) => r.person.name).sort()).toEqual(["Caio Ramos", "Júlia Prado"]);
    const caio = rows.find((r) => r.person.id === fx.caio.id)!;
    expect(caio.tasks).toBe(1);
    expect(caio.late).toBe(1);
    expect(caio.missingStreak).toBe(3);
  });
});

describe("modo TV (US-49)", () => {
  it("token revogado não abre; token válido abre", async () => {
    expect(await validTvToken("tv-revogado")).toBeNull();
    expect(await validTvToken("nao-existe")).toBeNull();
    expect((await validTvToken("tv-ok"))?.label).toBe("TV");
  });
});

describe("serviços da gestão", () => {
  it("só a gestão publica avaliação; publicar marca quem e quando", async () => {
    await expect(decideEvaluation(fx.caio, fx.ev.id, true)).rejects.toBeInstanceOf(ManagementError);
    await decideEvaluation(fx.marttini, fx.ev.id, true);
    const [ev] = await db.select().from(s.evaluations).where(eq(s.evaluations.id, fx.ev.id));
    expect(ev.published).toBe(true);
    expect(ev.publishedBy).toBe(fx.marttini.id);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.caio.id));
    expect(notes).toHaveLength(1);
  });

  it("cobrar cliente agenda um contato para a Maria, uma vez só", async () => {
    const r1 = await chargeClientForDemand(fx.marttini, fx.demand.id);
    expect(r1.created).toBe(true);
    expect(r1.contact.responsibleId).toBe(fx.maria.id);
    expect(r1.contact.objective).toBe("Cobrar aprovação da demanda Relatório extra");
    expect(r1.contact.scheduledAt.toISOString()).toBe("2026-10-09T13:00:00.000Z"); // próximo dia útil, 10h
    const r2 = await chargeClientForDemand(fx.marttini, fx.demand.id);
    expect(r2.created).toBe(false);
    await expect(chargeClientForDemand(fx.marttini, fx.task.id)).rejects.toThrow(/não está aguardando/);
  });
});
