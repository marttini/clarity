import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, eq, ne, gte, lte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { DEFAULT_SETTINGS, type Settings } from "@/domain/rules";
import { nationalHolidays } from "@/domain/dates";
import { audit } from "../audit";
import { Forbidden, isAdmin, type TeamUser } from "../session";
import { MANDATORY, type NotifyEvent } from "../notify";
import { DEFAULT_ODOO_FIELDS, type OdooFields } from "../odoo/fields";

/**
 * Configurações (só Administrador): pessoas e perfis (US-32), tipos de apontamento (US-08),
 * metas e faixas (US-50), regras, feriados, motivos de ausência, integração Odoo,
 * links de TV (US-49) e preferências de avisos (US-43).
 */
export class SettingsError extends Error {}

function admin(me: TeamUser) {
  if (!isAdmin(me)) throw new Forbidden("Só o Administrador muda as configurações.");
}

async function putSetting(me: TeamUser, key: string, value: unknown) {
  const [before] = await db.select().from(s.settings).where(eq(s.settings.key, key));
  await db.transaction(async (tx) => {
    await tx
      .insert(s.settings)
      .values({ key, value: value as object, updatedBy: me.id, updatedAt: now() })
      .onConflictDoUpdate({ target: s.settings.key, set: { value: value as object, updatedBy: me.id, updatedAt: now() } });
    await audit(tx, { personId: me.id, entity: "settings", entityId: me.id, action: `config:${key}`, before: before?.value ?? null, after: value });
  });
}

/** Lê as regras sem cache (telas de configuração e rotinas). */
export async function readRules(): Promise<Settings> {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "rules"));
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

// ---------- Metas, faixas e regras ----------

const posInt = (v: unknown, label: string, min = 1, max = 100000) => {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) throw new SettingsError(`${label}: use um número inteiro entre ${min} e ${max}.`);
  return n;
};

export function validateBandsAndGoals(input: { bands: Settings["bands"]; teamGoals: Settings["teamGoals"] }) {
  const b = {
    quota: posInt(input.bands.quota, "Cota"),
    band1: posInt(input.bands.band1, "Faixa 1"),
    band2: posInt(input.bands.band2, "Faixa 2"),
    band3: posInt(input.bands.band3, "Faixa 3"),
    extra: posInt(input.bands.extra, "Bônus extra"),
  };
  const order = [b.quota, b.band1, b.band2, b.band3, b.extra];
  if (order.some((v, i) => i > 0 && !(v > order[i - 1])))
    throw new SettingsError("Os valores precisam crescer: cota menor que Faixa 1, que é menor que Faixa 2, e assim por diante.");
  const goals = input.teamGoals
    .map((g) => ({ name: String(g.name ?? "").trim(), hours: g.hours }))
    .filter((g) => g.name || String(g.hours ?? "").trim());
  if (!goals.length) throw new SettingsError("Informe ao menos uma meta do time.");
  const parsed = goals.map((g, i) => {
    if (!g.name) throw new SettingsError(`Dê um nome à meta do nível ${i + 1}.`);
    return { name: g.name.slice(0, 40), hours: posInt(g.hours, `Horas de "${g.name}"`) };
  });
  if (parsed.some((g, i) => i > 0 && !(g.hours > parsed[i - 1].hours))) throw new SettingsError("Cada meta do time precisa ser maior que a anterior.");
  return { bands: b, teamGoals: parsed };
}

export async function saveBandsAndGoals(me: TeamUser, input: { bands: Settings["bands"]; teamGoals: Settings["teamGoals"] }) {
  admin(me);
  const v = validateBandsAndGoals(input);
  const cur = await readRules();
  await putSetting(me, "rules", { ...cur, ...v });
}

export type RulesInput = Pick<
  Settings,
  "editWindowHours" | "missingDaysLimit" | "contactAlertWorkdays" | "activeClientMonths" | "clientCommentAlertWorkdays" | "deadlineSoonDays" | "businessHours"
>;

