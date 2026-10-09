"use client";
import { useActionState, useState } from "react";
import { contactResultAction, scheduleFromQueueAction, type ContactState } from "@/app/(time)/fila/actions";
import { cx } from "@/components/ui";

export type PersonOpt = { id: string; name: string };

const pill = (on: boolean) =>
  cx("inline-flex min-h-10 cursor-pointer items-center rounded-full border px-3 text-[13px] font-semibold", on ? "border-white bg-white text-on-accent" : "border-line-5 text-[#e6d9f2] hover:bg-line");

function Flash({ state }: { state: ContactState }) {
  if (!state) return null;
  return (
    <div role="status" className={cx("rounded-xl px-3.5 py-3 text-sm font-semibold", state.ok ? "bg-green-bg text-green" : "bg-red-bg text-red")}>
      {state.message}
    </div>
  );
}

function Err({ msg }: { msg?: string }) {
  return msg ? <span className="text-[13px] font-semibold text-red">{msg}</span> : null;
}

/**
 * US-36 na fila: botão "Registrar resultado" que abre o formulário no lugar.
 * Resultado: Realizado (resumo obrigatório), Não atendeu ou Remarcar (data, hora e motivo).
 * Próximo passo opcional: tarefa de follow-up para alguém do time.
 */
export function ContactResult({
  contactId,
  people,
  meId,
  today,
  workdayOptions,
  label = "Registrar resultado",
  followUpLabel = "Criar tarefa de follow-up",
}: {
  contactId: string;
  people: PersonOpt[];
  meId: string;
  today: string;
  /** Prazos rápidos do follow-up: [rótulo, data]. */
  workdayOptions: [string, string][];
  label?: string;
  followUpLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<"realizado" | "nao_atendeu" | "remarcado">("realizado");
  const [fu, setFu] = useState(false);
  const [who, setWho] = useState(meId);
  const [when, setWhen] = useState(workdayOptions[0]?.[1] ?? today);
  const [state, action, pending] = useActionState(contactResultAction, null);
  const e = state && !state.ok ? state.fields : undefined;
  if (state?.ok) return <Flash state={state} />;
  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx("min-h-11 self-end rounded-[10px] border border-line-5 px-3.5 text-[13px] font-bold whitespace-nowrap", open ? "bg-line-2 text-white" : "text-accent-soft hover:bg-line")}
      >
        {open ? "Fechar" : label}
      </button>
      {open && (
        <form action={action} className="flex flex-col gap-3.5 rounded-[14px] border border-line-4 bg-surface-3 p-4">
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="result" value={result} />
          <div className="flex flex-col gap-1.5">
            <span className="label">Resultado</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Resultado">
              {(
                [
                  ["realizado", "Realizado"],
                  ["nao_atendeu", "Não atendeu"],
                  ["remarcado", "Remarcar"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={result === v} onClick={() => setResult(v)} className={pill(result === v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {result === "remarcado" ? (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                  <span className="label">Nova data</span>
                  <input name="newDate" type="date" className="field" min={today} defaultValue={workdayOptions[0]?.[1]} />
                  <Err msg={e?.newDate} />
                </label>
                <label className="flex min-w-[110px] flex-1 flex-col gap-1.5">
                  <span className="label">Horário</span>
                  <input name="newTime" type="time" className="field" defaultValue="10:00" step={300} />
                  <Err msg={e?.newTime} />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="label">Motivo</span>
                <input name="reason" className="field" placeholder="Ex.: cliente pediu para sexta" maxLength={300} />
                <Err msg={e?.reason} />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="label">{result === "realizado" ? "Resumo do contato" : "Observação (opcional)"}</span>
                <textarea name="summary" className="field min-h-[72px] py-2.5" placeholder={result === "realizado" ? "O que foi conversado" : "Ex.: caixa postal"} maxLength={2000} />
                <Err msg={e?.summary} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label">Próximo passo</span>
                <input name="nextStep" className="field" placeholder="Ex.: cliente envia a planilha até sexta" maxLength={300} />
              </label>
              <button type="button" aria-pressed={fu} onClick={() => setFu((v) => !v)} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start text-sm font-semibold">
                <span aria-hidden className={cx("inline-flex size-5 items-center justify-center rounded-md", fu ? "bg-accent" : "border-[1.5px] border-faint")}>
                  {fu && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#120A19" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                </span>
                {followUpLabel}
              </button>
              {fu && (
                <div className="flex flex-col gap-3 pl-1">
                  <input type="hidden" name="fu" value="tarefa" />
                  <input type="hidden" name="taskResponsibleId" value={who} />
                  <input type="hidden" name="taskDeadline" value={when} />
                  <label className="flex flex-col gap-1.5">
                    <span className="label">Tarefa</span>
                    <input name="taskName" className="field" placeholder="Ex.: enviar prévia do relatório" maxLength={200} />
                    <Err msg={e?.taskName} />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="label">Para quem</span>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Para quem">
                      {people.map((p) => (
                        <button key={p.id} type="button" aria-pressed={who === p.id} onClick={() => setWho(p.id)} className={pill(who === p.id)}>
                          {p.id === meId ? "Eu" : p.name.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                    <Err msg={e?.taskResponsibleId} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="label">Prazo</span>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Prazo">
                      {workdayOptions.map(([l, d]) => (
                        <button key={l} type="button" aria-pressed={when === d} onClick={() => setWhen(d)} className={pill(when === d)}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={pending}>
              {pending ? "Salvando..." : result === "remarcado" ? "Remarcar" : fu ? "Salvar e criar follow-up" : "Salvar contato"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
          <Flash state={state} />
        </form>
      )}
    </div>
  );
}

/**
 * Agendar a partir da fila (US-34/US-37): cliente sem contato ("Agendar") ou cobrança de retorno ("Cobrar").
 * Abre um mini formulário com dia, hora e objetivo já preenchidos.
 */
export function QuickSchedule({
  clientId,
  relatedItemId,
  objective,
  defaultDate,
  defaultTime = "10:00",
  today,
  label,
  primary,
}: {
  clientId: string;
  relatedItemId?: string;
  objective: string;
  defaultDate: string;
  defaultTime?: string;
  today: string;
  label: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(scheduleFromQueueAction, null);
  const e = state && !state.ok ? state.fields : undefined;
  if (state?.ok) return <span className="rounded-full bg-blue-bg px-2.5 py-1 text-xs font-bold text-blue">{state.message}</span>;
  return (
    <div className={cx("flex flex-col gap-2", open && "basis-full items-end")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "min-h-11 rounded-[10px] px-3.5 text-[13px] font-bold whitespace-nowrap",
          primary ? "bg-accent font-extrabold text-on-accent hover:bg-[#f48b5c]" : "border border-line-5 text-accent-soft hover:bg-line",
          open && "bg-line-2 text-white",
        )}
      >
        {open ? "Fechar" : label}
      </button>
      {open && (
        <form action={action} className="flex w-full min-w-[240px] flex-col gap-3 rounded-[14px] border border-line-4 bg-surface-3 p-3.5">
          <input type="hidden" name="clientId" value={clientId} />
          {relatedItemId && <input type="hidden" name="relatedItemId" value={relatedItemId} />}
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-[130px] flex-1 flex-col gap-1">
              <span className="label">Dia</span>
              <input name="date" type="date" className="field" defaultValue={defaultDate} min={today} />
              <Err msg={e?.date} />
            </label>
            <label className="flex min-w-[100px] flex-1 flex-col gap-1">
              <span className="label">Hora</span>
              <input name="time" type="time" className="field" defaultValue={defaultTime} step={300} />
              <Err msg={e?.time} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">Tipo</span>
            <select name="type" className="field" defaultValue="ligacao">
              <option value="ligacao">Ligação</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="reuniao_online">Reunião online</option>
              <option value="visita">Visita presencial</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Objetivo</span>
            <input name="objective" className="field" defaultValue={objective} maxLength={300} />
            <Err msg={e?.objective} />
          </label>
          <button className="btn-primary" disabled={pending}>
            {pending ? "Agendando..." : "Agendar para mim"}
          </button>
          <Flash state={state} />
        </form>
      )}
    </div>
  );
}
