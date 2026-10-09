/**
 * Lançamento rápido em linguagem natural (Minha fila).
 * Ex.: "2h30 kari broker erro na importação sust" →
 *   cliente Kari-Kari, tarefa "Broker › Erro na importação", 2:30, Faturável, Sustentação.
 * A pessoa sempre confere e pode trocar qualquer campo antes de salvar.
 */
import { parseDuration } from "./dates";

export type QuickClient = { id: string; name: string; isInternal?: boolean };
export type QuickTask = { id: string; clientId: string; name: string; parentName?: string | null; isSustentacao?: boolean };
export type QuickType = { id: string; code: string; name: string };

export type QuickResult = {
  minutes: number | null;
  client: QuickClient | null;
  task: QuickTask | null;
  typeCode: string;
  sustentacao: boolean | null;
  description: string;
  missing: string | null;
};

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9: ]+/g, " ");

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "na", "no", "para", "com", "por", "ltda", "sa", "s", "me"]);

function tokens(s: string): string[] {
  return strip(s)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const DURATION_RE = /(\d{1,2}:\d{2}|\d+\s*h\s*\d{0,2}(?:\s*min)?|\d+\s*min|\d+[.,]\d+\s*h?)/i;

const TYPE_WORDS: { code: string; words: string[] }[] = [
  { code: "provisionamento", words: ["prov", "provisionar", "provisionamento", "provisionado"] },
  { code: "bonificado", words: ["bonif", "bonificado", "bonificada", "cortesia"] },
  { code: "interno", words: ["interno", "interna"] },
  { code: "faturavel", words: ["fat", "faturavel", "cobrado"] },
];

export function parseQuickEntry(
  text: string,
  ctx: { clients: QuickClient[]; tasks: QuickTask[]; forceProvisioning?: boolean },
): QuickResult {
  const raw = text.trim();
  let rest = raw;

  // Horas
  let minutes: number | null = null;
  const dm = rest.match(DURATION_RE);
  if (dm) {
    minutes = parseDuration(dm[1].replace(/\s+/g, ""));
    rest = rest.replace(dm[0], " ");
  }

  const toks = tokens(rest);
  const used = new Set<string>();

  // Tipo
  let typeCode = "faturavel";
  for (const tw of TYPE_WORDS) {
    const hit = toks.find((t) => tw.words.some((w) => t === w || (w.length >= 4 && t.startsWith(w))));
    if (hit) {
      typeCode = tw.code;
      used.add(hit);
      break;
    }
  }
  if (ctx.forceProvisioning) typeCode = "provisionamento";

  // Sustentação
  let sustentacao: boolean | null = null;
  const sust = toks.find((t) => t.startsWith("sust"));
  if (sust) {
    sustentacao = true;
    used.add(sust);
  }

  // Cliente: maior sobreposição de palavras do nome (ou prefixo de 4+ letras)
  let client: QuickClient | null = null;
  if (typeCode === "interno") {
    client = ctx.clients.find((c) => c.isInternal) ?? null;
  } else {
    let best = 0;
    let bestHits: string[] = [];
    for (const c of ctx.clients) {
      if (c.isInternal) continue;
      const ct = tokens(c.name);
      let score = 0;
      const hits: string[] = [];
      for (const t of toks) {
        if (used.has(t)) continue;
        if (ct.some((w) => w === t || (t.length >= 4 && w.startsWith(t)) || (w.length >= 4 && t.startsWith(w)))) {
          score += t.length;
          hits.push(t);
        }
      }
      if (score > best) {
        best = score;
        client = c;
        bestHits = hits;
      }
    }
    bestHits.forEach((h) => used.add(h));
  }

  // Tarefa do cliente escolhido: maior sobreposição com nome da tarefa e do projeto
  let task: QuickTask | null = null;
  if (client) {
    const candidates = ctx.tasks.filter((t) => t.clientId === client!.id);
    let best = 0;
    for (const t of candidates) {
      const tt = new Set([...tokens(t.name), ...tokens(t.parentName ?? "")]);
      let score = 0;
      for (const w of toks) {
        if (used.has(w)) continue;
        if ([...tt].some((x) => x === w || (w.length >= 4 && x.startsWith(w)))) score += w.length;
      }
      if (score > best) {
        best = score;
        task = t;
      }
    }
    if (!task && candidates.length === 1) task = candidates[0];
  }
  if (task && sustentacao === null && task.isSustentacao) sustentacao = true;

  // Descrição: o texto sem as horas e sem as palavras de tipo/sustentação
  const description = rest
    .split(/\s+/)
    .filter((w) => {
      const n = strip(w).trim();
      return n && !TYPE_WORDS.some((tw) => tw.words.includes(n)) && !n.startsWith("sust");
    })
    .join(" ")
    .trim();

  const missing = !client ? "Falta o cliente." : !task ? "Falta a tarefa: escreva uma palavra dela." : !minutes ? "Falta a quantidade de horas." : null;

  return { minutes, client, task, typeCode, sustentacao, description, missing };
}
