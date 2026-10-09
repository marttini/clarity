/**
 * Modelo de dados do Síntese Clarity.
 * Fonte: docs/historias-mvp.md (US-xx) e aba "Arquitetura" das diretrizes.
 * Tudo que tem par no Odoo guarda o id de lá (odoo_*_id) e o estado de sincronização.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  smallint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Enums ----------
export const roleEnum = pgEnum("role", ["administrador", "gestor", "consultor", "administrativo"]);
export const itemKindEnum = pgEnum("item_kind", ["projeto", "tarefa"]);
export const stageEnum = pgEnum("stage", [
  "analise", // Projetos em Análise/Aprovação
  "estimativa", // Avaliação de novos projetos / estimativa de esforço
  "alocacao", // Alocação de recursos
  "andamento", // Em andamento
  "concluido", // Concluído
]);
export const scopeStatusEnum = pgEnum("scope_status", ["rascunho", "confirmado"]);
export const clientApprovalEnum = pgEnum("client_approval", ["nao_se_aplica", "aguardando", "aprovada", "recusada"]);
export const syncStatusEnum = pgEnum("sync_status", ["nao_sincroniza", "pendente", "enviado", "erro"]);
export const changeKindEnum = pgEnum("change_kind", ["alterar", "excluir"]);
export const decisionEnum = pgEnum("decision", ["pendente", "aprovada", "recusada"]);
export const contactTypeEnum = pgEnum("contact_type", ["ligacao", "visita", "reuniao_online", "email", "whatsapp"]);
export const contactStatusEnum = pgEnum("contact_status", ["agendado", "realizado", "nao_atendeu", "remarcado", "cancelado"]);
export const channelEnum = pgEnum("comment_channel", ["interno", "cliente"]);
export const outboxChannelEnum = pgEnum("outbox_channel", ["slack_dm", "slack_canal", "email", "google_agenda"]);
export const queueStatusEnum = pgEnum("queue_status", ["pendente", "processando", "feito", "erro", "cancelado"]);

// ---------- Pessoas (time) ----------
export const people = pgTable(
  "people",
  {
    id: id(),
    odooEmployeeId: integer("odoo_employee_id"),
    odooUserId: integer("odoo_user_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    jobTitle: text("job_title"),
    avatarUrl: text("avatar_url"),
    role: roleEnum("role").notNull().default("consultor"),
    /** Marcador "Consultor" do funcionário no Odoo: aponta horas, entra em carga, ranking, faixas e regra dos 3 dias. */
    isConsultor: boolean("is_consultor").notNull().default(true),
    canApproveHours: boolean("can_approve_hours").notNull().default(false),
    canConfirmScope: boolean("can_confirm_scope").notNull().default(false),
    slackUserId: text("slack_user_id"),
    authUserId: uuid("auth_user_id"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("people_email_uq").on(t.email), uniqueIndex("people_odoo_emp_uq").on(t.odooEmployeeId)],
);

// ---------- Clientes ----------
export const clients = pgTable(
  "clients",
  {
    id: id(),
    odooPartnerId: integer("odoo_partner_id"),
    name: text("name").notNull(),
    cnpj: text("cnpj"),
    street: text("street"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    email: text("email"),
    phone: text("phone"),
    /** Cor do cliente nas telas (gerada, editável). */
    color: text("color").notNull().default("#9C93AE"),
    erp: text("erp"),
    internalNotes: text("internal_notes"),
    isInternal: boolean("is_internal").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("clients_odoo_uq").on(t.odooPartnerId)],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    odooPartnerId: integer("odoo_partner_id"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    portalAccess: boolean("portal_access").notNull().default(false),
    portalInvitedAt: timestamp("portal_invited_at", { withTimezone: true }),
    portalRevokedAt: timestamp("portal_revoked_at", { withTimezone: true }),
    lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
    authUserId: uuid("auth_user_id"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("client_contacts_odoo_uq").on(t.odooPartnerId), index("client_contacts_client_idx").on(t.clientId)],
);

// ---------- Projetos anuais e itens ----------
export const annualProjects = pgTable(
  "annual_projects",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    odooProjectId: integer("odoo_project_id"),
    name: text("name").notNull(),
    year: smallint("year").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("annual_projects_odoo_uq").on(t.odooProjectId), index("annual_projects_client_idx").on(t.clientId)],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#4A3263"),
    odooTagId: integer("odoo_tag_id"),
    /** Etiquetas de sistema (Projeto, Tarefa, Fora do escopo) não aparecem como marcadores. */
    system: boolean("system").notNull().default(false),
  },
  (t) => [uniqueIndex("tags_name_uq").on(t.name)],
);

