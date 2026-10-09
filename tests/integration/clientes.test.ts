/**
 * Clientes e contatos (US-30, US-31, US-34, US-36, US-37, US-45).
 * Banco próprio (clarity_test_eva_clientes por padrão) para não disputar com outros módulos.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.TEST_DATABASE_URL = process.env.CLIENTES_TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/clarity_test_eva_clientes";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.CLARITY_NOW = "2026-10-08T13:00:00-03:00";
});

import { migrateTestDb, truncateAll } from "./db";
import { and, eq } from "drizzle-orm";
import { db, pg, schema as s } from "@/db";
import { clientPortfolio, situationLabel, personAgenda } from "@/server/queries/clients";
import { logContact, registerResult, rescheduleContact, scheduleContact, cancelContact, ContactError } from "@/server/services/contacts";
import { inviteToPortal, revokePortal, updateClientInternal, ClientError } from "@/server/services/clients";

const TODAY = "2026-10-08";
type Fx = Awaited<ReturnType<typeof fixture>>;
let fx: Fx;

async function fixture() {
  const [fat, prov] = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", countsForBonus: true, acceptsSalesOrder: true, builtin: true, sort: 1 },
      { code: "provisionamento", name: "Provisionamento", isProvisioning: true, builtin: true, sort: 4 },
    ])
    .returning();
  const [tagTarefa] = await db.insert(s.tags).values({ name: "Tarefa", system: true, odooTagId: 102 }).returning();
  const [gestor, caio, julia, maria] = await db
    .insert(s.people)
    .values([
      { name: "Marttini", email: "marttini@sintesebrasil.com", role: "administrador", isConsultor: false },
      { name: "Caio Ramos", email: "caio@sintesebrasil.com", role: "consultor", slackUserId: "U-CAIO" },
      { name: "Júlia Prado", email: "julia@sintesebrasil.com", role: "consultor" },
      { name: "Maria", email: "maria@sintesebrasil.com", role: "administrativo", isConsultor: false },
    ])
    .returning();
  const [kari, radar, hdn, brava] = await db
    .insert(s.clients)
    .values([
      { name: "Kari-Kari", odooPartnerId: 500 },
      { name: "Radar", odooPartnerId: 501 },
      { name: "HDN", odooPartnerId: 502 },
      { name: "Brava", odooPartnerId: 503 },
    ])
    .returning();
  const annuals = await db
    .insert(s.annualProjects)
    .values([kari, radar, hdn, brava].map((c, i) => ({ clientId: c.id, name: `${c.name} 2026`, year: 2026, odooProjectId: 300 + i })))
    .returning();
  const A = Object.fromEntries(annuals.map((a) => [a.clientId, a.id]));
  const [kTask, rTask, hTask, bTask, bDemand] = await db
    .insert(s.items)
    .values([
      { annualProjectId: A[kari.id], kind: "tarefa", name: "Rateio por filial", stage: "andamento", deadline: "2026-10-01" },
      { annualProjectId: A[radar.id], kind: "tarefa", name: "Inventário", stage: "andamento" },
      { annualProjectId: A[hdn.id], kind: "tarefa", name: "Sustentação", stage: "andamento", deadline: "2026-12-31" },
      { annualProjectId: A[brava.id], kind: "tarefa", name: "Portal do representante", stage: "andamento" },
      { annualProjectId: A[brava.id], kind: "tarefa", name: "Campo de desconto", stage: "analise", outOfScope: true, clientApproval: "aguardando", deadline: "2026-10-02" },
    ])
    .returning();
  void bDemand;
  await db.insert(s.timeEntries).values([
    { personId: caio.id, itemId: kTask.id, date: "2026-10-07", minutes: 120, description: "x", typeId: fat.id },
    { personId: caio.id, itemId: rTask.id, date: "2026-01-10", minutes: 60, description: "x", typeId: fat.id },
    // Provisionamento nunca conta para "Ativo".
    { personId: caio.id, itemId: rTask.id, date: "2026-09-20", minutes: 240, description: "x", typeId: prov.id },
    { personId: caio.id, itemId: hTask.id, date: "2026-10-06", minutes: 90, description: "x", typeId: fat.id },
    { personId: caio.id, itemId: bTask.id, date: "2026-10-06", minutes: 90, description: "x", typeId: fat.id },
  ]);
  const at = (d: string, t = "11:00") => new Date(`${d}T${t}:00-03:00`);
  await db.insert(s.contacts).values([
    { clientId: kari.id, type: "ligacao", responsibleId: caio.id, scheduledAt: at("2026-09-28"), objective: "Semanal", status: "realizado", resultSummary: "ok", createdBy: caio.id },
    { clientId: hdn.id, type: "visita", responsibleId: caio.id, scheduledAt: at("2026-10-07"), objective: "Semanal", status: "realizado", resultSummary: "ok", createdBy: caio.id },
    { clientId: brava.id, type: "ligacao", responsibleId: julia.id, scheduledAt: at("2026-10-08", "09:00"), objective: "Semanal", status: "realizado", resultSummary: "ok", createdBy: julia.id },
  ]);
  const [scheduled] = await db
    .insert(s.contacts)
    .values({ clientId: kari.id, type: "reuniao_online", responsibleId: caio.id, scheduledAt: at("2026-10-07", "15:00"), objective: "Alinhar prazos", status: "agendado", createdBy: gestor.id })
    .returning();
  const [carla, semEmail] = await db
    .insert(s.clientContacts)
    .values([
      { clientId: kari.id, name: "Carla Mendes", email: "Carla@Kari.com.br", odooPartnerId: 900 },
      { clientId: kari.id, name: "Rogério", email: null, odooPartnerId: 901 },
    ])
    .returning();
  return { fat, prov, tagTarefa, gestor, caio, julia, maria, kari, radar, hdn, brava, kTask, scheduled, carla, semEmail, A };
}

beforeAll(async () => {
  const admin = (await import("postgres")).default("postgres://postgres@localhost:5432/postgres", { max: 1, onnotice: () => {} });
  const name = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database "${name}"`);
  await admin.end();
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
  fx = await fixture();
});

afterAll(async () => {
  await pg.end();
});

const row = async (clientId: string) => (await clientPortfolio(TODAY, undefined, { clientIds: [clientId] }))[0];

describe("carteira: saúde e situação (US-30, US-45)", () => {
  it("vermelho com prazo vencido e 5+ dias úteis sem contato, com os motivos", async () => {
    const r = await row(fx.kari.id);
    expect(r.active).toBe(true);
    expect(r.health).toBe("vermelho");
    expect(r.reasons).toContain("1 prazo vencido");
    expect(r.reasons).toContain("sem contato há 8 dias úteis");
    expect(r.contactAlert).toBe(true);
    expect(r.overdueTasks).toBe(1);
    expect(r.minutes.total).toBe(120);
    expect(r.nextContact?.overdue).toBe(true);
  });

  it("amarelo com demanda adicional aguardando o cliente (o prazo dela não conta)", async () => {
    const r = await row(fx.brava.id);
    expect(r.health).toBe("amarelo");
    expect(r.reasons).toEqual(["1 demanda adicional aguardando o cliente"]);
    expect(r.demandsAwaiting).toBe(1);
    expect(r.openTasks).toBe(1);
    expect(r.workdaysSinceContact).toBe(0);
  });

  it("verde quando está tudo em dia", async () => {
    const r = await row(fx.hdn.id);
    expect(r.health).toBe("verde");
    expect(r.reasons).toEqual([]);
  });

  it("comentário do cliente sem resposta há 1 dia útil deixa vermelho", async () => {
    await db.insert(s.comments).values({ itemId: fx.kTask.id, channel: "cliente", authorContactId: fx.carla.id, body: "Conseguem olhar?", createdAt: new Date("2026-10-07T16:40:00-03:00") });
    const hdnTask = (await db.select().from(s.items).where(eq(s.items.name, "Sustentação")))[0];
    await db.insert(s.comments).values({ itemId: hdnTask.id, channel: "cliente", authorContactId: fx.carla.id, body: "Hoje", createdAt: new Date("2026-10-08T09:00:00-03:00") });
    expect((await row(fx.kari.id)).reasons).toContain("comentário do cliente sem resposta");
    // Comentário de hoje ainda não completou 1 dia útil.
    expect((await row(fx.hdn.id)).health).toBe("verde");
  });

  it("inativo: sem horas reais há mais de 6 meses (Provisionamento não conta) e sem alerta de contato", async () => {
    const r = await row(fx.radar.id);
    expect(r.active).toBe(false);
    expect(r.lastRealEntry).toBe("2026-01-10");
    expect(r.inactiveMonths).toBe(8);
    expect(situationLabel(r)).toBe("Inativo há 8 meses");
    expect(r.contactAlert).toBe(false);
    expect(r.health).toBe("verde");
    // Os inativos vão para o fim da carteira.
    const all = await clientPortfolio(TODAY);
    expect(all.at(-1)!.id).toBe(fx.radar.id);
    expect(all[0].id).toBe(fx.kari.id);
  });
});

describe("contatos (US-34 a US-37)", () => {
  it("registrar contato exige resumo", async () => {
    await expect(logContact(fx.caio, { clientId: fx.kari.id, type: "ligacao", date: TODAY, summary: "  " })).rejects.toMatchObject({ fields: { summary: expect.any(String) } });
    await expect(registerResult(fx.caio, fx.scheduled.id, { result: "realizado", summary: "" })).rejects.toThrow(/resumo/);
    const ok = await logContact(fx.caio, { clientId: fx.kari.id, type: "ligacao", date: TODAY, time: "10:00", summary: "Prazo alinhado", clientContactId: fx.carla.id });
    expect(ok.contact.status).toBe("realizado");
    const r = await row(fx.kari.id);
    expect(r.workdaysSinceContact).toBe(0);
    expect(r.reasons).not.toContain("sem contato há 8 dias úteis");
  });

  it("não registra contato futuro e não aceita contato de outro cliente", async () => {
    await expect(logContact(fx.caio, { clientId: fx.kari.id, type: "ligacao", date: "2026-10-09", summary: "x" })).rejects.toThrow(ContactError);
    const [other] = await db.insert(s.clientContacts).values({ clientId: fx.hdn.id, name: "Paulo", email: "p@hdn.com" }).returning();
    await expect(logContact(fx.caio, { clientId: fx.kari.id, type: "ligacao", date: TODAY, summary: "x", clientContactId: other.id })).rejects.toThrow(/não é do cliente/);
  });

  it("resultado Realizado com tarefa de follow-up no projeto anual (etiqueta Tarefa, fila do Odoo)", async () => {
    const res = await registerResult(fx.caio, fx.scheduled.id, {
      result: "realizado",
      summary: "Carla vai mandar o arquivo",
      followUp: { kind: "tarefa", name: "Conferir arquivo de retorno", responsibleId: fx.julia.id },
    });
    expect(res.contact.status).toBe("realizado");
    const task = res.task!;
    expect(task.annualProjectId).toBe(fx.A[fx.kari.id]);
    expect(task.deadline).toBe("2026-10-12"); // 2 dias úteis (sem feriados no banco de teste)
    const tags = await db.select().from(s.itemTags).where(eq(s.itemTags.itemId, task.id));
    expect(tags.map((t) => t.tagId)).toEqual([fx.tagTarefa.id]);
    const ass = await db.select().from(s.itemAssignees).where(eq(s.itemAssignees.itemId, task.id));
    expect(ass.map((a) => a.personId)).toEqual([fx.julia.id]);
    const q = await db.select().from(s.syncQueue).where(eq(s.syncQueue.entityId, task.id));
    expect(q).toMatchObject([{ entity: "item", op: "upsert", status: "pendente" }]);
    const [after] = await db.select().from(s.contacts).where(eq(s.contacts.id, fx.scheduled.id));
    expect(after.nextStep).toBe("Tarefa: Conferir arquivo de retorno");
  });

  it("remarcar exige nova data e motivo, e só o responsável ou a gestão remarcam", async () => {
    await expect(rescheduleContact(fx.caio, fx.scheduled.id, { date: "2026-10-13", time: "10:00", reason: "" })).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
    await expect(registerResult(fx.caio, fx.scheduled.id, { result: "remarcado", reason: "Cliente pediu" })).rejects.toMatchObject({ fields: { newDate: expect.any(String) } });
    await expect(rescheduleContact(fx.julia, fx.scheduled.id, { date: "2026-10-13", time: "10:00", reason: "Cliente pediu" })).rejects.toThrow(/responsável/);
    await expect(rescheduleContact(fx.maria, fx.scheduled.id, { date: "2026-10-13", time: "10:00", reason: "Cliente pediu" })).rejects.toThrow(/responsável/);
    await expect(rescheduleContact(fx.caio, fx.scheduled.id, { date: "2026-10-01", time: "10:00", reason: "x" })).rejects.toThrow(/futuro/);

    const res = await rescheduleContact(fx.gestor, fx.scheduled.id, { date: "2026-10-13", time: "10:00", reason: "Cliente pediu" });
    expect(res.contact.status).toBe("remarcado");
    expect(res.contact.rescheduleReason).toBe("Cliente pediu");
    expect(res.nextContact.status).toBe("agendado");
    expect(res.nextContact.responsibleId).toBe(fx.caio.id);
    expect(res.nextContact.scheduledAt.toISOString()).toBe("2026-10-13T13:00:00.000Z");
    // Evento da agenda atualizado e aviso ao responsável (só no sino).
    const cal = await db.select().from(s.outbox).where(eq(s.outbox.channel, "google_agenda"));
    expect(cal).toHaveLength(1);
    expect(cal[0].target).toBe("caio@sintesebrasil.com");
    expect(cal[0].payload).toMatchObject({ action: "update", contactId: res.nextContact.id, previousContactId: fx.scheduled.id });
    const n = await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.caio.id));
    expect(n).toMatchObject([{ event: "contato_agendado" }]);
    expect(await db.select().from(s.outbox).where(eq(s.outbox.channel, "slack_dm"))).toHaveLength(0);
  });

  it("agendar para outra pessoa (inclusive administrativo) avisa o responsável e registra o evento da agenda", async () => {
    const { contact } = await scheduleContact(fx.caio, {
      clientId: fx.hdn.id,
      type: "visita",
      responsibleId: fx.maria.id,
      date: "2026-10-09",
      time: "14:00",
      objective: "Levar o contrato",
    });
    expect(contact.status).toBe("agendado");
    const [n] = await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.maria.id));
    expect(n.event).toBe("contato_agendado");
    expect(n.link).toBe(`/contatos?sel=${contact.id}`);
    const [cal] = await db.select().from(s.outbox).where(and(eq(s.outbox.channel, "google_agenda"), eq(s.outbox.target, "maria@sintesebrasil.com")));
    expect(cal.payload).toMatchObject({ action: "create", start: "2026-10-09T17:00:00.000Z", end: "2026-10-09T18:00:00.000Z" });
    // Para si mesmo: sem aviso.
    await scheduleContact(fx.caio, { clientId: fx.hdn.id, type: "ligacao", responsibleId: fx.caio.id, date: "2026-10-09", time: "09:00", objective: "x" });
    expect(await db.select().from(s.notifications).where(eq(s.notifications.personId, fx.caio.id))).toHaveLength(0);
    // Agenda da Maria: amanhã está em "próximos 7 dias".
    const ag = await personAgenda(fx.maria.id, TODAY);
    expect(ag.next.map((c) => c.id)).toEqual([contact.id]);
    // Agenda do Caio: o contato de ontem está atrasado.
    expect((await personAgenda(fx.caio.id, TODAY)).late.map((c) => c.id)).toEqual([fx.scheduled.id]);
  });

  it("agendar valida tipo, objetivo e data", async () => {
    await expect(scheduleContact(fx.caio, { clientId: fx.hdn.id, type: "telegrama", responsibleId: fx.caio.id, date: "2026-10-09", time: "09:00", objective: "x" })).rejects.toMatchObject({ fields: { type: expect.any(String) } });
    await expect(scheduleContact(fx.caio, { clientId: fx.hdn.id, type: "ligacao", responsibleId: fx.caio.id, date: "2026-10-09", time: "09:00", objective: " " })).rejects.toMatchObject({ fields: { objective: expect.any(String) } });
    await expect(scheduleContact(fx.caio, { clientId: fx.hdn.id, type: "ligacao", responsibleId: fx.caio.id, date: "2026-10-01", time: "09:00", objective: "x" })).rejects.toThrow(/data futura/);
  });

  it("cancelar exige motivo e permissão", async () => {
    await expect(cancelContact(fx.julia, fx.scheduled.id, "x")).rejects.toThrow(/responsável/);
    await expect(cancelContact(fx.caio, fx.scheduled.id, "")).rejects.toThrow(/motivo/);
    const c = await cancelContact(fx.caio, fx.scheduled.id, "Cliente de férias");
    expect(c.status).toBe("cancelado");
    const [cal] = await db.select().from(s.outbox).where(eq(s.outbox.channel, "google_agenda"));
    expect(cal.payload).toMatchObject({ action: "cancel" });
  });
});

describe("portal e dados internos (US-30, US-31)", () => {
  it("convidar liga o acesso e manda o convite por e-mail; revogar desliga", async () => {
    await expect(inviteToPortal(fx.caio, fx.semEmail.id)).rejects.toThrow(/sem e-mail/);
    await expect(inviteToPortal(fx.maria, fx.carla.id)).rejects.toThrow(ClientError);
    const inv = await inviteToPortal(fx.caio, fx.carla.id);
    expect(inv.portalAccess).toBe(true);
    expect(inv.portalInvitedAt?.toISOString()).toBe("2026-10-08T16:00:00.000Z");
    const [n] = await db.select().from(s.notifications).where(eq(s.notifications.contactId, fx.carla.id));
    expect(n.event).toBe("convite_portal");
    const [mail] = await db.select().from(s.outbox).where(eq(s.outbox.notificationId, n.id));
    expect(mail).toMatchObject({ channel: "email", target: "carla@kari.com.br" });

    const rev = await revokePortal(fx.gestor, fx.carla.id);
    expect(rev.portalAccess).toBe(false);
    expect(rev.portalRevokedAt).not.toBeNull();
    await expect(revokePortal(fx.gestor, fx.carla.id)).rejects.toThrow(/já está sem acesso/);
    // Reconvidar limpa a revogação.
    const again = await inviteToPortal(fx.gestor, fx.carla.id);
    expect(again.portalRevokedAt).toBeNull();
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, fx.carla.id));
    expect(audits.map((a) => a.action).sort()).toEqual(["convidar_portal", "convidar_portal", "revogar_portal"]);
  });

  it("ERP e observações internas: só a gestão edita", async () => {
    await expect(updateClientInternal(fx.caio, fx.kari.id, { erp: "Odoo", internalNotes: "x" })).rejects.toThrow(/gestão/);
    const c = await updateClientInternal(fx.gestor, fx.kari.id, { erp: " Odoo 19 ", internalNotes: "Cliente prefere ligação." });
    expect(c.erp).toBe("Odoo 19");
    expect(c.internalNotes).toBe("Cliente prefere ligação.");
  });
});
