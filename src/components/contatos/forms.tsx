"use client";
import { useActionState, useState, type ReactNode } from "react";
import { cancelAction, logAction, resultAction, scheduleAction, type FormState } from "@/app/(time)/contatos/actions";
import { cx } from "@/components/ui";
import { CONTACT_TYPES } from "./labels";

export type ClientOpt = { id: string; name: string; color: string; contacts: { id: string; name: string }[] };
export type PersonOpt = { id: string; name: string; role: string };
export type ItemOpt = { id: string; name: string; clientId: string };

const chipRadio =
  "chip cursor-pointer select-none has-checked:border-white has-checked:bg-white has-checked:text-on-accent has-focus-visible:outline-2 has-focus-visible:outline-accent";

export function Field({ label, error, children, hint, htmlFor }: { label: string; error?: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-xs text-faint">{hint}</span>}
      {error && <span className="text-[13px] font-semibold text-red">{error}</span>}
    </div>
  );
}

function TypeChips({ name, defaultValue, error }: { name: string; defaultValue?: string; error?: string }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="label mb-1.5">Tipo</legend>
      <div className="flex flex-wrap gap-1.5">
        {CONTACT_TYPES.map((t) => (
          <label key={t.value} className={chipRadio}>
            <input type="radio" name={name} value={t.value} defaultChecked={t.value === (defaultValue ?? "ligacao")} className="sr-only" />
            {t.label}
          </label>
        ))}
      </div>
      {error && <span className="text-[13px] font-semibold text-red">{error}</span>}
    </fieldset>
  );
}

function Flash({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <div role="status" className={cx("rounded-xl px-3.5 py-3 text-sm font-semibold", state.ok ? "bg-green-bg text-green" : "bg-red-bg text-red")}>
      {state.message}
    </div>
  );
}

