import "server-only";

/**
 * Cliente do Odoo 19 pela API JSON-2 (docs/integracao-odoo.md).
 * POST {ODOO_URL}/json/2/{modelo}/{método}, argumentos nomeados no corpo,
 * autenticado pela chave do usuário "Integração Clarity".
 * Nenhuma tela usa este cliente direto: só a fila (push.ts) e a leitura (pull.ts).
 */

export type OdooDomainTerm = "&" | "|" | "!" | [string, string, unknown];
export type OdooDomain = OdooDomainTerm[];
export type OdooRecord = Record<string, unknown> & { id: number };
export type OdooContext = Record<string, unknown>;

export type SearchReadOpts = { limit?: number; offset?: number; order?: string; context?: OdooContext };

export interface OdooClient {
  searchRead(model: string, domain: OdooDomain, fields: string[], opts?: SearchReadOpts): Promise<OdooRecord[]>;
  create(model: string, vals: Record<string, unknown>, opts?: { context?: OdooContext }): Promise<number>;
  write(model: string, ids: number[], vals: Record<string, unknown>, opts?: { context?: OdooContext }): Promise<boolean>;
  unlink(model: string, ids: number[]): Promise<boolean>;
  call<T = unknown>(model: string, method: string, body: Record<string, unknown>): Promise<T>;
}

// ---------- Erros ----------

export type OdooErrorKind = "config" | "auth" | "not_found" | "missing" | "validation" | "down" | "timeout" | "unknown";

/** Erro do Odoo com mensagem em português claro; a original fica em `original`. */
export class OdooError extends Error {
  constructor(
    message: string,
    public kind: OdooErrorKind,
    public original: string,
    public status?: number,
  ) {
    super(message);
    this.name = "OdooError";
  }
  /** Vale tentar de novo mais tarde (Odoo fora do ar, lento, chave trocada). */
  get retryable(): boolean {
    return this.kind === "down" || this.kind === "timeout" || this.kind === "auth" || this.kind === "unknown" || this.kind === "config";
  }
}