export function validateRules(r: RulesInput): RulesInput {
  const out: RulesInput = {
    editWindowHours: posInt(r.editWindowHours, "Prazo para editar horas", 1, 720),
    missingDaysLimit: posInt(r.missingDaysLimit, "Dias sem apontar", 1, 30),
    contactAlertWorkdays: posInt(r.contactAlertWorkdays, "Cliente sem contato", 1, 90),
    activeClientMonths: posInt(r.activeClientMonths, "Cliente ativo", 1, 36),
    clientCommentAlertWorkdays: posInt(r.clientCommentAlertWorkdays, "Comentário sem resposta", 1, 30),
    deadlineSoonDays: posInt(r.deadlineSoonDays, "Prazo perto de vencer", 1, 30),
    businessHours: { start: posInt(r.businessHours.start, "Início dos avisos", 0, 23), end: posInt(r.businessHours.end, "Fim dos avisos", 1, 24) },
  };
  if (out.businessHours.start >= out.businessHours.end) throw new SettingsError("O horário dos avisos precisa começar antes de terminar.");
  return out;
}

export async function saveRules(me: TeamUser, r: RulesInput) {
  admin(me);
  const v = validateRules(r);
  const cur = await readRules();
  await putSetting(me, "rules", { ...cur, ...v });
}

// ---------- Pessoas e perfis (US-32) ----------

export async function updatePerson(
  me: TeamUser,
  personId: string,
  input: { role: TeamUser["role"]; canApproveHours: boolean; canConfirmScope: boolean; slackUserId: string | null },
) {
  admin(me);
  const roles: TeamUser["role"][] = ["administrador", "gestor", "consultor", "administrativo"];
  if (!roles.includes(input.role)) throw new SettingsError("Perfil inválido.");
  const [before] = await db.select().from(s.people).where(eq(s.people.id, personId));
  if (!before) throw new SettingsError("Pessoa não encontrada.");
  if (before.role === "administrador" && input.role !== "administrador") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(s.people)
      .where(and(eq(s.people.role, "administrador"), eq(s.people.active, true), ne(s.people.id, personId)));
    if (n === 0) throw new SettingsError("É preciso ter ao menos um Administrador. Defina outro antes de mudar este perfil.");
  }
  const slack = input.slackUserId?.trim() || null;
  if (slack && !/^[UW][A-Z0-9]{2,}$/.test(slack)) throw new SettingsError("O ID do Slack começa com U ou W (ex.: U04ABCD1234). Veja no perfil da pessoa no Slack, em Copiar ID do membro.");
  await db.transaction(async (tx) => {
    const [after] = await tx
      .update(s.people)
      .set({ role: input.role, canApproveHours: input.canApproveHours, canConfirmScope: input.canConfirmScope, slackUserId: slack, updatedAt: now() })
      .where(eq(s.people.id, personId))
      .returning();
    await audit(tx, { personId: me.id, entity: "person", entityId: personId, action: "perfil", before, after });
  });
}

// ---------- Tipos de apontamento (US-08) ----------

const slug = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export async function createEntryType(me: TeamUser, input: { name: string; acceptsSalesOrder: boolean }) {
  admin(me);
  const name = input.name.trim();
  if (name.length < 2) throw new SettingsError("Dê um nome ao tipo.");
  const code = slug(name);
  if (!code) throw new SettingsError("Use letras ou números no nome.");
  const [dup] = await db.select().from(s.entryTypes).where(eq(s.entryTypes.code, code));
  if (dup) throw new SettingsError(`Já existe o tipo "${dup.name}" com esse nome.`);
  const [{ n }] = await db.select({ n: count() }).from(s.entryTypes);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.entryTypes)
      .values({ code, name: name.slice(0, 60), acceptsSalesOrder: input.acceptsSalesOrder, sort: 10 + n })
      .returning();
    await audit(tx, { personId: me.id, entity: "entry_type", entityId: row.id, action: "criar", after: row });
    return row;
  });
}

export async function updateEntryType(me: TeamUser, id: string, input: { name?: string; acceptsSalesOrder?: boolean; active?: boolean }) {
  admin(me);
  const [before] = await db.select().from(s.entryTypes).where(eq(s.entryTypes.id, id));
  if (!before) throw new SettingsError("Tipo não encontrado.");
  const set: Partial<typeof s.entryTypes.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw new SettingsError("Dê um nome ao tipo.");
    set.name = name.slice(0, 60);
  }
  if (input.acceptsSalesOrder !== undefined && input.acceptsSalesOrder !== before.acceptsSalesOrder) {
    if (before.builtin) throw new SettingsError("Os tipos padrão já vêm definidos: só Faturável aceita pedido de venda.");
    set.acceptsSalesOrder = input.acceptsSalesOrder;
  }
  if (input.active !== undefined && input.active !== before.active) {
    if (before.builtin && !input.active) throw new SettingsError("Faturável, Bonificado, Interno e Provisionamento não podem ser desativados.");
    set.active = input.active;
  }
  if (!Object.keys(set).length) return before;
  return db.transaction(async (tx) => {
    const [after] = await tx.update(s.entryTypes).set(set).where(eq(s.entryTypes.id, id)).returning();
    await audit(tx, { personId: me.id, entity: "entry_type", entityId: id, action: "editar", before, after });
    return after;
  });
}

