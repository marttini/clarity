import "server-only";
import { db, schema as s } from "@/db";
import {
  odooErrorFromResponse,
  odooNetworkError,
  toOdooDatetime,
  type OdooClient,
  type OdooContext,
  type OdooDomain,
  type OdooError,
  type OdooRecord,
  type SearchReadOpts,
} from "./client";
import { deadlineToOdoo, minutesToHours, startToOdoo, textToHtml } from "./convert";
import { getOdooFields, STAGE_ODOO_NAMES } from "./fields";

/**
 * Odoo em memória para testes e para o modo ODOO_MODE=fake do app local.
 * Imita o comportamento do JSON-2 que o Clarity usa: domínios, many2one como [id, "nome"],
 * many2many com comandos [[6,0,ids]], campo active (arquivados somem da busca),
 * write_date a cada escrita e erros no mesmo formato do Odoo real.
 */

type FieldType = "char" | "text" | "html" | "bool" | "int" | "float" | "date" | "datetime" | "selection" | "m2o" | "m2m";
type FieldDef = { type: FieldType; rel?: string; required?: boolean };
type ModelDef = Record<string, FieldDef>;

const f = (type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({ type, ...extra });

const MODELS: Record<string, ModelDef> = {
  "project.project": {
    name: f("char", { required: true }),
    partner_id: f("m2o", { rel: "res.partner" }),
    tag_ids: f("m2m", { rel: "project.tags" }),
    user_id: f("m2o", { rel: "res.users" }),
    date_start: f("date"),
    date: f("date"),
    active: f("bool"),
  },
  "project.task": {
    name: f("char", { required: true }),
    project_id: f("m2o", { rel: "project.project" }),
    parent_id: f("m2o", { rel: "project.task" }),
    user_ids: f("m2m", { rel: "res.users" }),
    partner_id: f("m2o", { rel: "res.partner" }),
    planned_date_begin: f("datetime"),
    date_deadline: f("datetime"),
    allocated_hours: f("float"),
    effective_hours: f("float"),
    stage_id: f("m2o", { rel: "project.task.type" }),
    tag_ids: f("m2m", { rel: "project.tags" }),
    description: f("html"),
    state: f("selection"),
    active: f("bool"),
  },
  "project.tags": { name: f("char", { required: true }), color: f("int") },
  "project.task.type": { name: f("char", { required: true }), sequence: f("int"), fold: f("bool"), active: f("bool") },
  "account.analytic.line": {
    name: f("char", { required: true }),
    date: f("date"),
    employee_id: f("m2o", { rel: "hr.employee" }),
    user_id: f("m2o", { rel: "res.users" }),
    project_id: f("m2o", { rel: "project.project" }),
    task_id: f("m2o", { rel: "project.task" }),
    unit_amount: f("float"),
    so_line: f("m2o", { rel: "sale.order.line" }),
  },
  "res.partner": {
    name: f("char", { required: true }),
    is_company: f("bool"),
    parent_id: f("m2o", { rel: "res.partner" }),
    commercial_partner_id: f("m2o", { rel: "res.partner" }),
    type: f("selection"),
    vat: f("char"),
    street: f("char"),
    street2: f("char"),
    city: f("char"),
    state_id: f("m2o", { rel: "res.country.state" }),
    zip: f("char"),
    email: f("char"),
    phone: f("char"),
    function: f("char"),
    active: f("bool"),
  },
  "res.country.state": { name: f("char", { required: true }), code: f("char") },
  "hr.employee": {
    name: f("char", { required: true }),
    work_email: f("char"),
    job_title: f("char"),
    user_id: f("m2o", { rel: "res.users" }),
    active: f("bool"),
  },
  "res.users": { name: f("char", { required: true }), login: f("char", { required: true }), active: f("bool") },
  "sale.order": { name: f("char", { required: true }), partner_id: f("m2o", { rel: "res.partner" }), state: f("selection") },
  "sale.order.line": {
    name: f("char", { required: true }),
    order_id: f("m2o", { rel: "sale.order", required: true }),
    order_partner_id: f("m2o", { rel: "res.partner" }),
    state: f("selection"),
    display_type: f("selection"),
    product_uom_qty: f("float"),
  },
  "ir.attachment": {
    name: f("char", { required: true }),
    res_model: f("char"),
    res_id: f("int"),
    datas: f("char"),
    mimetype: f("char"),
    type: f("selection"),
  },
};

const COMMON: ModelDef = {
  id: f("int"),
  display_name: f("char"),
  write_date: f("datetime"),
  create_date: f("datetime"),
};

const DEFAULTS: Record<string, Record<string, unknown>> = {
  "project.project": { active: true },
  "project.task": { active: true, state: "01_in_progress", allocated_hours: 0, effective_hours: 0 },
  "project.task.type": { active: true },
  "res.partner": { active: true, type: "contact", is_company: false },
  "hr.employee": { active: true },
  "res.users": { active: true },
  "sale.order": { state: "sale" },
  "ir.attachment": { type: "binary" },
};

export type FailureKind = "down" | "timeout" | "auth" | "validation" | "missing" | "server";

type Rec = Record<string, unknown> & { id: number };

function raise(status: number, name: string, message: string): never {
  throw odooErrorFromResponse(status, { name, message, arguments: [message] });
}

export class FakeOdoo implements OdooClient {
  private tables = new Map<string, Map<number, Rec>>();
  private seq = new Map<string, number>();
  private failures: { kind: FailureKind; message?: string }[] = [];
  /** Todas as chamadas recebidas, para conferir nos testes. */
  calls: { model: string; method: string; body: Record<string, unknown> }[] = [];
  /** Relógio do Odoo (write_date). */
  clock: () => Date = () => new Date();

  // ---------- Controle (testes) ----------

  /** As próximas `n` chamadas falham do jeito pedido (ex.: "down" = Odoo fora do ar). */
  failNext(n: number, kind: FailureKind = "down", message?: string) {
    for (let i = 0; i < n; i++) this.failures.push({ kind, message });
  }

  /** Grava um registro direto (sem regras), mantendo o id dado. */
  insert(model: string, rec: Record<string, unknown> & { id?: number }, opts: { writeDate?: Date | string } = {}): number {
    this.model(model);
    const id = rec.id ?? this.nextId(model);
    const wd = opts.writeDate instanceof Date ? toOdooDatetime(opts.writeDate) : (opts.writeDate ?? toOdooDatetime(this.clock()));
    const row: Rec = { ...(DEFAULTS[model] ?? {}), ...rec, id, create_date: wd, write_date: wd };
    for (const [k, def] of Object.entries(MODELS[model])) if (def.type === "m2m") row[k] = applyM2m([], row[k]);
    this.table(model).set(id, row);
    if (id >= (this.seq.get(model) ?? 1)) this.seq.set(model, id + 1);
    return id;
  }

  /** Lê um registro cru (para conferir nos testes), inclusive arquivado. */
  get(model: string, id: number): Rec | undefined {
    const r = this.table(model).get(id);
    return r ? { ...r } : undefined;
  }

  /** Todos os registros crus de um modelo (inclusive arquivados). */
  all(model: string): Rec[] {
    return [...this.table(model).values()].map((r) => ({ ...r }));
  }

  /** Altera um registro "como se um usuário tivesse mexido no Odoo" (atualiza write_date). */
  touch(model: string, id: number, vals: Record<string, unknown>, at?: Date) {
    this.doWrite(model, [id], vals, at);
  }

  // ---------- OdooClient ----------

  async call<T = unknown>(model: string, method: string, body: Record<string, unknown>): Promise<T> {
    this.calls.push({ model, method, body: structuredClone(body) });
    const fail = this.failures.shift();
    if (fail) throw failure(fail.kind, fail.message);
    this.model(model);
    const ctx = (body.context ?? {}) as OdooContext;
    switch (method) {
      case "search_read":
        return this.doSearchRead(model, (body.domain ?? []) as OdooDomain, (body.fields ?? []) as string[], body as SearchReadOpts, ctx) as T;
      case "search":
        return this.doSearch(model, (body.domain ?? []) as OdooDomain, body as SearchReadOpts, ctx).map((r) => r.id) as T;
      case "search_count":
        return this.doSearch(model, (body.domain ?? []) as OdooDomain, {}, ctx).length as T;
      case "read":
        return this.doRead(model, (body.ids ?? []) as number[], (body.fields ?? []) as string[]) as T;
      case "create": {
        const list = (body.vals_list ?? []) as Record<string, unknown>[];
        return list.map((v) => this.doCreate(model, v)) as T;
      }
      case "write":
        this.doWrite(model, (body.ids ?? []) as number[], (body.vals ?? {}) as Record<string, unknown>);
        return true as T;
      case "unlink":
        this.doUnlink(model, (body.ids ?? []) as number[]);
        return true as T;
      default:
        raise(404, "werkzeug.exceptions.NotFound", `The method '${method}' does not exist on the model '${model}'`);
    }
  }

  searchRead(model: string, domain: OdooDomain, fields: string[], opts: SearchReadOpts = {}) {
    return this.call<OdooRecord[]>(model, "search_read", { domain, fields, ...opts });
  }
  async create(model: string, vals: Record<string, unknown>, opts: { context?: OdooContext } = {}) {
    const ids = await this.call<number[]>(model, "create", { vals_list: [vals], ...opts });
    return ids[0];
  }
  async write(model: string, ids: number[], vals: Record<string, unknown>, opts: { context?: OdooContext } = {}) {
    await this.call(model, "write", { ids, vals, ...opts });
    return true;
  }
  async unlink(model: string, ids: number[]) {
    await this.call(model, "unlink", { ids });
    return true;
  }

  // ---------- Internos ----------

  private model(model: string): ModelDef {
    const m = MODELS[model];
    if (!m) raise(404, "werkzeug.exceptions.NotFound", `The model '${model}' does not exist.`);
    return m;
  }
  private table(model: string) {
    let t = this.tables.get(model);
    if (!t) this.tables.set(model, (t = new Map()));
    return t;
  }
  private nextId(model: string) {
    const n = this.seq.get(model) ?? 1;
    this.seq.set(model, n + 1);
    return n;
  }
  private fieldDef(model: string, field: string): FieldDef {
    const d = MODELS[model][field] ?? COMMON[field];
    if (d) return d;
    if (field.startsWith("x_")) return { type: "char" }; // campos do Studio
    raise(422, "builtins.ValueError", `Invalid field '${field}' on model '${model}'`);
  }
  private hasActive(model: string) {
    return "active" in MODELS[model];
  }
  private missing(model: string, ids: number[]): never {
    raise(404, "odoo.exceptions.MissingError", `Record does not exist or has been deleted.\n(Record: ${model}(${ids.join(", ")},), User: 2)`);
  }

  /** Valor "cru" (inclui campos calculados). */
  private raw(model: string, rec: Rec, field: string): unknown {
    if (field === "display_name") return this.displayName(model, rec);
    if (model === "res.partner" && field === "commercial_partner_id") {
      let cur: Rec | undefined = rec;
      while (cur && !cur.is_company && typeof cur.parent_id === "number") cur = this.table("res.partner").get(cur.parent_id);
      return cur?.id ?? rec.id;
    }
    if (model === "sale.order.line" && (field === "order_partner_id" || field === "state")) {
      const o = typeof rec.order_id === "number" ? this.table("sale.order").get(rec.order_id) : undefined;
      return field === "state" ? (o?.state ?? false) : (o?.partner_id ?? false);
    }
    if (model === "project.task" && field === "effective_hours") {
      let h = 0;
      for (const l of this.table("account.analytic.line").values()) if (l.task_id === rec.id) h += Number(l.unit_amount ?? 0);
      return Math.round(h * 100) / 100;
    }
    return rec[field];
  }
  private displayName(model: string, rec: Rec): string {
    if (model === "res.partner" && typeof rec.parent_id === "number" && !rec.is_company) {
      const p = this.table("res.partner").get(rec.parent_id);
      if (p) return `${p.name}, ${rec.name}`;
    }
    return String(rec.name ?? `${model},${rec.id}`);
  }

  private exportValue(model: string, rec: Rec, field: string): unknown {
    const def = this.fieldDef(model, field);
    const v = this.raw(model, rec, field);
    if (def.type === "m2o") {
      if (typeof v !== "number") return false;
      const target = this.table(def.rel!).get(v);
      return [v, target ? this.displayName(def.rel!, target) : `${def.rel},${v}`];
    }
    if (def.type === "m2m") return Array.isArray(v) ? [...v] : [];
    if (field === "id") return rec.id;
    if (def.type === "float") return typeof v === "number" ? v : 0;
    if (def.type === "int") return typeof v === "number" ? v : false;
    if (def.type === "bool") return !!v;
    return v === undefined || v === null || v === "" ? false : v;
  }

  private doRead(model: string, ids: number[], fields: string[]) {
    const out: OdooRecord[] = [];
    for (const id of ids) {
      const rec = this.table(model).get(id);
      if (!rec) this.missing(model, [id]);
      out.push(this.project(model, rec, fields));
    }
    return out;
  }

  private project(model: string, rec: Rec, fields: string[]): OdooRecord {
    const list = fields.length ? fields : [...Object.keys(MODELS[model]), "display_name", "write_date"];
    const o: OdooRecord = { id: rec.id };
    for (const fld of list) o[fld] = this.exportValue(model, rec, fld);
    return o;
  }

  private doSearch(model: string, domain: OdooDomain, opts: SearchReadOpts, ctx: OdooContext): Rec[] {
    const pred = this.compile(model, domain);
    const mentionsActive = domain.some((t) => Array.isArray(t) && t[0] === "active");
    const activeTest = ctx.active_test !== false && this.hasActive(model) && !mentionsActive;
    let rows = [...this.table(model).values()].filter((r) => (!activeTest || r.active !== false) && pred(r));
    const order = (opts.order ?? "id").split(",").map((p) => p.trim().split(/\s+/));
    rows.sort((a, b) => {
      for (const [fld, dir] of order) {
        const av = this.raw(model, a, fld) as string | number;
        const bv = this.raw(model, b, fld) as string | number;
        if (av === bv) continue;
        const c = (av ?? "") < (bv ?? "") ? -1 : 1;
        return dir?.toLowerCase() === "desc" ? -c : c;
      }
      return a.id - b.id;
    });
    if (opts.offset) rows = rows.slice(opts.offset);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }

  private doSearchRead(model: string, domain: OdooDomain, fields: string[], opts: SearchReadOpts, ctx: OdooContext) {
    for (const fld of fields) this.fieldDef(model, fld);
    return this.doSearch(model, domain, opts, ctx).map((r) => this.project(model, r, fields));
  }

  // --- domínio (notação polonesa, '&' implícito) ---
  private compile(model: string, domain: OdooDomain): (r: Rec) => boolean {
    let i = 0;
    const parse = (): ((r: Rec) => boolean) => {
      const t = domain[i++];
      if (t === "&" || t === "|") {
        const a = parse();
        const b = parse();
        return t === "&" ? (r) => a(r) && b(r) : (r) => a(r) || b(r);
      }
      if (t === "!") {
        const a = parse();
        return (r) => !a(r);
      }
      if (!Array.isArray(t) || t.length !== 3) raise(422, "builtins.ValueError", `Invalid leaf ${JSON.stringify(t)}`);
      return this.leaf(model, t[0], t[1], t[2]);
    };
    const preds: ((r: Rec) => boolean)[] = [];
    while (i < domain.length) preds.push(parse());
    return (r) => preds.every((p) => p(r));
  }

  private leaf(model: string, path: string, op: string, value: unknown): (r: Rec) => boolean {
    const parts = path.split(".");
    // valida o caminho
    let m = model;
    for (const [idx, p] of parts.entries()) {
      const d = this.fieldDef(m, p);
      if (idx < parts.length - 1) {
        if (!d.rel) raise(422, "builtins.ValueError", `Invalid field '${path}' on model '${model}'`);
        m = d.rel;
      }
    }
    const lastDef = this.fieldDef(m, parts.at(-1)!);
    const textOp = /like/.test(op);
    if (textOp && lastDef.rel) parts.push("display_name");

    const values = (rec: Rec): unknown[] => {
      let cur: { model: string; rec: Rec }[] = [{ model, rec }];
      let vals: unknown[] = [];
      parts.forEach((p, idx) => {
        const last = idx === parts.length - 1;
        const next: { model: string; rec: Rec }[] = [];
        vals = [];
        for (const c of cur) {
          const d = this.fieldDef(c.model, p);
          const v = this.raw(c.model, c.rec, p);
          const ids = d.type === "m2m" ? ((v as number[]) ?? []) : d.type === "m2o" ? (typeof v === "number" ? [v] : []) : null;
          if (last) {
            if (ids) vals.push(...ids);
            else vals.push(v);
          } else if (ids) {
            for (const id of ids) {
              const t = this.table(d.rel!).get(id);
              if (t) next.push({ model: d.rel!, rec: t });
            }
          }
        }
        cur = next;
      });
      return vals;
    };
    const empty = (v: unknown) => v === false || v === null || v === undefined || v === "";
    const eq = (v: unknown, x: unknown) => (empty(v) && empty(x)) || v === x;
    const cmp = (v: unknown, x: unknown) => (typeof v === "number" ? v - Number(x) : String(v).localeCompare(String(x)));
    const anyMatch = (vals: unknown[], fn: (v: unknown) => boolean) => (vals.length ? vals.some(fn) : fn(false));

    switch (op) {
      case "=":
        return (r) => anyMatch(values(r), (v) => eq(v, value));
      case "!=":
        return (r) => !anyMatch(values(r), (v) => eq(v, value));
      case "in":
        return (r) => anyMatch(values(r), (v) => (value as unknown[]).some((x) => eq(v, x)));
      case "not in":
        return (r) => !anyMatch(values(r), (v) => (value as unknown[]).some((x) => eq(v, x)));
      case "ilike":
      case "like":
      case "=ilike":
      case "=like":
      case "not ilike": {
        const ci = op.includes("ilike");
        const needle = ci ? String(value).toLowerCase() : String(value);
        const exact = op.startsWith("=");
        const test = (v: unknown) => {
          if (typeof v !== "string") return false;
          const hay = ci ? v.toLowerCase() : v;
          return exact ? hay === needle : hay.includes(needle);
        };
        return op === "not ilike" ? (r) => !values(r).some(test) : (r) => values(r).some(test);
      }
      case ">":
        return (r) => values(r).some((v) => !empty(v) && cmp(v, value) > 0);
      case ">=":
        return (r) => values(r).some((v) => !empty(v) && cmp(v, value) >= 0);
      case "<":
        return (r) => values(r).some((v) => !empty(v) && cmp(v, value) < 0);
      case "<=":
        return (r) => values(r).some((v) => !empty(v) && cmp(v, value) <= 0);
      default:
        raise(422, "builtins.ValueError", `Invalid leaf operator '${op}'`);
    }
  }

  // --- escrita ---
  private normalize(model: string, vals: Record<string, unknown>, current?: Rec): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(vals)) {
      if (k === "id" || k === "write_date" || k === "create_date" || k === "display_name") continue;
      const d = this.fieldDef(model, k);
      if (d.type === "m2o") {
        if (v === false || v === null) out[k] = false;
        else {
          const id = Number(v);
          if (!this.table(d.rel!).has(id))
            raise(422, "psycopg2.errors.ForeignKeyViolation", `insert or update on table "${model.replace(/\./g, "_")}" violates foreign key constraint on ${k}: ${d.rel}(${id}) does not exist`);
          out[k] = id;
        }
      } else if (d.type === "m2m") {
        const ids = applyM2m((current?.[k] as number[]) ?? [], v);
        for (const id of ids)
          if (!this.table(d.rel!).has(id)) raise(422, "psycopg2.errors.ForeignKeyViolation", `${d.rel}(${id}) does not exist`);
        out[k] = ids;
      } else out[k] = v;
    }
    return out;
  }

  private rules(model: string, rec: Rec, changed?: Set<string>) {
    for (const [k, d] of Object.entries(MODELS[model]))
      if (d.required && (rec[k] === undefined || rec[k] === false || rec[k] === null || rec[k] === ""))
        raise(422, "odoo.exceptions.ValidationError", `Missing required value for the field '${k}' on model '${model}'`);
    if (model === "account.analytic.line") {
      if (typeof rec.task_id === "number") {
        const task = this.table("project.task").get(rec.task_id)!;
        if (task.active === false && (!changed || changed.has("task_id"))) raise(422, "odoo.exceptions.UserError", "You cannot log timesheets on an archived task.");
        if (!rec.project_id) rec.project_id = task.project_id;
      }
      if (!rec.project_id) raise(422, "odoo.exceptions.ValidationError", "Timesheets must be created on a project.");
      if (!rec.employee_id) raise(422, "odoo.exceptions.ValidationError", "Timesheets must be created with an active employee.");
      if (!rec.date) rec.date = toOdooDatetime(this.clock()).slice(0, 10);
    }
    if (model === "project.task" && typeof rec.parent_id === "number" && rec.parent_id === rec.id)
      raise(422, "odoo.exceptions.ValidationError", "Error! You cannot create a recursive hierarchy of tasks.");
  }

  private doCreate(model: string, vals: Record<string, unknown>): number {
    const id = this.nextId(model);
    const norm = this.normalize(model, vals);
    const wd = toOdooDatetime(this.clock());
    const rec: Rec = { ...(DEFAULTS[model] ?? {}), ...norm, id, create_date: wd, write_date: wd };
    for (const [k, d] of Object.entries(MODELS[model])) if (d.type === "m2m" && !Array.isArray(rec[k])) rec[k] = [];
    this.rules(model, rec);
    this.table(model).set(id, rec);
    return id;
  }

  private doWrite(model: string, ids: number[], vals: Record<string, unknown>, at?: Date) {
    const t = this.table(model);
    const missing = ids.filter((id) => !t.has(id));
    if (missing.length) this.missing(model, missing);
    const wd = toOdooDatetime(at ?? this.clock());
    for (const id of ids) {
      const cur = t.get(id)!;
      const next: Rec = { ...cur, ...this.normalize(model, vals, cur), id, write_date: wd };
      this.rules(model, next, new Set(Object.keys(vals)));
      t.set(id, next);
    }
  }

  private doUnlink(model: string, ids: number[]) {
    const t = this.table(model);
    const missing = ids.filter((id) => !t.has(id));
    if (missing.length) this.missing(model, missing);
    for (const id of ids) t.delete(id);
  }
}

