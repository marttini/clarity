import { expect, test, type Page } from "@playwright/test";
import { loginAs, personId, sql, watchErrors } from "./helpers";

/** US-01, US-02, US-04, US-09, US-24/27: lançamentos do consultor (Caio). */

async function itemId(name: string) {
  const [r] = await sql<{ id: string }[]>`select id from items where name = ${name} order by created_at limit 1`;
  return r.id;
}

async function entryByDesc(text: string) {
  const [r] = await sql<{ id: string; minutes: number; code: string; date: string; item: string; client: string; so: string | null; person: string }[]>`
    select te.id, te.minutes, et.code, te.date::text as date, i.name as item, c.name as client, te.sales_order_line_id as so, p.email as person
    from time_entries te join entry_types et on et.id = te.type_id join items i on i.id = te.item_id
    join annual_projects a on a.id = i.annual_project_id join clients c on c.id = a.client_id join people p on p.id = te.person_id
    where te.description like ${"%" + text + "%"} and te.deleted_at is null`;
  return r;
}

async function openForm(page: Page) {
  await page.goto("/fila");
  await page.getByRole("button", { name: "Conferir ou trocar os campos" }).click();
  await expect(page.locator("#lc-h")).toBeVisible();
}

const launcher = (page: Page) => page.locator("#lancar");

test.beforeEach(async ({ context }) => {
  await loginAs(context, "caio");
});

test("US-01: lança pelo lançador rápido, em nome de quem está logado, e entra na fila do Odoo", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/fila");
  const desc = `e2e rapido ${Date.now()}`;
  await launcher(page).getByPlaceholder("2h30 kari broker sustentação").fill(`1h30 kari mapeamento ${desc}`);
  await expect(launcher(page).getByText("Kari-Kari Alimentos").first()).toBeVisible();
  await expect(launcher(page).getByText("Mapeamento de tabelas de preço")).toBeVisible();
  await launcher(page).getByRole("button", { name: /^Lançar 1:30 h$/ }).click();
  await expect(launcher(page).getByRole("status")).toContainText("1:30 h lançadas");
  const e = await entryByDesc(desc);
  expect(e).toMatchObject({ minutes: 90, code: "faturavel", date: "2026-10-08", item: "Mapeamento de tabelas de preço", client: "Kari-Kari Alimentos", person: "caio@sintesebrasil.com" });
  const [q] = await sql`select 1 from sync_queue where entity = 'time_entry' and entity_id = ${e.id}`;
  expect(q).toBeTruthy();
  expect(errors).toEqual([]);
});

test("US-01/US-02: formulário completo; Bonificado remove e trava o pedido de venda", async ({ page }) => {
  await openForm(page);
  const task = await itemId("Mapeamento de tabelas de preço");
  await page.locator("#lc-client").selectOption({ label: "Kari-Kari Alimentos" });
  await page.locator("#lc-task").selectOption(task);
  await page.locator("#lc-h").fill("0:45");
  await page.locator("#lc-desc").fill("e2e formulario bonificado");
  await page.locator("#lc-so").selectOption({ index: 1 });
  await page.locator("#lc-type").getByRole("button", { name: "Bonificado" }).click();
  await expect(launcher(page).getByText(/Pedido de venda removido/)).toBeVisible();
  await expect(page.locator("#lc-so")).toHaveCount(0);
  await expect(launcher(page).getByText("Bonificado: pedido de venda bloqueado.").first()).toBeVisible();
  await launcher(page).getByRole("button", { name: /^Lançar 0:45 h$/ }).click();
  await expect(launcher(page).getByRole("status")).toContainText("0:45 h lançadas");
  const e = await entryByDesc("e2e formulario bonificado");
  expect(e).toMatchObject({ minutes: 45, code: "bonificado", so: null });
});

