"use server";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam } from "@/server/session";
import { deleteEntry, EntryError, justifyAbsence, requestChange, updateEntry } from "@/server/services/entries";
import { saveAttachment } from "@/server/attachments";
import { formatMinutes, shortDate } from "@/domain/dates";
import { entryFromForm, fail, ok, str, type EntryState } from "./_form";

function bad(message: string, fields: Record<string, string>): EntryState {
  return { ok: false, message, fields, at: Date.now() };
}

/** US-04: editar em até 48 h. */
export async function editEntryAction(_prev: EntryState, f: FormData): Promise<EntryState> {
  const me = await requireTeam();
  try {
    const input = await entryFromForm(f);
    const row = await updateEntry(me, str(f, "id"), input);
    return ok(`Apontamento de ${shortDate(row.date)} atualizado.`);
  } catch (e) {
    return fail(e);
  }
}

/** US-04: excluir em até 48 h (a tela pede confirmação). */
export async function deleteEntryAction(_prev: EntryState, f: FormData): Promise<EntryState> {
  const me = await requireTeam();
  try {
    await deleteEntry(me, str(f, "id"));
    return ok("Apontamento excluído.");
  } catch (e) {
    return fail(e);
  }
}

/** US-09: depois de 48 h, pedir alteração (novos valores) ou exclusão, com justificativa. */
export async function requestChangeAction(_prev: EntryState, f: FormData): Promise<EntryState> {
  const me = await requireTeam();
  const kind = str(f, "kind") === "excluir" ? "excluir" : "alterar";
  try {
    const justification = str(f, "justification");
    if (!justification) return bad("A justificativa é obrigatória.", { justification: "Explique o motivo do pedido." });
    const newValues = kind === "alterar" ? await entryFromForm(f) : undefined;
    await requestChange(me, str(f, "id"), { kind, newValues, justification });
    return ok("Pedido enviado para aprovação. O apontamento original vale até a decisão.");
  } catch (e) {
    return fail(e);
  }
}

/** US-12: converter provisionamento em hora real (Faturável, Bonificado ou Interno), dentro de 48 h da data. */
export async function convertAction(_prev: EntryState, f: FormData): Promise<EntryState> {
  const me = await requireTeam();
  try {
    const id = str(f, "id");
    const [cur] = await db
      .select({ e: s.timeEntries, prov: s.entryTypes.isProvisioning })
      .from(s.timeEntries)
      .innerJoin(s.entryTypes, eq(s.entryTypes.id, s.timeEntries.typeId))
      .where(and(eq(s.timeEntries.id, id), eq(s.timeEntries.personId, me.id), isNull(s.timeEntries.deletedAt)));
    if (!cur) throw new EntryError("Apontamento não encontrado.");
    if (!cur.prov) throw new EntryError("Este apontamento já não é um provisionamento.");
    const input = await entryFromForm(f);
    const [type] = await db.select().from(s.entryTypes).where(eq(s.entryTypes.id, input.typeId));
    if (!type || type.isProvisioning) throw new EntryError("Para converter, escolha Faturável, Bonificado ou Interno.", { type: "Escolha o tipo real." });
    if (input.date !== cur.e.date) throw new EntryError("A conversão mantém a data provisionada.", { date: "Mantenha a data." });
    const row = await updateEntry(me, id, input);
    return ok(`Convertido: ${formatMinutes(row.minutes)} h como ${type.name}.`);
  } catch (e) {
    return fail(e);
  }
}

/** US-11: justificar dia útil sem apontamento. Comprovante obrigatório, visível só ao consultor e à gestão. */
export async function justifyAction(_prev: EntryState, f: FormData): Promise<EntryState> {
  const me = await requireTeam();
  try {
    const date = str(f, "date");
    const reasonId = str(f, "reasonId");
    const file = f.get("file");
    const errors: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Escolha o dia.";
    if (!reasonId) errors.reason = "Escolha o motivo.";
    if (!(file instanceof File) || file.size === 0) errors.file = "Anexe o comprovante, por exemplo o print da conversa com o gestor.";
    if (Object.keys(errors).length) return bad(errors.file && Object.keys(errors).length === 1 ? errors.file : "Preencha o dia, o motivo e o comprovante.", errors);
    if (!me.isConsultor) throw new EntryError("Só consultores registram justificativa.");
    const [reason] = await db.select().from(s.absenceReasons).where(and(eq(s.absenceReasons.id, reasonId), eq(s.absenceReasons.active, true)));
    if (!reason) return bad("Motivo inválido.", { reason: "Escolha um motivo da lista." });
    // O comprovante fica guardado em nome do consultor (interno); a justificativa aponta para ele.
    const att = await saveAttachment(db, file as File, { type: "justification", id: me.id }, { personId: me.id }, { internal: true });
    await justifyAbsence(me, { date, reasonId, note: str(f, "note") || undefined, attachmentId: att.id });
    return ok(`Dia ${shortDate(date)} justificado (${reason.name}).`);
  } catch (e) {
    return fail(e);
  }
}
