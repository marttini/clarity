import { startOfDayInstant, toISODate, type ISODate } from "@/domain/dates";
import { parseOdooDatetime, toOdooDatetime } from "./client";

/**
 * Conversões de formato entre o Clarity e o Odoo.
 * O Odoo guarda datetimes em UTC ("AAAA-MM-DD HH:MM:SS"); o Clarity trabalha com datas de Brasília.
 */

/** Início do dia em Brasília, em UTC (planned_date_begin). */
export function startToOdoo(d: ISODate | null | undefined): string | false {
  return d ? toOdooDatetime(startOfDayInstant(d)) : false;
}

/** Fim do dia (23:59:59) em Brasília, em UTC (date_deadline). Ex.: 2026-10-08 → "2026-10-09 02:59:59". */
export function deadlineToOdoo(d: ISODate | null | undefined): string | false {
  return d ? toOdooDatetime(new Date(startOfDayInstant(d).getTime() + 86_400_000 - 1000)) : false;
}

/** Datetime UTC do Odoo → data de Brasília. Aceita também "AAAA-MM-DD" (campo date). */
export function odooToDate(v: unknown): ISODate | null {
  if (typeof v !== "string" || !v) return null;
  if (v.length === 10) return v;
  const dt = parseOdooDatetime(v);
  return dt ? toISODate(dt) : null;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto simples → HTML do campo description. */
export function textToHtml(t: string | null | undefined): string | false {
  if (!t || !t.trim()) return false;
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** HTML do Odoo → texto simples. */
export function htmlToText(h: unknown): string | null {
  if (typeof h !== "string" || !h.trim()) return null;
  const t = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t || null;
}

/** Minutos → horas decimais do Odoo (1:30 → 1.5). */
export function minutesToHours(min: number): number {
  return Math.round((min / 60) * 10000) / 10000;
}
