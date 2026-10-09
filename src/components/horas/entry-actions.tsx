"use client";
import { useActionState, useState, type ReactNode } from "react";
import { convertAction, deleteEntryAction, editEntryAction, justifyAction, requestChangeAction } from "@/app/(time)/horas/actions";
import type { EntryState } from "@/app/(time)/horas/_form";
import { cx } from "@/components/ui";
import { formatMinutes, shortDate } from "@/domain/dates";
import { applyChange, EntryFields, EntryHidden, type EntryOptions, type EntryValues } from "./entry-fields";

/** Apontamento como chega à tela (sem objetos Date). */
export type EntryLite = {
  id: string;
  date: string;
  minutes: number;
  description: string;
  itemId: string;
  clientId: string;
  typeId: string;
  sust: boolean;
  soId: string | null;
  isProvisioning: boolean;
};

export function valuesOf(e: EntryLite, opts: EntryOptions): EntryValues {
  const t = opts.tasks.find((x) => x.id === e.itemId);
  return {
    date: e.date,
    clientId: e.clientId,
    annualId: t?.annualId ?? "",
    itemId: e.itemId,
    horas: formatMinutes(e.minutes),
    description: e.description,
    typeId: e.typeId,
    sust: e.sust,
    soId: e.soId ?? "",
  };
}

function Flash({ state }: { state: EntryState }) {
  if (!state) return null;
  return (
    <div role="status" className={cx("rounded-xl px-3.5 py-3 text-sm font-semibold", state.ok ? "bg-green-bg text-green" : "bg-red-bg text-red")}>
      {state.message}
    </div>
  );
}

type Mode = null | "editar" | "excluir" | "pedido" | "converter";

/**
 * Ações de uma linha (US-04, US-09, US-12):
 * dentro de 48 h, Editar e Excluir (com confirmação); depois, Solicitar alteração;
 * provisionamento cuja data chegou, Converter.
 */
export function EntryActions({
  entry,
  opts,
  today,
  editable,
  pendingChange,
  canConvert,
}: {
  entry: EntryLite;
  opts: EntryOptions;
  today: string;
  editable: boolean;
  pendingChange: boolean;
  canConvert: boolean;
}) {
  const [mode, setMode] = useState<Mode>(null);
  if (pendingChange) return <span className="rounded-full bg-yellow-bg px-2.5 py-1 text-xs font-bold whitespace-nowrap text-yellow">Alteração pendente</span>;
  const btn = (m: Exclude<Mode, null>, label: string, strong?: boolean) => (
    <button
      type="button"
      aria-expanded={mode === m}
      onClick={() => setMode(mode === m ? null : m)}
      className={cx(
        "min-h-10 rounded-[10px] px-3 text-[13px] font-bold whitespace-nowrap",
        strong ? "bg-accent text-on-accent hover:bg-[#f48b5c]" : "border border-line-5 text-[#e6d9f2] hover:bg-line",
        mode === m && !strong && "bg-line-2 text-white",
      )}
    >
      {mode === m ? "Fechar" : label}
    </button>
  );
  return (
    <div className="flex w-full flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        {canConvert && editable && btn("converter", "Converter", true)}
        {editable ? (
          <>
            {btn("editar", "Editar")}
            {btn("excluir", "Excluir")}
          </>
        ) : (
          btn("pedido", "Solicitar alteração")
        )}
      </div>
      {mode === "editar" && <EditForm entry={entry} opts={opts} today={today} onDone={() => setMode(null)} />}
      {mode === "converter" && <ConvertForm entry={entry} opts={opts} today={today} />}
      {mode === "excluir" && <DeleteConfirm entry={entry} onCancel={() => setMode(null)} />}
      {mode === "pedido" && <RequestForm entry={entry} opts={opts} today={today} />}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="flex w-full max-w-[560px] flex-col gap-3.5 self-stretch rounded-[14px] border border-line-4 bg-surface-3 p-4 text-left sm:self-end">{children}</div>;
}

function EditForm({ entry, opts, today, onDone }: { entry: EntryLite; opts: EntryOptions; today: string; onDone: () => void }) {
  const [values, setValues] = useState(() => valuesOf(entry, opts));
  const [notice, setNotice] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (p: EntryState, f: FormData) => {
    const r = await editEntryAction(p, f);
    if (r?.ok) onDone();
    return r;
  }, null);
  return (
    <Panel>
      <form action={action} className="flex flex-col gap-3.5">
        <input type="hidden" name="id" value={entry.id} />
        <EntryHidden values={values} />
        <EntryFields
          idp={`ed-${entry.id.slice(0, 6)}`}
          values={values}
          onChange={(p) => {
            const r = applyChange(values, p, opts, today);
            setValues(r.values);
            if (r.notice) setNotice(r.notice);
          }}
          opts={opts}
          today={today}
          errors={state && !state.ok ? state.fields : undefined}
        />
        {notice && <span className="text-[13px] font-semibold text-accent-soft">{notice}</span>}
        <button className="btn-primary self-start" disabled={pending}>
          {pending ? "Salvando..." : "Salvar alteração"}
        </button>
        <Flash state={state} />
      </form>
    </Panel>
  );
}

