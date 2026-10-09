"use client";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cx } from "@/components/ui";
import type { ActionState } from "@/app/(time)/projetos/actions";
import { STAGE_LIST } from "./bits";

/** Componentes interativos pequenos dos projetos. */

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

/** useActionState que chama `onOk` quando a ação dá certo (sem setState em efeito). */
export function useAct(action: Action, onOk?: () => void) {
  return useActionState<ActionState, FormData>(async (prev, f) => {
    const r = await action(prev, f);
    if (r.ok) onOk?.();
    return r;
  }, {});
}

/**
 * Envia sem o reset automático do React 19, para o que a pessoa digitou não sumir
 * quando o servidor devolve um erro.
 */
export function keep(formAction: (f: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
}

function closeDetails(form: HTMLFormElement | null, reset = true) {
  const d = form?.closest("details");
  if (d) d.open = false;
  if (reset) form?.reset();
}

export function FormError({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="m-0 rounded-[10px] bg-red-bg px-3 py-2 text-sm font-semibold text-red">
      {state.error}
    </p>
  );
}

/** Guarda o filtro escolhido num cookie para a próxima visita (US-20). */
export function RememberFilters({ query }: { query: string }) {
  useEffect(() => {
    document.cookie = `clarity_projetos=${encodeURIComponent(query)}; path=/projetos; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  }, [query]);
  return null;
}

/** Envia o formulário de filtros ao mudar um campo (sem precisar do botão). */
export function AutoSubmit({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      method="get"
      className={className}
      onChange={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "SELECT" || (t as HTMLInputElement).type === "date" || (t as HTMLInputElement).type === "checkbox") ref.current?.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}

/**
 * US-16: muda a etapa com um seletor acessível. Concluir projeto com tarefas abertas
 * pede confirmação antes.
 */
export function StageMover({ action, id, stage, openTasks = 0, disabled, compact }: { action: Action; id: string; stage: string; openTasks?: number; disabled?: string; compact?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [target, setTarget] = useState(stage);
  const [askConfirm, setAskConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const needs = (state.needsConfirm && target === "concluido") || askConfirm;
  if (disabled) return <span className="text-[13px] text-muted">{disabled}</span>;
  return (
    <form ref={formRef} action={formAction} className={cx("flex flex-wrap items-center gap-2", compact && "w-full")}>
      <input type="hidden" name="id" value={id} />
      <label htmlFor={uid} className="sr-only">
        Etapa
      </label>
      <select
        id={uid}
        name="stage"
        value={target}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setTarget(v);
          if (v === "concluido" && openTasks > 0) {
            setAskConfirm(true);
            return;
          }
          setAskConfirm(false);
          if (v !== stage) setTimeout(() => formRef.current?.requestSubmit(), 0);
        }}
        className={cx("field w-auto min-w-0 text-sm", compact ? "min-h-11 flex-1" : "min-h-11")}
      >
        {STAGE_LIST.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      {needs && (
        <div role="alertdialog" aria-label="Concluir com tarefas abertas" className="flex w-full flex-col gap-2 rounded-xl bg-yellow-bg p-3 text-sm text-yellow">
          <span>
            {openTasks > 0 ? `Este projeto tem ${openTasks} ${openTasks === 1 ? "tarefa aberta" : "tarefas abertas"}.` : state.error} Concluir mesmo assim?
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="confirm" value="1" className="btn-primary min-h-11 text-sm" onClick={() => setAskConfirm(false)}>
              Concluir assim mesmo
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11 text-sm"
              onClick={() => {
                setAskConfirm(false);
                setTarget(stage);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {!needs && <FormError state={state} />}
      <noscript>
        <button className="btn-ghost min-h-11 text-sm">Mover</button>
      </noscript>
    </form>
  );
}

/** Popover simples com <details>: abre um formulário de edição sem sair da página. */
export function Pop({ label, children, className, align = "left", buttonClass }: { label: ReactNode; children: ReactNode; className?: string; align?: "left" | "right"; buttonClass?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onDoc = (e: MouseEvent) => {
      if (d.open && !d.contains(e.target as Node)) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && d.open) {
        d.open = false;
        (d.querySelector("summary") as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={ref} className={cx("relative", className)}>
      <summary className={cx("list-none [&::-webkit-details-marker]:hidden", buttonClass ?? "btn-ghost min-h-[42px] cursor-pointer text-sm")}>{label}</summary>
      <div
        className={cx(
          "absolute z-30 mt-2 flex w-[min(340px,calc(100vw-32px))] flex-col gap-3 rounded-2xl border border-line-4 bg-surface-3 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {children}
      </div>
    </details>
  );
}

/** US-17: alterar prazo exige motivo. */
export function DeadlineForm({ action, id, deadline }: { action: Action; id: string; deadline: string | null }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useAct(action, () => closeDetails(ref.current));
  return (
    <form ref={ref} action={formAction} onSubmit={keep(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="label flex flex-col gap-1.5">
        Novo prazo
        <input type="date" name="deadline" required defaultValue={deadline ?? ""} className="field" aria-invalid={!!state.fields?.deadline} />
      </label>
      <label className="label flex flex-col gap-1.5">
        Motivo
        <textarea name="reason" required rows={2} placeholder="Ex.: cliente atrasou o arquivo" className="field py-2" aria-invalid={!!state.fields?.reason} />
      </label>
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        Salvar prazo
      </button>
    </form>
  );
}

/** US-18: marcadores (vários por item). */
export function TagsForm({ action, id, tags, selected }: { action: Action; id: string; tags: { id: string; name: string; color: string }[]; selected: string[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useAct(action, () => closeDetails(ref.current));
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="label mb-1">Marcadores</legend>
        {tags.map((t) => (
          <label key={t.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm hover:bg-line">
            <input type="checkbox" name="tags" value={t.id} defaultChecked={selected.includes(t.id)} className="size-4" />
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: t.color }} />
            {t.name}
          </label>
        ))}
      </fieldset>
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        Salvar marcadores
      </button>
    </form>
  );
}

export function AssigneesForm({ action, id, people, selected }: { action: Action; id: string; people: { id: string; name: string }[]; selected: string[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useAct(action, () => closeDetails(ref.current));
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <fieldset className="m-0 flex max-h-72 flex-col gap-1 overflow-y-auto border-0 p-0">
        <legend className="label mb-1">Responsáveis</legend>
        {people.map((p) => (
          <label key={p.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm hover:bg-line">
            <input type="checkbox" name="assignees" value={p.id} defaultChecked={selected.includes(p.id)} className="size-4" />
            {p.name}
          </label>
        ))}
      </fieldset>
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        Salvar responsáveis
      </button>
    </form>
  );
}

/** US-19: visibilidade. Tornar projeto visível pergunta se as tarefas também ficam. */
export function VisibilityForm({ action, id, visible, isProject, taskCount, locked }: { action: Action; id: string; visible: boolean; isProject: boolean; taskCount: number; locked?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useAct(action, () => closeDetails(ref.current));
  if (locked) return <p className="m-0 text-sm text-muted">{locked}</p>;
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="visible" value={visible ? "0" : "1"} />
      <p className="m-0 text-sm text-ink">
        {visible ? "O cliente vê este item no portal. Tornar interno tira do portal." : "Hoje só o time vê este item. Tornar visível mostra no portal do cliente."}
      </p>
      {isProject && taskCount > 0 && (
        <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" name="cascade" value="1" defaultChecked className="size-4" />
          {visible ? `Tornar internas também as ${taskCount} tarefas` : `Mostrar também as ${taskCount} tarefas deste projeto`}
        </label>
      )}
      <FormError state={state} />
      <button className="btn-primary" disabled={pending}>
        {visible ? "Tornar interno" : "Tornar visível ao cliente"}
      </button>
    </form>
  );
}

export function SustForm({ action, id, value }: { action: Action; id: string; value: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="sustentacao" value={value ? "0" : "1"} />
      <p className="m-0 text-sm text-ink">{value ? "Os apontamentos deste item vêm marcados como sustentação." : "Marque se este item é de sustentação: os apontamentos herdam a marca."}</p>
      <FormError state={state} />
      <button className="btn-ghost" disabled={pending}>
        {value ? "Tirar sustentação" : "Marcar como sustentação"}
      </button>
    </form>
  );
}

/** Envio de vários arquivos (arrastar e soltar ou escolher), até 25 MB cada (US-39). */
export function UploadForm({ action, id, allowInternal = true, compact }: { action: Action; id: string; allowInternal?: boolean; compact?: boolean }) {
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLFormElement>(null);
  const uid = useId();
  const [state, formAction, pending] = useAct(action, () => {
    ref.current?.reset();
    setFiles([]);
  });
  const names = files.map((f) => f.name);
  const big = files.filter((f) => f.size > 25 * 1024 * 1024).map((f) => f.name);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="id" value={id} />
      <label
        htmlFor={uid}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (input.current && e.dataTransfer.files.length) {
            input.current.files = e.dataTransfer.files;
            setFiles([...e.dataTransfer.files].map((f) => ({ name: f.name, size: f.size })));
          }
        }}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-3 text-center text-sm",
          compact ? "min-h-14 py-2" : "min-h-20 py-3",
          over ? "border-accent bg-line text-white" : "border-line-5 text-muted hover:text-white",
        )}
      >
        <span className="font-semibold text-accent-soft">{names.length ? `${names.length} ${names.length === 1 ? "arquivo" : "arquivos"} escolhido${names.length === 1 ? "" : "s"}` : "Arraste arquivos ou clique para escolher"}</span>
        <span className="text-xs text-faint">{names.length ? names.join(", ") : "Até 25 MB por arquivo. Mesmo nome vira nova versão."}</span>
      </label>
      <input
        ref={input}
        id={uid}
        type="file"
        name="files"
        multiple
        className="sr-only"
        onChange={(e) => setFiles([...(e.target.files ?? [])].map((f) => ({ name: f.name, size: f.size })))}
      />
      {big.length > 0 && <p className="m-0 text-sm text-red">Passa de 25 MB: {big.join(", ")}</p>}
      {allowInternal && (
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" name="internal" value="1" className="size-4" />
          Interno: o cliente não vê
        </label>
      )}
      <FormError state={state} />
      <button className="btn-ghost min-h-11 text-sm" disabled={pending || !names.length || big.length > 0}>
        {pending ? "Enviando…" : "Anexar"}
      </button>
    </form>
  );
}
