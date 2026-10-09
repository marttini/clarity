import "server-only";
import { and, asc, eq, inArray, isNull, isNotNull, lt, lte, max, min, ne, sql, desc } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now as clockNow, today as clockToday } from "@/lib/clock";
import {
  addDays,
  addWorkdays,
  isWorkday,
  longDate,
  shortDate,
  toISODate,
  workdaysSince,
  type ISODate,
} from "@/domain/dates";
import { contactAlert, currentMissingStreak, isClientActive, nextBusinessInstant } from "@/domain/rules";
import { MANDATORY, notify, type NotifyEvent } from "../notify";
import { audit } from "../audit";
import { getHolidays, getSettings } from "../data/common";
import { Forbidden, isManager, type TeamUser } from "../session";
import { ChannelError, postSlackMessage, type FetchLike } from "../channels/slack";
import { emailHtml, sendEmail } from "../channels/email";
import { getMutes } from "./settings";

/**
 * Central de avisos (US-43): envio do outbox (Slack e e-mail), sino e rotina diária
 * de lembretes com o resumo da gestão.
 */

export const MAX_SEND_ATTEMPTS = 5;
const STUCK_MINUTES = 15;

/** Espera antes da próxima tentativa: 5 min, 15 min, 1 h, 4 h. */
export function retryDelayMinutes(attempts: number): number {
  return [5, 15, 60, 240][Math.min(Math.max(attempts, 1), 4) - 1];
}

export function notifyMode(): "dry-run" | "live" {
  return process.env.NOTIFY_MODE === "live" ? "live" : "dry-run";
}

export function gestaoChannel(): string {
  return process.env.SLACK_GESTAO_CHANNEL || "#clarity-gestao";
}