/** US-12: converter provisionamento (tipo real, revisando horas e descrição; mantém a data). */
export function ConvertForm({ entry, opts, today }: { entry: EntryLite; opts: EntryOptions; today: string }) {
  const fat = opts.types.find((t) => t.code === "faturavel");
  const [values, setValues] = useState(() => applyChange(valuesOf(entry, opts), { typeId: fat?.id ?? entry.typeId }, opts, today).values);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, action, pending] = useActionState(convertAction, null);
  if (state?.ok) return <Flash state={state} />;
  return (
    <Panel>
      <form action={action} className="flex flex-col gap-3.5">
        <input type="hidden" name="id" value={entry.id} />
        <EntryHidden values={values} />
        <p className="text-sm text-muted">
          Provisionado em <strong className="text-white">{shortDate(entry.date)}</strong>: escolha o tipo real e revise horas e descrição.
        </p>
        <EntryFields
          idp={`cv-${entry.id.slice(0, 6)}`}
          values={values}
          onChange={(p) => {
            const r = applyChange(values, p, opts, today);
            setValues(r.values);
            if (r.notice) setNotice(r.notice);
          }}
          opts={opts}
          today={today}
          errors={state && !state.ok ? state.fields : undefined}
          lockDate
          realTypesOnly
        />
        {notice && <span className="text-[13px] font-semibold text-accent-soft">{notice}</span>}
        <button className="btn-primary self-start" disabled={pending}>
          {pending ? "Convertendo..." : "Converter em hora real"}
        </button>
        <Flash state={state} />
      </form>
    </Panel>
  );
}

function DeleteConfirm({ entry, onCancel }: { entry: EntryLite; onCancel: () => void }) {
  const [state, action, pending] = useActionState(deleteEntryAction, null);
  return (
    <Panel>
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={entry.id} />
        <p className="text-[15px] text-white">
          Excluir {formatMinutes(entry.minutes)} h de {shortDate(entry.date)}? A exclusão também vai para o Odoo.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn min-h-11 bg-day-red font-extrabold text-on-accent" disabled={pending}>
            {pending ? "Excluindo..." : "Sim, excluir"}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Manter
          </button>
        </div>
        <Flash state={state} />
      </form>
    </Panel>
  );
}

