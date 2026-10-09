import Link from "next/link";
import type { ReactNode } from "react";
import { dayColor } from "@/domain/rules";
import { formatMinutes, shortDate } from "@/domain/dates";
import { Arrow, Avatar, cx } from "@/components/ui";
import { STAGES } from "@/server/data/common";
import type { TimelineEvent } from "@/server/queries/clients";
import { contactTypeLabel } from "@/components/contatos/labels";

export type ApontRow = { id: string; person: string; color: string; initials: string; item: string; parent: string | null; itemId: string; type: string; typeCode: string; sust: boolean; minutes: number };
export type Day = { date: string; label: string; minutes: number; entries: ApontRow[]; events: (TimelineEvent & { time: string })[] };

const DAY_DOT = { vermelho: "#E0453A", amarelo: "#E9B320", azul: "#3B86C9", verde: "#3FA06C" } as const;
const ICON: Record<string, [string, string]> = {
  apont: ["#2A1B37", "#EDE6F3"],
  tarefa: ["#15301F", "#8FD3AE"],
  coment: ["#10283A", "#9FD3F5"],
  contato: ["#3A1E12", "#F7B08C"],
  etapa: ["#2A1B37", "#C9BCF7"],
  anexo: ["#2A1B37", "#B6A7C6"],
  demanda: ["#3A2E12", "#F2D27A"],
  prazo: ["#3A1515", "#FF8A80"],
};

function Icon({ kind }: { kind: string }) {
  const [bg, fg] = ICON[kind] ?? ICON.apont;
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const svg: Record<string, ReactNode> = {
    apont: (
      <svg {...p}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    ),
    tarefa: (
      <svg {...p} strokeWidth={2.6}>
        <path d="M5 12l5 5 9-10" />
      </svg>
    ),
    coment: (
      <svg {...p}>
        <path d="M5 5h14v10H10l-5 4z" />
      </svg>
    ),
    contato: (
      <svg {...p}>
        <path d="M6 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 2-2z" />
      </svg>
    ),
    etapa: (
      <svg {...p}>
        <path d="M5 21V4h11l-2 4 2 4H5" />
      </svg>
    ),
    anexo: (
      <svg {...p}>
        <path d="M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7" />
      </svg>
    ),
    demanda: (
      <svg {...p} strokeWidth={2.4}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
    prazo: (
      <svg {...p}>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </svg>
    ),
  };
  return (
    <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px]" style={{ background: bg, color: fg }}>
      {svg[kind]}
    </span>
  );
}

function typePill(code: string) {
  return code === "faturavel" ? "bg-[#3A1E12] text-accent-soft" : code === "bonificado" ? "bg-[#241A3F] text-[#C9BCF7]" : "bg-line-2 text-muted";
}

const stageLabel = (k: string | null) => STAGES.find((s) => s.key === k)?.label ?? "início";