/** Excluir só tipo novo que nunca foi usado; os demais só se desativam. */
export async function deleteEntryType(me: TeamUser, id: string) {
  admin(me);
  const [t] = await db.select().from(s.entryTypes).where(eq(s.entryTypes.id, id));
  if (!t) throw new SettingsError("Tipo não encontrado.");
  if (t.builtin) throw new SettingsError("Faturável, Bonificado, Interno e Provisionamento não podem ser excluídos.");
  const [{ n }] = await db.select({ n: count() }).from(s.timeEntries).where(eq(s.timeEntries.typeId, id));
  if (n > 0) throw new SettingsError(`Este tipo já foi usado em ${n} apontamento${n > 1 ? "s" : ""}: só pode ser desativado.`);
  await db.transaction(async (tx) => {
    await tx.delete(s.entryTypes).where(eq(s.entryTypes.id, id));
    await audit(tx, { personId: me.id, entity: "entry_type", entityId: id, action: "excluir", before: t });
  });
}

// ---------- Feriados ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function addHoliday(me: TeamUser, input: { date: string; name: string }) {
  admin(me);
  if (!ISO.test(input.date)) throw new SettingsError("Informe a data.");
  const name = input.name.trim();
  if (!name) throw new SettingsError("Dê um nome ao feriado.");
  await db.transaction(async (tx) => {
    await tx.insert(s.holidays).values({ date: input.date, name: name.slice(0, 80) }).onConflictDoUpdate({ target: s.holidays.date, set: { name: name.slice(0, 80) } });
    await audit(tx, { personId: me.id, entity: "holiday", entityId: me.id, action: "adicionar", after: { date: input.date, name } });
  });
}

export async function removeHoliday(me: TeamUser, date: string) {
  admin(me);
  if (!ISO.test(date)) throw new SettingsError("Data inválida.");
  await db.transaction(async (tx) => {
    const [before] = await tx.delete(s.holidays).where(eq(s.holidays.date, date)).returning();
    if (before) await audit(tx, { personId: me.id, entity: "holiday", entityId: me.id, action: "remover", before });
  });
}

/** Inclui os feriados nacionais do ano que ainda não estão na lista. Retorna quantos entraram. */
export async function generateNationalHolidays(me: TeamUser, year: number) {
  admin(me);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new SettingsError("Ano inválido.");
  const existing = await db
    .select({ date: s.holidays.date })
    .from(s.holidays)
    .where(and(gte(s.holidays.date, `${year}-01-01`), lte(s.holidays.date, `${year}-12-31`)));
  const have = new Set(existing.map((h) => h.date));
  const add = nationalHolidays(year).filter((h) => !have.has(h.date));
  if (!add.length) return 0;
  await db.transaction(async (tx) => {
    await tx.insert(s.holidays).values(add).onConflictDoNothing();
    await audit(tx, { personId: me.id, entity: "holiday", entityId: me.id, action: "gerar_nacionais", after: { year, added: add } });
  });
  return add.length;
}

// ---------- Motivos de ausência ----------

export async function addAbsenceReason(me: TeamUser, name: string) {
  admin(me);
  const n = name.trim();
  if (n.length < 2) throw new SettingsError("Dê um nome ao motivo.");
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(s.absenceReasons).values({ name: n.slice(0, 60) }).returning();
    await audit(tx, { personId: me.id, entity: "absence_reason", entityId: row.id, action: "criar", after: row });
  });
}

export async function updateAbsenceReason(me: TeamUser, id: string, input: { name?: string; active?: boolean }) {
  admin(me);
  const [before] = await db.select().from(s.absenceReasons).where(eq(s.absenceReasons.id, id));
  if (!before) throw new SettingsError("Motivo não encontrado.");
  const set: Partial<typeof s.absenceReasons.$inferInsert> = {};
  if (input.name !== undefined) {
    if (input.name.trim().length < 2) throw new SettingsError("Dê um nome ao motivo.");
    set.name = input.name.trim().slice(0, 60);
  }
  if (input.active !== undefined) set.active = input.active;
  await db.transaction(async (tx) => {
    const [after] = await tx.update(s.absenceReasons).set(set).where(eq(s.absenceReasons.id, id)).returning();
    await audit(tx, { personId: me.id, entity: "absence_reason", entityId: id, action: "editar", before, after });
  });
}

