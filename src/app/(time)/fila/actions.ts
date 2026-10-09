"use server";
import { revalidatePath } from "next/cache";
import { requireTeam } from "@/server/session";
import { createEntry, EntryError } from "@/server/services/entries";
import { ContactError, registerResult, scheduleContact, type FollowUp } from "@/server/services/contacts";
import { formatMinutes } from "@/domain/dates";
import { entryFromForm, fail, ok, str, type EntryState } from "../horas/_form";

/** US-01: lançar pela fila. Sempre em nome de quem está logado; só consultores apontam. */
export async function launchAction(_prev: EntryState, f: FormData): Promise<EntryState> {
  const me = await requireTeam();
  try {
    if (!me.isConsultor) throw new EntryError("Só consultores apontam horas.", { item: "Seu perfil não aponta horas." });
    const input = await entryFromForm(f);
    const row = await createEntry(me, input);
    return ok(`${formatMinutes(row.minutes)} h lançadas. Já estão na fila do Odoo.`);
  } catch (e) {
    return fail(e);
  }
}

// ---------- Contatos (US-35, US-36) a partir da fila ----------

export type ContactState = { ok: boolean; message: string; fields?: Record<string, string>; at: number } | null;

function contactFail(e: unknown): ContactState {
  if (e instanceof ContactError) return { ok: false, message: e.message, fields: e.fields, at: Date.now() };
  console.error(e);
  return { ok: false, message: "Não foi possível salvar. Tente de novo em instantes.", at: Date.now() };
}

function contactOk(message: string): ContactState {
  revalidatePath("/fila");
  revalidatePath("/contatos");
  revalidatePath("/clientes");
  return { ok: true, message, at: Date.now() };
}

/** US-36: registrar o resultado (Realizado, Não atendeu, Remarcar), com tarefa de follow-up opcional. */
export async function contactResultAction(_prev: ContactState, f: FormData): Promise<ContactState> {
  const me = await requireTeam();
  const result = str(f, "result") as "realizado" | "nao_atendeu" | "remarcado";
  let followUp: FollowUp | null = null;
  if (result !== "remarcado" && str(f, "fu") === "tarefa")
    followUp = { kind: "tarefa", name: str(f, "taskName"), deadline: str(f, "taskDeadline") || null, responsibleId: str(f, "taskResponsibleId") || me.id };
  try {
    const r = await registerResult(me, str(f, "contactId"), {
      result,
      summary: str(f, "summary"),
      nextStep: str(f, "nextStep") || null,
      newDate: str(f, "newDate"),
      newTime: str(f, "newTime"),
      reason: str(f, "reason"),
      followUp,
    });
    const label = result === "remarcado" ? "Contato remarcado." : result === "realizado" ? "Contato registrado." : "Registrado: não atendeu.";
    return contactOk(`${label}${r.task ? ` Tarefa "${r.task.name}" criada.` : ""}`);
  } catch (e) {
    return contactFail(e);
  }
}

/** US-34/US-37: agendar contato (cliente sem contato, cobrança de retorno ou documento). */
export async function scheduleFromQueueAction(_prev: ContactState, f: FormData): Promise<ContactState> {
  const me = await requireTeam();
  try {
    const r = await scheduleContact(me, {
      clientId: str(f, "clientId"),
      clientContactId: str(f, "clientContactId") || null,
      type: str(f, "type") || "ligacao",
      responsibleId: str(f, "responsibleId") || me.id,
      date: str(f, "date"),
      time: str(f, "time"),
      objective: str(f, "objective"),
      relatedItemId: str(f, "relatedItemId") || null,
    });
    return contactOk(`Agendado.${r.warning ? ` ${r.warning}` : ""}`);
  } catch (e) {
    return contactFail(e);
  }
}
