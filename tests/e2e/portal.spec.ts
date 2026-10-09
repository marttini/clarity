import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loginAs, personId, sql, watchErrors } from "./helpers";

/** Portal (US-19, US-23, US-25, US-27, US-39, US-41, US-42): isolamento por cliente e sem dados internos. */

test.describe.configure({ mode: "serial" });

const CARLA = "contact:carla.mendes@kari.com.br";
const PAULA = "contact:paula.brandao@brava.com.br";
const DEMAND = "Relatório de comissões por representante";

async function karis() {
  const [item] = await sql<{ id: string }[]>`
    select i.id from items i join annual_projects a on a.id = i.annual_project_id join clients c on c.id = a.client_id
    where c.name like 'Kari%' and i.visible_to_client and not i.archived and i.scope_status <> 'rascunho' and i.kind = 'projeto' order by i.created_at limit 1`;
  return item.id;
}

/** Cria um anexo no banco e no disco local (./storage), como o upload faria. */
async function attachment(ownerType: string, ownerId: string, filename: string, internal: boolean) {
  const key = `e2e/${ownerType}-${Date.now()}-${filename}`;
  await mkdir(path.join(process.cwd(), "storage", "e2e"), { recursive: true });
  await writeFile(path.join(process.cwd(), "storage", key), `conteúdo ${filename}`);
  const [a] = await sql<{ id: string }[]>`insert into attachments (owner_type, owner_id, filename, storage_path, size_bytes, mime, version, internal)
    values (${ownerType}, ${ownerId}, ${filename}, ${key}, 20, 'text/plain', 1, ${internal}) returning id`;
  return a.id;
}

const forbiddenText = async (page: Page, texts: (string | RegExp)[]) => {
  for (const t of texts) await expect(page.locator("body"), `não deveria mostrar ${t}`).not.toContainText(t);
};

test("Carla vê só a Kari-Kari e nada interno", async ({ page, context }) => {
  await loginAs(context, CARLA);
  const errors = watchErrors(page);
  const others = await sql<{ name: string }[]>`select name from clients where name not like 'Kari%' and not is_internal`;
  const internalComments = await sql<{ body: string }[]>`select body from comments where channel = 'interno'`;
  const [notes] = await sql<{ internal_notes: string | null }[]>`select internal_notes from clients where name like 'Kari%'`;
  for (const route of ["/portal", "/portal/demandas", "/portal/mensagens", "/portal/arquivos", "/portal/avaliar"]) {
    await page.goto(route);
    await expect(page.locator("body")).toContainText("Kari-Kari");
    await forbiddenText(page, [
      "Provisionamento",
      "Provisionado",
      ...others.map((o) => o.name),
      ...internalComments.map((c) => c.body.slice(0, 40)),
      ...(notes?.internal_notes ? [notes.internal_notes.slice(0, 40)] : []),
    ]);
  }
  expect(errors).toEqual([]);
});

test("anexo de outro cliente, anexo interno e comprovante não abrem pela URL", async ({ page, context }) => {
  const item = await karis();
  const pub = await attachment("item", item, "publico-e2e.txt", false);
  const internal = await attachment("item", item, "interno-e2e.txt", true);
  const proof = await attachment("justification", await personId("caio"), "comprovante-e2e.txt", true);

  await loginAs(context, CARLA);
  expect((await page.request.get(`/portal/arquivos/${pub}`)).status()).toBe(200);
  expect((await page.request.get(`/api/anexos/${pub}`)).status()).toBe(200);
  for (const id of [internal, proof]) {
    expect((await page.request.get(`/portal/arquivos/${id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/anexos/${id}`)).status()).toBe(404);
  }

  await loginAs(context, PAULA);
  for (const id of [pub, internal, proof]) {
    expect((await page.request.get(`/portal/arquivos/${id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/anexos/${id}`)).status()).toBe(404);
  }
  // Item de outro cliente na URL do portal não mostra nada da Kari-Kari.
  await page.goto(`/portal?item=${item}`);
  await expect(page.locator("body")).not.toContainText("Kari-Kari");
  await page.goto(`/portal/mensagens?item=${item}`);
  await expect(page.locator("body")).not.toContainText("Kari-Kari");
});

test("contato de outro cliente não aprova demanda da Kari-Kari (servidor)", async ({ page, context }) => {
  await loginAs(context, CARLA);
  await page.goto("/portal/demandas");
  const card = page.locator("article").filter({ hasText: DEMAND });
  await expect(card).toBeVisible();
  await loginAs(context, PAULA);
  await card.getByRole("button", { name: "Aprovar" }).click();
  await expect(card.getByText("Item não encontrado.")).toBeVisible();
  const [d] = await sql<{ client_approval: string }[]>`select client_approval from items where name = ${DEMAND}`;
  expect(d.client_approval).toBe("aguardando");
});

test("Carla aprova a demanda e o consultor passa a lançar nela", async ({ page, context }) => {
  await loginAs(context, CARLA);
  await page.goto("/portal/demandas");
  const card = page.locator("article").filter({ hasText: DEMAND });
  await card.getByRole("button", { name: "Aprovar" }).click();
  await expect.poll(async () => (await sql<{ a: string }[]>`select client_approval as a from items where name = ${DEMAND}`)[0].a).toBe("aprovada");
  const [d] = await sql<{ id: string; by: string | null }[]>`select id, client_approval_by_contact_id as by from items where name = ${DEMAND}`;
  expect(d.by).toBeTruthy();

  await loginAs(context, "caio");
  await page.goto("/fila");
  await page.getByRole("button", { name: "Conferir ou trocar os campos" }).click();
  await page.locator("#lc-client").selectOption({ label: "Kari-Kari Alimentos" });
  await expect(page.locator(`#lc-task option[value="${d.id}"]`)).toBeEnabled();
  await page.locator("#lc-task").selectOption(d.id);
  await page.locator("#lc-h").fill("1:00");
  await page.locator("#lc-desc").fill("e2e demanda aprovada");
  await page.locator("#lancar").getByRole("button", { name: /^Lançar 1:00 h$/ }).click();
  await expect(page.locator("#lancar").getByRole("status")).toContainText("1:00 h lançadas");
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from time_entries where item_id = ${d.id}`;
  expect(n.n).toBe(1);
});
