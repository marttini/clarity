import "server-only";

/**
 * Canal Slack da Central de avisos (US-43): mensagens diretas ao time e o resumo
 * diário no #clarity-gestao. Usa a Web API (chat.postMessage) com o token do bot.
 */
export class ChannelError extends Error {
  constructor(
    message: string,
    /** Falha passageira (rede, limite de taxa, 5xx): vale tentar de novo. */
    public retryable: boolean,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Erros do Slack que não se resolvem tentando de novo. */
const PERMANENT = new Set([
  "channel_not_found",
  "user_not_found",
  "not_in_channel",
  "is_archived",
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "missing_scope",
  "cannot_dm_bot",
  "user_disabled",
  "msg_too_long",
  "no_text",
]);

const ERROR_PT: Record<string, string> = {
  channel_not_found: "canal ou usuário não encontrado no Slack",
  user_not_found: "usuário não encontrado no Slack",
  not_in_channel: "o bot não está no canal",
  invalid_auth: "token do Slack inválido",
  not_authed: "token do Slack ausente",
  token_revoked: "token do Slack revogado",
  missing_scope: "o bot do Slack não tem permissão para enviar",
  ratelimited: "limite de envios do Slack atingido",
};

export async function postSlackMessage(
  msg: { channel: string; text: string },
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<{ ts: string | null }> {
  const token = opts.token ?? process.env.SLACK_BOT_TOKEN;
  if (!token) throw new ChannelError("Slack não configurado (SLACK_BOT_TOKEN).", false);
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: msg.channel, text: msg.text, unfurl_links: false, unfurl_media: false }),
    });
  } catch (e) {
    throw new ChannelError(`Falha de rede ao falar com o Slack: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  if (res.status === 429 || res.status >= 500) throw new ChannelError(`Slack respondeu ${res.status}`, true);
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; ts?: string } | null;
  if (!body) throw new ChannelError(`Resposta inválida do Slack (${res.status})`, true);
  if (!body.ok) {
    const code = body.error ?? "erro_desconhecido";
    throw new ChannelError(ERROR_PT[code] ?? `Slack: ${code}`, !PERMANENT.has(code));
  }
  return { ts: body.ts ?? null };
}