/** Traduz uma resposta de erro do JSON-2 ({name, message, arguments, debug}) para português. */
export function odooErrorFromResponse(status: number, body: unknown): OdooError {
  const b = (body && typeof body === "object" ? body : {}) as { name?: string; message?: string; arguments?: unknown[] };
  const name = b.name ?? "";
  const msg = (b.message ?? (typeof body === "string" ? body : "")).toString();
  const original = `${status} ${name}: ${msg}`.trim();
  const has = (re: RegExp) => re.test(msg) || re.test(name);

  if (status === 401 || has(/invalid api key|AccessDenied|SessionExpired/i))
    return new OdooError("O Odoo recusou a chave de acesso. Peça ao administrador para conferir a chave de API em Configurações → Integração.", "auth", original, status);
  if (status === 403 || has(/AccessError/))
    return new OdooError("O usuário de integração não tem permissão para esta operação no Odoo. Peça ao administrador do Odoo para revisar os acessos do usuário \"Integração Clarity\".", "auth", original, status);
  if (has(/MissingError|does not exist or has been deleted|Record does not exist/i))
    return new OdooError("O registro não existe mais no Odoo (foi excluído ou arquivado). Confira no Odoo e envie de novo.", "missing", original, status);
  if (has(/archived/i))
    return new OdooError("O Odoo recusou: o registro está arquivado lá. Desarquive no Odoo ou escolha outra tarefa.", "validation", original, status);
  if (status === 404 || has(/Invalid field|Unknown field|does not exist.*model|model.*not found|object .* doesn't exist/i)) {
    const field = msg.match(/field[^'"]*['"]([\w.]+)['"]/i)?.[1];
    return new OdooError(
      field
        ? `O campo "${field}" não existe no Odoo. Confira os nomes técnicos em Configurações → Integração.`
        : "O Odoo não encontrou o modelo ou o campo pedido. Confira os nomes técnicos em Configurações → Integração.",
      "not_found",
      original,
      status,
    );
  }
  if (status === 422 || status === 400 || has(/ValidationError|UserError|ValueError|IntegrityError|constraint/i)) {
    const detail = msg.split("\n")[0].slice(0, 300);
    return new OdooError(`O Odoo recusou os dados: ${detail || "verifique os campos"}. Corrija e envie de novo.`, "validation", original, status);
  }
  if (status === 408 || status === 504) return new OdooError("O Odoo demorou demais para responder. O Clarity tenta de novo automaticamente.", "timeout", original, status);
  if (status === 502 || status === 503 || status === 520 || status === 521 || status === 522)
    return new OdooError("O Odoo está fora do ar no momento. O Clarity tenta de novo automaticamente.", "down", original, status);
  return new OdooError("O Odoo respondeu com um erro inesperado. O Clarity tenta de novo automaticamente; se continuar, avise o guardião técnico.", "unknown", original, status);
}

/** Falha de rede (sem resposta HTTP). */
export function odooNetworkError(err: unknown): OdooError {
  const original = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
    return new OdooError("O Odoo demorou demais para responder. O Clarity tenta de novo automaticamente.", "timeout", original);
  return new OdooError("Não foi possível falar com o Odoo (fora do ar ou sem rede). O Clarity tenta de novo automaticamente.", "down", original);
}

// ---------- Implementação HTTP (JSON-2) ----------

export const ODOO_TIMEOUT_MS = 20_000;

export class HttpOdooClient implements OdooClient {
  constructor(
    private cfg: { url: string; apiKey: string; db?: string; timeoutMs?: number; fetch?: typeof fetch },
  ) {}

  async call<T = unknown>(model: string, method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.cfg.url.replace(/\/+$/, "")}/json/2/${model}/${method}`;
    const headers: Record<string, string> = {
      Authorization: `bearer ${this.cfg.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "Sintese-Clarity",
    };
    if (this.cfg.db) headers["X-Odoo-Database"] = this.cfg.db;
    let res: Response;
    try {
      res = await (this.cfg.fetch ?? fetch)(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? ODOO_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      throw odooNetworkError(e);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // HTML de página de erro do proxy (Odoo.sh fora do ar, por exemplo)
    }
    if (!res.ok) throw odooErrorFromResponse(res.status, parsed);
    return parsed as T;
  }

  searchRead(model: string, domain: OdooDomain, fields: string[], opts: SearchReadOpts = {}) {
    const body: Record<string, unknown> = { domain, fields };
    if (opts.limit !== undefined) body.limit = opts.limit;
    if (opts.offset !== undefined) body.offset = opts.offset;
    if (opts.order) body.order = opts.order;
    if (opts.context) body.context = opts.context;
    return this.call<OdooRecord[]>(model, "search_read", body);
  }

  async create(model: string, vals: Record<string, unknown>, opts: { context?: OdooContext } = {}) {
    const ids = await this.call<number[] | number>(model, "create", { vals_list: [vals], ...(opts.context ? { context: opts.context } : {}) });
    return Array.isArray(ids) ? ids[0] : ids;
  }

  async write(model: string, ids: number[], vals: Record<string, unknown>, opts: { context?: OdooContext } = {}) {
    await this.call(model, "write", { ids, vals, ...(opts.context ? { context: opts.context } : {}) });
    return true;
  }

  async unlink(model: string, ids: number[]) {
    await this.call(model, "unlink", { ids });
    return true;
  }
}

// ---------- Escolha do cliente ----------

const g = globalThis as unknown as { __clarityOdoo?: OdooClient; __clarityOdooFake?: Promise<OdooClient> };

export function odooMode(): "fake" | "real" {
  const m = process.env.ODOO_MODE;
  if (m === "real" || m === "fake") return m;
  return process.env.NODE_ENV === "production" ? "real" : "fake";
}

/** Troca o cliente em uso (testes). `null` volta ao padrão. */
export function setOdoo(client: OdooClient | null) {
  g.__clarityOdoo = client ?? undefined;
  g.__clarityOdooFake = undefined;
}

/**
 * Cliente em uso: ODOO_MODE=real usa ODOO_URL/ODOO_API_KEY; fake (padrão fora de produção)
 * usa o Odoo em memória espelhando os ids gravados no banco local.
 */
export async function getOdoo(): Promise<OdooClient> {
  if (g.__clarityOdoo) return g.__clarityOdoo;
  if (odooMode() === "real") {
    const url = process.env.ODOO_URL;
    const apiKey = process.env.ODOO_API_KEY;
    if (!url || !apiKey)
      throw new OdooError("A integração com o Odoo não está configurada (ODOO_URL e ODOO_API_KEY).", "config", "missing ODOO_URL/ODOO_API_KEY");
    g.__clarityOdoo = new HttpOdooClient({ url, apiKey, db: process.env.ODOO_DB || undefined });
    return g.__clarityOdoo;
  }
  g.__clarityOdooFake ??= (async () => {
    const { FakeOdoo, seedFakeFromDb } = await import("./fake");
    const fake = new FakeOdoo();
    await seedFakeFromDb(fake);
    g.__clarityOdoo = fake;
    return fake;
  })();
  return g.__clarityOdooFake;
}

// ---------- Utilidades de formato ----------

/** many2one vem como [id, "nome"] ou false. */
export function m2oId(v: unknown): number | null {
  if (Array.isArray(v) && typeof v[0] === "number") return v[0];
  if (typeof v === "number") return v;
  return null;
}
export function m2oName(v: unknown): string | null {
  return Array.isArray(v) && typeof v[1] === "string" ? v[1] : null;
}
/** Datetime do Odoo ("AAAA-MM-DD HH:MM:SS", UTC) → Date. */
export function parseOdooDatetime(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  return new Date(v.replace(" ", "T") + (v.length <= 10 ? "T00:00:00Z" : "Z"));
}
/** Date → "AAAA-MM-DD HH:MM:SS" em UTC. */
export function toOdooDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
