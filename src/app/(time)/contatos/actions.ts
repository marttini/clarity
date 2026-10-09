"use server";
import { revalidatePath } from "next/cache";
import { requireTeam } from "@/server/session";
import { cancelContact, ContactError, logContact, registerResult, scheduleContact, type FollowUp } from "@/server/services/contacts";

export type FormState = { ok: boolean; message: string; fields?: Record<string, string>; at?: number } | null;

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

function fail(e: unknown): FormState {
  if (e instanceof ContactError) return { ok: false, message: e.message, fields: e.fields, at: Date.now() };
  console.error(e);
  return { ok: false, message: "Não foi possível salvar. Tente de novo em instantes.", at: Date.now() };
}

function done(message: string, clientId?: string): FormState {
  revalidatePath("/contatos");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  return { ok: true, message, at: Date.now() };
}

/** Próximo passo opcional (US-36): novo contato ou tarefa no projeto anual. */
function followUpFrom(f: FormData): FollowUp | null {
  const kind = str(f, "fu");
  if (kind === "contato")
    return {
      kind,
      date: str(f, "fuDate"),
      time: str(f, "fuTime"),
      type: str(f, "fuType"),
      responsibleId: str(f, "fuResponsibleId"),
      objective: str(f, "fuObjective"),
      clientContactId: str(f, "clientContactId") || null,
    };
  if (kind === "tarefa") return { kind, name: str(f, "taskName"), deadline: str(f, "taskDeadline") || null, responsibleId: str(f, "taskResponsibleId") };
  return null;
}

function followUpMessage(r: { nextContact: unknown; task: { name: string } | null }) {
  if (r.task) return ` Tarefa "${r.task.name}" criada no projeto anual.`;
  if (r.nextContact) return " Próximo contato agendado.";
  return "";
}

/** US-34: agendar. */
export async function scheduleAction(_prev: FormState, f: FormData): Promise<FormState> {
  const me = await requireTeam();
  const clientId = str(f, "clientId");
  try {
    const r = await scheduleContact(me, {
      clientId,
      clientContactId: str(f, "clientContactId") || null,
      type: str(f, "type"),
      responsibleId: str(f, "responsibleId") || me.id,
      date: str(f, "date"),
      time: str(f, "time"),
      objective: str(f, "objective"),
      relatedItemId: str(f, "relatedItemId") || null,
    });
    return done(`Contato agendado.${r.warning ? ` ${r.warning}` : ""}`, clientId);
  } catch (e) {
    return fail(e);
  }
}

/** US-36: registrar um contato que já aconteceu. */
export async function logAction(_prev: FormState, f: FormData): Promise<FormState> {
  const me = await requireTeam();
  const clientId = str(f, "clientId");
  try {
    const r = await logContact(me, {
      clientId,
      clientContactId: str(f, "clientContactId") || null,
      type: str(f, "type"),
      date: str(f, "date"),
      time: str(f, "time") || null,
      summary: str(f, "summary"),
      nextStep: str(f, "nextStep") || null,
      followUp: followUpFrom(f),
    });
    return done(`Contato registrado.${followUpMessage(r)}`, clientId);
  } catch (e) {
    return fail(e);
  }
}

/** US-36: resultado de um contato agendado (Realizado, Não atendeu, Remarcado). */
export async function resultAction(_prev: FormState, f: FormData): Promise<FormState> {
  const me = await requireTeam();
  const result = str(f, "result") as "realizado" | "nao_atendeu" | "remarcado";
  try {
    const r = await registerResult(me, str(f, "contactId"), {
      result,
      summary: str(f, "summary"),
      nextStep: str(f, "nextStep") || null,
      newDate: str(f, "newDate"),
      newTime: str(f, "newTime"),
      reason: str(f, "reason"),
      followUp: result === "remarcado" ? null : followUpFrom(f),
    });
    const label = result === "remarcado" ? "Contato remarcado." : result === "realizado" ? "Contato registrado como realizado." : "Registrado: não atendeu.";
    return done(`${label}${followUpMessage(r)}`, r.contact.clientId);
  } catch (e) {
    return fail(e);
  }
}

export async function cancelAction(_prev: FormState, f: FormData): Promise<FormState> {
  const me = await requireTeam();
  try {
    const c = await cancelContact(me, str(f, "contactId"), str(f, "reason"));
    return done("Contato cancelado.", c.clientId);
  } catch (e) {
    return fail(e);
  }
}
