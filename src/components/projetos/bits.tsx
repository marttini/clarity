import type { ReactNode } from "react";
import { Avatar, cx } from "@/components/ui";
import { diffDays, formatMinutes, shortDate } from "@/domain/dates";

/** Peças visuais dos projetos (V3: Projeto, Escopo e cartões da Fila). */

export const STAGE_LIST = [
  { key: "analise", label: "Análise/Aprovação" },
  { key: "estimativa", label: "Estimativa de esforço" },
  { key: "alocacao", label: "Alocação de recursos" },
  { key: "andamento", label: "Em andamento" },
  { key: "concluido", label: "Concluído" },
] as const;

export function stageLabel(k: string) {
  return STAGE_LIST.find((s) => s.key === k)?.label ?? k;
}

export function stagePos(k: string) {
  return STAGE_LIST.findIndex((s) => s.key === k);
}

/** Cinco segmentos pequenos (cartão da Fila). */
export function StageSegs({ stage }: { stage: string }) {
  const i = stagePos(stage);
  return (
    <span className="inline-flex gap-[3px]" role="img" aria-label={`Etapa: ${stageLabel(stage)}`}>
      {STAGE_LIST.map((s, k) => (
        <span key={s.key} className="h-[5px] w-3 rounded-[3px]" style={{ background: k < i ? "#A897F5" : k === i ? "#F07A45" : "#2A1B37" }} />
      ))}
    </span>
  );
}

