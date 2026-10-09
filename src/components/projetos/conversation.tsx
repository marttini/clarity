"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import type { ActionState } from "@/app/(time)/projetos/actions";
import { FormError, keep, useAct } from "./client";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

/** US-40 / US-41: composer do canal Interno ou Cliente. No canal Cliente, confirma antes de publicar. */
export function Composer({ action, id, channel, disabledReason }: { action: Action; id: string; channel: "interno" | "cliente"; disabledReason?: string }) {
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const cli = channel === "cliente";
  const [state, formAction, pending] = useAct(action, () => {
    ref.current?.reset();
    setAsking(false);
  });
  if (disabledReason) return <p className="m-0 rounded-[10px] bg-surface-2 px-3 py-2.5 text-sm text-muted">{disabledReason}</p>;
  return (
    <form ref={ref} action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-2.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="channel" value={channel} />
      {cli && <span className="rounded-[10px] bg-blue-bg px-3 py-2 text-[13px] font-bold text-blue">O cliente verá este comentário.</span>}
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
        {cli ? "Mensagem para o cliente" : "Comentário interno"}
        <textarea
          name="body"
          rows={2}
          required
          placeholder={cli ? "Escreva para o cliente" : "Escreva… use @ para mencionar"}
          className={cx("min-h-11 resize-y rounded-[10px] border px-3 py-2.5 text-white placeholder:text-faint focus:border-accent focus:outline-none", cli ? "border-[#2E5A8A] bg-[#0E1C2C]" : "border-line-5 bg-bg")}
        />
      </label>
      {cli && asking && (
        <div role="alertdialog" aria-label="Confirmar envio ao cliente" className="flex flex-col gap-2 rounded-xl border border-[#2E5A8A] bg-[#0E1C2C] p-3 text-sm text-[#DCEBF6]">
          <strong className="text-white">Este comentário será visto pelo cliente.</strong>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="confirmClient" value="1" disabled={pending} className="btn min-h-11 bg-client-channel text-[#0B1A2C]">
              Sim, enviar ao cliente
            </button>
            <button type="button" className="btn-ghost min-h-11" onClick={() => setAsking(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
      <FormError state={state} />
      {!(cli && asking) && (
        <button
          type={cli ? "button" : "submit"}
          disabled={pending}
          onClick={
            cli
              ? () => {
                  if (ref.current?.reportValidity()) setAsking(true);
                }
              : undefined
          }
          className={cx("btn min-h-[42px] font-extrabold", cli ? "bg-client-channel text-[#0B1A2C]" : "bg-accent text-on-accent")}
        >
          {cli ? "Enviar ao cliente" : "Comentar"}
        </button>
      )}
    </form>
  );
}

export type CommentView = {
  id: string;
  who: string;
  when: string;
  body: string;
  edited: boolean;
  mine: boolean;
  fromClient: boolean;
  waiting?: string | null;
};

export function CommentItem({ c, itemId, editAction, deleteAction, channel }: { c: CommentView; itemId: string; editAction: Action; deleteAction: Action; channel: "interno" | "cliente" }) {
  const [editing, setEditing] = useState(false);
  const [es, editForm, editPending] = useAct(editAction, () => setEditing(false));
  const [ds, delForm, delPending] = useActionState(deleteAction, {});
  const [sure, setSure] = useState(false);
  const bubble = channel === "cliente" ? "bg-[#10283A] text-[#DCEBF6]" : "bg-line-2 text-ink";
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
        <strong className="text-ink">{c.who}</strong>· {c.when}
        {c.edited && <span className="text-faint">· editado</span>}
        {c.waiting && <span className="font-bold text-accent-soft">· {c.waiting}</span>}
      </span>
      {editing ? (
        <form action={editForm} onSubmit={keep(editForm)} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={itemId} />
          <input type="hidden" name="commentId" value={c.id} />
          <label className="sr-only" htmlFor={`e-${c.id}`}>
            Editar comentário
          </label>
          <textarea id={`e-${c.id}`} name="body" defaultValue={c.body} rows={3} className="field py-2" />
          <FormError state={es} />
          <div className="flex gap-2">
            <button className="btn-primary min-h-10 text-sm" disabled={editPending}>
              Salvar
            </button>
            <button type="button" className="btn-ghost min-h-10 text-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <p className={cx("m-0 rounded-[4px_12px_12px_12px] px-3 py-2.5 text-sm leading-[1.45] whitespace-pre-wrap", bubble)}>{c.body}</p>
      )}
      {c.mine && !editing && (
        <form action={delForm} className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="id" value={itemId} />
          <input type="hidden" name="commentId" value={c.id} />
          <button type="button" className="btn-quiet min-h-9 px-1.5 text-xs" onClick={() => setEditing(true)}>
            Editar
          </button>
          {sure ? (
            <>
              <button className="btn-quiet min-h-9 px-1.5 text-xs text-red" disabled={delPending}>
                Confirmar exclusão
              </button>
              <button type="button" className="btn-quiet min-h-9 px-1.5 text-xs" onClick={() => setSure(false)}>
                Manter
              </button>
            </>
          ) : (
            <button type="button" className="btn-quiet min-h-9 px-1.5 text-xs" onClick={() => setSure(true)}>
              Excluir
            </button>
          )}
          <FormError state={ds} />
        </form>
      )}
    </div>
  );
}

/** US-27: registrar aprovação recebida fora do portal, com print obrigatório. */
export function ApprovalForm({ action, id, projectId }: { action: Action; id: string; projectId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <p className="m-0 text-sm text-ink">O cliente aprovou por e-mail ou mensagem? Anexe o print como evidência. Ele fica interno.</p>
      <label className="label flex flex-col gap-1.5">
        Print da aprovação
        <input type="file" name="evidence" required accept="image/*,.pdf,.eml,.msg" className="field py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-line-2 file:px-3 file:py-1.5 file:text-ink" />
      </label>
      <label className="label flex flex-col gap-1.5">
        Observação <span className="text-faint">(opcional)</span>
        <input name="note" placeholder="Ex.: Carla aprovou no WhatsApp" className="field" />
      </label>
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        Registrar aprovação
      </button>
    </form>
  );
}

/** US-24: a gestão reclassifica, sempre com motivo. */
export function ReclassifyForm({ action, id, projectId, deliverables, current }: { action: Action; id: string; projectId: string; deliverables: { id: string; label: string }[]; current: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <label className="label flex flex-col gap-1.5">
        Classificação
        <select name="deliverable" defaultValue={current} className="field">
          {deliverables.map((d) => (
            <option key={d.id} value={d.id}>
              No escopo: {d.label}
            </option>
          ))}
          <option value="adicional">Fora do escopo (demanda adicional)</option>
        </select>
      </label>
      <label className="label flex flex-col gap-1.5">
        Motivo
        <textarea name="reason" required rows={2} className="field py-2" />
      </label>
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        Reclassificar
      </button>
    </form>
  );
}

/** Checklist da tarefa (US-15). */
export function ChecklistForm({ action, id, items }: { action: Action; id: string; items: { text: string; done: boolean }[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.ok && newRef.current) newRef.current.value = "";
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      {items.length === 0 && <p className="m-0 py-2 text-sm text-muted">Nenhum item no checklist.</p>}
      {items.map((it, i) => (
        <div key={i + it.text} className="flex min-h-11 items-center gap-3 border-t border-line">
          <input type="hidden" name="text" value={it.text} />
          <input
            type="checkbox"
            name="done"
            value={String(i)}
            defaultChecked={it.done}
            aria-label={it.text}
            className="size-4"
            onChange={() => ref.current?.requestSubmit()}
          />
          <span className={cx("flex-1 text-sm", it.done && "text-muted line-through")}>{it.text}</span>
          <button type="submit" name={`remove${i}`} value="1" aria-label={`Remover ${it.text}`} className="btn-quiet min-h-9 text-xs text-muted">
            Remover
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <label className="sr-only" htmlFor={`new-${id}`}>
          Novo item do checklist
        </label>
        <input ref={newRef} id={`new-${id}`} name="new" placeholder="Novo item" className="field flex-1" />
        <button className="btn-ghost" disabled={pending}>
          Adicionar
        </button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** Editar dados básicos do item. */
export function DetailsForm({ action, id, item }: { action: Action; id: string; item: { name: string; description: string | null; startDate: string | null; planned: string; isSustentacao: boolean } }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useAct(action, () => {
    const d = ref.current?.closest("details");
    if (d) d.open = false;
  });
  return (
    <form ref={ref} action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="label flex flex-col gap-1.5">
        Nome
        <input name="name" required defaultValue={item.name} className="field" />
      </label>
      <label className="label flex flex-col gap-1.5">
        Descrição
        <textarea name="description" rows={3} defaultValue={item.description ?? ""} className="field py-2" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="label flex flex-col gap-1.5">
          Início
          <input type="date" name="startDate" defaultValue={item.startDate ?? ""} className="field" />
        </label>
        <label className="label flex flex-col gap-1.5">
          Horas previstas
          <input name="planned" defaultValue={item.planned} className="field num" />
        </label>
      </div>
      <label className="flex min-h-10 items-center gap-2.5 text-sm text-ink">
        <input type="checkbox" name="sustentacao" defaultChecked={item.isSustentacao} className="size-4" />
        Sustentação
      </label>
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        Salvar
      </button>
    </form>
  );
}
