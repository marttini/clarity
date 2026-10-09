import "server-only";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";

/**
 * Nomes técnicos dos campos criados no Studio (Configurações → Integração).
 * Ficam na tabela settings, chave "odoo_fields"; o Diego confirma no staging.
 */
export type OdooFields = {
  /** account.analytic.line: Tipo de apontamento (seleção com os códigos dos tipos). */
  entryType: string;
  /** project.task e account.analytic.line: Sustentação (sim/não). */
  sustentacao: string;
  /** project.task e account.analytic.line: ID Clarity (texto). */
  clarityId: string;
  /** hr.employee: Consultor (sim/não). */
  consultor: string;
  /** Nome da etiqueta de projeto (project.project) que marca o novo modelo. */
  novoModeloTag: string;
};

export const DEFAULT_ODOO_FIELDS: OdooFields = {
  entryType: "x_studio_tipo_de_apontamento",
  sustentacao: "x_studio_sustentacao",
  clarityId: "x_studio_id_clarity",
  consultor: "x_studio_consultor",
  novoModeloTag: "Novo modelo",
};

export async function getOdooFields(): Promise<OdooFields> {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "odoo_fields"));
  const v = (row?.value ?? {}) as Partial<OdooFields>;
  const out = { ...DEFAULT_ODOO_FIELDS };
  for (const k of Object.keys(out) as (keyof OdooFields)[]) {
    const val = v[k];
    if (typeof val === "string" && val.trim()) out[k] = val.trim();
  }
  return out;
}

/** Nomes longos das etapas no Odoo (project.task.type), localizadas pelo nome. */
export const STAGE_ODOO_NAMES = {
  analise: "Projetos em Análise/Aprovação",
  estimativa: "Avaliação de novos projetos / estimativa de esforço",
  alocacao: "Alocação de recursos",
  andamento: "Em andamento",
  concluido: "Concluído",
} as const;
export type StageKey = keyof typeof STAGE_ODOO_NAMES;

export function stageFromOdooName(name: string | null | undefined): StageKey | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  for (const [k, v] of Object.entries(STAGE_ODOO_NAMES)) if (v.toLowerCase() === n) return k as StageKey;
  return null;
}

/** Etiquetas de sistema das tarefas (project.tags). */
export const SYSTEM_TAGS = { projeto: "Projeto", tarefa: "Tarefa", foraDoEscopo: "Fora do escopo" } as const;

/** Paleta para clientes novos, escolhida em ordem. */
export const CLIENT_PALETTE = ["#F59A6B", "#A897F5", "#63BDEB", "#6CCB98", "#EDC75A", "#D98BC9", "#7FB7A4", "#B9A06B"];
