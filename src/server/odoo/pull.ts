import "server-only";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "../audit";
import { enqueueSync } from "../sync/enqueue";
import { getOdoo, m2oId, m2oName, parseOdooDatetime, toOdooDatetime, type OdooClient, type OdooDomain, type OdooRecord } from "./client";
import { htmlToText, odooToDate } from "./convert";
import { CLIENT_PALETTE, getOdooFields, stageFromOdooName, SYSTEM_TAGS, type OdooFields, type StageKey } from "./fields";
import { log } from "./push";

/**
 * Leitura incremental do Odoo (US-21, US-28, US-31, US-32), a cada 15 minutos e pelo botão
 * "Sincronizar agora". Só enxerga projetos anuais com a etiqueta "Novo modelo".
 * Conflito: vale a alteração mais recente; se o Clarity mudou depois do write_date do Odoo,
 * o Clarity fica e o caso vai para o sync_log.
 */

export type PullSummary = {
  people: { created: number; updated: number };
  clients: { created: number; updated: number };
  contacts: { created: number; updated: number };
  projects: { created: number; updated: number };
  items: { created: number; updated: number };
  soLines: { created: number; updated: number };
  conflicts: number;
  pending: number;
  errors: string[];
};

/** Margem de segurança da leitura incremental (transações que gravaram com write_date anterior). */
const OVERLAP_SECONDS = 60;

const ctxAll = { active_test: false };

type Counter = { created: number; updated: number };
const counter = (): Counter => ({ created: 0, updated: 0 });

export async function pullFromOdoo(opts: { odoo?: OdooClient } = {}): Promise<PullSummary> {
  const odoo = opts.odoo ?? (await getOdoo());
  const F = await getOdooFields();
  const sum: PullSummary = {
    people: counter(),
    clients: counter(),
    contacts: counter(),
    projects: counter(),
    items: counter(),
    soLines: counter(),
    conflicts: 0,
    pending: 0,
    errors: [],
  };
  const p = new Puller(odoo, F, sum);
  await p.step("hr.employee", () => p.employees());
  await p.step("project.project", () => p.projects());
  await p.step("res.partner", () => p.partners());
  await p.step("project.task", () => p.tasks());
  await p.step("sale.order.line", () => p.soLines());
  return sum;
}

class Puller {
  /** Parceiros de clientes criados nesta execução: os contatos deles vêm todos, sem filtro de data. */
  private newClientPartners = new Set<number>();
  /** Projetos anuais criados nesta execução: as tarefas deles vêm todas. */
  private newProjects = new Set<number>();
  private maxWrite = new Map<string, string>();

  constructor(
    private odoo: OdooClient,
    private F: OdooFields,
    private sum: PullSummary,
  ) {}

  // ---------- estado incremental ----------

