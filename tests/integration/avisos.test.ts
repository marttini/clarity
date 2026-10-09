/**
 * Central de avisos (US-43): envio do outbox, horário comercial, dry-run, silenciar,
 * novas tentativas e rotina diária com dedupe.
 * Banco: TEST_DATABASE_URL (padrão clarity_test), migrado e limpo antes de cada caso.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test";
  process.env.CLARITY_NOW = "2026-10-08T13:00:00-03:00";
  process.env.NOTIFY_MODE = "dry-run";
  process.env.SLACK_BOT_TOKEN = "xoxb-teste";
  process.env.RESEND_API_KEY = "re_teste";
  process.env.EMAIL_FROM = "Síntese <avisos@sintese.test>";
  process.env.SLACK_GESTAO_CHANNEL = "#clarity-gestao";
});

import { migrateTestDb, truncateAll } from "./db";
import { and, eq } from "drizzle-orm";
import { db, pg, schema as s } from "@/db";
import { notify } from "@/server/notify";
import { buildDigest, MAX_SEND_ATTEMPTS, runDaily, sendOutbox, markAllRead, markRead } from "@/server/services/notifications";
import { setMutes, getMutes } from "@/server/services/settings";

type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;
const old = new Date("2026-09-01T12:00:00Z");
const NOW = "2026-10-08T13:00:00-03:00";

async function fixture() {
  const [faturavel, provisionamento] = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 },
      { code: "provisionamento", name: "Provisionamento", isProvisioning: true, builtin: true, sort: 4 },
    ])
    .returning();
  const [admin, caio, julia, semSlack] = await db
    .insert(s.people)
    .values([
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false, slackUserId: "U0MARTTINI", createdAt: old },
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor", slackUserId: "U0CAIO", createdAt: old },
      { name: "Júlia Prado", email: "julia@sintesebrasil.com", role: "consultor", slackUserId: "U0JULIA", createdAt: old },
      { name: "Otávio Reis", email: "otavio@sintesebrasil.com", role: "consultor", createdAt: old },
    ])
    .returning();
  const [kari] = await db.insert(s.clients).values({ name: "Kari-Kari" }).returning();
  const [carla] = await db.insert(s.clientContacts).values({ clientId: kari.id, name: "Carla", email: "carla@kari.com.br", portalAccess: true }).returning();
  const [annual] = await db.insert(s.annualProjects).values({ clientId: kari.id, name: "Kari 2026", year: 2026 }).returning();
  const [task] = await db
    .insert(s.items)
    .values({ annualProjectId: annual.id, kind: "tarefa", name: "Sustentação", stage: "andamento", deadline: "2026-10-09", visibleToClient: true, createdAt: old, updatedAt: old })
    .returning();
  await db.insert(s.itemAssignees).values([{ itemId: task.id, personId: caio.id }]);
  // Caio apontou até 05/10 (segunda) e parou: 06, 07 = 2 dias úteis sem horas até ontem (07/10).
  // Júlia nunca mais apontou desde 01/10: 02, 05, 06, 07 = 4 dias úteis (regra dos 3 dias).
  // Otávio apontou ontem (07/10).
  await db.insert(s.timeEntries).values([
    { personId: caio.id, itemId: task.id, date: "2026-10-05", minutes: 480, description: "a", typeId: faturavel.id },
    { personId: julia.id, itemId: task.id, date: "2026-10-01", minutes: 480, description: "b", typeId: faturavel.id },
    { personId: semSlack.id, itemId: task.id, date: "2026-10-07", minutes: 480, description: "c", typeId: faturavel.id },
    { personId: semSlack.id, itemId: task.id, date: "2026-10-08", minutes: 60, description: "prov", typeId: provisionamento.id },
  ]);
  // Comentário do cliente sem resposta desde 06/10.
  await db.insert(s.comments).values({ itemId: task.id, channel: "cliente", authorContactId: carla.id, body: "Alguma novidade?", createdAt: new Date("2026-10-06T12:00:00Z") });
  return { faturavel, provisionamento, admin, caio, julia, semSlack, kari, carla, task };
}

const fetchSpy = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify({ ok: true, ts: "1.0", id: "em_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  process.env.CLARITY_NOW = NOW;
  await truncateAll();
  fx = await fixture();
});
afterEach(() => {
  process.env.CLARITY_NOW = NOW;
  process.env.NOTIFY_MODE = "dry-run";
});
afterAll(async () => {
  await pg.end();
});

const outbox = () => db.select().from(s.outbox);

describe("envio do outbox", () => {
  it("dry-run registra como enviado e não chama a rede", async () => {
    await notify(db, { event: "mencao", to: { personId: fx.caio.id, slackUserId: fx.caio.slackUserId }, title: "Você foi mencionado" });
    const f = fetchSpy();
    const r = await sendOutbox({ fetchImpl: f });
    expect(r).toMatchObject({ sent: 1, mode: "dry-run" });
    expect(f).not.toHaveBeenCalled();
    const [o] = await outbox();
    expect(o.status).toBe("feito");
    expect(o.sentAt).not.toBeNull();
  });

  it("live: Slack DM vai para o slack user id; pessoa sem Slack vira erro sem chamar a rede", async () => {
    await notify(db, { event: "mencao", to: { personId: fx.caio.id, slackUserId: fx.caio.slackUserId }, title: "Oi Caio" });
    await notify(db, { event: "mencao", to: { personId: fx.semSlack.id, slackUserId: null }, title: "Oi Otávio" });
    await notify(db, { event: "convite_portal", to: { contactId: fx.carla.id, email: "carla@kari.com.br" }, title: "Convite", link: "/entrar" });
    const f = fetchSpy();
    const r = await sendOutbox({ fetchImpl: f, mode: "live" });
    expect(r).toMatchObject({ sent: 2, failed: 1 });
    const urls = f.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://slack.com/api/chat.postMessage");
    expect(urls).toContain("https://api.resend.com/emails");
    const slackCall = f.mock.calls.find((c) => c[0].includes("slack"))!;
    expect(JSON.parse((slackCall[1] as RequestInit).body as string).channel).toBe("U0CAIO");
    const rows = await outbox();
    const err = rows.find((o) => o.status === "erro")!;
    expect(err.lastError).toBe("pessoa sem Slack configurado");
  });

  it("respeita o horário comercial (send_after) e envia no próximo dia útil às 8h", async () => {
    process.env.CLARITY_NOW = "2026-10-08T20:00:00-03:00";
    await notify(db, { event: "mencao", to: { personId: fx.caio.id, slackUserId: "U0CAIO" }, title: "Noite" });
    const [o] = await outbox();
    expect(o.sendAfter.toISOString()).toBe(new Date("2026-10-09T08:00:00-03:00").toISOString());
    expect((await sendOutbox({ now: new Date("2026-10-08T20:05:00-03:00") })).claimed).toBe(0);
    expect((await sendOutbox({ now: new Date("2026-10-09T08:05:00-03:00") })).sent).toBe(1);
  });

  it("linha pendente fora do horário é adiada, exceto erro de sincronização", async () => {
    await db.insert(s.outbox).values([
      { channel: "slack_canal", target: "#clarity-gestao", payload: { title: "x" }, sendAfter: new Date("2026-10-08T19:00:00-03:00") },
    ]);
    const n = await notify(db, { event: "erro_sincronizacao", to: { personId: fx.admin.id, slackUserId: "U0MARTTINI" }, title: "Erro", urgent: true });
    void n;
    const r = await sendOutbox({ now: new Date("2026-10-08T21:00:00-03:00") });
    expect(r).toMatchObject({ sent: 1, deferred: 1 });
  });

  it("novas tentativas com limite em falha passageira", async () => {
    process.env.NOTIFY_MODE = "live";
    await notify(db, { event: "mencao", to: { personId: fx.caio.id, slackUserId: "U0CAIO" }, title: "Oi" });
    const failing = vi.fn(async () => new Response("erro", { status: 503 }));
    let t = new Date("2026-10-08T13:00:00-03:00").getTime();
    for (let i = 1; i <= MAX_SEND_ATTEMPTS; i++) {
      await sendOutbox({ fetchImpl: failing, now: new Date(t) });
      const [o] = await outbox();
      expect(o.attempts).toBe(i);
      expect(o.status).toBe(i < MAX_SEND_ATTEMPTS ? "pendente" : "erro");
      t = o.sendAfter.getTime() + 1000;
      if (new Date(t).getUTCHours() >= 21) t = new Date("2026-10-09T09:00:00-03:00").getTime();
    }
    expect(failing).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
  });

  it("aviso informativo silenciado não sai; obrigatório sai mesmo assim", async () => {
    await setMutes(fx.caio, ["mencao", "prazo"]);
    expect(await getMutes(fx.caio.id)).toEqual(["mencao"]);
    await notify(db, { event: "mencao", to: { personId: fx.caio.id, slackUserId: "U0CAIO" }, title: "Menção" });
    await notify(db, { event: "prazo", to: { personId: fx.caio.id, slackUserId: "U0CAIO" }, title: "Prazo" });
    const r = await sendOutbox();
    expect(r).toMatchObject({ sent: 1, cancelled: 1 });
    const rows = await outbox();
    expect(rows.find((o) => o.status === "cancelado")!.lastError).toBe("silenciado pela pessoa");
  });

  it("Google Agenda fica cancelado até a integração existir", async () => {
    await db.insert(s.outbox).values({ channel: "google_agenda", target: fx.caio.id, payload: { title: "Contato" }, sendAfter: new Date("2026-10-08T12:00:00-03:00") });
    await sendOutbox();
    const [o] = await outbox();
    expect(o).toMatchObject({ status: "cancelado", lastError: "integração Google Agenda pendente" });
  });
});

describe("sino", () => {
  it("marca lida e todas lidas só da própria pessoa", async () => {
    const a = await notify(db, { event: "mencao", to: { personId: fx.caio.id }, title: "1", external: "none" });
    await notify(db, { event: "mencao", to: { personId: fx.caio.id }, title: "2", external: "none" });
    const other = await notify(db, { event: "mencao", to: { personId: fx.julia.id }, title: "3", external: "none" });
    await markRead(fx.caio, other!);
    await markRead(fx.caio, a!);
    const rows = await db.select().from(s.notifications);
    expect(rows.find((r) => r.id === other)!.readAt).toBeNull();
    expect(rows.find((r) => r.id === a)!.readAt).not.toBeNull();
    await markAllRead(fx.caio);
    const caio = await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.caio.id));
    expect(caio.every((r) => r.readAt)).toBe(true);
  });
});

describe("rotina diária", () => {
  it("gera os lembretes da US-43 uma vez por dia (dedupe) e um único resumo", async () => {
    process.env.CLARITY_NOW = "2026-10-08T08:00:00-03:00";
    const r1 = await runDaily();
    expect(r1.tresDias).toBe(1); // Júlia
    expect(r1.diaSemApontamento).toBe(1); // Caio (ontem sem horas, 2 dias na sequência)
    expect(r1.provisionamento).toBe(1); // Otávio
    expect(r1.prazo).toBe(1); // vence amanhã, Caio
    expect(r1.comentarioSemResposta).toBe(1);
    expect(r1.demandaCliente).toBe(0);
    expect(r1.resumo).toBe(true);
    const rows = await outbox();
    expect(rows.find((o) => o.dedupeKey === `tres-dias:${fx.julia.id}:2026-10-08`)).toBeTruthy();
    const resumo = rows.filter((o) => o.channel === "slack_canal");
    expect(resumo).toHaveLength(1);
    const body = (resumo[0].payload as { body: string }).body;
    expect(body).toContain("Júlia Prado: 4 dias úteis");
    expect(body).toContain("Kari-Kari: Sustentação");
    const nCount = (await db.select().from(s.notifications)).length;

    const r2 = await runDaily();
    expect(r2).toMatchObject({ tresDias: 0, diaSemApontamento: 0, provisionamento: 0, prazo: 0, comentarioSemResposta: 0, resumo: false });
    expect((await outbox()).length).toBe(rows.length);
    expect((await db.select().from(s.notifications)).length).toBe(nCount);
  });

  it("demanda adicional aguardando: e-mail aos contatos com acesso a cada 2 dias úteis", async () => {
    await db.update(s.items).set({ outOfScope: true, clientApproval: "aguardando", requestedAt: "2026-10-06" }).where(eq(s.items.id, fx.task.id));
    const r = await runDaily({ now: new Date("2026-10-08T08:00:00-03:00") });
    expect(r.demandaCliente).toBe(1);
    const mails = await db.select().from(s.outbox).where(and(eq(s.outbox.channel, "email")));
    expect(mails.map((m) => m.target)).toEqual(["carla@kari.com.br"]);
    const r2 = await runDaily({ now: new Date("2026-10-09T08:00:00-03:00") });
    expect(r2.demandaCliente).toBe(0); // 3 dias úteis: não é dia de lembrete
  });

  it("não roda em fim de semana nem feriado", async () => {
    expect((await runDaily({ now: new Date("2026-10-10T08:00:00-03:00") })).skipped).toBeTruthy();
    await db.insert(s.holidays).values({ date: "2026-10-12", name: "Nossa Senhora Aparecida" });
    expect((await runDaily({ now: new Date("2026-10-12T08:00:00-03:00") })).skipped).toBeTruthy();
    expect(await outbox()).toEqual([]);
  });

  it("resumo vazio diz que está tudo em dia", () => {
    const d = buildDigest({ today: "2026-10-08", missing: [], comments: [], demands: [], noContact: [], overdue: 0 });
    expect(d.title).toBe("Resumo da gestão, quinta, 8 de outubro");
    expect(d.body).toContain("Tudo em dia");
  });
});

describe("configurações (só Administrador)", () => {
  it("metas: valida ordem crescente e grava em settings 'rules'; não administrador é barrado", async () => {
    const { saveBandsAndGoals, readRules, SettingsError } = await import("@/server/services/settings");
    const goals = [{ name: "Cota", hours: 1280 }, { name: "Meta", hours: 1500 }];
    await expect(saveBandsAndGoals(fx.admin, { bands: { quota: 60, band1: 50, band2: 140, band3: 175, extra: 240 }, teamGoals: goals })).rejects.toBeInstanceOf(SettingsError);
    await expect(saveBandsAndGoals(fx.admin, { bands: { quota: 60, band1: 90, band2: 140, band3: 175, extra: 240 }, teamGoals: [goals[1], goals[0]] })).rejects.toThrow("maior que a anterior");
    await expect(saveBandsAndGoals(fx.caio, { bands: { quota: 60, band1: 90, band2: 140, band3: 175, extra: 240 }, teamGoals: goals })).rejects.toThrow("Administrador");
    await saveBandsAndGoals(fx.admin, { bands: { quota: 70, band1: 90, band2: 140, band3: 175, extra: 240 }, teamGoals: goals });
    const r = await readRules();
    expect(r.bands.quota).toBe(70);
    expect(r.teamGoals).toEqual(goals);
    expect(r.editWindowHours).toBe(48);
  });

  it("tipos: padrão não exclui nem desativa; tipo usado só desativa", async () => {
    const { createEntryType, deleteEntryType, updateEntryType } = await import("@/server/services/settings");
    await expect(deleteEntryType(fx.admin, fx.faturavel.id)).rejects.toThrow("não podem ser excluídos");
    const t = await createEntryType(fx.admin, { name: "Treinamento", acceptsSalesOrder: false });
    expect(t.code).toBe("treinamento");
    await db.insert(s.timeEntries).values({ personId: fx.caio.id, itemId: fx.task.id, date: "2026-10-07", minutes: 30, description: "x", typeId: t.id });
    await expect(deleteEntryType(fx.admin, t.id)).rejects.toThrow("só pode ser desativado");
    const off = await updateEntryType(fx.admin, t.id, { active: false });
    expect(off.active).toBe(false);
  });

  it("não deixa o sistema sem Administrador", async () => {
    const { updatePerson } = await import("@/server/services/settings");
    await expect(updatePerson(fx.admin, fx.admin.id, { role: "gestor", canApproveHours: true, canConfirmScope: true, slackUserId: "U0MARTTINI" })).rejects.toThrow("ao menos um Administrador");
    await updatePerson(fx.admin, fx.caio.id, { role: "consultor", canApproveHours: false, canConfirmScope: false, slackUserId: "" });
    const [c] = await db.select().from(s.people).where(eq(s.people.id, fx.caio.id));
    expect(c.slackUserId).toBeNull();
  });
});