function absoluteUrl(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + (link.startsWith("/") ? link : "/" + link);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = { title?: string; body?: string; link?: string | null };

export type SendSummary = { claimed: number; sent: number; retrying: number; failed: number; cancelled: number; deferred: number; mode: "dry-run" | "live" };

/**
 * Processa o outbox pendente com send_after <= agora.
 * NOTIFY_MODE=dry-run (padrão) só registra como enviado, sem chamar a rede.
 */
export async function sendOutbox(opts: { now?: Date; limit?: number; fetchImpl?: FetchLike; mode?: "dry-run" | "live" } = {}): Promise<SendSummary> {
  const at = opts.now ?? clockNow();
  const limit = opts.limit ?? 100;
  const mode = opts.mode ?? notifyMode();
  const sum: SendSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0, cancelled: 0, deferred: 0, mode };

  // Linhas presas em "processando" (rotina caiu no meio) voltam para a fila.
  await db
    .update(s.outbox)
    .set({ status: "pendente" })
    .where(and(eq(s.outbox.status, "processando"), lt(s.outbox.sendAfter, new Date(at.getTime() - STUCK_MINUTES * 60_000))));

  const due = await db
    .select({ id: s.outbox.id })
    .from(s.outbox)
    .where(and(eq(s.outbox.status, "pendente"), lte(s.outbox.sendAfter, at)))
    .orderBy(asc(s.outbox.sendAfter))
    .limit(limit);
  if (!due.length) return sum;
  const claimed = await db
    .update(s.outbox)
    .set({ status: "processando" })
    .where(and(inArray(s.outbox.id, due.map((d) => d.id)), eq(s.outbox.status, "pendente")))
    .returning();
  sum.claimed = claimed.length;

  const holidays = await getHolidays();
  const settings = await getSettings();
  const notifIds = claimed.map((r) => r.notificationId).filter((x): x is string => !!x);
  const notifs = notifIds.length ? await db.select().from(s.notifications).where(inArray(s.notifications.id, notifIds)) : [];
  const nById = new Map(notifs.map((n) => [n.id, n]));
  const mutes = new Map<string, NotifyEvent[]>();

  for (const row of claimed) {
    const n = row.notificationId ? nById.get(row.notificationId) : undefined;
    const event = (n?.event ?? null) as NotifyEvent | null;
    const urgent = event === "erro_sincronizacao";
    const finish = (set: Partial<typeof s.outbox.$inferInsert>) => db.update(s.outbox).set(set).where(eq(s.outbox.id, row.id));

    // Horário comercial: segunda barreira (vale também para novas tentativas).
    if (!urgent) {
      const allowed = nextBusinessInstant(at, holidays, settings);
      if (allowed.getTime() > at.getTime()) {
        await finish({ status: "pendente", sendAfter: allowed });
        sum.deferred++;
        continue;
      }
    }

    // Pessoa silenciou este aviso informativo: fica só no sino.
    if (n?.personId && event && !MANDATORY.includes(event)) {
      if (!mutes.has(n.personId)) mutes.set(n.personId, await getMutes(n.personId));
      if (mutes.get(n.personId)!.includes(event)) {
        await finish({ status: "cancelado", lastError: "silenciado pela pessoa" });
        sum.cancelled++;
        continue;
      }
    }

    if (row.channel === "google_agenda") {
      await finish({ status: "cancelado", lastError: "integração Google Agenda pendente" });
      sum.cancelled++;
      continue;
    }

    const p = (row.payload ?? {}) as Payload;
    const title = p.title ?? n?.title ?? "Aviso do Clarity";
    const body = p.body ?? n?.body ?? "";
    const url = absoluteUrl(p.link ?? n?.link ?? null);

    try {
      if (row.channel === "slack_dm") {
        let target: string | null = null;
        if (n?.personId) {
          const [person] = await db.select({ slack: s.people.slackUserId }).from(s.people).where(eq(s.people.id, n.personId));
          target = person?.slack || null;
        }
        if (!target && row.target && !UUID.test(row.target)) target = row.target;
        if (!target) throw new ChannelError("pessoa sem Slack configurado", false);
        const text = [`*${title}*`, body, url ? `<${url}|Abrir no Clarity>` : ""].filter(Boolean).join("\n");
        if (mode === "live") await postSlackMessage({ channel: target, text }, { fetchImpl: opts.fetchImpl });
      } else if (row.channel === "slack_canal") {
        const channel = row.target || gestaoChannel();
        const text = [`*${title}*`, body, url ? `<${url}|Abrir no Clarity>` : ""].filter(Boolean).join("\n");
        if (mode === "live") await postSlackMessage({ channel, text }, { fetchImpl: opts.fetchImpl });
      } else if (row.channel === "email") {
        const text = [body, url ? `Abrir no portal: ${url}` : "", "Síntese · Presente na sua gestão"].filter(Boolean).join("\n\n");
        if (mode === "live") await sendEmail({ to: row.target, subject: title, text, html: emailHtml({ title, body, url }) }, { fetchImpl: opts.fetchImpl });
      }
      await finish({ status: "feito", sentAt: at, attempts: row.attempts + 1, lastError: null });
      sum.sent++;
    } catch (e) {
      const err = e instanceof ChannelError ? e : new ChannelError(e instanceof Error ? e.message : String(e), true);
      const attempts = row.attempts + 1;
      if (!err.retryable || attempts >= MAX_SEND_ATTEMPTS) {
        await finish({ status: "erro", attempts, lastError: err.message.slice(0, 500) });
        sum.failed++;
      } else {
        await finish({ status: "pendente", attempts, lastError: err.message.slice(0, 500), sendAfter: new Date(at.getTime() + retryDelayMinutes(attempts) * 60_000) });
        sum.retrying++;
      }
    }
  }
  return sum;
}

/** "Reenviar" na lista de avisos enviados (gestão). */
export async function resendOutbox(me: TeamUser, id: string) {
  if (!isManager(me)) throw new Forbidden("Só a gestão reenvia avisos.");
  const [row] = await db.select().from(s.outbox).where(eq(s.outbox.id, id));
  if (!row) throw new Error("Aviso não encontrado.");
  if (row.status !== "erro" && row.status !== "cancelado") throw new Error("Só avisos que falharam podem ser reenviados.");
  await db.update(s.outbox).set({ status: "pendente", attempts: 0, lastError: null, sendAfter: clockNow() }).where(eq(s.outbox.id, id));
  await audit(db, { personId: me.id, entity: "outbox", entityId: id, action: "reenviar", before: { status: row.status, lastError: row.lastError } });
}

// ---------- Sino ----------

