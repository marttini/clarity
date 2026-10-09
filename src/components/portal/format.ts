import { TZ, toISODate, type ISODate } from "@/domain/dates";

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-11-30" → "30/nov" */
export function dayMon(d: ISODate | null | undefined): string {
  if (!d) return "";
  const [, m, day] = d.split("-").map(Number);
  return `${day}/${MON[m - 1]}`;
}

/** "2026-10-08" → "08/10/2026" */
export function fullDate(d: ISODate | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export function hhmm(at: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(at);
}

/** "08/10/2026 às 14:32" */
export function dateTime(at: Date): string {
  return `${fullDate(toISODate(at))} às ${hhmm(at)}`;
}

/** "Hoje, 09:40" · "Ontem, 17:10" · "07/10, 11:20" */
export function whenShort(at: Date, today: ISODate): string {
  const d = toISODate(at);
  const [, m, day] = d.split("-");
  if (d === today) return `Hoje, ${hhmm(at)}`;
  const y = new Date(at.getTime() + 86_400_000);
  if (toISODate(y) === today) return `Ontem, ${hhmm(at)}`;
  return `${day}/${m}, ${hhmm(at)}`;
}

export function fileSize(b: number): string {
  if (b >= 1_000_000) return (b / 1_000_000).toFixed(1).replace(".", ",") + " MB";
  return Math.max(1, Math.round(b / 1000)) + " KB";
}

export function fileExt(name: string): string {
  const e = (name.split(".").pop() || "").toLowerCase().slice(0, 4);
  return e && e !== name.toLowerCase() ? e : "arq";
}

export function firstName(n: string): string {
  return n.trim().split(/\s+/)[0] ?? n;
}