function applyM2m(current: number[], v: unknown): number[] {
  if (!Array.isArray(v)) return [...current];
  // lista simples de ids (aceito pelo Odoo em leitura/insert direto)
  if (v.every((x) => typeof x === "number")) return [...new Set(v as number[])];
  let ids = [...current];
  for (const cmd of v as unknown[][]) {
    const [c, id, list] = cmd as [number, number, number[]];
    if (c === 6) ids = [...new Set(list ?? [])];
    else if (c === 4) ids = ids.includes(id) ? ids : [...ids, id];
    else if (c === 3) ids = ids.filter((x) => x !== id);
    else if (c === 5) ids = [];
    else raise(422, "builtins.ValueError", `Unsupported x2many command ${c}`);
  }
  return ids;
}

function failure(kind: FailureKind, message?: string): OdooError {
  switch (kind) {
    case "down":
      return odooNetworkError(new TypeError(message ?? "fetch failed"));
    case "timeout": {
      const e = new Error(message ?? "The operation was aborted due to timeout");
      e.name = "TimeoutError";
      return odooNetworkError(e);
    }
    case "auth":
      return odooErrorFromResponse(401, { name: "werkzeug.exceptions.Unauthorized", message: message ?? "Invalid apikey" });
    case "validation":
      return odooErrorFromResponse(422, { name: "odoo.exceptions.ValidationError", message: message ?? "Invalid value" });
    case "missing":
      return odooErrorFromResponse(404, { name: "odoo.exceptions.MissingError", message: message ?? "Record does not exist or has been deleted." });
    case "server":
      return odooErrorFromResponse(500, { name: "builtins.Exception", message: message ?? "Internal Server Error" });
  }
}

