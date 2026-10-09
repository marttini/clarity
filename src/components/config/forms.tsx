"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type FormState = { ok: boolean; msg: string; key?: number } | null;
type Action = (s: FormState, f: FormData) => Promise<FormState>;

/** Formulário com Server Action e mensagem de retorno (erro explica o que fazer). */
export function ActionForm({
  action,
  children,
  className,
  resetOnOk,
  statusClassName,
  confirm,
  id,
}: {
  id?: string;
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnOk?: boolean;
  statusClassName?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);
  return (
    <form
      ref={ref}
      id={id}
      action={formAction}
      aria-busy={pending}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={className}
    >
      {children}
      {state && (
        <p key={state.key} role={state.ok ? "status" : "alert"} className={cx("basis-full text-sm font-semibold", state.ok ? "text-green" : "text-red", statusClassName)}>
          {state.msg}
        </p>
      )}
    </form>
  );
}

/** Interruptor acessível (checkbox nativo com visual de switch). */
export function Switch({ name, defaultChecked, label, disabled, value = "1", form }: { name: string; defaultChecked?: boolean; label: string; disabled?: boolean; value?: string; form?: string }) {
  return (
    <label className={cx("relative inline-flex min-h-11 items-center", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <input type="checkbox" form={form} name={name} value={value} defaultChecked={defaultChecked} disabled={disabled} aria-label={label} className="peer sr-only" />
      <span aria-hidden className="relative h-[26px] w-11 rounded-full border border-line-5 bg-line transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
      <span aria-hidden className="absolute top-1/2 left-[4px] h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-muted transition-all peer-checked:left-[22px] peer-checked:bg-bg" />
    </label>
  );
}

export function ConfigNav({ items }: { items: { href: string; label: string; hint: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Seções das configurações" className="card flex min-w-0 flex-[1_1_220px] flex-col gap-1 self-start p-2 md:max-w-[260px]">
      {items.map((x) => {
        const on = x.href === "/config" ? path === "/config" : path === x.href || path.startsWith(x.href + "/");
        return (
          <Link
            key={x.href}
            href={x.href}
            aria-current={on ? "page" : undefined}
            className={cx("flex min-h-[52px] flex-col items-start justify-center gap-px rounded-[10px] px-3 py-1.5 text-sm font-bold no-underline", on ? "bg-line-2 !text-white" : "!text-[#e6d9f2] hover:bg-surface-2")}
          >
            <span>{x.label}</span>
            <span className="text-xs font-medium text-faint">{x.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Submit({ children, className, ghost }: { children: ReactNode; className?: string; ghost?: boolean }) {
  return <button className={cx(ghost ? "btn-ghost" : "btn-primary", className)}>{children}</button>;
}