export async function markRead(me: TeamUser, id: string) {
  await db
    .update(s.notifications)
    .set({ readAt: clockNow() })
    .where(and(eq(s.notifications.id, id), eq(s.notifications.personId, me.id), isNull(s.notifications.readAt)));
}

export async function markAllRead(me: TeamUser) {
  await db.update(s.notifications).set({ readAt: clockNow() }).where(and(eq(s.notifications.personId, me.id), isNull(s.notifications.readAt)));
}

// ---------- Rotina diária (US-43) ----------

export type DigestData = {
  today: ISODate;
  missing: { name: string; days: number }[];
  comments: { client: string; item: string; workdays: number }[];
  demands: { client: string; item: string; workdays: number }[];
  noContact: { client: string; workdays: number | null }[];
  overdue: number;
};

/** Texto curto do resumo diário da gestão (#clarity-gestao). */
export function buildDigest(d: DigestData): { title: string; body: string } {
  const title = `Resumo da gestão, ${longDate(d.today)}`;
  const dias = (n: number) => (n === 1 ? "1 dia útil" : `${n} dias úteis`);
  const block = (head: string, lines: string[]) => (lines.length ? [`${head} (${lines.length})`, ...lines.slice(0, 8).map((l) => `• ${l}`), ...(lines.length > 8 ? [`• e mais ${lines.length - 8}`] : [])].join("\n") : "");
  const parts = [
    block("Sem apontar há 3 dias úteis ou mais", d.missing.map((m) => `${m.name}: ${dias(m.days)}`)),
    block("Comentários de cliente sem resposta", d.comments.map((c) => `${c.client}: ${c.item} (há ${dias(c.workdays)})`)),
    block("Demandas adicionais aguardando o cliente", d.demands.map((c) => `${c.client}: ${c.item} (há ${dias(c.workdays)})`)),
    block("Clientes ativos sem contato", d.noContact.map((c) => `${c.client}: ${c.workdays === null ? "nenhum contato registrado" : `há ${dias(c.workdays)}`}`)),
    d.overdue ? `Prazos vencidos: ${d.overdue}` : "",
  ].filter(Boolean);
  return { title, body: parts.length ? parts.join("\n\n") : "Tudo em dia. Nenhuma pendência da gestão hoje." };
}

async function alreadyQueued(key: string) {
  const [hit] = await db.select({ id: s.outbox.id }).from(s.outbox).where(eq(s.outbox.dedupeKey, key));
  return !!hit;
}

/** Lembrete com no máximo um envio por dia por pendência (dedupe pelo outbox). */
async function remind(key: string, ev: Parameters<typeof notify>[1]): Promise<boolean> {
  if (await alreadyQueued(key)) return false;
  await notify(db, { ...ev, external: "direct", dedupeKey: key });
  return true;
}

export type DailySummary = {
  skipped?: string;
  diaSemApontamento: number;
  tresDias: number;
  provisionamento: number;
  prazo: number;
  contatoAtrasado: number;
  comentarioSemResposta: number;
  demandaCliente: number;
  resumo: boolean;
};

/**
 * Lembretes diários (dias úteis, 8h). `part: "fim-do-dia"` só envia o lembrete de dia sem apontamento de hoje.
 */