function ClientAndContact({ clients, clientId, setClientId, fixedClient, errors }: { clients: ClientOpt[]; clientId: string; setClientId: (v: string) => void; fixedClient?: boolean; errors?: Record<string, string> }) {
  const client = clients.find((c) => c.id === clientId);
  return (
    <>
      {fixedClient ? (
        <input type="hidden" name="clientId" value={clientId} />
      ) : (
        <Field label="Cliente" htmlFor="f-client" error={errors?.clientId}>
          <select id="f-client" name="clientId" className="field" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="" disabled>
              Escolha o cliente
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Com quem do cliente" htmlFor="f-cc" error={errors?.clientContactId} hint="Contatos vêm do Odoo. Contato novo? Cadastre no Odoo.">
        <select id="f-cc" name="clientContactId" className="field" defaultValue="" key={clientId}>
          <option value="">Sem pessoa específica</option>
          {client?.contacts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function PersonSelect({ id, name, label, people, defaultValue, error, hint }: { id: string; name: string; label: string; people: PersonOpt[]; defaultValue: string; error?: string; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <select id={id} name={name} className="field" defaultValue={defaultValue}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.role === "administrativo" ? " (Administrativo)" : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** US-34: agendar um contato. */
export function ScheduleForm({
  clients,
  people,
  items = [],
  meId,
  defaultClientId,
  defaultDate,
  fixedClient,
  onDone,
}: {
  clients: ClientOpt[];
  people: PersonOpt[];
  items?: ItemOpt[];
  meId: string;
  defaultClientId?: string;
  defaultDate: string;
  fixedClient?: boolean;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(async (p: FormState, f: FormData) => {
    const r = await scheduleAction(p, f);
    if (r?.ok) onDone?.();
    return r;
  }, null);
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const e = state?.ok ? undefined : state?.fields;
  const its = items.filter((i) => i.clientId === clientId);
  return (
    <form action={action} key={state?.ok ? state.at : "schedule"} className="flex flex-col gap-4">
      <ClientAndContact clients={clients} clientId={clientId} setClientId={setClientId} fixedClient={fixedClient} errors={e} />
      <PersonSelect id="f-resp" name="responsibleId" label="Para quem" people={people} defaultValue={meId} error={e?.responsibleId} hint="Qualquer pessoa do time pode agendar para outra." />
      <TypeChips name="type" error={e?.type} />
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px] flex-1">
          <Field label="Dia" htmlFor="f-date" error={e?.date}>
            <input id="f-date" name="date" type="date" className="field" defaultValue={defaultDate} min={defaultDate} required />
          </Field>
        </div>
        <div className="min-w-[120px] flex-1">
          <Field label="Horário" htmlFor="f-time" error={e?.time}>
            <input id="f-time" name="time" type="time" className="field" defaultValue="10:00" step={300} required />
          </Field>
        </div>
      </div>
      <Field label="Objetivo" htmlFor="f-obj" error={e?.objective}>
        <input id="f-obj" name="objective" className="field" placeholder="Ex.: alinhar o prazo do broker" required maxLength={300} />
      </Field>
      {its.length > 0 && (
        <Field label="Item relacionado (opcional)" htmlFor="f-item" error={e?.relatedItemId}>
          <select id="f-item" name="relatedItemId" className="field" defaultValue="">
            <option value="">Nenhum</option>
            {its.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="text-xs text-faint">O responsável recebe o aviso no Clarity. O evento na agenda Google entra assim que a integração for ligada.</p>
      <button className="btn-primary min-h-12 text-[15px]" disabled={pending}>
        {pending ? "Agendando..." : "Agendar contato"}
      </button>
      <Flash state={state} />
    </form>
  );
}

/** Próximo passo do resultado (US-36): novo contato ou tarefa no projeto anual. */
function FollowUpFields({ people, meId, defaultDate, errors }: { people: PersonOpt[]; meId: string; defaultDate: string; errors?: Record<string, string> }) {
  const [kind, setKind] = useState<"" | "contato" | "tarefa">("");
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line-3 bg-surface-2 p-3.5">
      <legend className="label px-1">Próximo passo (opcional)</legend>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["", "Nenhum"],
            ["contato", "Agendar novo contato"],
            ["tarefa", "Criar tarefa de follow-up"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className={chipRadio}>
            <input type="radio" name="fu" value={v} checked={kind === v} onChange={() => setKind(v)} className="sr-only" />
            {l}
          </label>
        ))}
      </div>
      {kind === "contato" && (
        <div className="flex flex-col gap-3">
          <TypeChips name="fuType" error={errors?.fuType} />
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[150px] flex-1">
              <Field label="Dia" htmlFor="fu-date" error={errors?.fuDate}>
                <input id="fu-date" name="fuDate" type="date" className="field" defaultValue={defaultDate} min={defaultDate} />
              </Field>
            </div>
            <div className="min-w-[120px] flex-1">
              <Field label="Horário" htmlFor="fu-time" error={errors?.fuTime}>
                <input id="fu-time" name="fuTime" type="time" className="field" defaultValue="10:00" step={300} />
              </Field>
            </div>
          </div>
          <PersonSelect id="fu-resp" name="fuResponsibleId" label="Para quem" people={people} defaultValue={meId} error={errors?.fuResponsibleId} />
          <Field label="Objetivo" htmlFor="fu-obj" error={errors?.fuObjective}>
            <input id="fu-obj" name="fuObjective" className="field" placeholder="Ex.: confirmar a validação" />
          </Field>
        </div>
      )}
      {kind === "tarefa" && (
        <div className="flex flex-col gap-3">
          <Field label="Nome da tarefa" htmlFor="tk-name" error={errors?.taskName}>
            <input id="tk-name" name="taskName" className="field" placeholder="Ex.: enviar prévia do relatório" maxLength={200} />
          </Field>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[150px] flex-1">
              <Field label="Prazo" htmlFor="tk-dl" error={errors?.taskDeadline} hint="Em branco: 2 dias úteis.">
                <input id="tk-dl" name="taskDeadline" type="date" className="field" min={defaultDate} />
              </Field>
            </div>
            <div className="min-w-[150px] flex-1">
              <PersonSelect id="tk-resp" name="taskResponsibleId" label="Responsável" people={people} defaultValue={meId} error={errors?.taskResponsibleId} />
            </div>
          </div>
          <span className="text-xs text-faint">A tarefa entra no projeto anual do cliente, com a etiqueta Tarefa, e vai para o Odoo.</span>
        </div>
      )}
    </fieldset>
  );
}

/** US-36/US-37: registrar um contato que já aconteceu. */
export function LogForm({ clients, people, meId, defaultClientId, today, fixedClient }: { clients: ClientOpt[]; people: PersonOpt[]; meId: string; defaultClientId?: string; today: string; fixedClient?: boolean }) {
  const [state, action, pending] = useActionState(logAction, null);
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const e = state?.ok ? undefined : state?.fields;
  return (
    <form action={action} key={state?.ok ? state.at : "log"} className="flex flex-col gap-4">
      <ClientAndContact clients={clients} clientId={clientId} setClientId={setClientId} fixedClient={fixedClient} errors={e} />
      <TypeChips name="type" error={e?.type} />
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px] flex-1">
          <Field label="Quando foi" htmlFor="l-date" error={e?.date}>
            <input id="l-date" name="date" type="date" className="field" defaultValue={today} max={today} required />
          </Field>
        </div>
        <div className="min-w-[120px] flex-1">
          <Field label="Horário (opcional)" htmlFor="l-time" error={e?.time}>
            <input id="l-time" name="time" type="time" className="field" step={300} />
          </Field>
        </div>
      </div>
      <Field label="Resumo do contato" htmlFor="l-sum" error={e?.summary}>
        <textarea id="l-sum" name="summary" className="field min-h-20 py-2.5" placeholder="O que foi conversado" maxLength={2000} />
      </Field>
      <Field label="Próximo passo combinado" htmlFor="l-next">
        <input id="l-next" name="nextStep" className="field" placeholder="Ex.: enviar prévia até sexta" maxLength={300} />
      </Field>
      <FollowUpFields people={people} meId={meId} defaultDate={today} errors={e} />
      <button className="btn-primary min-h-12 text-[15px]" disabled={pending}>
        {pending ? "Registrando..." : "Registrar contato"}
      </button>
      <Flash state={state} />
    </form>
  );
}

/** US-36: resultado de um contato agendado. */
export function ResultForm({ contactId, people, meId, today, canManage }: { contactId: string; people: PersonOpt[]; meId: string; today: string; canManage: boolean }) {
  const [state, action, pending] = useActionState(resultAction, null);
  const [result, setResult] = useState<"realizado" | "nao_atendeu" | "remarcado">("realizado");
  const [cancelState, cancel, cancelling] = useActionState(cancelAction, null);
  const [showCancel, setShowCancel] = useState(false);
  if (!canManage) return <p className="text-sm text-muted">Só o responsável ou a gestão registram o resultado ou remarcam este contato.</p>;
  const e = state?.ok ? undefined : state?.fields;
  if (state?.ok) return <Flash state={state} />;
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="contactId" value={contactId} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="label mb-1.5">Resultado</legend>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["realizado", "Realizado"],
                ["nao_atendeu", "Não atendeu"],
                ["remarcado", "Remarcar"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className={chipRadio}>
                <input type="radio" name="result" value={v} checked={result === v} onChange={() => setResult(v)} className="sr-only" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        {result === "remarcado" ? (
          <>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[150px] flex-1">
                <Field label="Nova data" htmlFor="r-date" error={e?.newDate}>
                  <input id="r-date" name="newDate" type="date" className="field" min={today} />
                </Field>
              </div>
              <div className="min-w-[120px] flex-1">
                <Field label="Novo horário" htmlFor="r-time" error={e?.newTime}>
                  <input id="r-time" name="newTime" type="time" className="field" defaultValue="10:00" step={300} />
                </Field>
              </div>
            </div>
            <Field label="Motivo" htmlFor="r-reason" error={e?.reason}>
              <input id="r-reason" name="reason" className="field" placeholder="Ex.: cliente pediu para sexta" maxLength={300} />
            </Field>
          </>
        ) : (
          <>
            <Field label={result === "realizado" ? "Resumo do contato" : "Observação (opcional)"} htmlFor="r-sum" error={e?.summary}>
              <textarea id="r-sum" name="summary" className="field min-h-20 py-2.5" placeholder={result === "realizado" ? "O que foi conversado" : "Ex.: caixa postal"} maxLength={2000} />
            </Field>
            {result === "realizado" && (
              <Field label="Próximo passo combinado" htmlFor="r-next">
                <input id="r-next" name="nextStep" className="field" placeholder="Ex.: enviar prévia até sexta" maxLength={300} />
              </Field>
            )}
            <FollowUpFields people={people} meId={meId} defaultDate={today} errors={e} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={pending}>
            {pending ? "Salvando..." : result === "remarcado" ? "Remarcar" : "Registrar resultado"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setShowCancel((v) => !v)} aria-expanded={showCancel}>
            Cancelar contato
          </button>
        </div>
        <Flash state={state} />
      </form>
      {showCancel && (
        <form action={cancel} className="flex flex-col gap-3 rounded-xl border border-line-3 bg-surface-2 p-3.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="Motivo do cancelamento" htmlFor="c-reason" error={cancelState?.ok ? undefined : cancelState?.fields?.reason}>
            <input id="c-reason" name="reason" className="field" placeholder="Ex.: cliente encerrou o projeto" maxLength={300} />
          </Field>
          <button className="btn-ghost self-start" disabled={cancelling}>
            {cancelling ? "Cancelando..." : "Confirmar cancelamento"}
          </button>
          <Flash state={cancelState} />
        </form>
      )}
    </div>
  );
}