export const items = pgTable(
  "items",
  {
    id: id(),
    annualProjectId: uuid("annual_project_id").notNull().references(() => annualProjects.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => items.id),
    kind: itemKindEnum("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    stage: stageEnum("stage").notNull().default("analise"),
    /** Só projetos: rascunho fica só no Clarity. Tarefas são sempre "confirmado". */
    scopeStatus: scopeStatusEnum("scope_status").notNull().default("confirmado"),
    startDate: date("start_date"),
    deadline: date("deadline"),
    plannedMinutes: integer("planned_minutes"),
    isSustentacao: boolean("is_sustentacao").notNull().default(false),
    visibleToClient: boolean("visible_to_client").notNull().default(false),
    checklist: jsonb("checklist").$type<{ text: string; done: boolean }[]>().notNull().default([]),
    // Demanda adicional (fora do escopo)
    outOfScope: boolean("out_of_scope").notNull().default(false),
    deliverableId: uuid("deliverable_id"),
    clientApproval: clientApprovalEnum("client_approval").notNull().default("nao_se_aplica"),
    clientApprovalAt: timestamp("client_approval_at", { withTimezone: true }),
    clientApprovalByContactId: uuid("client_approval_by_contact_id").references(() => clientContacts.id),
    clientApprovalRegisteredBy: uuid("client_approval_registered_by").references(() => people.id),
    clientApprovalReason: text("client_approval_reason"),
    requestedByContactId: uuid("requested_by_contact_id").references(() => clientContacts.id),
    requestedAt: date("requested_at"),
    requestChannel: text("request_channel"),
    // Continuação na virada do ano
    continuationOfId: uuid("continuation_of_id").references((): AnyPgColumn => items.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archived: boolean("archived").notNull().default(false),
    odooTaskId: integer("odoo_task_id"),
    syncStatus: syncStatusEnum("sync_status").notNull().default("pendente"),
    syncError: text("sync_error"),
    createdBy: uuid("created_by").references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("items_odoo_uq").on(t.odooTaskId),
    index("items_annual_idx").on(t.annualProjectId),
    index("items_parent_idx").on(t.parentId),
  ],
);

export const itemAssignees = pgTable(
  "item_assignees",
  {
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => people.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.personId] })],
);

export const itemTags = pgTable(
  "item_tags",
  {
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] })],
);