test("US-02: Faturável aceita pedido de venda só do cliente da tarefa", async ({ page }) => {
  await openForm(page);
  await page.locator("#lc-client").selectOption({ label: "Kari-Kari Alimentos" });
  await page.locator("#lc-task").selectOption(await itemId("Mapeamento de tabelas de preço"));
  await page.locator("#lc-h").fill("0:15");
  await page.locator("#lc-desc").fill("e2e pedido de outro cliente");
  // Força, no campo escondido, um pedido de venda de outro cliente.
  const [other] = await sql<{ id: string }[]>`select s.id from sales_order_lines s join clients c on c.id = s.client_id where c.name not like 'Kari%' limit 1`;
  await page.locator('#lancar input[name="soId"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), other.id);
  await launcher(page).getByRole("button", { name: /^Lançar/ }).click();
  await expect(launcher(page).getByRole("status")).toContainText("não é do cliente da tarefa");
});

test("US-01: data futura só como Provisionamento (tela e servidor)", async ({ page }) => {
  await page.goto("/fila");
  await launcher(page).getByRole("button", { name: "Amanhã" }).click();
  await expect(launcher(page).getByText("Data futura: o tipo vira Provisionamento.")).toBeVisible();
  await launcher(page).getByPlaceholder("2h30 kari broker sustentação").fill("2h kari mapeamento e2e futuro");
  await expect(launcher(page).getByRole("button", { name: /^Provisionar 2:00 h$/ })).toBeVisible();
  // Mesmo se alguém forçar Faturável no campo escondido, o servidor grava como Provisionamento.
  const [fat] = await sql<{ id: string }[]>`select id from entry_types where code = 'faturavel'`;
  await page.locator('#lancar input[name="typeId"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), fat.id);
  await launcher(page).getByRole("button", { name: /^Provisionar/ }).click();
  await expect(launcher(page).getByRole("status")).toContainText("2:00 h lançadas");
  const e = await entryByDesc("e2e futuro");
  expect(e).toMatchObject({ code: "provisionamento", date: "2026-10-09", minutes: 120 });
});

test("US-02: Interno some com o cliente e vai para o projeto Síntese", async ({ page }) => {
  await openForm(page);
  await page.locator("#lc-type").getByRole("button", { name: "Interno" }).click();
  await expect(page.locator("#lc-client")).toHaveCount(0);
  await expect(launcher(page).getByText(/Interno: vai para o projeto Síntese/).first()).toBeVisible();
  await page.locator("#lc-task").selectOption(await itemId("Estudo e capacitação"));
  await page.locator("#lc-h").fill("0:30");
  await page.locator("#lc-desc").fill("e2e interno");
  await launcher(page).getByRole("button", { name: /^Lançar 0:30 h$/ }).click();
  await expect(launcher(page).getByRole("status")).toContainText("0:30 h lançadas");
  expect(await entryByDesc("e2e interno")).toMatchObject({ code: "interno", client: "Síntese", so: null });
});

test("US-27: demanda adicional aguardando o cliente não aceita horas", async ({ page }) => {
  await openForm(page);
  const demand = await itemId("Relatório de comissões por representante");
  await page.locator("#lc-client").selectOption({ label: "Kari-Kari Alimentos" });
  await expect(page.locator(`#lc-task option[value="${demand}"]`)).toBeDisabled();
  await page.locator("#lc-h").fill("1:00");
  await page.locator("#lc-desc").fill("e2e demanda aguardando");
  // Forçar a tarefa no campo escondido: o servidor recusa.
  await page.locator('#lancar input[name="itemId"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), demand);
  await launcher(page).getByRole("button", { name: /^Lançar/ }).click();
  await expect(launcher(page).getByRole("status")).toContainText("aguardando aprovação do cliente");
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from time_entries where item_id = ${demand}`;
  expect(n.n).toBe(0);
});

const row = (page: Page, ...texts: string[]) => {
  let l = page.locator("div.border-t.px-1.py-3");
  for (const t of texts) l = l.filter({ hasText: t });
  return l.first();
};

async function caioEntry(date: string, minutes: number) {
  const [r] = await sql<{ id: string }[]>`select id from time_entries where person_id = ${await personId("caio")} and date = ${date} and minutes = ${minutes} and deleted_at is null order by created_at limit 1`;
  return r.id;
}

test("US-04: edita dentro de 48 h; depois disso só Solicitar alteração (US-09)", async ({ page }) => {
  const id = await caioEntry("2026-10-07", 240);
  await page.goto("/horas?v=semana&d=2026-10-07");
  const fresh = row(page, "Editável até 09/10 às 18:00", "4:00");
  await expect(fresh.getByRole("button", { name: "Solicitar alteração" })).toHaveCount(0);
  await fresh.getByRole("button", { name: "Editar" }).click();
  await page.locator(`#ed-${id.slice(0, 6)}-desc`).fill("e2e editado dentro de 48 h");
  await fresh.getByRole("button", { name: "Salvar alteração" }).click();
  await expect(page.getByText("e2e editado dentro de 48 h")).toBeVisible();
  await expect.poll(async () => (await sql`select 1 from audit_log where entity = 'time_entry' and entity_id = ${id} and action = 'editar'`).length).toBe(1);

  // Segunda, 5/10, lançado há mais de 48 h: não há Editar/Excluir, só Solicitar alteração.
  const oldId = await caioEntry("2026-10-05", 150);
  const old = row(page, "Listas de materiais", "2:30", "Análise e ajustes");
  await expect(old.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(old.getByRole("button", { name: "Excluir" })).toHaveCount(0);
  await old.getByRole("button", { name: "Solicitar alteração" }).click();
  await page.locator(`#rq-${oldId.slice(0, 6)}-h`).fill("2:00");
  await old.getByRole("button", { name: "Pedir alteração" }).click();
  await expect(old.getByRole("status")).toContainText("justificativa é obrigatória");
  await old.locator('textarea[name="justification"]').fill("e2e: lancei meia hora a mais");
  await old.getByRole("button", { name: "Pedir alteração" }).click();
  // A linha passa a mostrar "Alteração pendente"; o original vale até a decisão.
  await expect(page.getByText("Alteração pendente").first()).toBeVisible();
  const [cr] = await sql<{ status: string }[]>`select status from change_requests where time_entry_id = ${oldId}`;
  expect(cr.status).toBe("pendente");
});

test("US-04: ninguém mexe nas horas de outra pessoa (servidor)", async ({ page, context }) => {
  // Abre a edição como Caio e troca a sessão para Júlia antes de salvar.
  const id = await caioEntry("2026-10-07", 30);
  await page.goto("/horas?v=semana&d=2026-10-07");
  const r = row(page, "Editável até 09/10 às 18:00", "0:30");
  await r.getByRole("button", { name: "Editar" }).click();
  await page.locator(`#ed-${id.slice(0, 6)}-desc`).fill("e2e tentativa de outra pessoa");
  await loginAs(context, "julia");
  await r.getByRole("button", { name: "Salvar alteração" }).click();
  await expect(r.getByRole("status")).toContainText("Apontamento não encontrado");
  const [x] = await sql`select 1 from time_entries where description = 'e2e tentativa de outra pessoa'`;
  expect(x).toBeFalsy();
});
