// Captura de tela para revisão visual: node scripts/shot.mjs <url> <saida.png> [email-ou-contact:id] [largura]
import { chromium } from "@playwright/test";
import postgres from "postgres";

const [, , url, out, who = "", width = "1440"] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 1 });
if (who) {
  let id = who;
  if (who.includes("@") || !who.includes(":")) {
    const sql = postgres(process.env.DATABASE_URL || "postgres://postgres@localhost:5432/clarity", { max: 1 });
    const [p] = await sql`select id from people where email like ${who.includes("@") ? who : who + "@%"}`;
    await sql.end();
    id = p.id;
  }
  const u = new URL(url);
  await ctx.addCookies([{ name: "clarity_dev_user", value: id, domain: u.hostname, path: "/" }]);
}
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: true });
if (errors.length) console.log("ERROS NO NAVEGADOR:\n" + errors.join("\n"));
await browser.close();
