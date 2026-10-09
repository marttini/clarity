import "server-only";
import { ChannelError, type FetchLike } from "./slack";

/**
 * E-mail transacional para clientes (US-43), via Resend.
 * O time nunca recebe e-mail: só Slack.
 */
export async function sendEmail(
  msg: { to: string; subject: string; text: string; html?: string },
  opts: { apiKey?: string; from?: string; fetchImpl?: FetchLike } = {},
): Promise<{ id: string | null }> {
  const key = opts.apiKey ?? process.env.RESEND_API_KEY;
  const from = opts.from ?? process.env.EMAIL_FROM;
  if (!key || !from) throw new ChannelError("E-mail não configurado (RESEND_API_KEY e EMAIL_FROM).", false);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.to)) throw new ChannelError(`Endereço de e-mail inválido: ${msg.to}`, false);
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
  } catch (e) {
    throw new ChannelError(`Falha de rede ao enviar e-mail: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  if (res.ok) return { id: body?.id ?? null };
  const detail = body?.message ?? body?.name ?? `status ${res.status}`;
  throw new ChannelError(`E-mail recusado: ${detail}`, res.status === 429 || res.status >= 500);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML simples e legível, com a marca Síntese e a tagline do portal. */
export function emailHtml(p: { title: string; body: string; url: string | null }) {
  const paras = p.body
    .split(/\n+/)
    .filter(Boolean)
    .map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#2A1B37">${esc(l)}</p>`)
    .join("");
  const btn = p.url
    ? `<p style="margin:20px 0"><a href="${esc(p.url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#F07A45;color:#120A19;font-weight:700;text-decoration:none">Abrir no portal</a></p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#F6F2F9;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:24px"><h1 style="margin:0 0 16px;font-size:19px;color:#120A19">${esc(p.title)}</h1>${paras}${btn}<p style="margin:24px 0 0;font-size:12px;color:#8C7E9B">Síntese · Presente na sua gestão</p></div></body></html>`;
}
