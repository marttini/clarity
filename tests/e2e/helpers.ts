import { expect, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PORT } from "./env";

/** Conexão direta ao banco do E2E, para achar ids e conferir o que a tela gravou. */
export const sql = postgres(E2E_DATABASE_URL, { max: 2, onnotice: () => {} });

export async function personId(who: string): Promise<string> {
  const [p] = await sql<{ id: string }[]>`select id from people where email = ${who + "@sintesebrasil.com"}`;
  if (!p) throw new Error(`Pessoa ${who} não está no seed`);
  return p.id;
}

export async function contactId(email: string): Promise<string> {
  const [c] = await sql<{ id: string }[]>`select id from client_contacts where email = ${email}`;
  if (!c) throw new Error(`Contato ${email} não está no seed`);
  return c.id;
}

/** Entra como alguém do time (prefixo do e-mail) ou como contato ("contact:<email>"). */
export async function loginAs(ctx: BrowserContext, who: string) {
  const value = who.startsWith("contact:") ? `contact:${await contactId(who.slice(8))}` : await personId(who);
  await ctx.clearCookies();
  await ctx.addCookies([{ name: "clarity_dev_user", value, domain: "localhost", path: "/" }]);
}

/** Coleta erros de console e de página; use expectNoErrors no fim. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Ruído do modo dev (HMR, favicon) que não é erro do app.
    if (/Download the React DevTools|webpack-hmr|turbopack-hmr|favicon/i.test(t)) return;
    errors.push(t);
  });
  return errors;
}

/** Abre a rota e confere que não é erro de servidor nem tela de erro do Next. */
export async function visit(page: Page, path: string, okStatus = [200]) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  const status = res?.status() ?? 0;
  expect(okStatus, `${path} respondeu ${status}`).toContain(status);
  await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error|Internal Server Error/);
  return res;
}

export const BASE = `http://localhost:${E2E_PORT}`;

/** Chama uma Server Action por fora da tela (simula alguém forçando a requisição). */
export async function forceAction(page: Page, path: string, actionId: string, fields: Record<string, string>) {
  return page.evaluate(
    async ({ path, actionId, fields }) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const r = await fetch(path, { method: "POST", headers: { "Next-Action": actionId, Accept: "text/x-component" }, body: fd });
      return { status: r.status, text: await r.text() };
    },
    { path, actionId, fields },
  );
}
