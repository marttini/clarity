import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loginAs, personId, sql, visit, watchErrors } from "./helpers";

/** US-32 (perfis), US-11 (comprovante), US-49 (TV), configurações só para Administrador. */

test("Maria (administrativo): fila sem horas, registra contato e não lança horas", async ({ page, context }) => {
  await loginAs(context, "maria");
  await page.goto("/fila");
  await expect(page.locator("#lancar")).toHaveCount(0);
  await page.goto("/horas");
  await expect(page.getByText("Seu perfil não aponta horas.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Lançar/ })).toHaveCount(0);

  // Registra um contato que já aconteceu (US-36).
  await page.goto("/contatos?modo=registrar#form");
  await page.locator("#f-client").selectOption({ label: "Kari-Kari Alimentos" });
  await page.locator("#l-sum").fill("e2e: Maria ligou para confirmar o pagamento");
  await page.getByRole("button", { name: "Registrar contato" }).click();
  await expect.poll(async () => (await sql`select 1 from contacts where result_summary = 'e2e: Maria ligou para confirmar o pagamento' and status = 'realizado'`).length).toBe(1);

  // Força: lançador aberto pelo Caio, envio com a sessão da Maria.
  await loginAs(context, "caio");
  await page.goto("/fila");
  await page.locator("#lancar").getByPlaceholder("2h30 kari broker sustentação").fill("1h kari mapeamento e2e maria forçou");
  await loginAs(context, "maria");
  await page.locator("#lancar").getByRole("button", { name: /^Lançar/ }).click();
  await expect(page.locator("#lancar").getByRole("status")).toContainText("Só consultores apontam horas.");
  expect((await sql`select 1 from time_entries where description like '%maria forçou%'`).length).toBe(0);
});

test("/config é só do Administrador", async ({ page, context }) => {
  for (const who of ["luiz", "richard", "caio", "maria"]) {
    await loginAs(context, who);
    await page.goto("/config/tipos");
    await expect(page).toHaveURL(/\/fila$/);
  }
  await loginAs(context, "marttini");
  await visit(page, "/config/tipos");
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
});

test("gestão carrega sem erro de console para marttini", async ({ page, context }) => {
  test.setTimeout(180_000);
  await loginAs(context, "marttini");
  const [client] = await sql<{ id: string }[]>`select id from clients where name like 'Kari%'`;
  const errors = watchErrors(page);
  for (const r of ["/gestao", "/time", `/time/${await personId("caio")}`, "/ranking", "/clientes", `/clientes/${client.id}`, "/contatos", "/projetos"]) {
    await visit(page, r);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});

test("/gestao é da gestão: consultor volta para a fila", async ({ page, context }) => {
  await loginAs(context, "caio");
  await page.goto("/gestao");
  await expect(page.locator("body")).not.toContainText("Pedidos de alteração de horas");
});

test("TV abre sem login; token inválido ou revogado dá 404", async ({ page }) => {
  await visit(page, "/tv/tv-demo-sintese");
  await expect(page.locator("body")).not.toContainText("R$");
  expect((await page.goto("/tv/nao-existe"))?.status()).toBe(404);
  await sql`insert into tv_tokens (token, label, revoked_at) values ('tv-e2e-revogado', 'e2e', now())`;
  expect((await page.goto("/tv/tv-e2e-revogado"))?.status()).toBe(404);
});

test("US-11: comprovante de justificativa só para o próprio consultor e a gestão", async ({ page, context }) => {
  const caio = await personId("caio");
  const key = `e2e/just-${Date.now()}.txt`;
  await mkdir(path.join(process.cwd(), "storage", "e2e"), { recursive: true });
  await writeFile(path.join(process.cwd(), "storage", key), "print da conversa");
  const [a] = await sql<{ id: string }[]>`insert into attachments (owner_type, owner_id, filename, storage_path, size_bytes, mime, version, internal, uploaded_by_person_id)
    values ('justification', ${caio}, 'print.txt', ${key}, 17, 'text/plain', 1, true, ${caio}) returning id`;
  const [reason] = await sql<{ id: string }[]>`select id from absence_reasons limit 1`;
  await sql`insert into absence_justifications (person_id, date, reason_id, attachment_id) values (${caio}, '2026-09-15', ${reason.id}, ${a.id}) on conflict do nothing`;

  for (const [who, ok] of [["caio", true], ["marttini", true], ["luiz", true], ["julia", false], ["maria", false]] as const) {
    await loginAs(context, who);
    for (const url of [`/api/anexos/${a.id}`, `/gestao/pendencias/comprovante/${a.id}`]) {
      const s = (await page.request.get(url)).status();
      expect(ok ? s === 200 : s === 403 || s === 404, `${who} em ${url}: ${s}`).toBe(true);
    }
  }
});

test("contato inativo no Odoo perde o portal na hora", async ({ page, context }) => {
  await loginAs(context, "contact:carla.mendes@kari.com.br");
  await sql`update client_contacts set active = false where email = 'carla.mendes@kari.com.br'`;
  try {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/entrar/);
  } finally {
    await sql`update client_contacts set active = true where email = 'carla.mendes@kari.com.br'`;
  }
});