function EventRow({ e }: { e: TimelineEvent & { time: string } }) {
  let title: ReactNode = null;
  let meta: ReactNode = null;
  let body: ReactNode = null;
  let flag: ReactNode = null;
  switch (e.kind) {
    case "tarefa":
      title = (
        <>
          Tarefa concluída:{" "}
          <Link href={`/projetos/${e.itemId}`} className="text-white! no-underline hover:underline">
            {e.title}
          </Link>
        </>
      );
      meta = [e.parent, e.who].filter(Boolean).join(" · ");
      break;
    case "coment":
      title = `${e.who} comentou`;
      meta = (
        <Link href={`/projetos/${e.itemId}`} className="text-faint!">
          {e.itemName}
        </Link>
      );
      body = <p className="rounded-[4px_12px_12px_12px] bg-blue-bg px-3 py-2 text-sm leading-snug text-[#DCEBF6]">{e.text}</p>;
      if (e.open) flag = <span className="rounded-full bg-red-bg px-2.5 py-0.5 text-xs font-bold text-red">sem resposta</span>;
      break;
    case "contato":
      title = `${contactTypeLabel(e.type)}${e.with ? ` com ${e.with}` : ""}`;
      meta = `por ${e.by}`;
      if (e.status === "nao_atendeu") flag = <span className="rounded-full bg-red-bg px-2.5 py-0.5 text-xs font-bold text-red">não atendeu</span>;
      body = (e.text || e.next) && (
        <p className="text-sm leading-snug text-muted">
          {e.text}
          {e.next && <span className="block text-faint">Próximo passo: {e.next}</span>}
        </p>
      );
      break;
    case "etapa":
      title = (
        <Link href={`/projetos/${e.itemId}`} className="text-white! no-underline hover:underline">
          {e.itemName}
        </Link>
      );
      meta = `mudou de ${stageLabel(e.from)} para ${stageLabel(e.to)}${e.who ? ` · ${e.who}` : ""}`;
      break;
    case "anexo":
      title = e.file;
      meta = `anexado${e.who ? ` por ${e.who}` : ""}${e.itemName ? ` · ${e.itemName}` : ""}`;
      break;
    case "demanda":
      title = (
        <>
          Demanda adicional criada:{" "}
          <Link href={`/projetos/${e.itemId}`} className="text-white! no-underline hover:underline">
            {e.title}
          </Link>
        </>
      );
      meta = `${e.minutes ? `${formatMinutes(e.minutes)} h estimadas · ` : ""}${e.approval === "aguardando" ? "aguardando o cliente aprovar" : e.approval === "aprovada" ? "aprovada pelo cliente" : e.approval === "recusada" ? "recusada pelo cliente" : ""}`;
      break;
    case "prazo":
      title = (
        <>
          Prazo reprogramado:{" "}
          <Link href={`/projetos/${e.itemId}`} className="text-white! no-underline hover:underline">
            {e.itemName}
          </Link>
        </>
      );
      meta = (
        <span className="inline-flex items-center gap-1">
          {e.from ? shortDate(e.from) : "sem prazo"} <Arrow dir="right" /> {shortDate(e.to)} · {e.who ?? "Odoo"}
        </span>
      );
      body = <p className="text-sm text-muted">Motivo: {e.reason}</p>;
      break;
  }
  return (
    <div className="flex gap-3 py-2 pl-1">
      <Icon kind={e.kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <strong className="text-sm text-white">{title}</strong>
          {meta && <span className="text-[13px] text-faint">{meta}</span>}
          {flag}
        </div>
        {body}
      </div>
      <span className="num shrink-0 pt-0.5 text-xs text-faint">{e.time}</span>
    </div>
  );
}

export function TimelineDays({ days, showEntries }: { days: Day[]; showEntries: boolean }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {days.map((d) => {
        const color = DAY_DOT[dayColor(d.minutes)];
        return (
          <li key={d.date} className="flex flex-col gap-1 border-t border-line pt-2.5">
            <div className="flex flex-wrap items-center gap-2.5 pb-1">
              <span role="img" aria-label={`${formatMinutes(d.minutes)} horas no dia`} className="size-3 shrink-0 rounded-full" style={{ background: color }} />
              <h3 className="h3">{d.label}</h3>
              <span className="num text-[13px] text-muted">{formatMinutes(d.minutes)} h apontadas</span>
            </div>
            {showEntries && d.entries.length > 0 && (
              <div className="flex gap-3 py-2 pl-1">
                <Icon kind="apont" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <strong className="text-sm text-white">Apontamentos</strong>
                    <span className="text-[13px] text-faint">
                      {d.entries.length} {d.entries.length === 1 ? "lançamento" : "lançamentos"} · {formatMinutes(d.entries.reduce((a, b) => a + b.minutes, 0))} h
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {d.entries.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-1 text-[13px]">
                        <Avatar name={r.person} initials={r.initials} size={24} color={r.color} />
                        <span className="min-w-0 flex-[1_1_220px] text-ink">
                          <Link href={`/projetos/${r.itemId}`} className="text-ink! no-underline hover:underline">
                            {r.item}
                          </Link>
                          {r.parent && <span className="text-faint"> · {r.parent}</span>}
                        </span>
                        <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", typePill(r.typeCode))}>{r.type}</span>
                        {r.sust && <span className="rounded-full bg-blue-bg px-2 py-0.5 text-[11px] font-bold text-blue">Sustentação</span>}
                        <span className="num min-w-[46px] text-right font-bold text-white">{formatMinutes(r.minutes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {d.events.map((e, i) => (
              <EventRow key={`${e.kind}-${i}`} e={e} />
            ))}
          </li>
        );
      })}
    </ol>
  );
}
