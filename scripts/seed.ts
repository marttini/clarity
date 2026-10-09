/**
 * Dados de demonstração (fictícios) para desenvolvimento e testes.
 * NUNCA rodar em produção: em produção, clientes, pessoas, projetos e tarefas vêm do Odoo.
 *
 * Uso: npx tsx scripts/seed.ts [--today=2026-10-08]
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import {
  addDays,
  addMonths,
  nationalHolidays,
  isWorkday,
  startOfMonth,
  toISODate,
  type ISODate,
} from "../src/domain/dates";
import { DEFAULT_SETTINGS } from "../src/domain/rules";

const arg = process.argv.find((a) => a.startsWith("--today="));
const TODAY: ISODate = arg ? arg.split("=")[1] : process.env.CLARITY_NOW ? toISODate(new Date(process.env.CLARITY_NOW)) : toISODate();
const YEAR = Number(TODAY.slice(0, 4));

// PRNG determinístico (mulberry32) para os números baterem entre execuções.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261008);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_SEED) throw new Error("Seed bloqueado em produção.");
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema: s });

  // Limpa tudo (ordem por dependência)
  await client.unsafe(`TRUNCATE ${[
    "audit_log", "sync_log", "sync_state", "sync_queue", "outbox", "notifications", "tv_tokens", "holidays", "settings",
    "evaluations", "attachments", "comments", "contacts", "absence_justifications", "absence_reasons", "change_requests",
    "time_entries", "sales_order_lines", "entry_types", "meetings", "deliverables", "scope_versions", "deadline_changes",
    "stage_history", "item_tags", "item_assignees", "items", "tags", "annual_projects", "client_contacts", "clients", "people",
  ].join(", ")} CASCADE`);

  // Configurações e feriados
  await db.insert(s.settings).values({ key: "rules", value: DEFAULT_SETTINGS });
  const hol = [YEAR - 1, YEAR, YEAR + 1].flatMap(nationalHolidays);
  await db.insert(s.holidays).values(hol);
  const H = new Set(hol.map((h) => h.date));

  // Tipos de apontamento
  const types = await db
    .insert(s.entryTypes)
    .values([
      { code: "faturavel", name: "Faturável", acceptsSalesOrder: true, countsForBonus: true, builtin: true, sort: 1 },
      { code: "bonificado", name: "Bonificado", builtin: true, sort: 2 },
      { code: "interno", name: "Interno", isInternal: true, builtin: true, sort: 3 },
      { code: "provisionamento", name: "Provisionamento", isProvisioning: true, builtin: true, sort: 4 },
    ])
    .returning();
  const T = Object.fromEntries(types.map((t) => [t.code, t]));

  // Etiquetas
  const tagRows = await db
    .insert(s.tags)
    .values([
      { name: "Projeto", system: true, odooTagId: 101 },
      { name: "Tarefa", system: true, odooTagId: 102 },
      { name: "Fora do escopo", system: true, color: "#F2D27A", odooTagId: 103 },
      { name: "Pausado", color: "#8C7E9B", odooTagId: 104 },
      { name: "Ag. retorno cliente", color: "#63BDEB", odooTagId: 105 },
      { name: "Pend. doc. cliente", color: "#EDC75A", odooTagId: 106 },
      { name: "Crítico", color: "#FF8A80", odooTagId: 107 },
      { name: "Não autorizado", color: "#D98BC9", odooTagId: 108 },
    ])
    .returning();
  const TG = Object.fromEntries(tagRows.map((t) => [t.name, t]));

  await db.insert(s.absenceReasons).values([{ name: "Liberação do gestor" }, { name: "Férias" }, { name: "Atestado" }]);

  // Pessoas
  const P = (
    name: string,
    email: string,
    role: (typeof s.roleEnum.enumValues)[number],
    extra: Partial<typeof s.people.$inferInsert> = {},
    i = 0,
  ) => ({ name, email: `${email}@sintesebrasil.com`, role, odooEmployeeId: 1000 + i, odooUserId: 2000 + i, ...extra });
  const peopleRows = await db
    .insert(s.people)
    .values([
      P("Marttini", "marttini", "administrador", { isConsultor: false, canApproveHours: true, canConfirmScope: true, jobTitle: "CEO" }, 1),
      P("Richard", "richard", "gestor", { canApproveHours: true, canConfirmScope: true, jobTitle: "Gestor e consultor" }, 2),
      P("Luiz", "luiz", "gestor", { canConfirmScope: true, jobTitle: "Gestor e consultor" }, 3),
      P("Maria", "maria", "administrativo", { isConsultor: false, jobTitle: "Assistente administrativa" }, 4),
      P("Ana Clara", "anaclara", "administrativo", { isConsultor: false, jobTitle: "Auxiliar administrativa" }, 5),
      P("Caio Ramos", "caio", "consultor", { jobTitle: "Consultor" }, 6),
      P("Júlia Prado", "julia", "consultor", { jobTitle: "Consultora" }, 7),
      P("Rafael Nunes", "rafael", "consultor", { jobTitle: "Consultor" }, 8),
      P("Bruna Teles", "bruna", "consultor", { jobTitle: "Consultora" }, 9),
      P("Otávio Reis", "otavio", "consultor", { jobTitle: "Consultor" }, 10),
      P("Helena Duarte", "helena", "consultor", { jobTitle: "Consultora" }, 11),
    ])
    .returning();
  const PP = Object.fromEntries(peopleRows.map((p) => [p.email.split("@")[0], p]));
  const consultants = peopleRows.filter((p) => p.isConsultor);

  // Clientes
  const clientDefs = [
    { key: "kari", name: "Kari-Kari Alimentos", color: "#F59A6B", erp: "Odoo", contacts: [["Carla Mendes", "Coordenadora de TI"], ["Rogério Alves", "Diretor financeiro"]] },
    { key: "brava", name: "Brava Soluções", color: "#A897F5", erp: "Odoo", contacts: [["Paula Brandão", "Gerente comercial"], ["Diogo Lemos", "Analista fiscal"]] },
    { key: "radar", name: "Radar Rolamentos", color: "#63BDEB", erp: "Odoo", contacts: [["Marcos Teixeira", "Diretor"], ["Sônia Ribeiro", "Financeiro"]] },
    { key: "hdn", name: "HDN Bombas", color: "#6CCB98", erp: "Odoo", contacts: [["Paulo Henrique", "Gerente industrial"]] },
    { key: "centro", name: "Centro Ar", color: "#EDC75A", erp: "Odoo", contacts: [["Fernanda Lima", "Supervisora administrativa"]] },
    { key: "lab", name: "3D Lab", color: "#D98BC9", erp: "Odoo", contacts: [["Igor Santana", "Sócio"]] },
    { key: "lumen", name: "Lumen Ótica", color: "#7FB7A4", erp: "Odoo", contacts: [["Renata Couto", "Gerente"]] },
    { key: "agro", name: "Agro Cerrado", color: "#B9A06B", erp: "Odoo", contacts: [["Sérgio Paiva", "Controller"]] },
  ];
  const clientRows = await db
    .insert(s.clients)
    .values([
      ...clientDefs.map((c, i) => ({ name: c.name, color: c.color, erp: c.erp, odooPartnerId: 500 + i, city: "Goiânia", state: "GO", cnpj: `12.345.${String(600 + i)}/0001-${10 + i}` })),
      { name: "Síntese", color: "#9C93AE", isInternal: true, odooPartnerId: 499, city: "Goiânia", state: "GO" },
    ])
    .returning();
  const C: Record<string, (typeof clientRows)[number]> = {};
  clientDefs.forEach((c, i) => (C[c.key] = clientRows[i]));
  C.sintese = clientRows.at(-1)!;

  const contactRows = await db
    .insert(s.clientContacts)
    .values(
      clientDefs.flatMap((c, i) =>
        c.contacts.map(([name, job], j) => ({
          clientId: C[c.key].id,
          name,
          jobTitle: job,
          email: name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ /g, ".") + "@" + c.key + ".com.br",
          phone: `(62) 9${8000 + i * 10 + j}-${1000 + j}`,
          odooPartnerId: 700 + i * 10 + j,
          portalAccess: j === 0,
          portalInvitedAt: j === 0 ? new Date(addDays(TODAY, -40) + "T12:00:00Z") : null,
          lastAccessAt: j === 0 ? new Date(addDays(TODAY, -(i % 4)) + "T14:00:00Z") : null,
        })),
      ),
    )
    .returning();
  const CT = (clientKey: string, idx = 0) => contactRows.filter((r) => r.clientId === C[clientKey].id)[idx];

  // Projetos anuais (ano anterior e atual)
  const annualRows = await db
    .insert(s.annualProjects)
    .values(
      Object.entries(C).flatMap(([key, c], i) =>
        [YEAR - 1, YEAR].map((y) => ({
          clientId: c.id,
          name: `${key === "sintese" ? "Síntese" : c.name} ${y}`,
          year: y,
          odooProjectId: 300 + i * 2 + (y - YEAR + 1),
        })),
      ),
    )
    .returning();
  const AP = (key: string, y = YEAR) => annualRows.find((a) => a.clientId === C[key].id && a.year === y)!;

  // Itens (projetos e tarefas)
  let odooTask = 9000;
  type ItemSpec = {
    key: string;
    client: string;
    kind: "projeto" | "tarefa";
    parent?: string;
    name: string;
    stage?: (typeof s.stageEnum.enumValues)[number];
    deadline?: number | null; // dias a partir de hoje
    planned?: number; // horas
    sust?: boolean;
    visible?: boolean;
    who: string[];
    tags?: string[];
    scope?: "rascunho" | "confirmado";
    outOfScope?: "aguardando" | "aprovada" | "recusada";
    requestedBy?: number;
  };
  const specs: ItemSpec[] = [
    // Kari-Kari
    { key: "kari-broker", client: "kari", kind: "projeto", name: "Integração Broker", stage: "andamento", deadline: 20, planned: 120, visible: true, who: ["caio", "helena"] },
    { key: "kari-broker-imp", client: "kari", kind: "tarefa", parent: "kari-broker", name: "Erro na importação de pedidos", stage: "andamento", deadline: -3, planned: 16, who: ["helena"], tags: ["Crítico"], visible: true },
    { key: "kari-broker-map", client: "kari", kind: "tarefa", parent: "kari-broker", name: "Mapeamento de tabelas de preço", stage: "andamento", deadline: 6, planned: 24, who: ["caio"], visible: true },
    { key: "kari-broker-dist", client: "kari", kind: "tarefa", parent: "kari-broker", name: "Regras de distribuição", stage: "concluido", deadline: -10, planned: 30, who: ["caio"], visible: true },
    { key: "kari-broker-rel", client: "kari", kind: "tarefa", parent: "kari-broker", name: "Relatório de comissões por representante", outOfScope: "aguardando", stage: "analise", deadline: 15, who: ["helena"], visible: true, requestedBy: 0 },
    { key: "kari-vendas", client: "kari", kind: "tarefa", name: "Ajuste no relatório de vendas", stage: "andamento", deadline: 2, planned: 6, who: ["caio"], visible: true },
    { key: "kari-sust", client: "kari", kind: "tarefa", name: "Sustentação mensal", stage: "andamento", sust: true, who: ["helena", "caio"], visible: true },
    // Brava
    { key: "brava-ecom", client: "brava", kind: "projeto", name: "Integração e-commerce", stage: "analise", deadline: 45, planned: 76, who: ["richard", "julia"], scope: "rascunho" },
    { key: "brava-fiscal", client: "brava", kind: "tarefa", name: "Suporte fiscal: rejeição de NF-e", stage: "andamento", deadline: 0, sust: true, who: ["julia"], tags: ["Crítico"], visible: true },
    { key: "brava-top", client: "brava", kind: "tarefa", name: "Correção do top 905 para tirar travas de pedido online", stage: "andamento", deadline: -2, who: ["julia"], visible: true },
    { key: "brava-crm", client: "brava", kind: "projeto", name: "Implantação do CRM", stage: "andamento", deadline: 30, planned: 90, who: ["julia", "bruna"], visible: true },
    { key: "brava-crm-funil", client: "brava", kind: "tarefa", parent: "brava-crm", name: "Funil de vendas e etapas", stage: "andamento", deadline: 9, who: ["julia"], visible: true },
    { key: "brava-crm-imp", client: "brava", kind: "tarefa", parent: "brava-crm", name: "Importação da base de clientes", stage: "andamento", deadline: 12, who: ["bruna"], visible: true },
    { key: "brava-crm-whats", client: "brava", kind: "tarefa", parent: "brava-crm", name: "Integração com WhatsApp do vendedor", outOfScope: "aguardando", stage: "analise", who: ["julia"], visible: true, requestedBy: 0 },
    { key: "brava-crm-dash", client: "brava", kind: "tarefa", parent: "brava-crm", name: "Painel de metas por vendedor", outOfScope: "aprovada", stage: "andamento", deadline: 18, who: ["bruna"], visible: true, requestedBy: 0 },
    // Radar
    { key: "radar-prec", client: "radar", kind: "projeto", name: "Precificação semi-automática", stage: "andamento", deadline: 25, planned: 100, visible: true, who: ["rafael", "luiz"] },
    { key: "radar-prec-dash", client: "radar", kind: "tarefa", parent: "radar-prec", name: "Dashboard de acompanhamento de vendas", stage: "andamento", deadline: -1, who: ["rafael"], tags: ["Ag. retorno cliente"], visible: true },
    { key: "radar-prec-regra", client: "radar", kind: "tarefa", parent: "radar-prec", name: "Regras de margem por família", stage: "andamento", deadline: 8, who: ["luiz"], visible: true },
    { key: "radar-stone", client: "radar", kind: "projeto", name: "Conciliação Stone", stage: "andamento", deadline: 14, planned: 40, visible: true, who: ["rafael"] },
    { key: "radar-stone-ret", client: "radar", kind: "tarefa", parent: "radar-stone", name: "Validar arquivo de retorno da Stone", stage: "andamento", deadline: 0, who: ["rafael"], visible: true },
    { key: "radar-sust", client: "radar", kind: "tarefa", name: "Sustentação mensal", stage: "andamento", sust: true, who: ["rafael", "luiz"] },
    // HDN
    { key: "hdn-mrp", client: "hdn", kind: "projeto", name: "Planejamento de produção (MRP)", stage: "andamento", deadline: 40, planned: 80, visible: true, who: ["caio", "otavio"] },
    { key: "hdn-mrp-bom", client: "hdn", kind: "tarefa", parent: "hdn-mrp", name: "Listas de materiais", stage: "andamento", deadline: 10, who: ["caio"], visible: true },
    { key: "hdn-mrp-roteiro", client: "hdn", kind: "tarefa", parent: "hdn-mrp", name: "Roteiros de produção", stage: "alocacao", deadline: 20, who: ["otavio"], visible: true },
    { key: "hdn-sust", client: "hdn", kind: "tarefa", name: "Sustentação mensal", stage: "andamento", sust: true, who: ["caio"] },
    // Centro Ar
    { key: "centro-imp", client: "centro", kind: "tarefa", name: "Importações via banco de dados", stage: "alocacao", deadline: 2, sust: true, who: ["otavio"], tags: ["Pend. doc. cliente"] },
    { key: "centro-fin", client: "centro", kind: "projeto", name: "Fluxo de caixa projetado", stage: "andamento", deadline: 35, planned: 50, who: ["otavio", "richard"], visible: true },
    { key: "centro-fin-cat", client: "centro", kind: "tarefa", parent: "centro-fin", name: "Plano de contas gerencial", stage: "andamento", deadline: 7, who: ["richard"], visible: true },
    // 3D Lab
    { key: "lab-site", client: "lab", kind: "projeto", name: "Loja virtual", stage: "estimativa", deadline: 60, planned: 60, who: ["bruna"] },
    { key: "lab-site-cat", client: "lab", kind: "tarefa", parent: "lab-site", name: "Catálogo de produtos", stage: "analise", deadline: 25, who: ["bruna"] },
    { key: "lab-orc", client: "lab", kind: "tarefa", name: "Modelo de orçamento", stage: "andamento", deadline: 5, who: ["bruna"], visible: true },
    { key: "lab-extra", client: "lab", kind: "tarefa", name: "Etiquetas de envio pelos Correios", outOfScope: "aguardando", stage: "analise", who: ["bruna"], requestedBy: 0, visible: true },
    // Lumen e Agro (pouco movimento)
    { key: "lumen-sust", client: "lumen", kind: "tarefa", name: "Sustentação mensal", stage: "andamento", sust: true, who: ["luiz"] },
    { key: "agro-sust", client: "agro", kind: "tarefa", name: "Sustentação mensal", stage: "andamento", sust: true, who: ["richard"] },
    // Síntese (interno)
    { key: "int-reun", client: "sintese", kind: "tarefa", name: "Reuniões internas", stage: "andamento", who: consultants.map((c) => c.email.split("@")[0]) },
    { key: "int-estudo", client: "sintese", kind: "tarefa", name: "Estudo e capacitação", stage: "andamento", who: consultants.map((c) => c.email.split("@")[0]) },
    { key: "int-comercial", client: "sintese", kind: "tarefa", name: "Apoio comercial e propostas", stage: "andamento", who: ["richard", "luiz"] },
  ];

  const IT: Record<string, typeof s.items.$inferSelect> = {};
  for (const sp of specs) {
    const parent = sp.parent ? IT[sp.parent] : null;
    const draft = sp.scope === "rascunho" || parent?.scopeStatus === "rascunho";
    const [row] = await db
      .insert(s.items)
      .values({
        annualProjectId: AP(sp.client).id,
        parentId: parent?.id ?? null,
        kind: sp.kind,
        name: sp.name,
        stage: sp.stage ?? "andamento",
        scopeStatus: sp.kind === "projeto" ? (sp.scope ?? "confirmado") : "confirmado",
        startDate: addDays(TODAY, -40),
        deadline: sp.deadline === undefined || sp.deadline === null ? null : addDays(TODAY, sp.deadline),
        plannedMinutes: sp.planned ? sp.planned * 60 : null,
        isSustentacao: !!sp.sust,
        visibleToClient: !!sp.visible,
        outOfScope: !!sp.outOfScope,
        clientApproval: sp.outOfScope ?? "nao_se_aplica",
        clientApprovalAt: sp.outOfScope === "aprovada" ? new Date(addDays(TODAY, -9) + "T15:00:00Z") : null,
        clientApprovalByContactId: sp.outOfScope === "aprovada" ? CT(sp.client, 0).id : null,
        requestedByContactId: sp.requestedBy !== undefined ? CT(sp.client, sp.requestedBy).id : null,
        requestedAt: sp.outOfScope ? addDays(TODAY, sp.outOfScope === "aguardando" ? -6 + specs.indexOf(sp) % 4 : -12) : null,
        requestChannel: sp.outOfScope ? "Reunião" : null,
        completedAt: sp.stage === "concluido" ? new Date(addDays(TODAY, -9) + "T18:00:00Z") : null,
        odooTaskId: draft ? null : odooTask++,
        syncStatus: draft ? "nao_sincroniza" : "enviado",
        createdBy: PP[sp.who[0]].id,
      })
      .returning();
    IT[sp.key] = row;
    await db.insert(s.itemAssignees).values(sp.who.map((w) => ({ itemId: row.id, personId: PP[w].id })));
    const tagNames = [sp.kind === "projeto" ? "Projeto" : !parent ? "Tarefa" : null, sp.outOfScope ? "Fora do escopo" : null, ...(sp.tags ?? [])].filter(Boolean) as string[];
    if (tagNames.length) await db.insert(s.itemTags).values(tagNames.map((n) => ({ itemId: row.id, tagId: TG[n].id })));
  }

  // Escopos: versões confirmadas para projetos confirmados e rascunho para a Brava
  for (const sp of specs.filter((x) => x.kind === "projeto")) {
    const it = IT[sp.key];
    const draft = sp.scope === "rascunho";
    const [v] = await db
      .insert(s.scopeVersions)
      .values({
        itemId: it.id,
        version: draft ? 0 : 1,
        objective: draft ? "Integrar a loja virtual da Brava ao Odoo: pedidos, estoque, preços e notas." : `Entregar ${sp.name.toLowerCase()} conforme levantamento com o cliente.`,
        exclusions: draft ? ["Layout e design da loja virtual", "Cadastro de produtos (feito pela Brava)", "Integração com marketplaces"] : ["Treinamento presencial além de 2 encontros"],
        assumptions: "O cliente disponibiliza um responsável para validar cada entrega.",
        estimateMinutes: (sp.planned ?? 40) * 60,
        confirmedBy: draft ? null : PP.richard.id,
        confirmedAt: draft ? null : new Date(addDays(TODAY, -35) + "T15:00:00Z"),
        updatedBy: PP.richard.id,
      })
      .returning();
    const dels = draft
      ? [["Pedidos do site no Odoo", 24, "julia"], ["Estoque e preços para o site", 20, "julia"], ["Notas fiscais e rastreio", 16, "richard"], ["Testes e acompanhamento da virada", 16, "julia"]]
      : [["Levantamento e desenho", Math.round((sp.planned ?? 40) * 0.2), sp.who[0]], ["Configuração e desenvolvimento", Math.round((sp.planned ?? 40) * 0.6), sp.who[0]], ["Validação e virada", Math.round((sp.planned ?? 40) * 0.2), sp.who.at(-1)!]];
    await db.insert(s.deliverables).values(
      dels.map(([title, h, w], i) => ({ scopeVersionId: v.id, number: i + 1, title: String(title), estimateMinutes: Number(h) * 60, suggestedPersonId: PP[String(w)].id })),
    );
    await db.insert(s.meetings).values([
      { itemId: it.id, date: addDays(TODAY, -38), title: "Kick-off e levantamento", participants: "Síntese e cliente", summary: "Objetivos, prazos e responsáveis combinados.", createdBy: PP.richard.id },
    ]);
  }

  // Pedidos de venda (para o Faturável)
  await db.insert(s.salesOrderLines).values(
    clientDefs.flatMap((c, i) => [
      { clientId: C[c.key].id, odooSoLineId: 4000 + i * 2, orderName: `S0${1200 + i}`, lineName: "Banco de horas de consultoria" },
      { clientId: C[c.key].id, odooSoLineId: 4001 + i * 2, orderName: `S0${1300 + i}`, lineName: "Sustentação mensal" },
    ]),
  );

  // Apontamentos: 13 meses de histórico até ontem + hoje parcial
  const taskOf: Record<string, string[]> = {};
  for (const sp of specs) {
    if (sp.kind !== "tarefa") continue;
    if (sp.outOfScope && sp.outOfScope !== "aprovada") continue;
    if (sp.parent && IT[sp.parent].scopeStatus === "rascunho") continue;
    for (const w of sp.who) (taskOf[w] ??= []).push(sp.key);
  }
  // ritmo mensal-alvo de horas faturáveis por pessoa (h/dia útil)
  const pace: Record<string, number> = { caio: 7.6, julia: 7.0, richard: 5.6, rafael: 6.6, bruna: 6.2, otavio: 6.0, luiz: 5.2, helena: 6.4 };
  const start = startOfMonth(addMonths(TODAY, -12));
  const entries: (typeof s.timeEntries.$inferInsert)[] = [];
  for (const p of consultants) {
    const key = p.email.split("@")[0];
    const mine = taskOf[key] ?? [];
    const clientTasks = mine.filter((k) => !k.startsWith("int-"));
    for (let d = start; d <= TODAY; d = addDays(d, 1)) {
      if (!isWorkday(d, H)) continue;
      // falhas: Helena sem apontar 2 dias recentes; Otávio 1
      if (key === "helena" && (d === addDays(TODAY, -1) || d === addDays(TODAY, -2)) && isWorkday(d, H)) continue;
      if (key === "otavio" && d === addDays(TODAY, -2)) continue;
      if (rand() < 0.03) continue; // ausências aleatórias
      const isToday = d === TODAY;
      let left = Math.round((pace[key] + (rand() - 0.5) * 2.4) * 60 / 30) * 30;
      if (isToday) left = Math.min(left, 150);
      while (left > 0 && clientTasks.length) {
        const k = pick(clientTasks);
        const chunk = Math.min(left, pick([60, 90, 120, 150, 180, 240]));
        const sp = specs.find((x) => x.key === k)!;
        const isBon = rand() < 0.08;
        entries.push({
          personId: p.id,
          itemId: IT[k].id,
          date: d,
          minutes: chunk,
          description: pick(["Análise e ajustes", "Reunião de alinhamento com o cliente", "Desenvolvimento e testes", "Correção de erro reportado", "Validação com o usuário", "Documentação da entrega"]),
          typeId: isBon ? T.bonificado.id : T.faturavel.id,
          isSustentacao: !!sp.sust,
          syncStatus: "enviado",
          odooLineId: 50000 + entries.length,
          createdAt: new Date(d + "T21:00:00Z"),
          updatedAt: new Date(d + "T21:00:00Z"),
        });
        left -= chunk;
      }
      if (rand() < 0.35) {
        entries.push({
          personId: p.id,
          itemId: IT[pick(["int-reun", "int-estudo"])].id,
          date: d,
          minutes: pick([30, 60]),
          description: "Reunião semanal do time",
          typeId: T.interno.id,
          syncStatus: "enviado",
          odooLineId: 50000 + entries.length,
          createdAt: new Date(d + "T21:30:00Z"),
          updatedAt: new Date(d + "T21:30:00Z"),
        });
      }
    }
  }
  // Provisionamentos futuros e um a converter (hoje)
  entries.push(
    { personId: PP.caio.id, itemId: IT["hdn-mrp-bom"].id, date: addDays(TODAY, 1), minutes: 240, description: "Visita técnica na fábrica", typeId: T.provisionamento.id, syncStatus: "enviado", odooLineId: 90001 },
    { personId: PP.julia.id, itemId: IT["brava-crm-funil"].id, date: TODAY, minutes: 180, description: "Treinamento do funil com o time comercial", typeId: T.provisionamento.id, syncStatus: "enviado", odooLineId: 90002, createdAt: new Date(addDays(TODAY, -5) + "T12:00:00Z") },
  );
  // Uma entrada pendente de envio e uma com erro (para a tela de sincronização)
  entries.push(
    { personId: PP.rafael.id, itemId: IT["radar-stone-ret"].id, date: TODAY, minutes: 60, description: "Leitura do arquivo de retorno", typeId: T.faturavel.id, syncStatus: "pendente" },
    { personId: PP.bruna.id, itemId: IT["lab-orc"].id, date: addDays(TODAY, -1), minutes: 90, description: "Modelo de orçamento: ajustes", typeId: T.faturavel.id, syncStatus: "erro", syncError: "O Odoo recusou: a tarefa está arquivada lá." },
  );
  for (let i = 0; i < entries.length; i += 1000) await db.insert(s.timeEntries).values(entries.slice(i, i + 1000));

  // Pedidos de alteração (Helena e Rafael) e um resolvido
  const old = await client`select id, person_id, date, minutes, description from time_entries where person_id in (${PP.helena.id}, ${PP.rafael.id}) and date < ${addDays(TODAY, -4)} order by date desc limit 2`;
  for (const [i, e] of old.entries()) {
    await db.insert(s.changeRequests).values({
      timeEntryId: e.id,
      personId: e.person_id,
      kind: "alterar",
      oldValues: { minutes: e.minutes, description: e.description },
      newValues: { minutes: e.minutes + (i ? -60 : 60), description: e.description + (i ? "" : " (incluída a reunião com o cliente)") },
      justification: i ? "Lancei 1 hora a mais por engano." : "Esqueci de somar a reunião com o cliente no fim do dia.",
    });
    await client`update time_entries set pending_change = true where id = ${e.id}`;
  }

  // Contatos com clientes: histórico (realizados) e agenda
  const lastContact: Record<string, number> = { kari: -2, radar: -8, brava: -1, centro: -3, hdn: 0, lab: -4, lumen: -9, agro: -12 };
  const contactVals: (typeof s.contacts.$inferInsert)[] = [];
  for (const [k, days] of Object.entries(lastContact)) {
    for (let w = 0; w < 10; w++) {
      const d = addDays(TODAY, days - w * 7);
      contactVals.push({
        clientId: C[k].id,
        clientContactId: CT(k, 0).id,
        type: pick(["ligacao", "reuniao_online", "visita", "whatsapp"]),
        responsibleId: pick([PP.maria.id, PP.richard.id, PP.luiz.id, PP.caio.id, PP.julia.id]),
        scheduledAt: new Date(d + "T14:00:00Z"),
        objective: "Acompanhamento semanal",
        status: "realizado",
        resultSummary: pick(["Cliente satisfeito, sem pendências.", "Pediu prioridade no relatório de vendas.", "Agendamos validação para a próxima semana.", "Comentou sobre um novo projeto para o ano que vem."]),
        doneAt: new Date(d + "T14:30:00Z"),
        createdBy: PP.maria.id,
      });
    }
  }
  contactVals.push(
    { clientId: C.kari.id, clientContactId: CT("kari", 0).id, type: "ligacao", responsibleId: PP.maria.id, scheduledAt: new Date(TODAY + "T17:00:00Z"), objective: "Confirmar recebimento do arquivo de preços", createdBy: PP.caio.id },
    { clientId: C.hdn.id, clientContactId: CT("hdn", 0).id, type: "reuniao_online", responsibleId: PP.caio.id, scheduledAt: new Date(TODAY + "T19:30:00Z"), objective: "Validação das listas de materiais", createdBy: PP.caio.id },
    { clientId: C.radar.id, clientContactId: CT("radar", 0).id, type: "ligacao", responsibleId: PP.maria.id, scheduledAt: new Date(addDays(TODAY, -1) + "T18:00:00Z"), objective: "Cobrar retorno do dashboard de vendas", createdBy: PP.luiz.id },
    { clientId: C.lab.id, clientContactId: CT("lab", 0).id, type: "whatsapp", responsibleId: PP.bruna.id, scheduledAt: new Date(addDays(TODAY, 3) + "T13:00:00Z"), objective: "Apresentar a estimativa da loja virtual", createdBy: PP.richard.id },
  );
  await db.insert(s.contacts).values(contactVals);

  // Comentários: interno e do cliente sem resposta
  await db.insert(s.comments).values([
    { itemId: IT["kari-broker"].id, channel: "interno", authorPersonId: PP.caio.id, body: "A Carla pediu prioridade nas tabelas de preço; @Helena consegue olhar a importação hoje?", mentions: [PP.helena.id], createdAt: new Date(addDays(TODAY, -2) + "T13:00:00Z") },
    { itemId: IT["kari-broker"].id, channel: "cliente", authorContactId: CT("kari", 0).id, body: "Bom dia! Os pedidos de ontem do representante 12 não entraram. Podem verificar?", createdAt: new Date(addDays(TODAY, -2) + "T12:10:00Z") },
    { itemId: IT["kari-broker"].id, channel: "cliente", authorPersonId: PP.helena.id, body: "Bom dia, Carla! Já estamos olhando e retornamos ainda hoje.", createdAt: new Date(addDays(TODAY, -2) + "T12:40:00Z") },
    { itemId: IT["kari-broker"].id, channel: "cliente", authorContactId: CT("kari", 0).id, body: "Conseguiram ver? Hoje aconteceu de novo com o representante 15.", createdAt: new Date(addDays(TODAY, -1) + "T12:00:00Z") },
    { itemId: IT["radar-prec-dash"].id, channel: "cliente", authorPersonId: PP.rafael.id, body: "Marcos, enviamos a primeira versão do dashboard. Pode validar os filtros?", createdAt: new Date(addDays(TODAY, -5) + "T17:00:00Z") },
  ]);
  await client`update comments set answered_at = created_at + interval '30 minutes' where channel = 'cliente' and author_contact_id is not null and body like 'Bom dia!%'`;

  // Avaliações
  await db.insert(s.evaluations).values([
    { clientId: C.kari.id, itemId: IT["kari-broker-dist"].id, contactId: CT("kari", 0).id, consultantId: PP.caio.id, scoreResult: 5, scoreConsultant: 5, scoreTeam: 4, comment: "Entrega muito boa, o time comercial adorou.", published: true, publishedBy: PP.marttini.id, publishedAt: new Date(addDays(TODAY, -6) + "T12:00:00Z") },
    { clientId: C.brava.id, contactId: CT("brava", 0).id, consultantId: PP.julia.id, scoreResult: 4, scoreConsultant: 5, scoreTeam: 4, comment: "Júlia é muito atenciosa. O prazo atrasou um pouco." },
    { clientId: C.hdn.id, contactId: CT("hdn", 0).id, consultantId: PP.caio.id, scoreResult: 5, scoreConsultant: 5, scoreTeam: 5, comment: "Excelente!" },
    { clientId: C.radar.id, contactId: CT("radar", 0).id, consultantId: PP.rafael.id, scoreResult: 3, scoreConsultant: 4, scoreTeam: 3, comment: "O dashboard demorou mais do que esperávamos." },
  ]);

  // Link da TV
  await db.insert(s.tvTokens).values({ token: "tv-demo-sintese", label: "TV do escritório", createdBy: PP.marttini.id });

  await client.end();
  console.log(`Seed pronto para ${TODAY}: ${peopleRows.length} pessoas, ${clientRows.length} clientes, ${specs.length} itens, ${entries.length} apontamentos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
