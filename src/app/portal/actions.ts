"use server";
import { revalidatePath } from "next/cache";
import { requireClient } from "@/server/session";
import {
  decideDemand,
  evaluate,
  inviteColleagues,
  postComment,
  uploadFile,
  PortalError,
  type InviteResult,
} from "@/server/services/portal";

/**
 * Ações do portal: finas, sempre a partir do contato logado (requireClient).
 * O cliente do contato vem da sessão, nunca do formulário.
 */
export type ActionState = { ok: boolean; msg: string; key?: number } | null;

function fail(e: unknown): ActionState {
  if (e instanceof PortalError) return { ok: false, msg: e.message, key: Date.now() };
  console.error(e);
  return { ok: false, msg: e instanceof Error && e.message ? e.message : "Não deu certo. Tente de novo em instantes.", key: Date.now() };
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const file = (f: FormData, k: string) => {
  const v = f.get(k);
  return v instanceof File && v.size > 0 ? v : null;
};

export async function approveDemandAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireClient();
  try {
    await decideDemand(me, str(f, "itemId"), true);
    revalidatePath("/portal", "layout");
    return { ok: true, msg: "Aprovada. A equipe já pode começar e as horas contam a partir de agora.", key: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function refuseDemandAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireClient();
  try {
    await decideDemand(me, str(f, "itemId"), false, str(f, "reason"));
    revalidatePath("/portal", "layout");
    return { ok: true, msg: "Recusada. A Síntese foi avisada.", key: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function sendMessageAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireClient();
  try {
    const r = await postComment(me, str(f, "itemId"), str(f, "body"), file(f, "file"));
    revalidatePath("/portal/mensagens");
    revalidatePath("/portal/arquivos");
    return { ok: true, msg: r.attachmentId && !r.commentId ? "Arquivo enviado." : "Mensagem enviada. O time da Síntese foi avisado.", key: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function uploadFileAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireClient();
  try {
    const a = await uploadFile(me, str(f, "itemId"), file(f, "file"));
    revalidatePath("/portal/arquivos");
    revalidatePath("/portal/mensagens");
    return { ok: true, msg: `"${a.filename}" enviado. A Síntese foi avisada.`, key: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function evaluateAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireClient();
  const n = (k: string) => Number(f.get(k) ?? 0);
  try {
    await evaluate(me, { itemId: str(f, "itemId"), result: n("result"), consultant: n("consultant"), team: n("team"), comment: str(f, "comment") });
    revalidatePath("/portal", "layout");
    return { ok: true, msg: `Obrigado, ${me.name.split(" ")[0]}. Notas: Resultado ${n("result")}, Consultor ${n("consultant")}, Time ${n("team")}. Sua avaliação vai para a gestão da Síntese.`, key: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export type InviteState = { ok: boolean; msg: string; results: InviteResult[]; key?: number } | null;

export async function inviteAction(_: InviteState, f: FormData): Promise<InviteState> {
  const me = await requireClient();
  try {
    const results = await inviteColleagues(me, str(f, "emails"));
    revalidatePath("/portal/convidar");
    const sent = results.filter((r) => r.status === "convidado").length;
    return { ok: sent > 0, msg: sent === 0 ? "Nenhum convite enviado. Veja abaixo." : sent === 1 ? "1 convite enviado por e-mail." : `${sent} convites enviados por e-mail.`, results, key: Date.now() };
  } catch (e) {
    const r = fail(e)!;
    return { ok: false, msg: r.msg, results: [], key: r.key };
  }
}