/** Barra de 5 etapas com rótulos (cabeçalho do projeto). */
export function StageBar({ stage, draft }: { stage: string; draft?: boolean }) {
  const i = draft ? -1 : stagePos(stage);
  return (
    <ol aria-label={draft ? "Etapa do projeto: rascunho" : `Etapa do projeto: ${stageLabel(stage)}`} className="m-0 grid list-none grid-cols-5 gap-1.5 p-0">
      {STAGE_LIST.map((s, k) => (
        <li key={s.key} aria-current={k === i ? "step" : undefined} className="flex min-w-0 flex-col gap-2">
          <span className="h-1.5 rounded-full" style={{ background: k < i ? "#A897F5" : k === i ? "#F07A45" : "#2A1B37" }} />
          <span className={cx("text-[13px] leading-tight break-words", k === i ? "font-extrabold text-white" : k < i ? "hidden font-medium text-muted sm:block" : "hidden font-medium text-faint sm:block")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function VisibilityBadge({ visible, small }: { visible: boolean; small?: boolean }) {
  return (
    <span
      className={cx("inline-flex items-center rounded-full font-bold whitespace-nowrap", small ? "px-2 py-0.5 text-[11px]" : "px-[11px] py-[5px] text-[13px]", visible ? "bg-green-bg text-green" : "bg-line-2 text-[#e6d9f2]")}
    >
      {visible ? "Visível ao cliente" : "Interno"}
    </span>
  );
}

/** Marcador colorido: fundo escuro com a cor do marcador no texto (contraste AA). */
export function TagChip({ name, color, small }: { name: string; color: string; small?: boolean }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap", small ? "px-2 py-0.5 text-[11px]" : "px-[9px] py-[3px] text-xs")}
      style={{ background: mix(color), color: lighten(color) }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

export function SustBadge({ small }: { small?: boolean }) {
  return <span className={cx("inline-flex items-center rounded-full bg-blue-bg font-bold whitespace-nowrap text-blue", small ? "px-2 py-0.5 text-[11px]" : "px-[9px] py-[3px] text-xs")}>Sustentação</span>;
}

export function ExtraBadge({ approval, small }: { approval: string; small?: boolean }) {
  const cls = small ? "px-2 py-0.5 text-[11px]" : "px-[9px] py-[3px] text-xs";
  if (approval === "aprovada") return <span className={cx("inline-flex rounded-full bg-[#3A1E12] font-bold whitespace-nowrap text-accent-soft", cls)}>Demanda adicional</span>;
  if (approval === "recusada") return <span className={cx("inline-flex rounded-full bg-red-bg font-bold whitespace-nowrap text-red", cls)}>Demanda recusada</span>;
  return <span className={cx("inline-flex rounded-full bg-yellow-bg font-bold whitespace-nowrap text-yellow", cls)}>Demanda aguardando cliente</span>;
}

function hex(c: string) {
  const m = c.replace("#", "");
  const n = m.length === 3 ? m.split("").map((x) => x + x).join("") : m;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
}
/** Fundo: cor do marcador misturada ao fundo da tela. */
function mix(c: string) {
  const [r, g, b] = hex(c);
  const bg = [0x1a, 0x10, 0x24];
  const a = 0.2;
  return `rgb(${Math.round(r * a + bg[0] * (1 - a))}, ${Math.round(g * a + bg[1] * (1 - a))}, ${Math.round(b * a + bg[2] * (1 - a))})`;
}
function lighten(c: string) {
  const [r, g, b] = hex(c);
  const a = 0.45;
  return `rgb(${Math.round(r + (255 - r) * a)}, ${Math.round(g + (255 - g) * a)}, ${Math.round(b + (255 - b) * a)})`;
}

export function ClientTag({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md px-[9px] py-1 text-xs font-extrabold whitespace-nowrap" style={{ background: color, color: "#1A0F22" }}>
      {name}
    </span>
  );
}

const AVATAR_COLORS = ["#A897F5", "#F07A45", "#63BDEB", "#6CCB98", "#EDC75A", "#D98BC9", "#F7B08C", "#9FD3F5"];
export function personColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatars({ people, size = 28, max = 4 }: { people: { id: string; name: string; initials: string }[]; size?: number; max?: number }) {
  if (!people.length) return <span className="text-sm text-faint">sem responsável</span>;
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center" aria-label={`Responsáveis: ${people.map((p) => p.name).join(", ")}`} role="img">
      {shown.map((p, i) => (
        <span key={p.id} className="rounded-full border-2 border-bg" style={{ marginLeft: i ? -8 : 0 }}>
          <Avatar name={p.name} initials={p.initials} size={size} color={personColor(p.id)} />
        </span>
      ))}
      {people.length > max && <span className="ml-1 text-xs text-muted">+{people.length - max}</span>}
    </span>
  );
}

/** Prazo: vermelho se vencido e não concluído (US-17). */
export function Due({ deadline, stage, today, long }: { deadline: string | null; stage: string; today: string; long?: boolean }) {
  if (!deadline) return <span className="text-sm text-faint">sem prazo</span>;
  const d = diffDays(deadline, today);
  const done = stage === "concluido";
  const late = !done && d < 0;
  const soon = !done && d >= 0 && d <= 1;
  const text = done || !long ? shortDate(deadline) : d < -1 ? `venceu há ${-d} dias` : d === -1 ? "venceu ontem" : d === 0 ? "hoje" : d === 1 ? "amanhã" : shortDate(deadline);
  return (
    <span className={cx("font-bold whitespace-nowrap", late ? "text-red" : soon ? "text-yellow" : "text-muted")} title={late ? "Prazo vencido" : undefined}>
      {text}
      {late && !long && <span className="sr-only"> (vencido)</span>}
    </span>
  );
}

export function Hours({ worked, planned }: { worked: number; planned: number | null }) {
  const over = planned != null && planned > 0 && worked > planned;
  return (
    <span className="num whitespace-nowrap text-[13px]">
      <span className={cx("font-bold", over ? "text-red" : "text-white")}>{formatMinutes(worked)}</span>
      <span className="text-faint"> / {planned ? formatMinutes(planned) : "–"}</span>
    </span>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return <span className="text-sm text-faint">sem tarefas</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="flex min-w-[96px] items-center gap-2">
      <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-line-2" aria-hidden>
        <span className="block h-full" style={{ width: `${pct}%`, background: pct === 100 ? "#57C08A" : "#A897F5" }} />
      </span>
      <span className="num text-xs text-muted">{pct}%</span>
    </span>
  );
}

export function Panel({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cx("flex flex-col gap-3 rounded-2xl border border-line bg-surface p-[18px]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id={id} className="m-0 text-[15px] font-bold text-white">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FileKind({ name }: { name: string }) {
  const ext = (name.split(".").pop() ?? "").toUpperCase().slice(0, 4);
  const tone = ext === "PDF" ? "bg-red-bg text-red" : ["XLS", "XLSX", "CSV"].includes(ext) ? "bg-green-bg text-green" : ["PNG", "JPG", "JPEG", "GIF", "WEBP"].includes(ext) ? "bg-blue-bg text-blue" : "bg-line-2 text-[#e6d9f2]";
  return <span className={cx("shrink-0 rounded-md px-[7px] py-[3px] text-[11px] font-extrabold", tone)}>{ext || "ARQ"}</span>;
}

export function relTime(at: Date, now: Date) {
  const min = Math.round((now.getTime() - at.getTime()) / 60000);
  const dateBr = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(at);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(at);
  const todayBr = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(now);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (dateBr === todayBr) return `hoje, ${time}`;
  return `${dateBr}, ${time}`;
}

/** Minutos em texto editável de horas: 1440 → "24", 750 → "12:30". */
export function hoursText(m: number | null) {
  if (!m) return "";
  return m % 60 === 0 ? String(m / 60) : formatMinutes(m);
}
