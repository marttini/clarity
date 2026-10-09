"use client";
import { useMemo, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { formatMinutes, parseDuration } from "@/domain/dates";

/** Opções vindas do servidor (src/server/queries/fila.ts › launcherOptions). Tipos repetidos aqui para não importar código de servidor. */
export type OptClient = { id: string; name: string; color: string; isInternal: boolean };
export type OptAnnual = { id: string; clientId: string; name: string };
export type OptTask = {
  id: string;
  clientId: string;
  annualId: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  kind: "projeto" | "tarefa";
  isSustentacao: boolean;
  disabled: string | null;
  mine: boolean;
};
export type OptType = { id: string; code: string; name: string; acceptsSalesOrder: boolean; isInternal: boolean; isProvisioning: boolean };
export type OptSO = { id: string; clientId: string; label: string };
export type EntryOptions = { clients: OptClient[]; annuals: OptAnnual[]; tasks: OptTask[]; types: OptType[]; salesOrders: OptSO[]; year: number };

export type EntryValues = {
  date: string;
  clientId: string;
  annualId: string;
  itemId: string;
  horas: string;
  description: string;
  typeId: string;
  sust: boolean;
  soId: string;
};

export function emptyValues(date: string, opts: EntryOptions): EntryValues {
  const fat = opts.types.find((t) => t.code === "faturavel") ?? opts.types.find((t) => !t.isProvisioning && !t.isInternal) ?? opts.types[0];
  return { date, clientId: "", annualId: "", itemId: "", horas: "", description: "", typeId: fat?.id ?? "", sust: false, soId: "" };
}

export function taskLabel(t: Pick<OptTask, "name" | "parentName" | "kind">) {
  if (t.parentName) return `${t.parentName} › ${t.name}`;
  return t.kind === "projeto" ? `${t.name} (projeto)` : t.name;
}

/**
 * Regras de mudança de campos (US-02, US-03):
 * - tipo sem pedido de venda remove o pedido, com aviso;
 * - Interno troca o cliente para Síntese; sair do Interno limpa o cliente;
 * - data futura força Provisionamento;
 * - a tarefa traz o marcador de sustentação.
 */
export function applyChange(v: EntryValues, patch: Partial<EntryValues>, opts: EntryOptions, today: string): { values: EntryValues; notice: string | null } {
  let next = { ...v, ...patch };
  let notice: string | null = null;
  const typeOf = (id: string) => opts.types.find((t) => t.id === id);
  const internal = opts.clients.find((c) => c.isInternal);
  if (patch.date !== undefined && patch.date > today) {
    const prov = opts.types.find((t) => t.isProvisioning);
    if (prov && next.typeId !== prov.id) {
      next.typeId = prov.id;
      notice = "Data futura: o tipo vira Provisionamento.";
    }
  }
  if (patch.date !== undefined && patch.date <= today && typeOf(next.typeId)?.isProvisioning && !patch.typeId) {
    const fat = opts.types.find((t) => t.code === "faturavel");
    if (fat) next.typeId = fat.id;
  }
  const type = typeOf(next.typeId);
  if (patch.typeId !== undefined || notice) {
    const prevType = typeOf(v.typeId);
    if (type?.isInternal && internal && next.clientId !== internal.id) {
      next = { ...next, clientId: internal.id, annualId: "", itemId: "", soId: "" };
    } else if (prevType?.isInternal && !type?.isInternal && internal && next.clientId === internal.id) {
      next = { ...next, clientId: "", annualId: "", itemId: "", soId: "" };
    }
    if (next.soId && !type?.acceptsSalesOrder) {
      next.soId = "";
      notice = `Pedido de venda removido: o tipo ${type?.name ?? ""} não aceita pedido.`;
    }
  }
  if (patch.clientId !== undefined && patch.clientId !== v.clientId) {
    const annuals = opts.annuals.filter((a) => a.clientId === patch.clientId);
    next = { ...next, annualId: annuals[0]?.id ?? "", itemId: patch.itemId ?? "", soId: "" };
  }
  if (patch.annualId !== undefined && patch.annualId !== v.annualId && patch.itemId === undefined) next.itemId = "";
  if (patch.itemId !== undefined && patch.itemId !== v.itemId) {
    const t = opts.tasks.find((x) => x.id === patch.itemId);
    if (t) {
      next.annualId = t.annualId;
      next.clientId = t.clientId;
      if (patch.sust === undefined) next.sust = t.isSustentacao;
    }
  }
  return { values: next, notice };
}

function FieldBox({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-xs text-faint">{hint}</span>}
      {error && <span className="text-[13px] font-semibold text-red">{error}</span>}
    </div>
  );
}

/**
 * Campos completos do apontamento (US-01). Controlado: quem usa guarda os valores
 * e os campos escondidos levam tudo ao servidor mesmo com o formulário recolhido.
 */
export function EntryFields({
  idp,
  values,
  onChange,
  opts,
  errors,
  lockDate,
  realTypesOnly,
  hideDate,
}: {
  idp: string;
  values: EntryValues;
  onChange: (patch: Partial<EntryValues>) => void;
  opts: EntryOptions;
  /** Hoje (AAAA-MM-DD), para quem chama aplicar as regras de data. */
  today?: string;
  errors?: Record<string, string>;
  lockDate?: boolean;
  /** Converter provisionamento: só tipos reais. */
  realTypesOnly?: boolean;
  hideDate?: boolean;
}) {
  const type = opts.types.find((t) => t.id === values.typeId);
  const internal = opts.clients.find((c) => c.isInternal);
  const clients = opts.clients.filter((c) => !c.isInternal);
  const annuals = opts.annuals.filter((a) => a.clientId === values.clientId);
  const tasks = useMemo(() => opts.tasks.filter((t) => t.clientId === values.clientId && (!values.annualId || t.annualId === values.annualId)), [opts.tasks, values.clientId, values.annualId]);
  const groups = useMemo(() => {
    const simple = tasks.filter((t) => t.kind === "tarefa" && !t.parentId);
    const projects = tasks.filter((t) => t.kind === "projeto");
    const children = tasks.filter((t) => t.parentId);
    const out: { label: string; items: OptTask[] }[] = [];
    if (simple.length) out.push({ label: "Tarefas simples", items: simple });
    for (const p of projects) out.push({ label: p.name, items: [p, ...children.filter((c) => c.parentId === p.id)] });
    const orphan = children.filter((c) => !projects.some((p) => p.id === c.parentId));
    if (orphan.length) out.push({ label: "Outras", items: orphan });
    return out;
  }, [tasks]);
  const sos = opts.salesOrders.filter((x) => x.clientId === values.clientId);
  const minutes = values.horas ? parseDuration(values.horas) : null;
  const types = opts.types.filter((t) => (realTypesOnly ? !t.isProvisioning : true));
  const e = errors ?? {};
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-3">
        {!hideDate && (
          <FieldBox label="Data" htmlFor={`${idp}-date`} error={e.date} className="min-w-[150px] flex-1">
            <input id={`${idp}-date`} type="date" className="field" value={values.date} onChange={(ev) => onChange({ date: ev.target.value })} disabled={lockDate} required />
          </FieldBox>
        )}
        <FieldBox label="Horas (hh:mm)" htmlFor={`${idp}-h`} error={e.minutes} hint={minutes ? `${formatMinutes(minutes)} h` : values.horas ? "Use 2:30, 2h30 ou 90min" : undefined} className="min-w-[120px] flex-1">
          <input id={`${idp}-h`} inputMode="text" autoComplete="off" className="field num" placeholder="2:30" value={values.horas} onChange={(ev) => onChange({ horas: ev.target.value })} />
        </FieldBox>
      </div>
      <FieldBox label="Tipo" error={e.type}>
        <div className="flex flex-wrap gap-1.5" role="group" id={`${idp}-type`} aria-label="Tipo">
          {types.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={t.id === values.typeId}
              onClick={() => onChange({ typeId: t.id })}
              className="chip min-h-10"
            >
              {t.name}
            </button>
          ))}
        </div>
      </FieldBox>
      {type?.isInternal ? (
        <p className="rounded-[10px] bg-line-2 px-3 py-2.5 text-[13px] text-accent-soft">Interno: vai para o projeto {internal?.name ?? "Síntese"} {opts.year}, sem cliente nem pedido de venda.</p>
      ) : (
        <FieldBox label="Cliente" htmlFor={`${idp}-client`} error={e.client}>
          <select id={`${idp}-client`} className="field" value={values.clientId} onChange={(ev) => onChange({ clientId: ev.target.value })}>
            <option value="">Escolha o cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FieldBox>
      )}
      {values.clientId && (
        <FieldBox label="Projeto anual" htmlFor={`${idp}-annual`} hint={annuals.length ? `Sugerido: projetos de ${opts.year} (Novo modelo).` : undefined} error={!annuals.length ? `Este cliente não tem projeto anual de ${opts.year}. Peça para criar no Odoo.` : undefined}>
          <select id={`${idp}-annual`} className="field" value={values.annualId} onChange={(ev) => onChange({ annualId: ev.target.value })} disabled={annuals.length <= 1}>
            {annuals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </FieldBox>
      )}
      <FieldBox label="Tarefa" htmlFor={`${idp}-task`} error={e.item}>
        <select id={`${idp}-task`} className="field" value={values.itemId} onChange={(ev) => onChange({ itemId: ev.target.value })} disabled={!values.clientId}>
          <option value="">{values.clientId ? "Escolha a tarefa" : "Escolha o cliente primeiro"}</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((t) => (
                <option key={t.id} value={t.id} disabled={!!t.disabled}>
                  {taskLabel(t)}
                  {t.mine ? " · sua" : ""}
                  {t.disabled ? ` (${t.disabled})` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </FieldBox>
      <FieldBox label="Descrição" htmlFor={`${idp}-desc`} error={e.description}>
        <textarea id={`${idp}-desc`} className="field min-h-[72px] py-2.5" placeholder="O que foi feito" value={values.description} onChange={(ev) => onChange({ description: ev.target.value })} maxLength={2000} />
      </FieldBox>
      {!type?.isInternal && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-[15px] font-semibold">
          <input type="checkbox" className="size-5" checked={values.sust} onChange={(ev) => onChange({ sust: ev.target.checked })} />
          Sustentação
          <span className="text-xs font-normal text-faint">sem marcar, conta como desenvolvimento</span>
        </label>
      )}
      {type?.acceptsSalesOrder ? (
        <FieldBox label="Pedido de venda (opcional)" htmlFor={`${idp}-so`} error={e.salesOrder} hint={values.clientId && !sos.length ? "Nenhum pedido deste cliente." : undefined}>
          <select id={`${idp}-so`} className="field" value={values.soId} onChange={(ev) => onChange({ soId: ev.target.value })} disabled={!values.clientId}>
            <option value="">Sem pedido</option>
            {sos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </FieldBox>
      ) : (
        type &&
        !type.isInternal && (
          <p className="rounded-[10px] bg-line-2 px-3 py-2.5 text-[13px] text-accent-soft">
            {type.isProvisioning ? "Provisionamento: não aparece ao cliente nem entra no faturamento." : `${type.name}: pedido de venda bloqueado.`}
          </p>
        )
      )}
      {e.salesOrder && !type?.acceptsSalesOrder && <span className="text-[13px] font-semibold text-red">{e.salesOrder}</span>}
    </div>
  );
}

/** Campos escondidos que levam os valores ao servidor. */
export function EntryHidden({ values }: { values: EntryValues }) {
  return (
    <>
      <input type="hidden" name="date" value={values.date} />
      <input type="hidden" name="itemId" value={values.itemId} />
      <input type="hidden" name="horas" value={values.horas} />
      <input type="hidden" name="description" value={values.description} />
      <input type="hidden" name="typeId" value={values.typeId} />
      <input type="hidden" name="sust" value={values.sust ? "1" : "0"} />
      <input type="hidden" name="soId" value={values.soId} />
    </>
  );
}
