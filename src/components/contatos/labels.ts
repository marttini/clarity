/** Rótulos e cores compartilhados por Clientes e Contatos (sem dependência de servidor). */

export const CONTACT_TYPES = [
  { value: "ligacao", label: "Ligação" },
  { value: "visita", label: "Visita presencial" },
  { value: "reuniao_online", label: "Reunião online" },
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number]["value"];
export type ContactStatus = "agendado" | "realizado" | "nao_atendeu" | "remarcado" | "cancelado";

export function contactTypeLabel(t: string): string {
  return CONTACT_TYPES.find((x) => x.value === t)?.label ?? t;
}

export const CONTACT_STATUS: Record<ContactStatus, { label: string; tone: "green" | "blue" | "red" | "yellow" | "neutral" }> = {
  agendado: { label: "Agendado", tone: "blue" },
  realizado: { label: "Realizado", tone: "green" },
  nao_atendeu: { label: "Não atendeu", tone: "red" },
  remarcado: { label: "Remarcado", tone: "yellow" },
  cancelado: { label: "Cancelado", tone: "neutral" },
};

export const HEALTH = {
  vermelho: { label: "Vermelho", zone: "Agir agora", dot: "#E0453A", bg: "#3A1515", fg: "#FF8A80" },
  amarelo: { label: "Amarelo", zone: "Atenção", dot: "#E9B320", bg: "#3A2E12", fg: "#F2D27A" },
  verde: { label: "Verde", zone: "Em dia", dot: "#3FA06C", bg: "#15301F", fg: "#8FD3AE" },
} as const;

/** Cor de cada tipo de apontamento nas barras (por código; outros tipos caem na paleta). */
const TYPE_COLORS: Record<string, string> = { faturavel: "#F07A45", bonificado: "#A897F5", interno: "#9C93AE" };
const EXTRA = ["#EDC75A", "#6CCB98", "#D98BC9", "#7FB7A4"];
export function entryTypeColor(code: string, i = 0): string {
  return TYPE_COLORS[code] ?? EXTRA[i % EXTRA.length];
}
export const SUST_COLOR = "#63BDEB";

/** "2 dias úteis", "hoje", "ontem", "nunca". */
export function sinceLabel(workdays: number | null): string {
  if (workdays === null) return "nunca";
  if (workdays === 0) return "hoje";
  if (workdays === 1) return "ontem";
  return `${workdays} dias úteis`;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

const PEOPLE_PALETTE = ["#63BDEB", "#A897F5", "#6CCB98", "#D98BC9", "#EDC75A", "#F07A45", "#F7B08C", "#9FD3F5"];
/** Cor estável por pessoa (avatares). */
export function personColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PEOPLE_PALETTE[h % PEOPLE_PALETTE.length];
}