// ---------- Espelho dos dados fictícios ----------

/** Ids fixos do Odoo falso que não existem no banco do Clarity. */
export const FAKE_IDS = { novoModeloTag: 100, stageBase: 11, stateGO: 72, companyPartner: 1 } as const;

/**
 * Preenche o Odoo falso com o que o banco do Clarity já diz existir lá (odoo_*_id gravados
 * pelo seed): etiquetas, etapas, clientes, contatos, funcionários, usuários, projetos anuais,
 * tarefas, linhas de pedido e apontamentos enviados. Assim o modo fake funciona no app local.
 */
export async function seedFakeFromDb(fake: FakeOdoo) {
  const F = await getOdooFields();
  const at = (d: Date | null | undefined) => d ?? new Date();

  fake.insert("res.country.state", { id: FAKE_IDS.stateGO, name: "Goiás (BR)", code: "GO" });
  fake.insert("res.partner", { id: FAKE_IDS.companyPartner, name: "Síntese Consultoria", is_company: true });

  // Etiquetas
  fake.insert("project.tags", { id: FAKE_IDS.novoModeloTag, name: F.novoModeloTag });
  for (const t of await db.select().from(s.tags)) if (t.odooTagId) fake.insert("project.tags", { id: t.odooTagId, name: t.name });

  // Etapas
  const stageIds: Record<string, number> = {};
  Object.entries(STAGE_ODOO_NAMES).forEach(([k, name], i) => {
    stageIds[k] = fake.insert("project.task.type", { id: FAKE_IDS.stageBase + i, name, sequence: i + 1, fold: k === "concluido" });
  });

  // Usuários e funcionários
  const people = await db.select().from(s.people);
  for (const p of people) {
    if (p.odooUserId) fake.insert("res.users", { id: p.odooUserId, name: p.name, login: p.email, active: p.active }, { writeDate: at(p.updatedAt) });
    if (p.odooEmployeeId)
      fake.insert(
        "hr.employee",
        { id: p.odooEmployeeId, name: p.name, work_email: p.email, job_title: p.jobTitle ?? false, user_id: p.odooUserId ?? false, active: p.active, [F.consultor]: p.isConsultor },
        { writeDate: at(p.updatedAt) },
      );
  }

  // Clientes e contatos
  const clients = await db.select().from(s.clients);
  for (const c of clients)
    if (c.odooPartnerId)
      fake.insert(
        "res.partner",
        {
          id: c.odooPartnerId,
          name: c.name,
          is_company: true,
          vat: c.cnpj ?? false,
          street: c.street ?? false,
          city: c.city ?? false,
          state_id: c.state === "GO" ? FAKE_IDS.stateGO : false,
          zip: c.zip ?? false,
          email: c.email ?? false,
          phone: c.phone ?? false,
          active: c.active,
        },
        { writeDate: at(c.updatedAt) },
      );
  const partnerOf = new Map(clients.map((c) => [c.id, c.odooPartnerId]));
  for (const ct of await db.select().from(s.clientContacts)) {
    const parent = partnerOf.get(ct.clientId);
    if (ct.odooPartnerId && parent)
      fake.insert(
        "res.partner",
        { id: ct.odooPartnerId, name: ct.name, is_company: false, parent_id: parent, email: ct.email ?? false, phone: ct.phone ?? false, function: ct.jobTitle ?? false, active: ct.active },
        { writeDate: at(ct.createdAt) },
      );
  }

  // Projetos anuais
  const annual = await db.select().from(s.annualProjects);
  for (const a of annual)
    if (a.odooProjectId)
      fake.insert(
        "project.project",
        { id: a.odooProjectId, name: a.name, partner_id: partnerOf.get(a.clientId) ?? false, tag_ids: [FAKE_IDS.novoModeloTag], date_start: `${a.year}-01-01`, date: `${a.year}-12-31`, active: a.active },
        { writeDate: at(a.createdAt) },
      );
  const projectOf = new Map(annual.map((a) => [a.id, a.odooProjectId]));

  // Tarefas (pais antes dos filhos)
  const items = await db.select().from(s.items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const userOf = new Map(people.map((p) => [p.id, p.odooUserId]));
  const assignees = await db.select().from(s.itemAssignees);
  const tagRows = await db.select().from(s.tags);
  const tagOf = new Map(tagRows.map((t) => [t.id, t.odooTagId]));
  const itemTags = await db.select().from(s.itemTags);
  const sorted = [...items].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
  for (const it of sorted) {
    if (!it.odooTaskId) continue;
    const parent = it.parentId ? byId.get(it.parentId) : null;
    fake.insert(
      "project.task",
      {
        id: it.odooTaskId,
        name: it.name,
        project_id: projectOf.get(it.annualProjectId) ?? false,
        parent_id: parent?.odooTaskId ?? false,
        user_ids: assignees.filter((a) => a.itemId === it.id).map((a) => userOf.get(a.personId)).filter((x): x is number => !!x),
        planned_date_begin: it.deadline ? startToOdoo(it.startDate) : false,
        date_deadline: deadlineToOdoo(it.deadline),
        allocated_hours: it.plannedMinutes ? minutesToHours(it.plannedMinutes) : 0,
        stage_id: stageIds[it.stage],
        tag_ids: itemTags.filter((t) => t.itemId === it.id).map((t) => tagOf.get(t.tagId)).filter((x): x is number => !!x),
        description: textToHtml(it.description),
        active: !it.archived,
        [F.sustentacao]: it.isSustentacao,
        [F.clarityId]: it.id,
      },
      { writeDate: at(it.updatedAt) },
    );
  }

  // Pedidos de venda
  for (const so of await db.select().from(s.salesOrderLines)) {
    const partner = partnerOf.get(so.clientId);
    const existing = fake.all("sale.order").find((o) => o.name === so.orderName);
    const orderId = existing?.id ?? fake.insert("sale.order", { name: so.orderName, partner_id: partner ?? false, state: so.active ? "sale" : "cancel" });
    fake.insert("sale.order.line", { id: so.odooSoLineId, name: so.lineName, order_id: orderId });
  }

  // Apontamentos já enviados
  const types = new Map((await db.select().from(s.entryTypes)).map((t) => [t.id, t]));
  const soOf = new Map((await db.select().from(s.salesOrderLines)).map((x) => [x.id, x.odooSoLineId]));
  const empOf = new Map(people.map((p) => [p.id, p.odooEmployeeId]));
  for (const e of await db.select().from(s.timeEntries)) {
    if (!e.odooLineId || e.deletedAt) continue;
    const it = byId.get(e.itemId);
    const type = types.get(e.typeId);
    fake.insert(
      "account.analytic.line",
      {
        id: e.odooLineId,
        name: e.description,
        date: e.date,
        employee_id: empOf.get(e.personId) ?? false,
        project_id: it ? (projectOf.get(it.annualProjectId) ?? false) : false,
        task_id: it?.odooTaskId ?? false,
        unit_amount: minutesToHours(e.minutes),
        so_line: type?.acceptsSalesOrder && e.salesOrderLineId ? (soOf.get(e.salesOrderLineId) ?? false) : false,
        [F.entryType]: type?.code ?? false,
        [F.sustentacao]: e.isSustentacao,
        [F.clarityId]: e.id,
      },
      { writeDate: at(e.updatedAt) },
    );
  }
  return fake;
}
