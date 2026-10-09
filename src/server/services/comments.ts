import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { audit } from "../audit";
import { notify } from "../notify";
import type { TeamUser } from "../session";
import { ItemError, loadItemCtx } from "./items";

/**
 * Comentários nos itens (US-40, US-41).
 * Canal Interno: só o time. Canal Cliente: visto pelo cliente no portal (item visível).
 */

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "@Helena" ou "@Helena Duarte" → ids das pessoas mencionadas (sem repetir). */
export function parseMentions(body: string, people: { id: string; name: string }[]): string[] {
  const text = norm(body);
  const out = new Set<string>();
  for (const p of people) {
    const full = norm(p.name);
    const first = full.split(/\s+/)[0];
    const re = (n: string) => new RegExp(`(^|[^\\w@])@${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`);
    if (re(full).test(text) || re(first).test(text)) out.add(p.id);
  }
  return [...out];
}

async function activePeople() {
  return db.select({ id: s.people.id, name: s.people.name, slackUserId: s.people.slackUserId }).from(s.people).where(eq(s.people.active, true));
}

function itemLink(item: { id: string }) {
  return `/projetos/${item.id}`;
}

/**
 * US-40/41: comentar. No canal Cliente, a tela pede a confirmação "Este comentário será visto pelo cliente"
 * e o servidor exige `confirmClient`. Responder no canal Cliente marca como respondidos os comentários
 * do cliente que estavam esperando.
 */
export async function addComment(me: TeamUser, itemId: string, input: { channel: "interno" | "cliente"; body: string; confirmClient?: boolean }) {
  const body = (input.body ?? "").trim();
  if (!body) throw new ItemError("Escreva o comentário.", { body: "Comentário vazio." });
  if (input.channel !== "interno" && input.channel !== "cliente") throw new ItemError("Canal inválido.");
  const { item } = await loadItemCtx(itemId);
  if (input.channel === "cliente") {
    if (!item.visibleToClient) throw new ItemError("Este item é interno. Torne-o visível ao cliente para conversar com ele.");
    if (!input.confirmClient) throw new ItemError("Confirme: este comentário será visto pelo cliente.", {}, true);
  }
  const people = await activePeople();
  const mentions = parseMentions(body, people).filter((id) => id !== me.id);

  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(s.comments)
      .values({ itemId, channel: input.channel, authorPersonId: me.id, body, mentions, createdAt: now() })
      .returning();
    await audit(tx, { personId: me.id, entity: "comment", entityId: c.id, action: "comentar", after: { itemId, channel: c.channel } });
    // US-40 / US-43: menção avisa a pessoa no Clarity e no Slack, na hora.
    for (const pid of mentions) {
      const p = people.find((x) => x.id === pid)!;
      await notify(tx, {
        event: "mencao",
        to: { personId: p.id, slackUserId: p.slackUserId },
        title: `${me.name} mencionou você em ${item.name}`,
        body: body.slice(0, 280),
        link: itemLink(item),
      });
    }
    if (input.channel === "cliente") {
      // US-41: a resposta encerra a espera dos comentários do cliente neste item.
      const pending = await tx
        .update(s.comments)
        .set({ answeredAt: now() })
        .where(and(eq(s.comments.itemId, itemId), eq(s.comments.channel, "cliente"), isNotNull(s.comments.authorContactId), isNull(s.comments.answeredAt), isNull(s.comments.deletedAt)))
        .returning({ contactId: s.comments.authorContactId });
      const contactIds = [...new Set(pending.map((p) => p.contactId!).filter(Boolean))];
      for (const cid of contactIds) {
        const [ct] = await tx.select().from(s.clientContacts).where(eq(s.clientContacts.id, cid));
        if (!ct?.email || !ct.portalAccess || !ct.active) continue;
        // US-43: resposta da Síntese a um comentário → e-mail para quem comentou.
        await notify(tx, {
          event: "resposta_sintese",
          to: { contactId: ct.id, email: ct.email },
          title: `A Síntese respondeu sobre ${item.name}`,
          body: body.slice(0, 500),
          link: `/portal`,
        });
      }
    }
    return c;
  });
}

async function own(me: TeamUser, id: string) {
  const [c] = await db.select().from(s.comments).where(and(eq(s.comments.id, id), isNull(s.comments.deletedAt)));
  // US-40: cada um edita ou exclui só os próprios comentários.
  if (!c || c.authorPersonId !== me.id) throw new ItemError("Você só edita ou exclui os seus próprios comentários.");
  return c;
}

export async function editComment(me: TeamUser, id: string, body: string) {
  const c = await own(me, id);
  const text = (body ?? "").trim();
  if (!text) throw new ItemError("O comentário não pode ficar vazio.");
  if (text === c.body) return c;
  const people = await activePeople();
  const mentions = parseMentions(text, people).filter((pid) => pid !== me.id);
  const fresh = mentions.filter((m) => !c.mentions.includes(m));
  const { item } = c.itemId ? await loadItemCtx(c.itemId) : { item: null };
  return db.transaction(async (tx) => {
    const [after] = await tx.update(s.comments).set({ body: text, mentions, editedAt: now() }).where(eq(s.comments.id, id)).returning();
    await audit(tx, { personId: me.id, entity: "comment", entityId: id, action: "editar", before: { body: c.body }, after: { body: text } });
    for (const pid of fresh) {
      const p = people.find((x) => x.id === pid)!;
      await notify(tx, {
        event: "mencao",
        to: { personId: p.id, slackUserId: p.slackUserId },
        title: `${me.name} mencionou você${item ? ` em ${item.name}` : ""}`,
        body: text.slice(0, 280),
        link: item ? itemLink(item) : undefined,
      });
    }
    return after;
  });
}

export async function deleteComment(me: TeamUser, id: string) {
  const c = await own(me, id);
  await db.transaction(async (tx) => {
    await tx.update(s.comments).set({ deletedAt: now() }).where(eq(s.comments.id, id));
    await audit(tx, { personId: me.id, entity: "comment", entityId: id, action: "excluir", before: { body: c.body } });
  });
}
