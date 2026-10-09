"use client";
import { useActionState, useMemo, useState } from "react";
import { cx } from "@/components/ui";
import { createItemAction, type ActionState } from "@/app/(time)/projetos/actions";
import { FormError, keep } from "./client";

type Opt = { id: string; name: string };
type Project = { id: string; name: string; scopeStatus: string; isSustentacao: boolean; visibleToClient: boolean; clientId: string; year: number; deliverables: { id: string; label: string }[] };

/**
 * US-14 / US-15 / US-24: criar projeto ou tarefa.
 * Tarefa num projeto confirmado pergunta a qual entregável atende; sem entregável vira demanda adicional
 * com origem (quem pediu, quando, canal).
 */
export function NewItemForm({
  kind: initialKind,
  clients,
  people,
  tags,
  projects,
  contacts,
  channels,
  today,
  me,
  initial,
}: {
  kind: "projeto" | "tarefa";
  clients: Opt[];
  people: Opt[];
  tags: { id: string; name: string; color: string }[];
  projects: Project[];
  contacts: { id: string; name: string; clientId: string }[];
  channels: readonly string[];
  today: string;
  me: string;
  initial: { clientId?: string; parentId?: string; extra?: boolean };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createItemAction, {});
  const [kind, setKind] = useState(initialKind);
  const startParent = projects.find((p) => p.id === initial.parentId);
  const [clientId, setClientId] = useState(startParent?.clientId ?? initial.clientId ?? "");
  const [parentId, setParentId] = useState(startParent?.id ?? "");
  const parent = projects.find((p) => p.id === parentId);
  const [sust, setSust] = useState(parent?.isSustentacao ?? false);
  const [visible, setVisible] = useState(parent?.visibleToClient ?? false);
  const [deliverable, setDeliverable] = useState(initial.extra ? "adicional" : "");
  const clientProjects = useMemo(() => projects.filter((p) => p.clientId === clientId), [projects, clientId]);
  const clientContacts = contacts.filter((c) => c.clientId === clientId);
  const confirmed = kind === "tarefa" && parent?.scopeStatus === "confirmado";
  const draftParent = kind === "tarefa" && parent?.scopeStatus === "rascunho";
  const extra = confirmed && deliverable === "adicional";
  const err = (k: string) => state.fields?.[k];

  return (
    <form action={action} onSubmit={keep(action)} className="flex flex-col gap-6">
      <input type="hidden" name="kind" value={kind} />
      <div role="radiogroup" aria-label="O que criar" className="flex gap-1 self-start rounded-[10px] border border-line bg-surface-2 p-[3px]">
        {(["projeto", "tarefa"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cx("inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-bold", kind === k ? "bg-line-2 text-white" : "text-muted hover:text-white")}
          >
            {k === "projeto" ? "Projeto" : "Tarefa"}
          </button>
        ))}
      </div>

      {kind === "projeto" && (
        <p role="note" className="m-0 flex items-start gap-3 rounded-xl bg-blue-bg px-4 py-3 text-sm leading-relaxed text-blue">
          O projeto nasce em <strong className="text-white">Rascunho</strong>: fica só no Clarity até o escopo ser confirmado. Horas de montagem de escopo não são apontadas.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Cliente" error={err("clientId")}>
          <select
            name="clientId"
            required
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setParentId("");
              setDeliverable("");
            }}
            className="field"
          >
            <option value="">Escolha o cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {kind === "tarefa" && (
          <Field label="Projeto" hint="Vazio: tarefa simples no projeto anual do cliente." error={err("parentId")}>
            <select
              name="parentId"
              value={parentId}
              disabled={!clientId}
              onChange={(e) => {
                const p = projects.find((x) => x.id === e.target.value);
                setParentId(e.target.value);
                setDeliverable("");
                // US-15: herda sustentação e visibilidade do projeto (editáveis).
                if (p) {
                  setSust(p.isSustentacao);
                  setVisible(p.visibleToClient);
                }
              }}
              className="field"
            >
              <option value="">Nenhum: tarefa simples</option>
              {clientProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.scopeStatus === "rascunho" ? " (rascunho)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={kind === "projeto" ? "Nome do projeto" : "Nome da tarefa"} error={err("name")} wide>
          <input name="name" required placeholder={kind === "projeto" ? "Ex.: Integração e-commerce" : "Ex.: Erro na importação de pedidos"} className="field" />
        </Field>
      </div>

      {confirmed && (
        <fieldset className="m-0 flex flex-col gap-3 rounded-2xl border border-line-4 bg-surface-3 p-4">
          <legend className="px-1 text-[15px] font-bold text-white">A qual entregável esta tarefa atende?</legend>
          <select name="deliverable" required value={deliverable} onChange={(e) => setDeliverable(e.target.value)} className="field" aria-invalid={!!err("deliverableId")}>
            <option value="">Escolha</option>
            {parent!.deliverables.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
            <option value="adicional">Nenhum: é demanda adicional (fora do escopo)</option>
          </select>
          {extra && (
            <>
              <p className="m-0 rounded-xl bg-yellow-bg px-3 py-2.5 text-sm leading-relaxed text-yellow">
                Vira <strong className="text-white">demanda adicional</strong>: o cliente vê no portal e precisa aprovar. Até lá, não aceita horas. Faturável por padrão.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Quem pediu" error={err("requestedBy")}>
                  <select name="requestedBy" required className="field">
                    <option value="">Contato do cliente</option>
                    {clientContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quando" error={err("requestedAt")}>
                  <input type="date" name="requestedAt" required defaultValue={today} max={today} className="field" />
                </Field>
                <Field label="Canal" error={err("requestChannel")}>
                  <select name="requestChannel" required className="field">
                    <option value="">Por onde pediu</option>
                    {channels.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          )}
        </fieldset>
      )}
      {draftParent && parent!.deliverables.length > 0 && (
        <Field label="Entregável planejado" hint="Opcional no rascunho.">
          <select name="deliverable" className="field">
            <option value="">Sem entregável</option>
            {parent!.deliverables.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={kind === "projeto" ? "Escopo resumido" : "Descrição"} hint={kind === "projeto" ? "O escopo completo (entregáveis, exclusões, reuniões) é montado depois." : undefined}>
        <textarea name="description" rows={3} className="field py-2.5" />
      </Field>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="label mb-2">
          Responsáveis <span className="text-faint">(ao menos um)</span>
        </legend>
        {err("assignees") && <span className="text-sm text-red">{err("assignees")}</span>}
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <label key={p.id} className="chip cursor-pointer gap-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:checked]:border-white has-[:checked]:bg-white has-[:checked]:text-on-accent">
              <input type="checkbox" name="assignees" value={p.id} defaultChecked={p.id === me} className="sr-only" />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Início">
          <input type="date" name="startDate" className="field" />
        </Field>
        <Field label={kind === "projeto" ? "Prazo" : "Prazo (opcional)"} error={err("deadline")}>
          <input type="date" name="deadline" required={kind === "projeto"} className="field" />
        </Field>
        <Field label="Horas previstas" hint="Ex.: 40 ou 12:30" error={err("planned")}>
          <input name="planned" inputMode="decimal" className="field num" />
        </Field>
      </div>

      {tags.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="label mb-2">Marcadores</legend>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <label key={t.id} className="chip cursor-pointer gap-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:checked]:border-white has-[:checked]:bg-white has-[:checked]:text-on-accent">
                <input type="checkbox" name="tags" value={t.id} className="sr-only" />
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {kind === "tarefa" && (
        <Field label="Checklist" hint="Um item por linha.">
          <textarea name="checklist" rows={3} className="field py-2.5" />
        </Field>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="sustentacao" checked={sust} onChange={(e) => setSust(e.target.checked)} className="size-4" />
          Sustentação <span className="text-faint">(os apontamentos herdam a marca)</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="visible" checked={extra || visible} disabled={extra} onChange={(e) => setVisible(e.target.checked)} className="size-4" />
          Visível ao cliente no portal <span className="text-faint">{extra ? "(demanda adicional é sempre visível)" : "(sem marcar, fica Interno)"}</span>
        </label>
      </div>

      <FormError state={state} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Criando…" : extra ? "Criar e enviar ao cliente aprovar" : kind === "projeto" ? "Criar projeto em rascunho" : "Criar tarefa"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, error, children, wide }: { label: string; hint?: string; error?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", wide && "md:col-span-2")}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="text-sm text-red">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  );
}