// ---------- Integração Odoo ----------

export async function saveOdooFields(me: TeamUser, input: Partial<OdooFields>) {
  admin(me);
  const out = {} as OdooFields;
  for (const k of Object.keys(DEFAULT_ODOO_FIELDS) as (keyof OdooFields)[]) {
    const v = String(input[k] ?? "").trim();
    if (!v) throw new SettingsError("Preencha todos os campos. Na dúvida, use o nome sugerido.");
    if (k !== "novoModeloTag" && !/^x_[a-z0-9_]+$/.test(v)) throw new SettingsError(`"${v}" não parece um campo do Studio: começa com x_ e usa letras minúsculas, números e _.`);
    out[k] = v.slice(0, 80);
  }
  await putSetting(me, "odoo_fields", out);
}

/** Botão "Sincronizar agora": lê o Odoo e envia a fila, na hora. */
export async function syncNow(me: TeamUser) {
  admin(me);
  const { pullFromOdoo } = await import("../odoo/pull");
  const { processQueue } = await import("../odoo/push");
  let pullError: string | null = null;
  let pull: Awaited<ReturnType<typeof pullFromOdoo>> | null = null;
  try {
    pull = await pullFromOdoo();
  } catch (e) {
    pullError = e instanceof Error ? e.message : String(e);
  }
  let push: Awaited<ReturnType<typeof processQueue>> | null = null;
  let pushError: string | null = null;
  try {
    push = await processQueue({ limit: 100 });
  } catch (e) {
    pushError = e instanceof Error ? e.message : String(e);
  }
  await audit(db, { personId: me.id, entity: "sync", entityId: me.id, action: "sincronizar_agora", after: { pull, push, pullError, pushError } });
  return { pull, push, pullError, pushError };
}

// ---------- Links de TV (US-49) ----------

export async function createTvToken(me: TeamUser, label: string) {
  admin(me);
  const l = label.trim();
  if (!l) throw new SettingsError("Dê um nome ao link (ex.: TV do escritório).");
  const token = randomBytes(24).toString("base64url");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.tvTokens).values({ token, label: l.slice(0, 60), createdBy: me.id }).returning();
    await audit(tx, { personId: me.id, entity: "tv_token", entityId: row.id, action: "criar", after: { label: row.label } });
    return row;
  });
}

export async function revokeTvToken(me: TeamUser, id: string) {
  admin(me);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(s.tvTokens).set({ revokedAt: now() }).where(eq(s.tvTokens.id, id)).returning();
    if (!row) throw new SettingsError("Link não encontrado.");
    await audit(tx, { personId: me.id, entity: "tv_token", entityId: id, action: "revogar" });
  });
}

// ---------- Silenciar avisos (US-43) ----------

export const muteKey = (personId: string) => `mute:${personId}`;

/** Eventos informativos que cada pessoa pode silenciar (fora de MANDATORY). */
export function mutableEvents(): NotifyEvent[] {
  const all: NotifyEvent[] = [
    "mencao",
    "comentario_cliente",
    "comentario_sem_resposta",
    "contato_agendado",
    "contato_atrasado",
    "dia_sem_apontamento",
    "provisionamento_converter",
    "demanda_decidida",
    "avaliacao_recebida",
  ];
  return all.filter((e) => !MANDATORY.includes(e));
}

export async function getMutes(personId: string): Promise<NotifyEvent[]> {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.key, muteKey(personId)));
  const v = (row?.value as { events?: string[] } | undefined)?.events ?? [];
  return v.filter((e): e is NotifyEvent => !MANDATORY.includes(e as NotifyEvent));
}

/** Cada pessoa decide só os próprios avisos. Avisos obrigatórios são ignorados. */
export async function setMutes(me: TeamUser, events: string[]) {
  const allowed = new Set<string>(mutableEvents());
  const clean = [...new Set(events)].filter((e) => allowed.has(e));
  await putSetting(me, muteKey(me.id), { events: clean });
  return clean;
}
