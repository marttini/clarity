import Link from "next/link";
import { requireClient } from "@/server/session";
import { formatMinutes } from "@/domain/dates";
import { listDemands } from "@/server/services/portal";
import { cx } from "@/components/ui";
import { DemandActions } from "@/components/portal/forms";
import { dateTime, fullDate } from "@/components/portal/format";
import { approveDemandAction, refuseDemandAction } from "../actions";

export const metadata = { title: "Demandas adicionais · Portal Síntese" };

const FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "aguardando", label: "Aguardando você" },
  { key: "aprovadas", label: "Aprovadas" },
  { key: "recusadas", label: "Recusadas" },
] as const;

const BADGE = {
  aguardando: { label: "Aguarda sua aprovação", cls: "bg-[#3A1E12] text-accent-soft" },
  aprovada: { label: "Aprovada", cls: "bg-green-bg text-green" },
  recusada: { label: "Recusada", cls: "bg-line-2 text-[#e6d9f2]" },
} as const;

/** US-25 e US-27: o cliente acompanha e decide as demandas fora do escopo. */
export default async function Demandas({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const me = await requireClient();
  const { filtro } = await searchParams;
  const f = FILTERS.find((x) => x.key === filtro)?.key ?? "todas";
  const all = await listDemands(me);
  const list = all.filter(
    (d) => f === "todas" || (f === "aguardando" && d.status === "aguardando") || (f === "aprovadas" && d.status === "aprovada") || (f === "recusadas" && d.status === "recusada"),
  );

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="h1">Demandas adicionais</h1>
        <p className="max-w-[70ch] text-base leading-normal text-muted">Pedidos que não estavam no escopo combinado. Cada um precisa da sua aprovação antes de começar.</p>
      </div>
      <div className="flex items-center gap-3 rounded-[14px] border border-line-4 bg-surface-3 px-[18px] py-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F7B08C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <strong className="text-base text-white">As horas só começam depois da sua aprovação.</strong>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar demandas">
        {FILTERS.map((x) => (
          <Link key={x.key} href={x.key === "todas" ? "/portal/demandas" : `/portal/demandas?filtro=${x.key}`} aria-pressed={f === x.key} scroll={false} className="chip min-h-10 aria-pressed:!text-on-accent px-3.5 text-sm no-underline">
            {x.label}
            {x.key === "aguardando" && all.some((d) => d.status === "aguardando") ? ` (${all.filter((d) => d.status === "aguardando").length})` : ""}
          </Link>
        ))}
      </div>

      {list.map((d) => (
        <article key={d.id} className="card flex flex-col gap-4 p-[22px]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
              {d.project && <span className="text-[13px] text-faint">{d.project}</span>}
              <h2 className="text-[19px] leading-snug font-bold text-white">{d.name}</h2>
              {d.description && <p className="max-w-[72ch] text-[15px] leading-relaxed whitespace-pre-line text-ink">{d.description}</p>}
            </div>
            <span className={cx("shrink-0 rounded-full px-[11px] py-1 text-[13px] font-bold whitespace-nowrap", BADGE[d.status].cls)}>{BADGE[d.status].label}</span>
          </div>
          <dl className="m-0 flex flex-wrap gap-x-9 gap-y-3.5">
            {d.estimateMinutes ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-[13px] text-faint">Horas estimadas</dt>
                <dd className="num m-0 text-lg font-bold text-white">{formatMinutes(d.estimateMinutes)}</dd>
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              <dt className="text-[13px] text-faint">Quem pediu</dt>
              <dd className="m-0 text-[15px] font-semibold text-white">{d.requestedBy ? `${d.requestedBy}${d.requestedById === me.id ? " (você)" : ` (${me.clientName})`}` : "Não informado"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[13px] text-faint">Pedido em</dt>
              <dd className="num m-0 text-[15px] font-semibold text-white">{fullDate(d.requestedAt)}</dd>
            </div>
            {d.status === "aprovada" && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-[13px] text-faint">Horas trabalhadas</dt>
                <dd className="num m-0 text-[15px] font-semibold text-white">{formatMinutes(d.workedMinutes)}</dd>
              </div>
            )}
          </dl>
          {d.status === "aguardando" && <DemandActions itemId={d.id} approve={approveDemandAction} refuse={refuseDemandAction} />}
          {d.status !== "aguardando" && d.decidedAt && (
            <div role="status" className={cx("flex flex-col gap-0.5 rounded-xl px-3.5 py-3 text-sm", d.status === "aprovada" ? "bg-green-bg text-green" : "border border-line-3 bg-surface-3 text-[#e6d9f2]")}>
              <span className="font-bold">
                {d.status === "aprovada" ? "Aprovada" : "Recusada"} por {d.decidedBy ?? "a equipe"} em {dateTime(d.decidedAt)}
              </span>
              {d.status === "recusada" && d.reason && <span className="font-medium">Motivo: {d.reason}</span>}
              {d.status === "aprovada" && d.stage === "concluido" && <span className="font-medium">Concluída.</span>}
            </div>
          )}
        </article>
      ))}
      {!list.length && (
        <p className="card p-7 text-center text-[15px] text-green">{f === "todas" ? "Nenhuma demanda adicional por enquanto." : f === "aguardando" ? "Nenhuma demanda aguardando você." : "Nenhuma demanda neste filtro."}</p>
      )}
    </div>
  );
}