export async function runDaily(opts: { now?: Date; part?: "manha" | "fim-do-dia" } = {}): Promise<DailySummary> {
  const at = opts.now ?? clockNow();
  const today = opts.now ? toISODate(opts.now) : clockToday();
  const part = opts.part ?? "manha";
  const holidays = await getHolidays();
  const st = await getSettings();
  const out: DailySummary = { diaSemApontamento: 0, tresDias: 0, provisionamento: 0, prazo: 0, contatoAtrasado: 0, comentarioSemResposta: 0, demandaCliente: 0, resumo: false };
  if (!isWorkday(today, holidays)) return { ...out, skipped: "Hoje não é dia útil." };

  // ----- Apontamento (US-11) -----
  const consultants = await db.select().from(s.people).where(and(eq(s.people.active, true), eq(s.people.isConsultor, true)));
  const floor = addDays(today, -60);
  const entryDays = await db
    .select({ personId: s.timeEntries.personId, date: s.timeEntries.date })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .where(and(isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, false), sql`${s.timeEntries.date} >= ${floor}`, lte(s.timeEntries.date, today)))
    .groupBy(s.timeEntries.personId, s.timeEntries.date);
  const firstEntry = await db.select({ personId: s.timeEntries.personId, d: min(s.timeEntries.date) }).from(s.timeEntries).groupBy(s.timeEntries.personId);
  const justified = await db
    .select({ personId: s.absenceJustifications.personId, date: s.absenceJustifications.date })
    .from(s.absenceJustifications)
    .where(sql`${s.absenceJustifications.date} >= ${floor}`);
  const byPerson = (rows: { personId: string; date: string }[]) => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!m.has(r.personId)) m.set(r.personId, new Set());
      m.get(r.personId)!.add(r.date);
    }
    return m;
  };
  const eDays = byPerson(entryDays);
  const jDays = byPerson(justified);
  const first = new Map(firstEntry.map((r) => [r.personId, r.d]));
  const prevWorkday = (() => {
    let d = addDays(today, -1);
    while (!isWorkday(d, holidays)) d = addDays(d, -1);
    return d;
  })();
  const missing: DigestData["missing"] = [];

  for (const p of consultants) {
    const has = eDays.get(p.id) ?? new Set<string>();
    const just = jDays.get(p.id) ?? new Set<string>();
    if (part === "fim-do-dia") {
      if (!has.has(today) && !just.has(today)) {
        if (await remind(`dia-sem:${p.id}:${today}`, { event: "dia_sem_apontamento", to: { personId: p.id, slackUserId: p.slackUserId }, title: "Você ainda não apontou horas hoje", body: `Lance as horas de ${longDate(today)} antes de encerrar o dia.`, link: "/fila#lancar" }))
          out.diaSemApontamento++;
      }
      continue;
    }
    const created = toISODate(p.createdAt);
    const firstD = first.get(p.id);
    const since = firstD && firstD < created ? firstD : created;
    const streak = currentMissingStreak({ today, daysWithEntries: has, justifiedDays: just, holidays, since });
    if (streak.length >= st.missingDaysLimit) {
      missing.push({ name: p.name, days: streak.length });
      if (
        await remind(`tres-dias:${p.id}:${today}`, {
          event: "tres_dias_sem_apontamento",
          to: { personId: p.id, slackUserId: p.slackUserId },
          title: `${streak.length} dias úteis seguidos sem apontamento`,
          body: `Dias sem horas: ${streak.map(shortDate).join(", ")}. Aponte as horas ou registre a justificativa com comprovante.`,
          link: "/horas",
        })
      )
        out.tresDias++;
    } else if (streak.includes(prevWorkday)) {
      if (await remind(`dia-sem:${p.id}:${prevWorkday}`, { event: "dia_sem_apontamento", to: { personId: p.id, slackUserId: p.slackUserId }, title: `Sem horas em ${shortDate(prevWorkday)}`, body: `Você não apontou horas em ${longDate(prevWorkday)}. Lance agora ou registre a justificativa.`, link: "/horas" }))
        out.diaSemApontamento++;
    }
  }
  if (part === "fim-do-dia") return out;

  // ----- Provisionamento a converter (US-12) -----
  const provs = await db
    .select({ id: s.timeEntries.id, personId: s.timeEntries.personId, minutes: s.timeEntries.minutes, item: s.items.name, slack: s.people.slackUserId })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.people, eq(s.people.id, s.timeEntries.personId))
    .where(and(eq(s.entryTypes.isProvisioning, true), eq(s.timeEntries.date, today), isNull(s.timeEntries.deletedAt), eq(s.people.active, true)));
  for (const e of provs)
    if (await remind(`provisionamento:${e.id}:${today}`, { event: "provisionamento_converter", to: { personId: e.personId, slackUserId: e.slack }, title: "Provisionamento para converter hoje", body: `"${e.item}": confirme as horas reais de hoje.`, link: "/horas" }))
      out.provisionamento++;

  // ----- Prazos: vence amanhã (ou hoje) ou venceu -----
  const limit = addWorkdays(today, 1, holidays);
  const due = await db
    .select({ id: s.items.id, name: s.items.name, deadline: s.items.deadline, personId: s.itemAssignees.personId, slack: s.people.slackUserId })
    .from(s.items)
    .innerJoin(s.itemAssignees, eq(s.itemAssignees.itemId, s.items.id))
    .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
    .where(and(ne(s.items.stage, "concluido"), eq(s.items.archived, false), isNotNull(s.items.deadline), lte(s.items.deadline, limit), ne(s.items.clientApproval, "recusada"), eq(s.people.active, true)));
  const overdueItems = new Set<string>();
  for (const d of due) {
    const dl = d.deadline!;
    if (dl < today) overdueItems.add(d.id);
    const title = dl < today ? `Prazo vencido: ${d.name}` : dl === today ? `Prazo vence hoje: ${d.name}` : `Prazo vence ${dl === addDays(today, 1) ? "amanhã" : `em ${shortDate(dl)}`}: ${d.name}`;
    if (await remind(`prazo:${d.id}:${d.personId}:${today}`, { event: "prazo", to: { personId: d.personId, slackUserId: d.slack }, title, body: dl < today ? `Venceu em ${shortDate(dl)}. Conclua ou altere o prazo com motivo.` : `Prazo: ${shortDate(dl)}.`, link: `/projetos/${d.id}` }))
      out.prazo++;
  }

  // ----- Contato atrasado (US-34/36) -----
  const late = await db
    .select({ id: s.contacts.id, objective: s.contacts.objective, scheduledAt: s.contacts.scheduledAt, client: s.clients.name, personId: s.contacts.responsibleId, slack: s.people.slackUserId })
    .from(s.contacts)
    .innerJoin(s.clients, eq(s.clients.id, s.contacts.clientId))
    .innerJoin(s.people, eq(s.people.id, s.contacts.responsibleId))
    .where(and(eq(s.contacts.status, "agendado"), lt(s.contacts.scheduledAt, at), eq(s.people.active, true)));
  for (const c of late)
    if (await remind(`contato-atrasado:${c.id}:${today}`, { event: "contato_atrasado", to: { personId: c.personId, slackUserId: c.slack }, title: `Contato atrasado: ${c.client}`, body: `${c.objective} (agendado para ${shortDate(toISODate(c.scheduledAt))}). Registre o resultado ou remarque.`, link: "/contatos" }))
      out.contatoAtrasado++;

  // ----- Comentário do cliente sem resposta (US-41) -----
  const open = await db
    .select({ id: s.comments.id, createdAt: s.comments.createdAt, itemId: s.items.id, item: s.items.name, client: s.clients.name })
    .from(s.comments)
    .innerJoin(s.items, eq(s.items.id, s.comments.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(eq(s.comments.channel, "cliente"), isNotNull(s.comments.authorContactId), isNull(s.comments.answeredAt), isNull(s.comments.deletedAt)));
  const comments: DigestData["comments"] = [];
  const assignees = async (itemId: string) =>
    db
      .select({ id: s.people.id, slack: s.people.slackUserId })
      .from(s.itemAssignees)
      .innerJoin(s.people, eq(s.people.id, s.itemAssignees.personId))
      .where(and(eq(s.itemAssignees.itemId, itemId), eq(s.people.active, true)));
  for (const c of open) {
    const n = workdaysSince(toISODate(c.createdAt), today, holidays);
    if (n < st.clientCommentAlertWorkdays) continue;
    comments.push({ client: c.client, item: c.item, workdays: n });
    for (const a of await assignees(c.itemId))
      if (await remind(`comentario-sem-resposta:${c.id}:${a.id}:${today}`, { event: "comentario_sem_resposta", to: { personId: a.id, slackUserId: a.slack }, title: `${c.client} espera resposta em "${c.item}"`, body: `Comentário do cliente sem resposta há ${n === 1 ? "1 dia útil" : `${n} dias úteis`}.`, link: `/projetos/${c.itemId}` }))
        out.comentarioSemResposta++;
  }

  // ----- Demanda adicional aguardando o cliente (US-27) -----
  const waiting = await db
    .select({ id: s.items.id, name: s.items.name, requestedAt: s.items.requestedAt, createdAt: s.items.createdAt, visible: s.items.visibleToClient, clientId: s.clients.id, client: s.clients.name })
    .from(s.items)
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
    .where(and(eq(s.items.outOfScope, true), eq(s.items.clientApproval, "aguardando"), eq(s.items.archived, false)));
  const demands: DigestData["demands"] = [];
  for (const d of waiting) {
    const base = d.requestedAt ?? toISODate(d.createdAt);
    const n = workdaysSince(base, today, holidays);
    demands.push({ client: d.client, item: d.name, workdays: n });
    if (!d.visible || n < 2 || n % 2 !== 0) continue;
    const contacts = await db
      .select()
      .from(s.clientContacts)
      .where(and(eq(s.clientContacts.clientId, d.clientId), eq(s.clientContacts.portalAccess, true), eq(s.clientContacts.active, true), isNull(s.clientContacts.portalRevokedAt), isNotNull(s.clientContacts.email)));
    for (const c of contacts)
      if (await remind(`demanda-cliente:${d.id}:${c.id}:${today}`, { event: "demanda_aguardando_cliente", to: { contactId: c.id, email: c.email! }, title: `Lembrete: "${d.name}" aguarda sua aprovação`, body: `Esta demanda adicional foi pedida em ${shortDate(base)} e só começa depois da sua aprovação no portal.`, link: "/portal/demandas" }))
        out.demandaCliente++;
  }

  // ----- Cliente ativo sem contato (US-37) -----
  const clients = await db.select().from(s.clients).where(and(eq(s.clients.active, true), eq(s.clients.isInternal, false)));
  const lastEntry = await db
    .select({ clientId: s.annualProjects.clientId, d: max(s.timeEntries.date) })
    .from(s.timeEntries)
    .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
    .innerJoin(s.items, eq(s.items.id, s.timeEntries.itemId))
    .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
    .where(and(isNull(s.timeEntries.deletedAt), eq(s.entryTypes.isProvisioning, false), lte(s.timeEntries.date, today)))
    .groupBy(s.annualProjects.clientId);
  const lastContact = await db
    .select({ clientId: s.contacts.clientId, at: max(sql<Date>`coalesce(${s.contacts.doneAt}, ${s.contacts.scheduledAt})`) })
    .from(s.contacts)
    .where(eq(s.contacts.status, "realizado"))
    .groupBy(s.contacts.clientId);
  const le = new Map(lastEntry.map((r) => [r.clientId, r.d]));
  const lc = new Map(lastContact.map((r) => [r.clientId, r.at ? toISODate(new Date(r.at)) : null]));
  const noContact: DigestData["noContact"] = [];
  for (const c of clients) {
    if (!isClientActive(le.get(c.id) ?? null, today, st)) continue;
    const a = contactAlert(lc.get(c.id) ?? null, today, holidays, st);
    if (a.alert) noContact.push({ client: c.name, workdays: a.workdays });
  }

  // ----- Resumo diário da gestão: um único aviso no #clarity-gestao -----
  const digest = buildDigest({ today, missing, comments, demands, noContact, overdue: overdueItems.size });
  const inserted = await db
    .insert(s.outbox)
    .values({ channel: "slack_canal", target: gestaoChannel(), payload: { ...digest, link: "/gestao" }, dedupeKey: `resumo:${today}`, sendAfter: nextBusinessInstant(at, holidays, st) })
    .onConflictDoNothing()
    .returning({ id: s.outbox.id });
  if (inserted.length) {
    out.resumo = true;
    const managers = await db.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.active, true), inArray(s.people.role, ["administrador", "gestor"])));
    if (managers.length)
      await db.insert(s.notifications).values(managers.map((m) => ({ personId: m.id, event: "resumo_gestao", title: digest.title, body: digest.body, link: "/gestao" })));
  }
  return out;
}

// ---------- Consultas para as telas ----------

export async function unreadCount(personId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.notifications)
    .where(and(eq(s.notifications.personId, personId), isNull(s.notifications.readAt)));
  return r?.n ?? 0;
}

export async function listMyNotifications(personId: string, limit = 100) {
  return db.select().from(s.notifications).where(eq(s.notifications.personId, personId)).orderBy(desc(s.notifications.createdAt)).limit(limit);
}