export const stageHistory = pgTable("stage_history", {
  id: id(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  fromStage: stageEnum("from_stage"),
  toStage: stageEnum("to_stage").notNull(),
  byPersonId: uuid("by_person_id").references(() => people.id),
  at: createdAt(),
});

export const deadlineChanges = pgTable("deadline_changes", {
  id: id(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  oldDeadline: date("old_deadline"),
  newDeadline: date("new_deadline").notNull(),
  reason: text("reason").notNull(),
  byPersonId: uuid("by_person_id").notNull().references(() => people.id),
  at: createdAt(),
});

// ---------- Escopo ----------
export const scopeVersions = pgTable(
  "scope_versions",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    /** 0 = rascunho; 1, 2, ... = versões confirmadas (congeladas). */
    version: integer("version").notNull().default(0),
    objective: text("objective"),
    exclusions: jsonb("exclusions").$type<string[]>().notNull().default([]),
    assumptions: text("assumptions"),
    estimateMinutes: integer("estimate_minutes"),
    reason: text("reason"),
    confirmedBy: uuid("confirmed_by").references(() => people.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("scope_versions_item_version_uq").on(t.itemId, t.version)],
);

export const deliverables = pgTable("deliverables", {
  id: id(),
  scopeVersionId: uuid("scope_version_id").notNull().references(() => scopeVersions.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  estimateMinutes: integer("estimate_minutes"),
  suggestedPersonId: uuid("suggested_person_id").references(() => people.id),
});

export const meetings = pgTable("meetings", {
  id: id(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  title: text("title").notNull(),
  participants: text("participants"),
  summary: text("summary"),
  createdBy: uuid("created_by").references(() => people.id),
  createdAt: createdAt(),
});

// ---------- Apontamento ----------
export const entryTypes = pgTable(
  "entry_types",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    acceptsSalesOrder: boolean("accepts_sales_order").notNull().default(false),
    /** Só Faturável conta para cota, metas e faixas. */
    countsForBonus: boolean("counts_for_bonus").notNull().default(false),
    isInternal: boolean("is_internal").notNull().default(false),
    isProvisioning: boolean("is_provisioning").notNull().default(false),
    builtin: boolean("builtin").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(100),
  },
  (t) => [uniqueIndex("entry_types_code_uq").on(t.code)],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: id(),
    odooSoLineId: integer("odoo_so_line_id").notNull(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    orderName: text("order_name").notNull(),
    lineName: text("line_name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("so_lines_odoo_uq").on(t.odooSoLineId)],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    personId: uuid("person_id").notNull().references(() => people.id),
    itemId: uuid("item_id").notNull().references(() => items.id),
    date: date("date").notNull(),
    minutes: integer("minutes").notNull(),
    description: text("description").notNull(),
    typeId: uuid("type_id").notNull().references(() => entryTypes.id),
    isSustentacao: boolean("is_sustentacao").notNull().default(false),
    salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
    pendingChange: boolean("pending_change").notNull().default(false),
    /** Provisionamento convertido: guarda quando virou hora real. */
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    odooLineId: integer("odoo_line_id"),
    syncStatus: syncStatusEnum("sync_status").notNull().default("pendente"),
    syncError: text("sync_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("time_entries_person_date_idx").on(t.personId, t.date), index("time_entries_item_idx").on(t.itemId)],
);

export const changeRequests = pgTable("change_requests", {
  id: id(),
  timeEntryId: uuid("time_entry_id").notNull().references(() => timeEntries.id),
  personId: uuid("person_id").notNull().references(() => people.id),
  kind: changeKindEnum("kind").notNull(),
  newValues: jsonb("new_values").$type<Record<string, unknown>>(),
  oldValues: jsonb("old_values").$type<Record<string, unknown>>().notNull(),
  justification: text("justification").notNull(),
  status: decisionEnum("status").notNull().default("pendente"),
  decidedBy: uuid("decided_by").references(() => people.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: createdAt(),
});

export const absenceReasons = pgTable("absence_reasons", {
  id: id(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const absenceJustifications = pgTable(
  "absence_justifications",
  {
    id: id(),
    personId: uuid("person_id").notNull().references(() => people.id),
    date: date("date").notNull(),
    reasonId: uuid("reason_id").notNull().references(() => absenceReasons.id),
    note: text("note"),
    attachmentId: uuid("attachment_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("absence_person_date_uq").on(t.personId, t.date)],
);

// ---------- Contatos com o cliente ----------
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    clientContactId: uuid("client_contact_id").references(() => clientContacts.id),
    type: contactTypeEnum("type").notNull(),
    responsibleId: uuid("responsible_id").notNull().references(() => people.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    objective: text("objective").notNull(),
    relatedItemId: uuid("related_item_id").references(() => items.id),
    status: contactStatusEnum("status").notNull().default("agendado"),
    resultSummary: text("result_summary"),
    nextStep: text("next_step"),
    rescheduleReason: text("reschedule_reason"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    googleEventId: text("google_event_id"),
    createdBy: uuid("created_by").notNull().references(() => people.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_client_idx").on(t.clientId), index("contacts_resp_idx").on(t.responsibleId, t.scheduledAt)],
);

// ---------- Comentários, anexos, avaliações ----------
export const comments = pgTable(
  "comments",
  {
    id: id(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    authorPersonId: uuid("author_person_id").references(() => people.id),
    authorContactId: uuid("author_contact_id").references(() => clientContacts.id),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    /** Para comentários do cliente: quando a Síntese respondeu. */
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("comments_item_idx").on(t.itemId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    ownerType: text("owner_type").notNull(), // item | scope | contact | comment | justification | approval
    ownerId: uuid("owner_id").notNull(),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mime: text("mime").notNull(),
    version: integer("version").notNull().default(1),
    internal: boolean("internal").notNull().default(false),
    uploadedByPersonId: uuid("uploaded_by_person_id").references(() => people.id),
    uploadedByContactId: uuid("uploaded_by_contact_id").references(() => clientContacts.id),
    odooAttachmentId: integer("odoo_attachment_id"),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_owner_idx").on(t.ownerType, t.ownerId)],
);

export const evaluations = pgTable("evaluations", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  itemId: uuid("item_id").references(() => items.id),
  contactId: uuid("contact_id").notNull().references(() => clientContacts.id),
  consultantId: uuid("consultant_id").references(() => people.id),
  scoreResult: smallint("score_result").notNull(),
  scoreConsultant: smallint("score_consultant").notNull(),
  scoreTeam: smallint("score_team").notNull(),
  comment: text("comment"),
  published: boolean("published").notNull().default(false),
  publishedBy: uuid("published_by").references(() => people.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Configurações ----------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => people.id),
  updatedAt: updatedAt(),
});

export const holidays = pgTable("holidays", {
  date: date("date").primaryKey(),
  name: text("name").notNull(),
});

export const tvTokens = pgTable("tv_tokens", {
  id: id(),
  token: text("token").notNull().unique(),
  label: text("label").notNull(),
  createdBy: uuid("created_by").references(() => people.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Avisos ----------
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    personId: uuid("person_id").references(() => people.id),
    contactId: uuid("contact_id").references(() => clientContacts.id),
    event: text("event").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_person_idx").on(t.personId, t.createdAt)],
);

export const outbox = pgTable("outbox", {
  id: id(),
  notificationId: uuid("notification_id").references(() => notifications.id),
  channel: outboxChannelEnum("channel").notNull(),
  target: text("target").notNull(),
  payload: jsonb("payload").notNull(),
  /** Chave de agrupamento/dedupe: no máximo um lembrete por dia por pendência. */
  dedupeKey: text("dedupe_key"),
  status: queueStatusEnum("status").notNull().default("pendente"),
  attempts: integer("attempts").notNull().default(0),
  sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("outbox_dedupe_uq").on(t.dedupeKey)]);

// ---------- Sincronização com o Odoo ----------
export const syncQueue = pgTable(
  "sync_queue",
  {
    id: id(),
    entity: text("entity").notNull(), // time_entry | item | attachment
    entityId: uuid("entity_id").notNull(),
    op: text("op").notNull(), // upsert | delete
    status: queueStatusEnum("status").notNull().default("pendente"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sync_queue_status_idx").on(t.status, t.nextAttemptAt)],
);

export const syncState = pgTable("sync_state", {
  model: text("model").primaryKey(),
  lastWriteDate: text("last_write_date"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export const syncLog = pgTable("sync_log", {
  id: id(),
  direction: text("direction").notNull(), // in | out
  model: text("model").notNull(),
  odooId: integer("odoo_id"),
  message: text("message").notNull(),
  level: text("level").notNull().default("info"),
  at: createdAt(),
});

// ---------- Auditoria ----------
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorPersonId: uuid("actor_person_id").references(() => people.id),
    actorContactId: uuid("actor_contact_id").references(() => clientContacts.id),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);
