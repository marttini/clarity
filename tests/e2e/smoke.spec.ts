import { expect, test } from "@playwright/test";
import { loginAs, personId, sql, visit, watchErrors } from "./helpers";

/** Smoke: toda rota do app responde sem erro 500 para cada perfil apropriado. */

async function ids() {
  const [client] = await sql<{ id: string }[]>`select id from clients where name like 'Kari-Kari%'`;
  const [project] = await sql<{ id: string }[]>`select id from items where kind = 'projeto' and scope_status = 'confirmado' order by created_at limit 1`;
  const [draft] = await sql<{ id: string }[]>`select id from items where kind = 'projeto' and scope_status = 'rascunho' order by created_at limit 1`;
  const [task] = await sql<{ id: string }[]>`select id from items where kind = 'tarefa' order by created_at limit 1`;
  return { client: client.id, project: project.id, draft: draft?.id ?? project.id, task: task.id, caio: await personId("caio") };
}

const TEAM_ROUTES = (i: Awaited<ReturnType<typeof ids>>) => [
  "/fila",
  "/horas",
  "/time",
  `/time/${i.caio}`,
  "/ranking",
  "/clientes",
  `/clientes/${i.client}`,
  "/clientes/pendencias",
  "/contatos",
  "/projetos",
  "/projetos?v=kanban",
  "/projetos?v=calendario",
  "/projetos/novo",
  `/projetos/${i.project}`,
  `/projetos/${i.project}/escopo`,
  `/projetos/${i.project}/escopo/nova-versao`,
  `/projetos/${i.draft}`,
  `/projetos/${i.draft}/escopo`,
  `/projetos/${i.task}`,
  "/avisos",
];
const MANAGER_ROUTES = ["/gestao", "/gestao/pendencias", "/gestao/pendencias?aba=avaliacoes", "/gestao/pendencias?aba=sincronizacao"];
const ADMIN_ROUTES = ["/config", "/config/tipos", "/config/metas", "/config/regras", "/config/feriados", "/config/ausencias", "/config/integracao", "/config/tv", "/config/notificacoes"];
const PORTAL_ROUTES = ["/portal", "/portal/demandas", "/portal/mensagens", "/portal/arquivos", "/portal/avaliar", "/portal/convidar"];

for (const who of ["caio", "luiz", "maria"]) {
  test(`time: rotas carregam para ${who}`, async ({ page, context }) => {
    test.setTimeout(240_000);
    await loginAs(context, who);
    const i = await ids();
    for (const r of [...TEAM_ROUTES(i), ...MANAGER_ROUTES]) await visit(page, r);
  });
}

test("gestão e configurações carregam para marttini, sem erro de console", async ({ page, context }) => {
  test.setTimeout(300_000);
  await loginAs(context, "marttini");
  const i = await ids();
  const errors = watchErrors(page);
  for (const r of [...TEAM_ROUTES(i), ...MANAGER_ROUTES, ...ADMIN_ROUTES]) {
    await visit(page, r);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});

test("portal: rotas carregam para Carla, sem erro de console", async ({ page, context }) => {
  await loginAs(context, "contact:carla.mendes@kari.com.br");
  const errors = watchErrors(page);
  for (const r of PORTAL_ROUTES) {
    await visit(page, r);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});

test("sem login: telas internas mandam para /entrar e a TV abre", async ({ page }) => {
  await visit(page, "/entrar");
  for (const r of ["/fila", "/gestao", "/portal", "/config"]) {
    await page.goto(r);
    await expect(page).toHaveURL(/\/entrar/);
  }
  await visit(page, "/tv/tv-demo-sintese");
  const res = await page.goto("/tv/token-que-nao-existe");
  expect(res?.status()).toBe(404);
  const api = await page.request.get("/api/busca?q=kari");
  expect(api.status()).toBe(401);
});

test("celular (390 px): sem rolagem horizontal nas telas principais", async ({ browser }) => {
  test.setTimeout(240_000);
  const i = await ids();
  const cases: [string, string[]][] = [
    ["marttini", ["/gestao", "/config", "/clientes", `/clientes/${i.client}`, "/time", "/ranking", "/gestao/pendencias", "/contatos"]],
    ["caio", ["/fila", "/horas", "/projetos", `/projetos/${i.project}`, `/projetos/${i.project}/escopo`]],
    ["maria", ["/fila"]],
    ["contact:carla.mendes@kari.com.br", ["/portal", "/portal/demandas", "/portal/mensagens", "/portal/arquivos"]],
  ];
  for (const [who, routes] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await loginAs(ctx, who);
    const page = await ctx.newPage();
    for (const r of routes) {
      await visit(page, r);
      await page.waitForLoadState("networkidle");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${who} ${r} rola ${over}px na horizontal`).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  }
});
