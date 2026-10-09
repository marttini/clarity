import "server-only";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { parseDuration } from "@/domain/dates";
import { today } from "@/lib/clock";
import { EntryError, type EntryInput } from "@/server/services/entries";

/** Resposta das ações de apontamento (US-01, US-04, US-09, US-11, US-12). */
export type EntryState = { ok: boolean; message: string; fields?: Record<string, string>; at: number } | null;

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export function fail(e: unknown): EntryState {
  if (e instanceof EntryError) return { ok: false, message: e.message, fields: e.fields as Record<string, string>, at: Date.now() };
  if (e instanceof Error && /arquivo|25 MB|execut/i.test(e.message)) return { ok: false, message: e.message, fields: { file: e.message }, at: Date.now() };
  console.error(e);
  return { ok: false, message: "Não foi possível salvar. Tente de novo em instantes.", at: Date.now() };
}

export function ok(message: string): EntryState {
  revalidatePath("/fila");
  revalidatePath("/horas");
  return { ok: true, message, at: Date.now() };
}

/**
 * Lê os campos do formulário de apontamento. Horas aceitam "2:30", "2h30", "90min" ou "1,5".
 * Data futura sempre vira Provisionamento (US-01: datas futuras só com Provisionamento).
 */
export async function entryFromForm(f: FormData): Promise<EntryInput> {
  const errors: Record<string, string> = {};
  const raw = str(f, "horas");
  const minutes = raw ? parseDuration(raw) : null;
  if (minutes === null) errors.minutes = raw ? "Horas inválidas. Use hh:mm, por exemplo 2:30." : "Informe as horas.";
  const date = str(f, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Escolha a data.";
  const itemId = str(f, "itemId");
  if (!itemId) errors.item = "Escolha a tarefa.";
  let typeId = str(f, "typeId");
  if (date > today()) {
    const [prov] = await db.select({ id: s.entryTypes.id }).from(s.entryTypes).where(eq(s.entryTypes.isProvisioning, true));
    if (prov) typeId = prov.id;
  }
  if (!typeId) errors.type = "Escolha o tipo.";
  if (Object.keys(errors).length) throw new EntryError(Object.values(errors)[0], errors);
  const sust = str(f, "sust");
  return {
    itemId,
    date,
    minutes: minutes!,
    description: str(f, "description"),
    typeId,
    isSustentacao: sust === "" ? null : sust === "1",
    salesOrderLineId: str(f, "soId") || null,
  };
}
