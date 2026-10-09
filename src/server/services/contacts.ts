import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now, today } from "@/lib/clock";
import { addWorkdays, isWorkday, shortDate, toISODate, weekdayShort, type ISODate } from "@/domain/dates";
import { CONTACT_TYPES, contactTypeLabel, type ContactType } from "@/components/contatos/labels";
import { audit, type Tx } from "../audit";
import { notify } from "../notify";
import { enqueueSync } from "../sync/enqueue";
import { getHolidays } from "../data/common";
import { hhmm } from "../queries/clients";
import { isManager, type TeamUser } from "../session";

/**
 * Contatos com o cliente (US-34 a US-38). Ficam só no Clarity: não vão ao Odoo e não aparecem no portal.
 * O evento na agenda Google entra na fila (outbox, canal google_agenda) para a integração futura.
 */

export class ContactError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type ScheduleInput = {
  clientId: string;
  clientContactId?: string | null;
  type: string;
  responsibleId: string;
  date: string;
  time: string;
  objective: string;
  relatedItemId?: string | null;
};

export type FollowUp =
  | { kind: "contato"; date: string; time: string; type: string; responsibleId: string; objective: string; clientContactId?: string | null }
  | { kind: "tarefa"; name: string; deadline?: string | null; responsibleId: string };

export type ResultInput = {
  result: "realizado" | "nao_atendeu" | "remarcado";
  summary?: string | null;
  nextStep?: string | null;
  newDate?: string | null;
  newTime?: string | null;
  reason?: string | null;
  followUp?: FollowUp | null;
};

