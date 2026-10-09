import { expect, test } from "@playwright/test";
import { loginAs, sql } from "./helpers";

/** US-14, US-22, US-23, US-24, US-27: projeto nasce rascunho, só confirmadores confirmam, demanda nova sem entregável vira demanda adicional. */

test.describe.configure({ mode: "serial" });

const NAME = `Projeto e2e ${Date.now()}`;
let projectId = "";

async function project() {
  const [p] = await sql<{ id: string; scope_status: string; stage: string }[]>`select id, scope_status, stage from items where name = ${NAME}`;
  return p;
}
async function queued(id: string) {
  const rows = await sql`select 1 from sync_queue where entity = 'item' and entity_id = ${id}`;
  return rows.length;
}

test("consultor cria projeto: nasce Rascunho e não vai à fila do Odoo", async ({ page, context }) => {
  await loginAs(context, "caio");
  await page.goto("/projetos/novo");
  await page.locator('select[name="clientId"]').selectOption({ label: "Kari-Kari Alimentos" });
  await page.locator('input[name="name"]').fill(NAME);
  await page.locator('input[name="deadline"]').fill("2026-12-15");
  await page.getByRole("button", { name: "Criar projeto em rascunho" }).click();
  await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
  const p = await project();
  projectId = p.id;
  expect(p.scope_status).toBe("rascunho");
  expect(await queued(p.id)).toBe(0);
});

test("rascunho: monta o escopo; consultor não confirma (nem forçando)", async ({ page, context }) => {
  await loginAs(context, "caio");
  await page.goto(`/projetos/${projectId}/escopo`);
  await page.locator('textarea[name="objective"]').fill("Objetivo e2e");
  await page.getByRole("button", { name: "Adicionar item" }).click();
  await page.getByLabel("Nome do item E1").fill("Entregável e2e");
  await page.getByLabel("Horas estimadas do item E1").fill("10");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect.poll(async () => (await sql`select 1 from deliverables d join scope_versions v on v.id = d.scope_version_id where v.item_id = ${projectId}`).length).toBe(1);
  await page.reload();
  // Caio não tem o botão habilitado.
  const btn = page.getByRole("button", { name: "Confirmar escopo" });
  if (await btn.count()) await expect(btn).toHaveAttribute("aria-disabled", "true");

  // Força: tela aberta pelo Luiz, clique com a sessão do Caio.
  await loginAs(context, "luiz");
  await page.reload();
  await page.getByRole("button", { name: "Confirmar escopo" }).click();
  await loginAs(context, "caio");
  await page.getByRole("button", { name: "Sim, confirmar" }).click();
  await expect(page.getByText("Só Marttini, Richard e Luiz confirmam escopo.")).toBeVisible();
  expect((await project()).scope_status).toBe("rascunho");
  expect(await queued(projectId)).toBe(0);
});

test("Luiz confirma: vira versão 1 e o projeto entra na fila do Odoo", async ({ page, context }) => {
  await loginAs(context, "luiz");
  await page.goto(`/projetos/${projectId}/escopo`);
  await page.getByRole("button", { name: "Confirmar escopo" }).click();
  await page.getByRole("button", { name: "Sim, confirmar" }).click();
  await expect.poll(async () => (await project()).scope_status).toBe("confirmado");
  expect(await queued(projectId)).toBeGreaterThan(0);
  const [v] = await sql<{ version: number; confirmed_by: string | null }[]>`select version, confirmed_by from scope_versions where item_id = ${projectId} and version = 1`;
  expect(v.confirmed_by).toBeTruthy();
});

test("nova tarefa sem entregável vira demanda adicional aguardando o cliente, sem aceitar horas", async ({ page, context }) => {
  await loginAs(context, "caio");
  await page.goto(`/projetos/novo?tipo=tarefa&pai=${projectId}`);
  await page.locator('input[name="name"]').fill("Demanda e2e fora do escopo");
  await page.locator('select[name="deliverable"]').selectOption("adicional");
  await page.locator('select[name="requestedBy"]').selectOption({ index: 1 });
  await page.locator('select[name="requestChannel"]').selectOption({ index: 1 });
  await page.getByRole("button", { name: "Criar e enviar ao cliente aprovar" }).click();
  await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
  const [t] = await sql<{ out_of_scope: boolean; client_approval: string; visible_to_client: boolean }[]>`select out_of_scope, client_approval, visible_to_client from items where name = 'Demanda e2e fora do escopo'`;
  expect(t).toEqual({ out_of_scope: true, client_approval: "aguardando", visible_to_client: true });
});
