"use server";
import { revalidatePath } from "next/cache";
import { requireTeam } from "@/server/session";
import { decideChange, EntryError } from "@/server/services/entries";
import { chargeClientForDemand, decideEvaluation, ManagementError, reopenEvaluation, resendSync } from "@/server/services/management";
import { SyncError } from "@/server/odoo/push";

export type ActionState = { ok?: string; error?: string } | null;

function fail(e: unknown): ActionState {
  if (e instanceof EntryError || e instanceof ManagementError || e instanceof SyncError) return { error: e.message };
  console.error(e);
  return { error: "Não deu certo. Tente de novo em instantes." };
}

function refresh() {
  revalidatePath("/gestao/pendencias");
  revalidatePath("/gestao");
}

/** US-10: aprovar ou recusar um pedido de alteração (só quem tem can_approve_hours). */
export async function decideChangeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = String(form.get("id") ?? "");
  const approve = form.get("decisao") === "aprovar";
  const reason = String(form.get("motivo") ?? "");
  try {
    await decideChange(me, id, approve, reason);
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: approve ? "Alteração aprovada." : "Pedido recusado." };
}

/** US-33: publicar ou manter oculta uma avaliação. */
export async function decideEvaluationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = String(form.get("id") ?? "");
  const what = String(form.get("decisao") ?? "");
  try {
    if (what === "reabrir") await reopenEvaluation(me, id);
    else await decideEvaluation(me, id, what === "publicar");
  } catch (e) {
    return fail(e);
  }
  refresh();
  revalidatePath("/time/[id]", "page");
  return { ok: what === "publicar" ? "Publicada para o time." : what === "reabrir" ? "Voltou para a lista." : "Mantida oculta." };
}

/** Demanda parada com o cliente: agenda a cobrança para a Maria. */
export async function chargeClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireTeam();
  try {
    const r = await chargeClientForDemand(me, String(form.get("id") ?? ""));
    refresh();
    return { ok: r.created ? "Cobrança agendada." : "Já havia cobrança agendada." };
  } catch (e) {
    return fail(e);
  }
}

/** Sincronização: reenviar ao Odoo. */
export async function resendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const entity = form.get("entity") === "item" ? "item" : "time_entry";
  try {
    await resendSync(me, entity, String(form.get("id") ?? ""));
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: "Na fila para reenviar." };
}
