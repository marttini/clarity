"use client";
import { useActionState, useId, useState } from "react";
import { cx } from "@/components/ui";
import type { ActionState } from "@/app/(time)/projetos/actions";
import { FormError, keep, useAct } from "./client";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

export type DelivDraft = { id?: string | null; title: string; description: string; hours: string; person: string };

function toMin(h: string): number {
  const s = h.trim().replace(",", ".");
  if (!s) return 0;
  const m = s.match(/^(\d{1,4}):([0-5]\d)$/);
  if (m) return +m[1] * 60 + +m[2];
  const n = Number(s.replace(/h$/i, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
}
function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, "0")} h` : `${h} h`;
}

/**
 * US-22 (rascunho) e US-26 (nova versão): objetivo, entregáveis numerados com horas e responsável
 * sugerido, o que não está incluso e premissas. Total recalculado na hora.
 */
export function ScopeEditor({
  action,
  id,
  people,
  initial,
  mode,
  extras = [],
}: {
  action: Action;
  id: string;
  people: { id: string; name: string }[];
  initial: { objective: string; assumptions: string; exclusions: string[]; deliverables: DelivDraft[] };
  mode: "rascunho" | "nova_versao";
  extras?: { id: string; name: string }[];
}) {
  const [dirty, setDirty] = useState(false);
  const [state, formAction, pending] = useAct(action, () => setDirty(false));
  const [objective, setObjective] = useState(initial.objective);
  const [assumptions, setAssumptions] = useState(initial.assumptions);
  const [exclusions, setExclusions] = useState(initial.exclusions);
  const [outDraft, setOutDraft] = useState("");
  const [ds, setDs] = useState<(DelivDraft & { key: number })[]>(initial.deliverables.map((d, i) => ({ ...d, key: i })));
  const [nextKey, setNextKey] = useState(initial.deliverables.length);
  const [incorp, setIncorp] = useState<Record<string, string>>({});
  const uid = useId();
  const total = ds.reduce((a, d) => a + toMin(d.hours), 0);
  const upd = (key: number, patch: Partial<DelivDraft>) => {
    setDs((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setDirty(true);
  };
  const addOut = () => {
    const t = outDraft.trim();
    if (!t) return;
    setExclusions((x) => [...x, t]);
    setOutDraft("");
    setDirty(true);
  };
  // Demanda incorporada aponta para o número do entregável (1, 2, ...) na versão nova.
  const incorporate = Object.entries(incorp)
    .filter(([, v]) => v)
    .map(([taskId, v]) => ({ taskId, deliverableNumber: Number(v) }));

  return (
    <form action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-5" onChange={() => setDirty(true)}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="exclusions" value={JSON.stringify(exclusions)} />
      <input type="hidden" name="deliverables" value={JSON.stringify(ds.map(({ id, title, description, hours, person }) => ({ id, title, description, hours, person })))} />
      <input type="hidden" name="incorporate" value={JSON.stringify(incorporate)} />

      {mode === "nova_versao" && (
        <label className="flex flex-col gap-1.5">
          <span className="label">Motivo da nova versão</span>
          <textarea name="reason" required rows={2} placeholder="Ex.: aditivo assinado em 08/10 incluindo exportação de divergências" className="field py-2.5" />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="label">Objetivo</span>
        <textarea name="objective" rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="O que o cliente recebe ao final, em uma ou duas frases" className="field py-2.5" />
      </label>

      <section aria-labelledby={`${uid}-hit`} className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-2 bg-surface-3 px-5 py-3.5">
          <h2 id={`${uid}-hit`} className="m-0 text-base font-bold text-white">
            {mode === "rascunho" ? "Itens do escopo · rascunho" : "Entregáveis da nova versão"}
          </h2>
          <span className="text-[13px] text-muted">
            {ds.length} {ds.length === 1 ? "item" : "itens"}
          </span>
        </div>
        <div className="flex flex-col px-5 pt-1.5 pb-4">
          {ds.length === 0 && <p className="m-0 py-[18px] text-muted">Nenhum item ainda. Adicione o primeiro entregável.</p>}
          {ds.map((d, i) => {
            const bad = !toMin(d.hours);
            return (
              <div key={d.key} className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5 border-b border-line py-3.5">
                <span className="num mt-1 flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-line-2 text-[13px] font-bold text-white">E{i + 1}</span>
                <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1.5">
                  <input
                    aria-label={`Nome do item E${i + 1}`}
                    value={d.title}
                    onChange={(e) => upd(d.key, { title: e.target.value })}
                    placeholder="Nome do entregável"
                    className="min-h-11 w-full rounded-[10px] border border-line-5 bg-bg px-3 text-[15px] font-bold text-white placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                  <input
                    aria-label={`Descrição do item E${i + 1}`}
                    value={d.description}
                    onChange={(e) => upd(d.key, { description: e.target.value })}
                    placeholder="Descrição curta: o que o cliente recebe"
                    className="min-h-10 w-full rounded-[10px] border border-line-3 bg-bg px-3 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="flex w-24 shrink-0 flex-col gap-1">
                  <input
                    inputMode="decimal"
                    aria-label={`Horas estimadas do item E${i + 1}`}
                    value={d.hours}
                    onChange={(e) => upd(d.key, { hours: e.target.value.replace(/[^0-9.,:h]/g, "") })}
                    className={cx("num min-h-11 w-full rounded-[10px] border bg-bg px-2 text-center text-base font-bold text-white focus:border-accent focus:outline-none", bad ? "border-red" : "border-line-5")}
                  />
                  <span className="text-center text-xs text-faint">horas</span>
                </div>
                <select
                  aria-label={`Responsável sugerido do item E${i + 1}`}
                  value={d.person}
                  onChange={(e) => upd(d.key, { person: e.target.value })}
                  className="min-h-11 w-[170px] shrink-0 rounded-[10px] border border-line-3 bg-surface-2 px-2.5 text-[13px] font-semibold text-ink"
                >
                  <option value="">Sem sugestão</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remover item E${i + 1}`}
                  onClick={() => {
                    setDs((list) => list.filter((x) => x.key !== d.key));
                    setDirty(true);
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-line-3 text-muted hover:text-white"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5">
            <button
              type="button"
              onClick={() => {
                setDs((list) => [...list, { key: nextKey, title: "", description: "", hours: "", person: "" }]);
                setNextKey((k) => k + 1);
                setDirty(true);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-line-5 px-3.5 font-bold text-accent-soft"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              Adicionar item
            </button>
            <div className="ml-auto flex items-baseline gap-2.5">
              <span className="text-sm text-muted">Total estimado</span>
              <span className="num text-2xl font-bold text-white" aria-live="polite">
                {fmt(total)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby={`${uid}-out`} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${uid}-out`} className="m-0 text-base font-bold text-white">
            Fora do escopo
          </h2>
          <span className="text-[13px] text-muted">o que não está incluso, combinado com o cliente</span>
        </div>
        <ul className="m-0 flex list-none flex-col p-0">
          {exclusions.map((x, i) => (
            <li key={i + x} className="flex min-h-11 items-center gap-3 border-t border-line">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF8A80" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="shrink-0">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12h8" />
              </svg>
              <span className="min-w-0 flex-1 text-sm text-ink">{x}</span>
              <button
                type="button"
                aria-label={`Tirar "${x}" da lista`}
                onClick={() => {
                  setExclusions((l) => l.filter((_, j) => j !== i));
                  setDirty(true);
                }}
                className="flex size-10 items-center justify-center rounded-[10px] text-faint hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Novo item fora do escopo"
            value={outDraft}
            onChange={(e) => setOutDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOut();
              }
            }}
            placeholder="Ex.: Integração com transportadoras"
            className="field flex-[1_1_260px]"
          />
          <button type="button" onClick={addOut} className="btn-ghost">
            Marcar como fora do escopo
          </button>
        </div>
      </section>

      <label className="flex flex-col gap-1.5">
        <span className="label">Premissas e responsabilidades do cliente</span>
        <textarea name="assumptions" rows={3} value={assumptions} onChange={(e) => setAssumptions(e.target.value)} placeholder="Uma por linha" className="field py-2.5" />
      </label>

      {mode === "nova_versao" && extras.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-2 rounded-2xl border border-line bg-surface px-5 py-4">
          <legend className="px-1 text-base font-bold text-white">Incorporar demandas adicionais</legend>
          <p className="m-0 text-sm text-muted">Demandas incorporadas deixam de ser fora do escopo a partir desta versão. O histórico fica guardado.</p>
          {extras.map((x) => (
            <label key={x.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2">
              <span className="min-w-0 flex-[1_1_240px] text-sm text-ink">{x.name}</span>
              <select value={incorp[x.id] ?? ""} onChange={(e) => setIncorp((m) => ({ ...m, [x.id]: e.target.value }))} className="field w-auto min-w-[220px]" aria-label={`Entregável para ${x.name}`}>
                <option value="">Continua fora do escopo</option>
                {ds.map((d, i) => (
                  <option key={d.key} value={i + 1}>
                    Entra em E{i + 1} {d.title ? `· ${d.title}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}

      <FormError state={state} />
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line-4 bg-surface-3 px-4 py-3">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Salvando…" : mode === "rascunho" ? "Salvar rascunho" : "Confirmar nova versão"}
        </button>
        <span className="text-sm text-muted" aria-live="polite">
          {state.ok && !dirty ? "Rascunho salvo." : dirty ? "Alterações não salvas." : ""}
        </span>
      </div>
    </form>
  );
}

/** US-23: botão Confirmar escopo (só aparece habilitado para quem pode). */
export function ConfirmScope({ action, id, enabled }: { action: Action; id: string; enabled: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [sure, setSure] = useState(false);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      {sure ? (
        <div role="alertdialog" aria-label="Confirmar escopo" className="flex flex-col gap-2 rounded-xl bg-yellow-bg p-3 text-sm text-yellow">
          <span>O escopo vira a versão 1, não muda mais, e o projeto vai para o Odoo. Confirmar?</span>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary min-h-11" disabled={pending}>
              {pending ? "Confirmando…" : "Sim, confirmar"}
            </button>
            <button type="button" className="btn-ghost min-h-11" onClick={() => setSure(false)}>
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-disabled={!enabled}
          onClick={() => enabled && setSure(true)}
          className={cx("btn min-h-12 text-[15px] font-extrabold", enabled ? "bg-accent text-on-accent hover:bg-[#f48b5c]" : "cursor-not-allowed bg-line-2 text-faint")}
        >
          Confirmar escopo
        </button>
      )}
      <FormError state={state} />
    </form>
  );
}

export function MeetingForm({ action, id, today }: { action: Action; id: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useAct(action, () => setOpen(false));
  if (!open)
    return (
      <button type="button" className="btn-ghost min-h-10 self-start text-sm" onClick={() => setOpen(true)}>
        Registrar reunião
      </button>
    );
  return (
    <form action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-2.5 rounded-xl border border-line-3 bg-surface-3 p-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-[140px_1fr] gap-2">
        <label className="label flex flex-col gap-1">
          Data
          <input type="date" name="date" required defaultValue={today} className="field" />
        </label>
        <label className="label flex flex-col gap-1">
          Título
          <input name="title" required placeholder="Ex.: Reunião de levantamento" className="field" />
        </label>
      </div>
      <label className="label flex flex-col gap-1">
        Participantes
        <input name="participants" placeholder="Síntese e cliente" className="field" />
      </label>
      <label className="label flex flex-col gap-1">
        Resumo
        <textarea name="summary" rows={2} className="field py-2" />
      </label>
      <FormError state={state} />
      <div className="flex gap-2">
        <button className="btn-primary min-h-10 text-sm" disabled={pending}>
          Salvar reunião
        </button>
        <button type="button" className="btn-ghost min-h-10 text-sm" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function RemoveMeeting({ action, id, meetingId, label }: { action: Action; id: string; meetingId: string; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="meetingId" value={meetingId} />
      <button aria-label={`Remover reunião ${label}`} disabled={pending} className="btn-quiet min-h-9 px-1 text-xs text-faint">
        Remover
      </button>
      {state.error && <span className="text-xs text-red">{state.error}</span>}
    </form>
  );
}
