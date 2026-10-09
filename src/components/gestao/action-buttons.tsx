"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/app/(time)/gestao/pendencias/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

function Status({ state }: { state: ActionState }) {
  if (!state) return null;
  return state.error ? (
    <span role="alert" className="text-[13px] font-bold text-red">
      {state.error}
    </span>
  ) : (
    <span role="status" className="text-[13px] font-bold text-green">
      {state.ok}
    </span>
  );
}

/** US-10: Aprovar ou Recusar (recusa pede o motivo, que o consultor recebe). */
export function ApproveRefuse({ id, action }: { id: string; action: Action }) {
  const [state, run, pending] = useActionState(action, null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(false);
  if (state?.ok) return <Status state={state} />;
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (refusing && !reason.trim()) {
          e.preventDefault();
          setErr(true);
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      {!refusing ? (
        <div className="flex flex-wrap gap-2">
          <button name="decisao" value="aprovar" disabled={pending} className="btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12l5 5 9-10" />
            </svg>
            Aprovar
          </button>
          <button type="button" onClick={() => setRefusing(true)} disabled={pending} className="btn-ghost">
            Recusar
          </button>
        </div>
      ) : (
        <>
          <label className="label flex flex-col gap-1.5">
            Por que recusar? O consultor recebe este texto.
            <textarea
              name="motivo"
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErr(false);
              }}
              placeholder="Ex.: a reunião já está lançada em outra entrada."
              className="field py-2 font-normal"
              aria-invalid={err}
            />
          </label>
          {err && (
            <span role="alert" className="text-[13px] font-bold text-red">
              Escreva o motivo para recusar.
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <button name="decisao" value="recusar" disabled={pending} className="btn bg-red-bg text-red hover:bg-[#4a1c1c]">
              Confirmar recusa
            </button>
            <button type="button" onClick={() => setRefusing(false)} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </>
      )}
      <Status state={state} />
    </form>
  );
}

/** Botões simples: cada um envia `decisao` com seu valor. */
export function ActionButtons({
  id,
  action,
  buttons,
  extra,
}: {
  id: string;
  action: Action;
  buttons: { value: string; label: string; primary?: boolean }[];
  extra?: Record<string, string>;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {!state?.ok &&
        buttons.map((b) => (
          <button key={b.value} name="decisao" value={b.value} disabled={pending} className={b.primary ? "btn-primary" : "btn-ghost"}>
            {b.label}
          </button>
        ))}
      <Status state={state} />
    </form>
  );
}