/** US-09: novos valores ou exclusão, com justificativa obrigatória. */
function RequestForm({ entry, opts, today }: { entry: EntryLite; opts: EntryOptions; today: string }) {
  const [kind, setKind] = useState<"alterar" | "excluir">("alterar");
  const [values, setValues] = useState(() => valuesOf(entry, opts));
  const [notice, setNotice] = useState<string | null>(null);
  const [state, action, pending] = useActionState(requestChangeAction, null);
  if (state?.ok) return <Flash state={state} />;
  const e = state && !state.ok ? state.fields : undefined;
  return (
    <Panel>
      <form action={action} className="flex flex-col gap-3.5">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="kind" value={kind} />
        <p className="text-sm text-muted">Passaram 48 horas do lançamento. O pedido vai para Marttini ou Richard; o apontamento original vale até a decisão.</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="O que pedir">
          {(
            [
              ["alterar", "Alterar valores"],
              ["excluir", "Excluir"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className="chip min-h-10">
              {l}
            </button>
          ))}
        </div>
        {kind === "alterar" && (
          <>
            <EntryHidden values={values} />
            <EntryFields
              idp={`rq-${entry.id.slice(0, 6)}`}
              values={values}
              onChange={(p) => {
                const r = applyChange(values, p, opts, today);
                setValues(r.values);
                if (r.notice) setNotice(r.notice);
              }}
              opts={opts}
              today={today}
              errors={e}
            />
            {notice && <span className="text-[13px] font-semibold text-accent-soft">{notice}</span>}
          </>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="label">Justificativa</span>
          <textarea name="justification" className="field min-h-[72px] py-2.5" placeholder="Ex.: lancei 1 hora a mais por engano" maxLength={1000} />
          {e?.justification && <span className="text-[13px] font-semibold text-red">{e.justification}</span>}
        </label>
        <button className="btn-primary self-start" disabled={pending}>
          {pending ? "Enviando..." : kind === "excluir" ? "Pedir exclusão" : "Pedir alteração"}
        </button>
        <Flash state={state} />
      </form>
    </Panel>
  );
}

/** US-11: justificar dia útil sem apontamento (motivo + comprovante obrigatório). */
export function JustifyForm({ days, reasons, defaultDate, compact }: { days: string[]; reasons: { id: string; name: string }[]; defaultDate?: string; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const [state, action, pending] = useActionState(justifyAction, null);
  const e = state && !state.ok ? state.fields : undefined;
  if (state?.ok) return <Flash state={state} />;
  const form = (
    <form action={action} className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
          <span className="label">Dia</span>
          {days.length ? (
            <select name="date" className="field" defaultValue={defaultDate ?? days[0]}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {shortDate(d)}
                </option>
              ))}
            </select>
          ) : (
            <input name="date" type="date" className="field" defaultValue={defaultDate} />
          )}
          {e?.date && <span className="text-[13px] font-semibold text-red">{e.date}</span>}
        </label>
        <label className="flex min-w-[170px] flex-1 flex-col gap-1.5">
          <span className="label">Motivo</span>
          <select name="reasonId" className="field" defaultValue="">
            <option value="" disabled>
              Escolha o motivo
            </option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {e?.reason && <span className="text-[13px] font-semibold text-red">{e.reason}</span>}
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">Comprovante (obrigatório)</span>
        <input name="file" type="file" className="field py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-line-2 file:px-3 file:py-1.5 file:font-semibold file:text-ink" />
        {e?.file ? <span className="text-[13px] font-semibold text-red">{e.file}</span> : <span className="text-xs text-faint">Print da conversa com o gestor, atestado... Só você e a gestão veem.</span>}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Observação (opcional)</span>
        <input name="note" className="field" maxLength={300} />
      </label>
      <button className="btn-primary self-start" disabled={pending}>
        {pending ? "Enviando..." : "Justificar dia"}
      </button>
      <Flash state={state} />
    </form>
  );
  if (!compact) return form;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-[42px] cursor-pointer self-start rounded-[10px] border border-[#7A3A33] bg-transparent px-3.5 font-semibold text-[#FFC9C3] hover:bg-[#3a1a1c]"
      >
        {open ? "Fechar" : "Justificar ausência"}
      </button>
      {open && <div className="rounded-[14px] border border-line-4 bg-surface-3 p-4">{form}</div>}
    </div>
  );
}

/** Cartão "Provisionamento a converter" da fila: texto à esquerda, botão à direita e o formulário embaixo, na largura toda. */
export function ConvertCard({ entry, opts, today, children }: { entry: EntryLite; opts: EntryOptions; today: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border-[1.5px] border-dashed border-accent bg-[#1C1018] px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="flex flex-[1_1_280px] flex-col gap-1">{children}</div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cx("min-h-[42px] rounded-[10px] px-4 font-extrabold", open ? "border border-line-5 bg-line-2 text-white" : "bg-accent text-on-accent hover:bg-[#f48b5c]")}
        >
          {open ? "Fechar" : "Converter em hora real"}
        </button>
      </div>
      {open && (
        <div className="[&>div]:max-w-none">
          <ConvertForm entry={entry} opts={opts} today={today} />
        </div>
      )}
    </section>
  );
}