  async step(model: string, fn: () => Promise<void>) {
    const [st] = await db.select().from(s.syncState).where(eq(s.syncState.model, model));
    this.since.set(model, st?.lastWriteDate ? toOdooDatetime(new Date(parseOdooDatetime(st.lastWriteDate)!.getTime() - OVERLAP_SECONDS * 1000)) : null);
    let error: string | null = null;
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      const original = (e as { original?: string }).original;
      this.sum.errors.push(`${model}: ${error}`);
      await log("in", model, null, `Falha ao ler do Odoo: ${error}${original ? ` [${original}]` : ""}`, "error");
    }
    const last = this.maxWrite.get(model) ?? st?.lastWriteDate ?? null;
    const values = { model, lastWriteDate: error ? (st?.lastWriteDate ?? null) : last, lastRunAt: new Date(), lastError: error };
    await db.insert(s.syncState).values(values).onConflictDoUpdate({ target: s.syncState.model, set: values });
  }
  private since = new Map<string, string | null>();

  private sinceDomain(model: string): OdooDomain {
    const v = this.since.get(model);
    return v ? [["write_date", ">=", v]] : [];
  }
  private seen(model: string, recs: OdooRecord[]) {
    for (const r of recs) {
      const w = typeof r.write_date === "string" ? r.write_date : null;
      if (w && w > (this.maxWrite.get(model) ?? "")) this.maxWrite.set(model, w);
    }
  }

  /** Registra no log só uma vez a mesma mensagem para o mesmo registro. */
  private async logOnce(model: string, odooId: number | null, message: string, level: string) {
    const [hit] = await db
      .select({ n: count() })
      .from(s.syncLog)
      .where(and(eq(s.syncLog.model, model), odooId === null ? sql`${s.syncLog.odooId} is null` : eq(s.syncLog.odooId, odooId), eq(s.syncLog.message, message)));
    if (hit.n > 0) return false;
    await log("in", model, odooId, message, level);
    return true;
  }

  // ---------- Funcionários (US-32) ----------

  async employees() {
    const recs = await this.odoo.searchRead(
      "hr.employee",
      this.sinceDomain("hr.employee"),
      ["id", "name", "work_email", "job_title", "user_id", "active", "write_date", this.F.consultor],
      { context: ctxAll, order: "write_date asc, id asc" },
    );
    this.seen("hr.employee", recs);
    // e-mail do usuário para quem não tem e-mail de trabalho
    const userIds = recs.filter((r) => !r.work_email && m2oId(r.user_id)).map((r) => m2oId(r.user_id)!);
    const logins = new Map<number, string>();
    if (userIds.length) for (const u of await this.odoo.searchRead("res.users", [["id", "in", userIds]], ["id", "login"], { context: ctxAll })) logins.set(u.id, String(u.login));

    for (const r of recs) {
      const userId = m2oId(r.user_id);
      const email = (typeof r.work_email === "string" && r.work_email ? r.work_email : userId ? logins.get(userId) : "")?.trim().toLowerCase();
      const active = r.active !== false;
      const isConsultor = r[this.F.consultor] === true;
      const [byOdoo] = await db.select().from(s.people).where(eq(s.people.odooEmployeeId, r.id));
      const [byEmail] = byOdoo || !email ? [] : await db.select().from(s.people).where(sql`lower(${s.people.email}) = ${email}`);
      const cur = byOdoo ?? byEmail;
      if (!email && !cur) {
        await this.logOnce("hr.employee", r.id, `Funcionário "${r.name}" sem e-mail no Odoo: não entra no Clarity até ter e-mail de trabalho.`, "pendencia");
        this.sum.pending++;
        continue;
      }
      if (!cur) {
        if (!active) continue;
        await db.insert(s.people).values({
          odooEmployeeId: r.id,
          odooUserId: userId,
          name: String(r.name),
          email: email!,
          jobTitle: typeof r.job_title === "string" ? r.job_title : null,
          role: "consultor",
          isConsultor,
          active,
        });
        this.sum.people.created++;
        continue;
      }
      // e-mail só muda se não pertence a outra pessoa
      let newEmail = cur.email;
      if (email && email !== cur.email.toLowerCase()) {
        const [other] = await db.select({ id: s.people.id }).from(s.people).where(sql`lower(${s.people.email}) = ${email}`);
        if (!other) newEmail = email;
      }
      const next = {
        odooEmployeeId: r.id,
        odooUserId: userId ?? cur.odooUserId,
        name: String(r.name),
        email: newEmail,
        jobTitle: typeof r.job_title === "string" ? r.job_title : cur.jobTitle,
        isConsultor,
        active,
      };
      if (Object.entries(next).some(([k, v]) => cur[k as keyof typeof cur] !== v)) {
        await db.update(s.people).set({ ...next, updatedAt: new Date() }).where(eq(s.people.id, cur.id));
        this.sum.people.updated++;
        if (cur.active && !active) await log("in", "hr.employee", r.id, `${cur.name} foi desligado(a) ou arquivado(a) no Odoo: acesso ao Clarity bloqueado.`, "info");
      }
    }
  }

  // ---------- Projetos anuais e clientes (US-28) ----------

  async projects() {
    const recs = await this.odoo.searchRead(
      "project.project",
      [["tag_ids.name", "=", this.F.novoModeloTag], ...this.sinceDomain("project.project")],
      ["id", "name", "partner_id", "active", "date_start", "date", "write_date"],
      { context: ctxAll, order: "write_date asc, id asc" },
    );
    this.seen("project.project", recs);
    const partnerIds = [...new Set(recs.map((r) => m2oId(r.partner_id)).filter((x): x is number => !!x))];
    const companies = await this.companiesFor(partnerIds);

    for (const r of recs) {
      const pid = m2oId(r.partner_id);
      if (!pid) {
        if (await this.logOnce("project.project", r.id, `Projeto anual "${r.name}" está sem cliente no Odoo. Informe o cliente no projeto do Odoo.`, "pendencia")) this.sum.pending++;
        continue;
      }
      const company = companies.get(pid);
      if (!company) continue;
      const clientId = await this.upsertClient(company);
      const year = yearOf(r);
      const [cur] = await db.select().from(s.annualProjects).where(eq(s.annualProjects.odooProjectId, r.id));
      const vals = { clientId, name: String(r.name), year, active: r.active !== false };
      if (!cur) {
        await db.insert(s.annualProjects).values({ ...vals, odooProjectId: r.id });
        this.newProjects.add(r.id);
        this.sum.projects.created++;
      } else if (cur.clientId !== vals.clientId || cur.name !== vals.name || cur.year !== vals.year || cur.active !== vals.active) {
        await db.update(s.annualProjects).set(vals).where(eq(s.annualProjects.id, cur.id));
        this.sum.projects.updated++;
      }
    }
  }

  private partnerFields = ["id", "name", "is_company", "parent_id", "commercial_partner_id", "vat", "street", "city", "state_id", "zip", "email", "phone", "active", "write_date"];

  /** Empresa (commercial partner) de cada parceiro. */
  private async companiesFor(partnerIds: number[]): Promise<Map<number, OdooRecord>> {
    const out = new Map<number, OdooRecord>();
    if (!partnerIds.length) return out;
    const recs = await this.odoo.searchRead("res.partner", [["id", "in", partnerIds]], this.partnerFields, { context: ctxAll });
    const byId = new Map(recs.map((r) => [r.id, r]));
    const missing = [...new Set(recs.map((r) => m2oId(r.commercial_partner_id)).filter((x): x is number => !!x && !byId.has(x)))];
    if (missing.length) for (const r of await this.odoo.searchRead("res.partner", [["id", "in", missing]], this.partnerFields, { context: ctxAll })) byId.set(r.id, r);
    for (const r of recs) out.set(r.id, byId.get(m2oId(r.commercial_partner_id) ?? r.id) ?? r);
    return out;
  }

  private stateCodes = new Map<number, string>();
  private async stateCode(v: unknown): Promise<string | null> {
    const id = m2oId(v);
    if (!id) return null;
    if (!this.stateCodes.has(id)) {
      const [st] = await this.odoo.searchRead("res.country.state", [["id", "=", id]], ["id", "code"], { limit: 1 });
      this.stateCodes.set(id, st ? String(st.code) : "");
    }
    return this.stateCodes.get(id) || null;
  }

  private async clientValues(p: OdooRecord) {
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      name: String(p.name),
      cnpj: str(p.vat),
      street: str(p.street),
      city: str(p.city),
      state: await this.stateCode(p.state_id),
      zip: str(p.zip),
      email: str(p.email),
      phone: str(p.phone),
    };
  }

  /** Cliente = empresa do Odoo; dados de cadastro são só leitura no Clarity. */
  private async upsertClient(p: OdooRecord): Promise<string> {
    const vals = await this.clientValues(p);
    const [cur] = await db.select().from(s.clients).where(eq(s.clients.odooPartnerId, p.id));
    if (!cur) {
      const [{ n }] = await db.select({ n: count() }).from(s.clients);
      const [row] = await db
        .insert(s.clients)
        .values({ ...vals, odooPartnerId: p.id, color: CLIENT_PALETTE[n % CLIENT_PALETTE.length] })
        .returning({ id: s.clients.id });
      this.newClientPartners.add(p.id);
      this.sum.clients.created++;
      return row.id;
    }
    if (Object.entries(vals).some(([k, v]) => cur[k as keyof typeof cur] !== v)) {
      await db.update(s.clients).set({ ...vals, updatedAt: new Date() }).where(eq(s.clients.id, cur.id));
      this.sum.clients.updated++;
    }
    return cur.id;
  }

  // ---------- Cadastro dos clientes e contatos (US-28, US-31) ----------

  async partners() {
    const clients = await db.select({ id: s.clients.id, pid: s.clients.odooPartnerId }).from(s.clients);
    const clientOf = new Map(clients.filter((c) => c.pid).map((c) => [c.pid!, c.id]));
    const pids = [...clientOf.keys()];
    if (!pids.length) return;
    const since = this.sinceDomain("res.partner");

    // Empresas já conhecidas que mudaram no Odoo
    if (since.length) {
      const changed = await this.odoo.searchRead("res.partner", [["id", "in", pids], ...since], this.partnerFields, { context: ctxAll });
      this.seen("res.partner", changed);
      for (const p of changed) await this.upsertClient(p);
    }

    // Contatos: pessoas dentro da empresa cliente (só no Odoo se cria contato)
    const contactFields = ["id", "name", "parent_id", "email", "phone", "function", "active", "write_date"];
    const base: OdooDomain = [["is_company", "=", false], ["type", "=", "contact"]];
    const recs: OdooRecord[] = since.length
      ? await this.odoo.searchRead("res.partner", [...base, ["parent_id", "in", pids], ...since], contactFields, { context: ctxAll })
      : await this.odoo.searchRead("res.partner", [...base, ["parent_id", "in", pids]], contactFields, { context: ctxAll });
    this.seen("res.partner", recs);
    const fresh = [...this.newClientPartners].filter((x) => clientOf.has(x));
    if (since.length && fresh.length) {
      const more = await this.odoo.searchRead("res.partner", [...base, ["parent_id", "in", fresh]], contactFields, { context: ctxAll });
      const ids = new Set(recs.map((r) => r.id));
      for (const r of more) if (!ids.has(r.id)) recs.push(r);
    }
    for (const r of recs) {
      const clientId = clientOf.get(m2oId(r.parent_id) ?? -1);
      if (!clientId) continue;
      const str = (v: unknown) => (typeof v === "string" && v ? v : null);
      const vals = { clientId, name: String(r.name), email: str(r.email), phone: str(r.phone), jobTitle: str(r.function), active: r.active !== false };
      const [cur] = await db.select().from(s.clientContacts).where(eq(s.clientContacts.odooPartnerId, r.id));
      if (!cur) {
        if (!vals.active) continue;
        await db.insert(s.clientContacts).values({ ...vals, odooPartnerId: r.id });
        this.sum.contacts.created++;
      } else if (Object.entries(vals).some(([k, v]) => cur[k as keyof typeof cur] !== v)) {
        await db.update(s.clientContacts).set(vals).where(eq(s.clientContacts.id, cur.id));
        this.sum.contacts.updated++;
      }
    }
  }

  // ---------- Tarefas (US-21) ----------

  async tasks() {
    const annual = await db.select().from(s.annualProjects);
    const annualOf = new Map(annual.filter((a) => a.odooProjectId).map((a) => [a.odooProjectId!, a]));
    const projectIds = [...annualOf.keys()];
    if (!projectIds.length) return;
    const F = this.F;
    const fields = ["id", "name", "project_id", "parent_id", "user_ids", "planned_date_begin", "date_deadline", "allocated_hours", "stage_id", "tag_ids", "description", "active", "write_date", F.sustentacao, F.clarityId];
    const since = this.sinceDomain("project.task");
    const recs = await this.odoo.searchRead("project.task", [["project_id", "in", projectIds], ...since], fields, { context: ctxAll, order: "write_date asc, id asc" });
    this.seen("project.task", recs);
    const fresh = [...this.newProjects];
    if (since.length && fresh.length) {
      const ids = new Set(recs.map((r) => r.id));
      for (const r of await this.odoo.searchRead("project.task", [["project_id", "in", fresh]], fields, { context: ctxAll })) if (!ids.has(r.id)) recs.push(r);
    }
    if (!recs.length) return;

    // etiquetas usadas
    const tagIds = [...new Set(recs.flatMap((r) => (r.tag_ids as number[]) ?? []))];
    const tagName = new Map<number, string>();
    if (tagIds.length) for (const t of await this.odoo.searchRead("project.tags", [["id", "in", tagIds]], ["id", "name"])) tagName.set(t.id, String(t.name));

    // pais antes dos filhos
    recs.sort((a, b) => Number(!!m2oId(a.parent_id)) - Number(!!m2oId(b.parent_id)));
    for (const r of recs) await this.task(r, annualOf, tagName);
  }

  private async task(r: OdooRecord, annualOf: Map<number, typeof s.annualProjects.$inferSelect>, tagName: Map<number, string>) {
    const F = this.F;
    const annual = annualOf.get(m2oId(r.project_id) ?? -1);
    if (!annual) return;
    const odooWrite = parseOdooDatetime(r.write_date) ?? new Date();

    // vínculo
    let cur: typeof s.items.$inferSelect | undefined = (await db.select().from(s.items).where(eq(s.items.odooTaskId, r.id)))[0];
    const cid = typeof r[F.clarityId] === "string" ? (r[F.clarityId] as string) : "";
    if (!cur && /^[0-9a-f-]{36}$/i.test(cid)) {
      cur = (await db.select().from(s.items).where(eq(s.items.id, cid)))[0];
      if (cur?.odooTaskId && cur.odooTaskId !== r.id) cur = undefined; // ID Clarity copiado para outra tarefa (duplicada no Odoo)
    }

    // pai
    const parentOdoo = m2oId(r.parent_id);
    let parentId: string | null = null;
    if (parentOdoo) {
      const [par] = await db.select().from(s.items).where(eq(s.items.odooTaskId, parentOdoo));
      if (!par) {
        if (await this.logOnce("project.task", r.id, `Tarefa "${r.name}": a tarefa-mãe ${parentOdoo} não está no Clarity (fora de um projeto Novo modelo?).`, "pendencia")) this.sum.pending++;
        return;
      }
      if (par.parentId) {
        if (await this.logOnce("project.task", r.id, `Tarefa "${r.name}" é subtarefa de subtarefa no Odoo; o Clarity não tem esse nível. Ajuste a tarefa-mãe no Odoo.`, "pendencia")) this.sum.pending++;
        return;
      }
      parentId = par.id;
    }

    // conflito: o Clarity mudou depois do Odoo
    // (o write_date do Odoo tem precisão de segundos: 1 s de tolerância)
    if (cur && cur.updatedAt.getTime() >= odooWrite.getTime() + 1000) {
      const msg = `Conflito na tarefa "${cur.name}": o Clarity foi alterado em ${cur.updatedAt.toISOString()}, depois do Odoo (${r.write_date}). Mantida a versão do Clarity; a do Odoo foi descartada (nome "${r.name}", etapa "${m2oName(r.stage_id) ?? "-"}").`;
      if (await this.logOnce("project.task", r.id, msg, "conflito")) this.sum.conflicts++;
      if (cur.syncStatus !== "nao_sincroniza") {
        const open = await db
          .select({ id: s.syncQueue.id })
          .from(s.syncQueue)
          .where(and(eq(s.syncQueue.entity, "item"), eq(s.syncQueue.entityId, cur.id), inArray(s.syncQueue.status, ["pendente", "processando"])));
        if (!open.length && cur.syncStatus !== "erro") await enqueueSync(db, "item", cur.id, cur.archived ? "delete" : "upsert");
      }
      return;
    }

    const names = ((r.tag_ids as number[]) ?? []).map((id) => tagName.get(id)).filter((x): x is string => !!x);
    const kind: "projeto" | "tarefa" = !parentId && names.includes(SYSTEM_TAGS.projeto) ? "projeto" : "tarefa";
    if (!parentId && !names.includes(SYSTEM_TAGS.projeto) && !names.includes(SYSTEM_TAGS.tarefa))
      await this.logOnce("project.task", r.id, `Tarefa "${r.name}" sem etiqueta Projeto ou Tarefa no Odoo; entrou no Clarity como tarefa simples.`, "warn");

    const stageName = m2oName(r.stage_id);
    let stage: StageKey | null = stageFromOdooName(stageName);
    if (!stage) {
      await this.logOnce("project.task", r.id, `Tarefa "${r.name}": etapa "${stageName ?? "(vazia)"}" do Odoo não corresponde a nenhuma das 5 etapas do Clarity.`, "warn");
      stage = (cur?.stage as StageKey) ?? "analise";
    }
    const hours = typeof r.allocated_hours === "number" ? r.allocated_hours : 0;
    const vals = {
      annualProjectId: annual.id,
      parentId,
      kind,
      name: String(r.name),
      description: htmlToText(r.description),
      stage,
      // sem prazo o Odoo não guarda o início planejado: mantém o do Clarity
      startDate: odooToDate(r.planned_date_begin) ?? (r.date_deadline ? null : (cur?.startDate ?? null)),
      deadline: odooToDate(r.date_deadline),
      plannedMinutes: hours ? Math.round(hours * 60) : null,
      isSustentacao: r[F.sustentacao] === true,
      archived: r.active === false,
    };

    let itemId: string;
    if (!cur) {
      const out = names.includes(SYSTEM_TAGS.foraDoEscopo);
      const [row] = await db
        .insert(s.items)
        .values({
          ...vals,
          scopeStatus: "confirmado",
          outOfScope: out,
          clientApproval: out ? "aguardando" : "nao_se_aplica",
          completedAt: stage === "concluido" ? odooWrite : null,
          odooTaskId: r.id,
          syncStatus: "enviado",
          createdAt: odooWrite,
          updatedAt: odooWrite,
        })
        .returning();
      itemId = row.id;
      await db.insert(s.stageHistory).values({ itemId, fromStage: null, toStage: stage });
      await audit(db, { entity: "item", entityId: itemId, action: "odoo_criar", after: row });
      this.sum.items.created++;
    } else {
      itemId = cur.id;
      const changed = Object.entries(vals).filter(([k, v]) => cur[k as keyof typeof cur] !== v);
      const assigneesChanged = await this.syncAssignees(itemId, (r.user_ids as number[]) ?? []);
      const tagsChanged = await this.syncTags(itemId, names);
      if (changed.length || assigneesChanged || tagsChanged || cur.odooTaskId !== r.id) {
        await db
          .update(s.items)
          .set({
            ...vals,
            odooTaskId: r.id,
            completedAt: stage === "concluido" ? (cur.completedAt ?? odooWrite) : null,
            syncStatus: "enviado",
            syncError: null,
            updatedAt: odooWrite,
          })
          .where(eq(s.items.id, itemId));
        if (cur.stage !== stage) await db.insert(s.stageHistory).values({ itemId, fromStage: cur.stage, toStage: stage });
        // o Odoo é mais recente: um envio antigo na fila não pode sobrescrevê-lo
        await db
          .update(s.syncQueue)
          .set({ status: "cancelado", lastError: "Substituído por alteração mais recente no Odoo.", updatedAt: new Date() })
          .where(and(eq(s.syncQueue.entity, "item"), eq(s.syncQueue.entityId, itemId), eq(s.syncQueue.status, "pendente")));
        await audit(db, {
          entity: "item",
          entityId: itemId,
          action: "odoo_atualizar",
          before: Object.fromEntries(changed.map(([k]) => [k, cur[k as keyof typeof cur]])),
          after: Object.fromEntries(changed),
        });
        this.sum.items.updated++;
      }
    }
    if (!cur) {
      await this.syncAssignees(itemId, (r.user_ids as number[]) ?? []);
      await this.syncTags(itemId, names);
    }
  }

  /** Responsáveis = usuários do Odoo ligados a pessoas do Clarity. Devolve se mudou. */
  private async syncAssignees(itemId: string, userIds: number[]): Promise<boolean> {
    const people = userIds.length ? await db.select({ id: s.people.id }).from(s.people).where(inArray(s.people.odooUserId, userIds)) : [];
    const want = new Set(people.map((p) => p.id));
    const have = new Set((await db.select({ id: s.itemAssignees.personId }).from(s.itemAssignees).where(eq(s.itemAssignees.itemId, itemId))).map((x) => x.id));
    const same = want.size === have.size && [...want].every((x) => have.has(x));
    if (same) return false;
    await db.delete(s.itemAssignees).where(eq(s.itemAssignees.itemId, itemId));
    if (want.size) await db.insert(s.itemAssignees).values([...want].map((personId) => ({ itemId, personId })));
    return true;
  }

  /** Etiquetas e marcadores pelo nome; marcador novo do Odoo passa a existir no Clarity. */
  private async syncTags(itemId: string, names: string[]): Promise<boolean> {
    const system = new Set<string>(Object.values(SYSTEM_TAGS));
    const want = new Set<string>();
    for (const n of names) {
      let [t] = await db.select().from(s.tags).where(eq(s.tags.name, n));
      if (!t) [t] = await db.insert(s.tags).values({ name: n, system: system.has(n) }).returning();
      want.add(t.id);
    }
    const have = new Set((await db.select({ id: s.itemTags.tagId }).from(s.itemTags).where(eq(s.itemTags.itemId, itemId))).map((x) => x.id));
    const same = want.size === have.size && [...want].every((x) => have.has(x));
    if (same) return false;
    await db.delete(s.itemTags).where(eq(s.itemTags.itemId, itemId));
    if (want.size) await db.insert(s.itemTags).values([...want].map((tagId) => ({ itemId, tagId })));
    return true;
  }

  // ---------- Pedidos de venda ----------

  async soLines() {
    const clients = await db.select({ id: s.clients.id, pid: s.clients.odooPartnerId }).from(s.clients);
    const contacts = await db.select({ clientId: s.clientContacts.clientId, pid: s.clientContacts.odooPartnerId }).from(s.clientContacts);
    const clientOf = new Map<number, string>();
    for (const c of contacts) if (c.pid) clientOf.set(c.pid, c.clientId);
    for (const c of clients) if (c.pid) clientOf.set(c.pid, c.id);
    const pids = [...clientOf.keys()];
    if (!pids.length) return;
    const recs = await this.odoo.searchRead(
      "sale.order.line",
      [["order_partner_id", "in", pids], ["display_type", "=", false], ...this.sinceDomain("sale.order.line")],
      ["id", "name", "order_id", "order_partner_id", "state", "write_date"],
      { order: "write_date asc, id asc" },
    );
    this.seen("sale.order.line", recs);
    for (const r of recs) {
      const clientId = clientOf.get(m2oId(r.order_partner_id) ?? -1);
      if (!clientId) continue;
      const vals = {
        clientId,
        orderName: m2oName(r.order_id) ?? "",
        lineName: String(r.name ?? "").split("\n")[0].slice(0, 200),
        active: r.state === "sale",
      };
      const [cur] = await db.select().from(s.salesOrderLines).where(eq(s.salesOrderLines.odooSoLineId, r.id));
      if (!cur) {
        await db.insert(s.salesOrderLines).values({ ...vals, odooSoLineId: r.id });
        this.sum.soLines.created++;
      } else if (Object.entries(vals).some(([k, v]) => cur[k as keyof typeof cur] !== v)) {
        await db.update(s.salesOrderLines).set(vals).where(eq(s.salesOrderLines.id, cur.id));
        this.sum.soLines.updated++;
      }
    }
  }
}

function yearOf(r: OdooRecord): number {
  for (const v of [r.date_start, r.date]) if (typeof v === "string" && /^\d{4}/.test(v)) return Number(v.slice(0, 4));
  const m = String(r.name).match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}
