"use server";
import { revalidatePath } from "next/cache";
import { requireTeam } from "@/server/session";
import { ClientError, inviteToPortal, revokePortal, updateClientInternal } from "@/server/services/clients";

export type FormState = { ok: boolean; message: string; fields?: Record<string, string> } | null;

function fail(e: unknown): FormState {
  if (e instanceof ClientError) return { ok: false, message: e.message, fields: e.fields };
  console.error(e);
  return { ok: false, message: "Não foi possível salvar. Tente de novo em instantes." };
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

/** US-30: ERP e observações internas (gestão). */
export async function saveInternalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireTeam();
  const id = str(form, "clientId");
  try {
    await updateClientInternal(me, id, { erp: str(form, "erp"), internalNotes: str(form, "internalNotes") });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/clientes/${id}`);
  return { ok: true, message: "Dados internos salvos." };
}

/** US-31: convidar ou revogar acesso ao portal. */
export async function portalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireTeam();
  const contactId = str(form, "contactId");
  const op = str(form, "op");
  try {
    if (op === "revogar") await revokePortal(me, contactId);
    else await inviteToPortal(me, contactId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/clientes/${str(form, "clientId")}`);
  return { ok: true, message: op === "revogar" ? "Acesso revogado." : "Convite enviado por e-mail." };
}
