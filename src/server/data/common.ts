import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DEFAULT_SETTINGS, type Settings } from "@/domain/rules";
import type { HolidaySet } from "@/domain/dates";

export const getSettings = cache(async (): Promise<Settings> => {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "rules"));
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
});

export const getHolidays = cache(async (): Promise<HolidaySet> => {
  const rows = await db.select().from(s.holidays);
  return new Set(rows.map((r) => r.date));
});

export const getEntryTypes = cache(async () => db.select().from(s.entryTypes).orderBy(asc(s.entryTypes.sort), asc(s.entryTypes.name)));

export const getPeople = cache(async () => db.select().from(s.people).where(eq(s.people.active, true)).orderBy(asc(s.people.name)));

export const getClients = cache(async () => db.select().from(s.clients).where(eq(s.clients.active, true)).orderBy(asc(s.clients.name)));

export const getTags = cache(async () => db.select().from(s.tags).orderBy(asc(s.tags.name)));

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : (parts[0]?.[1] ?? ""))).toUpperCase();
}

export const STAGES = [
  { key: "analise", label: "Análise/Aprovação", long: "Projetos em Análise/Aprovação" },
  { key: "estimativa", label: "Estimativa", long: "Avaliação de novos projetos / estimativa de esforço" },
  { key: "alocacao", label: "Alocação", long: "Alocação de recursos" },
  { key: "andamento", label: "Em andamento", long: "Em andamento" },
  { key: "concluido", label: "Concluído", long: "Concluído" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export function stageIndex(k: string): number {
  return STAGES.findIndex((x) => x.key === k);
}
