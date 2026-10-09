import { expect, test, type Page } from "@playwright/test";
import { loginAs, sql } from "./helpers";

/** US-10: só Marttini e Richard aprovam ou recusam pedidos de alteração; recusa exige motivo. */

const card = (page: Page, justification: string) => page.locator("article").filter({ hasText: justification });

async function request(justification: string) {
  const [r] = await sql<{ status: string; reason: string | null; decided_by: string | null; minutes: number; pending: boolean }[]>`
    select cr.status, cr.decision_reason as reason, cr.decided_by, te.minutes, te.pending_change as pending
    from change_requests cr join time_entries te on te.id = cr.time_entry_id where cr.justification = ${justification}`;
  return r;
}

const APPROVE = "Esqueci de somar a reunião com o cliente no fim do dia.";
const REFUSE = "Lancei 1 hora a mais por engano.";

test("Luiz (gestor, não aprovador) vê os pedidos sem botões, e o servidor recusa se ele forçar", async ({ page, context }) => {
  await loginAs(context, "luiz");
  await page.goto("/gestao/pendencias");
  await expect(card(page, APPROVE)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  await expect(page.getByText("só Marttini e Richard decidem")).toBeVisible();

  // Força: a tela é aberta por Richard e o clique sai com a sessão do Luiz.
  await loginAs(context, "richard");
  await page.goto("/gestao/pendencias");
  await loginAs(context, "luiz");
  await card(page, APPROVE).getByRole("button", { name: "Aprovar" }).click();
  await expect(card(page, APPROVE).getByRole("alert")).toContainText("Só Marttini e Richard");
  expect((await request(APPROVE)).status).toBe("pendente");
});

test("Richard aprova; recusa exige motivo; o consultor vê o resultado", async ({ page, context }) => {
  await loginAs(context, "richard");
  await page.goto("/gestao/pendencias");
  const before = await request(APPROVE);
  await card(page, APPROVE).getByRole("button", { name: "Aprovar" }).click();
  // Decidido, o cartão sai da lista e o pedido vai para "Resolvidos hoje".
  await expect(card(page, APPROVE)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Resolvidos hoje" })).toBeVisible();
  const approved = await request(APPROVE);
  expect(approved).toMatchObject({ status: "aprovada", pending: false, minutes: before.minutes + 60 });
  expect(approved.decided_by).toBeTruthy();

  const c = card(page, REFUSE);
  await c.getByRole("button", { name: "Recusar" }).click();
  await c.getByRole("button", { name: "Confirmar recusa" }).click();
  await expect(c.getByRole("alert")).toContainText("Escreva o motivo para recusar.");
  expect((await request(REFUSE)).status).toBe("pendente");
  await c.getByRole("textbox").fill("A reunião já está lançada em outro apontamento.");
  await c.getByRole("button", { name: "Confirmar recusa" }).click();
  await expect(card(page, REFUSE)).toHaveCount(0);
  expect(await request(REFUSE)).toMatchObject({ status: "recusada", reason: "A reunião já está lançada em outro apontamento.", pending: false });

  // O consultor que pediu vê a decisão e o motivo em Minhas horas.
  const [who] = await sql<{ email: string }[]>`select p.email from change_requests cr join people p on p.id = cr.person_id where cr.justification = ${REFUSE}`;
  await loginAs(context, who.email.split("@")[0]);
  await page.goto("/horas");
  await expect(page.getByText("Motivo da recusa: A reunião já está lançada em outro apontamento.")).toBeVisible();
  await expect(page.getByText(/Aprovada por Richard/).first()).toBeVisible();
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from notifications where event = 'pedido_alteracao_decidido'`;
  expect(n.n).toBeGreaterThanOrEqual(2);
});
