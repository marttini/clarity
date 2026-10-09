import "server-only";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { nextBusinessInstant } from "@/domain/rules";
import { getHolidays, getSettings } from "./data/common";
import type { Tx } from "./audit";

/**
 * Central de avisos (US-43). Todo aviso aparece no sino do Clarity e sai por
 * no máximo UM canal externo: Slack para o time, e-mail para o cliente.
 * Avisos externos só saem em dias úteis, das 8h às 18h (exceto erro de sincronização).
 */
export type NotifyEvent =
  | "mencao"
  | "comentario_cliente"
  | "comentario_sem_resposta"
  | "contato_agendado"
  | "contato_atrasado"
  | "dia_sem_apontamento"
  | "tres_dias_sem_apontamento"
  | "provisionamento_converter"
  | "prazo"
  | "pedido_alteracao"
  | "pedido_alteracao_decidido"
  | "demanda_decidida"
  | "avaliacao_recebida"
  | "erro_sincronizacao"
  | "convite_portal"
  | "demanda_aguardando_cliente"
  | "resposta_sintese";

/** Eventos que não podem ser silenciados pela pessoa. */
export const MANDATORY: NotifyEvent[] = ["pedido_alteracao", "pedido_alteracao_decidido", "prazo", "tres_dias_sem_apontamento", "erro_sincronizacao"];

type Target =
  | { personId: string; slackUserId?: string | null }
  | { contactId: string; email: string };

export async function notify(
  tx: Tx | typeof db,
  ev: {
    event: NotifyEvent;
    to: Target;
    title: string;
    body?: string;
    link?: string;
    /** "direct" = mensagem direta/e-mail na hora; "none" = só no sino; "digest" = vai para o resumo diário da gestão. */
    external?: "direct" | "none" | "digest";
    /** Para lembretes: no máximo um por dia por pendência. */
    dedupeKey?: string;
    /** Ignora o horário comercial (erro de sincronização). */
    urgent?: boolean;
  },
) {
  const [n] = await tx
    .insert(s.notifications)
    .values({
      personId: "personId" in ev.to ? ev.to.personId : null,
      contactId: "contactId" in ev.to ? ev.to.contactId : null,
      event: ev.event,
      title: ev.title,
      body: ev.body ?? null,
      link: ev.link ?? null,
    })
    .returning({ id: s.notifications.id });

  const external = ev.external ?? "direct";
  if (external === "none" || external === "digest") return n.id; // o resumo diário lê do sino

  const at = ev.urgent ? now() : nextBusinessInstant(now(), await getHolidays(), await getSettings());
  const payload = { title: ev.title, body: ev.body ?? "", link: ev.link ?? null };
  if ("personId" in ev.to) {
    await tx
      .insert(s.outbox)
      .values({ notificationId: n.id, channel: "slack_dm", target: ev.to.slackUserId ?? ev.to.personId, payload, sendAfter: at, dedupeKey: ev.dedupeKey ?? null })
      .onConflictDoNothing();
  } else {
    await tx
      .insert(s.outbox)
      .values({ notificationId: n.id, channel: "email", target: ev.to.email, payload, sendAfter: at, dedupeKey: ev.dedupeKey ?? null })
      .onConflictDoNothing();
  }
  return n.id;
}
