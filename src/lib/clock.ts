import { toISODate, type ISODate } from "@/domain/dates";

/**
 * Relógio do sistema. Em testes e demonstrações, CLARITY_NOW fixa o "agora"
 * (ex.: 2026-10-08T13:00:00-03:00) para os números serem reproduzíveis.
 */
export function now(): Date {
  const fixed = process.env.CLARITY_NOW;
  return fixed ? new Date(fixed) : new Date();
}

export function today(): ISODate {
  return toISODate(now());
}
