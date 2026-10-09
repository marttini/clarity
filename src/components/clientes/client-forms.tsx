"use client";
import { useActionState, useState } from "react";
import { portalAction, saveInternalAction, type FormState } from "@/app/(time)/clientes/actions";
import { cx } from "@/components/ui";
import { ScheduleForm, type ClientOpt, type ItemOpt, type PersonOpt } from "@/components/contatos/forms";

function Msg({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <p role="status" className={cx("text-[13px] font-semibold", state.ok ? "text-green" : "text-red")}>
      {state.message}
    </p>
  );
}

/** US-30: ERP e observações internas. Só a gestão edita; nunca aparecem no portal. */
export function InternalForm({ clientId, erp, notes, canEdit }: { clientId: string; erp: string | null; notes: string | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveInternalAction, null);
  if (!canEdit)
    return (
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="label">ERP utilizado</dt>
          <dd className="text-ink">{erp || <span className="text-faint">Não informado</span>}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="label">Observações internas</dt>
          <dd className="whitespace-pre-wrap text-ink">{notes || <span className="text-faint">Nenhuma</span>}</dd>
        </div>
      </dl>
    );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor="erp">
          ERP utilizado
        </label>
        <input id="erp" name="erp" className="field" defaultValue={erp ?? ""} maxLength={80} placeholder="Ex.: Odoo 19" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="label" htmlFor="notes">
          Observações internas
        </label>
        <textarea id="notes" name="internalNotes" className="field min-h-24 py-2.5" defaultValue={notes ?? ""} maxLength={5000} placeholder="Só o time vê. Nunca aparece no portal." />
        {state && !state.ok && state.fields?.internalNotes && <span className="text-[13px] font-semibold text-red">{state.fields.internalNotes}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost" disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export type PortalContact = {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  active: boolean;
  portalAccess: boolean;
  invited: string | null;
  revoked: string | null;
  lastAccess: string | null;
};

function PortalRow({ c, clientId, canManage }: { c: PortalContact; clientId: string; canManage: boolean }) {
  const [state, action, pending] = useActionState(portalAction, null);
  const [confirm, setConfirm] = useState(false);
  const status = c.portalAccess
    ? c.lastAccess
      ? { text: `Último acesso: ${c.lastAccess}`, cls: "bg-green-bg text-green" }
      : { text: `Convite enviado em ${c.invited}, sem acesso`, cls: "bg-yellow-bg text-yellow" }
    : c.revoked
      ? { text: `Acesso revogado em ${c.revoked}`, cls: "bg-line-2 text-muted" }
      : { text: "Sem acesso", cls: "bg-line-2 text-muted" };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col">
        <strong className="text-sm text-white">{c.name}</strong>
        <span className="text-xs [overflow-wrap:anywhere] text-faint">
          {[c.jobTitle, c.email ?? "sem e-mail no Odoo"].filter(Boolean).join(" · ")}
        </span>
      </div>
      <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", status.cls)}>{status.text}</span>
      {canManage && c.active && (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="contactId" value={c.id} />
          <input type="hidden" name="clientId" value={clientId} />
          {c.portalAccess ? (
            confirm ? (
              <>
                <input type="hidden" name="op" value="revogar" />
                <button className="btn-ghost min-h-10 px-3 text-sm text-red" disabled={pending}>
                  {pending ? "Revogando..." : "Confirmar revogação"}
                </button>
                <button type="button" className="btn-quiet text-sm" onClick={() => setConfirm(false)}>
                  Manter
                </button>
              </>
            ) : (
              <button type="button" className="btn-quiet text-sm" onClick={() => setConfirm(true)}>
                Revogar
              </button>
            )
          ) : (
            <>
              <input type="hidden" name="op" value="convidar" />
              <button className="btn-ghost min-h-10 px-3 text-sm" disabled={pending || !c.email} title={c.email ? undefined : "Cadastre o e-mail no Odoo para convidar"}>
                {pending ? "Enviando..." : c.revoked || c.invited ? "Convidar de novo" : "Convidar por e-mail"}
              </button>
            </>
          )}
        </form>
      )}
      {state && <div className="basis-full"><Msg state={state} /></div>}
    </li>
  );
}

/** US-31: contatos do cliente (vindos do Odoo) e acesso ao portal. */
export function PortalAccess({ clientId, contacts, canManage }: { clientId: string; contacts: PortalContact[]; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {contacts.length === 0 ? (
        <p className="py-2 text-sm text-muted">Nenhum contato cadastrado para este cliente no Odoo.</p>
      ) : (
        <ul className="flex flex-col">
          {contacts.map((c) => (
            <PortalRow key={c.id} c={c} clientId={clientId} canManage={canManage} />
          ))}
        </ul>
      )}
      <p className="border-t border-line pt-2.5 text-xs text-faint">Contato novo? Cadastre no Odoo, dentro da empresa do cliente. O Clarity traz na próxima sincronização.</p>
    </div>
  );
}

/** Ficha 360°: botão "Agendar contato" que abre o formulário no próprio card. */
export function ScheduleToggle(props: { clients: ClientOpt[]; people: PersonOpt[]; items: ItemOpt[]; meId: string; clientId: string; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-primary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Fechar" : "Agendar contato"}
      </button>
      {open && (
        <div className="basis-full rounded-xl border border-line-3 bg-surface-3 p-3.5">
          <ScheduleForm clients={props.clients} people={props.people} items={props.items} meId={props.meId} defaultClientId={props.clientId} defaultDate={props.today} fixedClient />
        </div>
      )}
    </>
  );
}
