"use server";
import { revalidatePath } from "next/cache";
import { requireTeam, Forbidden } from "@/server/session";
import { markAllRead, markRead, resendOutbox } from "@/server/services/notifications";
import { setMutes } from "@/server/services/settings";
import type { FormState } from "@/components/config/forms";

/** Sino (US-43): marcar lidas, silenciar avisos informativos e reenviar falhas (gestão). */
export async function markReadAction(f: FormData) {
  const me = await requireTeam();
  await markRead(me, String(f.get("id") ?? ""));
  revalidatePath("/", "layout");
}

export async function markAllReadAction() {
  const me = await requireTeam();
  await markAllRead(me);
  revalidatePath("/", "layout");
}

export async function saveMutesAction(_: FormState, f: FormData): Promise<FormState> {
  const me = await requireTeam();
  const list = await setMutes(me, f.getAll("mute").map(String));
  revalidatePath("/avisos");
  return { ok: true, msg: list.length ? `${list.length} tipo${list.length > 1 ? "s" : ""} de aviso silenciado${list.length > 1 ? "s" : ""}: continuam no sino, mas não chegam no Slack.` : "Você recebe todos os avisos no Slack.", key: Date.now() };
}

export async function resendAction(_: FormState, f: FormData): Promise<FormState> {
  const me = await requireTeam();
  try {
    await resendOutbox(me, String(f.get("id") ?? ""));
    revalidatePath("/avisos");
    return { ok: true, msg: "Na fila para reenviar.", key: Date.now() };
  } catch (e) {
    return { ok: false, msg: e instanceof Forbidden || e instanceof Error ? e.message : "Não deu certo.", key: Date.now() };
  }
}