export type LogInput = {
  clientId: string;
  clientContactId?: string | null;
  type: string;
  date: string;
  time?: string | null;
  summary: string;
  nextStep?: string | null;
  relatedItemId?: string | null;
  followUp?: FollowUp | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Data e hora de Brasília (UTC-3 fixo) → instante. */
export function brInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-03:00`);
}

const DURATION: Record<ContactType, number> = { ligacao: 30, visita: 60, reuniao_online: 60, email: 15, whatsapp: 15 };

function isType(t: string): t is ContactType {
  return CONTACT_TYPES.some((x) => x.value === t);
}

/** Remarcar, cancelar e registrar resultado: o responsável ou a gestão (US-34). */
export function canManageContact(me: TeamUser, c: { responsibleId: string }): boolean {
  return me.id === c.responsibleId || isManager(me);
}

async function loadClient(clientId: string) {
  const [c] = await db.select().from(s.clients).where(eq(s.clients.id, clientId));
  if (!c || !c.active) throw new ContactError("Cliente não encontrado.", { clientId: "Escolha o cliente." });
  return c;
}

async function loadPerson(id: string, field = "responsibleId") {
  const [p] = await db.select().from(s.people).where(eq(s.people.id, id));
  if (!p || !p.active) throw new ContactError("Escolha alguém do time.", { [field]: "Escolha quem vai fazer o contato." });
  return p;
}

async function checkClientContact(clientId: string, clientContactId?: string | null) {
  if (!clientContactId) return null;
  const [cc] = await db.select().from(s.clientContacts).where(eq(s.clientContacts.id, clientContactId));
  if (!cc || cc.clientId !== clientId) throw new ContactError("Este contato não é do cliente escolhido.", { clientContactId: "Escolha um contato do cliente." });
  return cc;
}

async function checkRelatedItem(clientId: string, itemId?: string | null) {
  if (!itemId) return null;
  const [row] = await db
    .select({ id: s.items.id, clientId: s.annualProjects.clientId })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(eq(s.items.id, itemId));
  if (!row || row.clientId !== clientId) throw new ContactError("O item relacionado não é deste cliente.", { relatedItemId: "Escolha um item do cliente." });
  return row;
}

function checkWhen(date: string | null | undefined, time: string | null | undefined, fields: { date: string; time: string }) {
  const errors: Record<string, string> = {};
  if (!date || !DATE_RE.test(date)) errors[fields.date] = "Escolha o dia.";
  if (!time || !TIME_RE.test(time)) errors[fields.time] = "Escolha o horário.";
  if (Object.keys(errors).length) throw new ContactError(Object.values(errors)[0], errors);
  return brInstant(date!, time!);
}

type CalendarContact = {
  id: string;
  scheduledAt: Date;
  type: string;
  objective: string;
  clientName: string;
  withName: string | null;
  responsible: { id: string; name: string; email: string };
};

/**
 * US-34: o evento na agenda Google do responsável. Enquanto o OAuth do Google não existe,
 * a intenção fica registrada no outbox (canal google_agenda) com tudo o que a integração precisa.
 */
async function queueCalendar(tx: Tx, action: "create" | "update" | "cancel", c: CalendarContact, extra: Record<string, unknown> = {}) {
  const minutes = isType(c.type) ? DURATION[c.type] : 30;
  const end = new Date(c.scheduledAt.getTime() + minutes * 60_000);
  await tx
    .insert(s.outbox)
    .values({
      channel: "google_agenda",
      target: c.responsible.email,
      payload: {
        action,
        contactId: c.id,
        calendarOwner: { personId: c.responsible.id, name: c.responsible.name, email: c.responsible.email },
        summary: `${contactTypeLabel(c.type)}: ${c.clientName}${c.withName ? ` (${c.withName})` : ""}`,
        description: c.objective,
        start: c.scheduledAt.toISOString(),
        end: end.toISOString(),
        timeZone: "America/Sao_Paulo",
        reminderMinutes: 30,
        link: `/contatos?sel=${c.id}`,
        ...extra,
      },
      dedupeKey: `gcal:${c.id}:${action}`,
      sendAfter: now(),
    })
    .onConflictDoNothing();
}

function whenText(at: Date) {
  const d = toISODate(at);
  return `${weekdayShort(d)}, ${shortDate(d)} às ${hhmm(at)}`;
}

/** Cria um contato agendado dentro de uma transação já aberta. */
async function insertScheduled(tx: Tx, me: TeamUser, input: ScheduleInput, opts: { previousId?: string; allowPast?: boolean } = {}) {
  const errors: Record<string, string> = {};
  if (!isType(input.type)) errors.type = "Escolha o tipo de contato.";
  if (!input.objective?.trim()) errors.objective = "Escreva o objetivo do contato.";
  if (Object.keys(errors).length) throw new ContactError(Object.values(errors)[0], errors);
  const at = checkWhen(input.date, input.time, { date: "date", time: "time" });
  if (!opts.allowPast && input.date < today()) throw new ContactError("Para agendar, escolha hoje ou uma data futura. Contato que já aconteceu: use Registrar contato.", { date: "Escolha hoje ou depois." });
  const [client, person, cc] = await Promise.all([loadClient(input.clientId), loadPerson(input.responsibleId), checkClientContact(input.clientId, input.clientContactId)]);
  await checkRelatedItem(input.clientId, input.relatedItemId);
  const [row] = await tx
    .insert(s.contacts)
    .values({
      clientId: client.id,
      clientContactId: cc?.id ?? null,
      type: input.type as ContactType,
      responsibleId: person.id,
      scheduledAt: at,
      objective: input.objective.trim(),
      relatedItemId: input.relatedItemId || null,
      status: "agendado",
      createdBy: me.id,
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();
  await audit(tx, { personId: me.id, entity: "contact", entityId: row.id, action: opts.previousId ? "remarcar_novo" : "agendar", after: row });
  await queueCalendar(
    tx,
    opts.previousId ? "update" : "create",
    { id: row.id, scheduledAt: at, type: row.type, objective: row.objective, clientName: client.name, withName: cc?.name ?? null, responsible: { id: person.id, name: person.name, email: person.email } },
    opts.previousId ? { previousContactId: opts.previousId } : {},
  );
  if (person.id !== me.id) {
    await notify(tx, {
      event: "contato_agendado",
      to: { personId: person.id, slackUserId: person.slackUserId },
      title: opts.previousId
        ? `${me.name} remarcou seu contato com ${client.name} para ${whenText(at)}`
        : `${me.name} agendou um contato para você: ${contactTypeLabel(row.type)} com ${client.name}, ${whenText(at)}`,
      body: row.objective,
      link: `/contatos?sel=${row.id}`,
      // Canal externo deste aviso é a agenda Google (outbox google_agenda); no Slack, nada.
      external: "none",
    });
  }
  return row;
}

/** US-34: agendar um contato para qualquer pessoa do time. */
export async function scheduleContact(me: TeamUser, input: ScheduleInput) {
  if (!me.active) throw new ContactError("Sem acesso.");
  const holidays = await getHolidays();
  const row = await db.transaction((tx) => insertScheduled(tx, me, input));
  return { contact: row, warning: isWorkday(input.date as ISODate, holidays) ? null : "Atenção: o dia escolhido não é dia útil." };
}

async function loadContact(id: string) {
  const [row] = await db
    .select({ c: s.contacts, clientName: s.clients.name, withName: s.clientContacts.name, person: s.people })
    .from(s.contacts)
    .innerJoin(s.clients, eq(s.clients.id, s.contacts.clientId))
    .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.contacts.clientContactId))
    .where(eq(s.contacts.id, id));
  if (!row) throw new ContactError("Contato não encontrado.");
  return row;
}

/** US-36: tarefa simples no projeto anual do cliente (etiqueta Tarefa), enviada ao Odoo pela fila. */
async function createFollowUpTask(tx: Tx, me: TeamUser, clientId: string, f: Extract<FollowUp, { kind: "tarefa" }>, context: string) {
  const name = f.name?.trim();
  if (!name) throw new ContactError("Dê um nome para a tarefa.", { taskName: "Nome da tarefa." });
  if (f.deadline && !DATE_RE.test(f.deadline)) throw new ContactError("Prazo inválido.", { taskDeadline: "Escolha uma data." });
  const person = await loadPerson(f.responsibleId, "taskResponsibleId");
  const t = today();
  const year = Number(t.slice(0, 4));
  const [annual] = await tx
    .select()
    .from(s.annualProjects)
    .where(and(eq(s.annualProjects.clientId, clientId), eq(s.annualProjects.year, year), eq(s.annualProjects.active, true)));
  if (!annual) throw new ContactError(`Este cliente não tem projeto anual de ${year} no Clarity. Crie o projeto anual no Odoo e sincronize.`);
  const deadline = f.deadline || addWorkdays(t, 2, await getHolidays());
  const [item] = await tx
    .insert(s.items)
    .values({
      annualProjectId: annual.id,
      kind: "tarefa",
      name,
      description: context,
      stage: "andamento",
      scopeStatus: "confirmado",
      startDate: t,
      deadline,
      syncStatus: "pendente",
      createdBy: me.id,
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();
  await tx.insert(s.itemAssignees).values({ itemId: item.id, personId: person.id });
  const [tag] = await tx.select().from(s.tags).where(and(eq(s.tags.name, "Tarefa"), eq(s.tags.system, true)));
  if (tag) await tx.insert(s.itemTags).values({ itemId: item.id, tagId: tag.id });
  await tx.insert(s.stageHistory).values({ itemId: item.id, fromStage: null, toStage: "andamento", byPersonId: me.id, at: now() });
  await audit(tx, { personId: me.id, entity: "item", entityId: item.id, action: "criar_followup_contato", after: item });
  await enqueueSync(tx, "item", item.id, "upsert");
  return item;
}

async function applyFollowUp(tx: Tx, me: TeamUser, clientId: string, f: FollowUp | null | undefined, context: string) {
  if (!f) return { nextContact: null, task: null };
  if (f.kind === "contato") {
    try {
      const nextContact = await insertScheduled(tx, me, {
        clientId,
        clientContactId: f.clientContactId ?? null,
        type: f.type,
        responsibleId: f.responsibleId,
        date: f.date,
        time: f.time,
        objective: f.objective,
      });
      return { nextContact, task: null };
    } catch (e) {
      // Erros do próximo contato ganham o prefixo "fu" para não se misturarem aos campos do resultado.
      if (!(e instanceof ContactError)) throw e;
      const fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`fu${k.charAt(0).toUpperCase()}${k.slice(1)}`, v]));
      throw new ContactError(`Próximo contato: ${e.message}`, fields);
    }
  }
  return { nextContact: null, task: await createFollowUpTask(tx, me, clientId, f, context) };
}

/** US-36: registrar o resultado de um contato agendado (Realizado / Não atendeu / Remarcado). */
export async function registerResult(me: TeamUser, contactId: string, input: ResultInput) {
  const row = await loadContact(contactId);
  const c = row.c;
  if (!canManageContact(me, c)) throw new ContactError("Só o responsável pelo contato ou a gestão registram o resultado.");
  if (c.status !== "agendado") throw new ContactError("Este contato já tem resultado registrado.");
  if (input.result === "remarcado") return rescheduleContact(me, contactId, { date: input.newDate, time: input.newTime, reason: input.reason });
  const summary = input.summary?.trim() || null;
  if (input.result === "realizado" && !summary) throw new ContactError("Escreva um resumo do que foi conversado.", { summary: "O resumo é obrigatório." });
  if (input.result !== "realizado" && input.result !== "nao_atendeu") throw new ContactError("Escolha o resultado.");
  const at = now();
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.contacts)
      .set({
        status: input.result,
        resultSummary: summary,
        nextStep: input.nextStep?.trim() || null,
        doneAt: at,
        // Feito antes da hora marcada: o contato conta na data em que aconteceu.
        scheduledAt: c.scheduledAt > at ? at : c.scheduledAt,
        updatedAt: at,
      })
      .where(eq(s.contacts.id, contactId))
      .returning();
    const context = `Follow-up do contato de ${shortDate(toISODate(after.scheduledAt))} (${contactTypeLabel(c.type)}${row.withName ? ` com ${row.withName}` : ""}): ${summary ?? "não atendeu"}`;
    const fu = await applyFollowUp(tx, me, c.clientId, input.followUp, context);
    if (fu.task && !after.nextStep) await tx.update(s.contacts).set({ nextStep: `Tarefa: ${fu.task.name}` }).where(eq(s.contacts.id, contactId));
    await audit(tx, { personId: me.id, entity: "contact", entityId: contactId, action: `resultado_${input.result}`, before: c, after });
    return { contact: after, ...fu };
  });
}

/** US-34/US-36: remarcar (nova data e motivo obrigatórios). O contato antigo fica no histórico como Remarcado. */
export async function rescheduleContact(me: TeamUser, contactId: string, input: { date?: string | null; time?: string | null; reason?: string | null }) {
  const row = await loadContact(contactId);
  const c = row.c;
  if (!canManageContact(me, c)) throw new ContactError("Só o responsável pelo contato ou a gestão podem remarcar.");
  if (c.status !== "agendado") throw new ContactError("Só contatos agendados podem ser remarcados.");
  const reason = input.reason?.trim();
  const errors: Record<string, string> = {};
  if (!input.date || !DATE_RE.test(input.date)) errors.newDate = "Escolha a nova data.";
  if (!input.time || !TIME_RE.test(input.time)) errors.newTime = "Escolha o novo horário.";
  if (!reason) errors.reason = "Informe o motivo.";
  if (Object.keys(errors).length) throw new ContactError(errors.reason && Object.keys(errors).length === 1 ? "Para remarcar, informe o motivo." : "Para remarcar, informe a nova data, o horário e o motivo.", errors);
  if (brInstant(input.date!, input.time!) <= now()) throw new ContactError("A nova data precisa ser no futuro.", { newDate: "Escolha uma data futura." });
  return db.transaction(async (tx) => {
    const [old] = await tx
      .update(s.contacts)
      .set({ status: "remarcado", rescheduleReason: reason!, updatedAt: now() })
      .where(eq(s.contacts.id, contactId))
      .returning();
    const next = await insertScheduled(
      tx,
      me,
      {
        clientId: c.clientId,
        clientContactId: c.clientContactId,
        type: c.type,
        responsibleId: c.responsibleId,
        date: input.date!,
        time: input.time!,
        objective: c.objective,
        relatedItemId: c.relatedItemId,
      },
      { previousId: c.id },
    );
    if (c.googleEventId) await tx.update(s.contacts).set({ googleEventId: c.googleEventId }).where(eq(s.contacts.id, next.id));
    await audit(tx, { personId: me.id, entity: "contact", entityId: contactId, action: "remarcar", before: c, after: { ...old, newContactId: next.id } });
    return { contact: old, nextContact: next, task: null };
  });
}

/** Cancelar um contato agendado (responsável ou gestão), com motivo. Atualiza o evento da agenda. */
export async function cancelContact(me: TeamUser, contactId: string, reason: string) {
  const row = await loadContact(contactId);
  const c = row.c;
  if (!canManageContact(me, c)) throw new ContactError("Só o responsável pelo contato ou a gestão podem cancelar.");
  if (c.status !== "agendado") throw new ContactError("Só contatos agendados podem ser cancelados.");
  if (!reason?.trim()) throw new ContactError("Informe o motivo do cancelamento.", { reason: "Informe o motivo." });
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.contacts)
      .set({ status: "cancelado", rescheduleReason: reason.trim(), updatedAt: now() })
      .where(eq(s.contacts.id, contactId))
      .returning();
    await queueCalendar(tx, "cancel", {
      id: c.id,
      scheduledAt: c.scheduledAt,
      type: c.type,
      objective: c.objective,
      clientName: row.clientName,
      withName: row.withName,
      responsible: { id: row.person.id, name: row.person.name, email: row.person.email },
    });
    await audit(tx, { personId: me.id, entity: "contact", entityId: contactId, action: "cancelar", before: c, after });
    return after;
  });
}

/** US-36/US-37: registrar um contato que já aconteceu (sem agendamento prévio). Quem registra é o responsável. */
export async function logContact(me: TeamUser, input: LogInput) {
  if (!me.active) throw new ContactError("Sem acesso.");
  const errors: Record<string, string> = {};
  if (!isType(input.type)) errors.type = "Escolha o tipo de contato.";
  if (!input.summary?.trim()) errors.summary = "O resumo é obrigatório.";
  if (!input.date || !DATE_RE.test(input.date)) errors.date = "Escolha o dia.";
  if (input.time && !TIME_RE.test(input.time)) errors.time = "Horário inválido.";
  if (Object.keys(errors).length) throw new ContactError(errors.summary ? "Escreva um resumo do que foi conversado." : Object.values(errors)[0], errors);
  if (input.date > today()) throw new ContactError("Contato futuro se agenda, não se registra.", { date: "Escolha hoje ou antes." });
  const [client, cc] = await Promise.all([loadClient(input.clientId), checkClientContact(input.clientId, input.clientContactId)]);
  await checkRelatedItem(input.clientId, input.relatedItemId);
  const t = now();
  const at = input.time ? brInstant(input.date, input.time) : input.date === today() ? t : brInstant(input.date, "12:00");
  if (at > t) throw new ContactError("Esse horário ainda não chegou. Agende o contato ou ajuste o horário.", { time: "Horário no futuro." });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.contacts)
      .values({
        clientId: client.id,
        clientContactId: cc?.id ?? null,
        type: input.type as ContactType,
        responsibleId: me.id,
        scheduledAt: at,
        objective: "Contato registrado",
        relatedItemId: input.relatedItemId || null,
        status: "realizado",
        resultSummary: input.summary.trim(),
        nextStep: input.nextStep?.trim() || null,
        doneAt: t,
        createdBy: me.id,
        createdAt: t,
        updatedAt: t,
      })
      .returning();
    await audit(tx, { personId: me.id, entity: "contact", entityId: row.id, action: "registrar", after: row });
    const context = `Follow-up do contato de ${shortDate(input.date)} (${contactTypeLabel(row.type)}${cc ? ` com ${cc.name}` : ""}): ${row.resultSummary}`;
    const fu = await applyFollowUp(tx, me, client.id, input.followUp, context);
    if (fu.task && !row.nextStep) await tx.update(s.contacts).set({ nextStep: `Tarefa: ${fu.task.name}` }).where(eq(s.contacts.id, row.id));
    return { contact: row, ...fu };
  });
}
