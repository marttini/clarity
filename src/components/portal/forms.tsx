"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { ActionState, InviteState } from "@/app/portal/actions";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

export function Status({ state, className }: { state: ActionState; className?: string }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cx("rounded-[10px] px-3.5 py-2.5 text-sm font-semibold", state.ok ? "bg-green-bg text-green" : "bg-red-bg text-red", className)}>
      {state.msg}
    </p>
  );
}

// ---------- Navegação do portal ----------

export function PortalNav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Portal" className="flex flex-wrap gap-0.5">
      {items.map((it) => {
        const on = it.href === "/portal" ? path === "/portal" : path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={cx("inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-[15px] no-underline", on ? "bg-line font-bold text-white" : "font-medium text-muted hover:text-white")}
          >
            {it.label}
            {!!it.badge && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-extrabold text-on-accent" aria-label={`${it.badge} pendente${it.badge > 1 ? "s" : ""}`}>
                {it.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------- Demandas adicionais (US-27) ----------

export function DemandActions({ itemId, approve, refuse }: { itemId: string; approve: Action; refuse: Action }) {
  const [mode, setMode] = useState<"idle" | "refusing">("idle");
  const [aState, aAction, aPending] = useActionState(approve, null);
  const [rState, rAction, rPending] = useActionState(refuse, null);
  const [warn, setWarn] = useState(false);
  if (aState?.ok || rState?.ok) return <Status state={aState?.ok ? aState : rState} />;
  if (mode === "refusing")
    return (
      <form
        action={rAction}
        onSubmit={(e) => {
          const r = (e.currentTarget.elements.namedItem("reason") as HTMLInputElement).value.trim();
          if (!r) {
            e.preventDefault();
            setWarn(true);
          }
        }}
        className="flex flex-col gap-2.5 border-t border-line pt-3.5"
      >
        <input type="hidden" name="itemId" value={itemId} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Conte o motivo para a Síntese (obrigatório)
          <input name="reason" autoFocus className="field min-h-12 bg-bg font-normal" placeholder="Ex.: vamos deixar para o próximo semestre" onChange={() => setWarn(false)} />
        </label>
        {warn && (
          <span role="alert" className="text-sm font-semibold text-yellow">
            Escreva o motivo para confirmar.
          </span>
        )}
        <Status state={rState} />
        <div className="flex flex-wrap gap-2.5">
          <button disabled={rPending} className="btn min-h-[46px] bg-red font-extrabold text-on-accent hover:bg-[#ff9d95]">
            Confirmar recusa
          </button>
          <button type="button" className="btn-ghost min-h-[46px]" onClick={() => setMode("idle")}>
            Voltar
          </button>
        </div>
      </form>
    );
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
      <Status state={aState} />
      <div className="flex flex-wrap gap-2.5">
        <form action={aAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <button disabled={aPending} className="btn-primary min-h-12 px-6 font-extrabold">
            Aprovar
          </button>
        </form>
        <button type="button" className="btn-ghost min-h-12 px-5 font-bold" onClick={() => setMode("refusing")}>
          Recusar
        </button>
      </div>
    </div>
  );
}

// ---------- Mensagens (US-41, US-42) ----------

export function MessageForm({ itemId, action }: { itemId: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [fname, setFname] = useState("");
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpa o nome do arquivo depois do envio
      setFname("");
    }
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-2 border-t border-line px-[22px] pt-4 pb-5">
      <input type="hidden" name="itemId" value={itemId} />
      <div className="flex flex-wrap gap-2.5">
        <label className="sr-only" htmlFor="msg">
          Escreva uma mensagem
        </label>
        <textarea id="msg" name="body" rows={2} placeholder="Escreva sua mensagem para a Síntese" className="field min-h-[50px] min-w-0 flex-[1_1_320px] resize-y bg-bg py-3 text-[15px]" />
        <button disabled={pending} className="btn-primary min-h-[50px] px-[22px] font-extrabold">
          {pending ? "Enviando" : "Enviar"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-quiet relative cursor-pointer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.3 3.3 0 0 1 4.7 4.7L10.2 18.7a1.7 1.7 0 0 1-2.4-2.4L15.5 8.6" />
          </svg>
          {fname ? "Trocar arquivo" : "Anexar arquivo"}
          <input type="file" name="file" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setFname(e.target.files?.[0]?.name ?? "")} />
        </label>
        <span className="text-[13px] text-faint">{fname ? fname : "Documentos, planilhas, PDF e imagens, até 25 MB."}</span>
      </div>
      <Status state={state} />
    </form>
  );
}

// ---------- Arquivos ----------

export function UploadForm({ options, action, defaultItem }: { options: { id: string; label: string }[]; action: Action; defaultItem?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [fname, setFname] = useState("");
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpa o nome do arquivo depois do envio
      setFname("");
    }
  }, [state]);
  return (
    <form ref={ref} action={formAction} aria-labelledby="up" className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-[18px] border border-dashed border-line-5 bg-surface-3 p-[22px]">
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5">
        <h2 id="up" className="text-[17px] font-bold text-white">
          Enviar arquivo
        </h2>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Até 25 MB por arquivo. Escolha o projeto:
          <select name="itemId" defaultValue={defaultItem ?? options[0]?.id} className="field bg-bg">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-ghost relative min-h-12 cursor-pointer">
          {fname ? "Trocar arquivo" : "Escolher arquivo"}
          <input type="file" name="file" required className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => setFname(e.target.files?.[0]?.name ?? "")} />
        </label>
        <button disabled={pending || !fname} className="btn-primary min-h-12 px-[22px] font-extrabold">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4M6 10l6-6 6 6M5 20h14" />
          </svg>
          {pending ? "Enviando" : "Enviar"}
        </button>
      </div>
      {fname && <span className="basis-full text-sm text-ink">{fname}</span>}
      {state && <Status state={state} className="basis-full" />}
    </form>
  );
}

// ---------- Avaliação ----------

const RATINGS = [
  { name: "result", label: "Resultado" },
  { name: "consultant", label: "Consultor" },
  { name: "team", label: "Time Síntese" },
] as const;

export function RatingForm({ itemId, action, compact }: { itemId: string; action: Action; compact?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [v, setV] = useState<Record<string, number>>({});
  const [warn, setWarn] = useState(false);
  const blocked = RATINGS.some((r) => !v[r.name]);
  if (state?.ok)
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl bg-green-bg px-4 py-3.5 text-green">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d="M5 12l5 5 9-10" />
        </svg>
        <span className="text-[15px] leading-normal">{state.msg}</span>
      </div>
    );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (blocked) {
          e.preventDefault();
          setWarn(true);
        }
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="itemId" value={itemId} />
      {RATINGS.map((r) => (
        <div key={r.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span id={`${itemId}-${r.name}`} className="text-[15px] font-bold text-white">
            {r.label}
          </span>
          <input type="hidden" name={r.name} value={v[r.name] ?? ""} />
          <div role="radiogroup" aria-labelledby={`${itemId}-${r.name}`} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const sel = v[r.name] === n;
              const below = !!v[r.name] && n < v[r.name];
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  aria-label={`${r.label}: nota ${n}`}
                  onClick={() => {
                    setV({ ...v, [r.name]: n });
                    setWarn(false);
                  }}
                  className={cx(
                    "num h-11 w-11 cursor-pointer rounded-[10px] border text-[17px] font-bold",
                    sel ? "border-accent bg-accent text-on-accent" : below ? "border-[#5A2E1C] bg-[#3A1E12] text-accent-soft" : "border-line-5 bg-surface text-[#e6d9f2]",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <span className="text-[13px] text-faint">1 = muito ruim · 5 = excelente</span>
      <label className="sr-only" htmlFor={`${itemId}-c`}>
        Comentário (opcional)
      </label>
      <input id={`${itemId}-c`} name="comment" placeholder="Comentário (opcional)" className="field min-h-12 bg-bg text-[15px]" />
      <button disabled={pending} aria-disabled={blocked} className={cx("btn min-h-12 w-full font-extrabold", blocked ? "bg-line-2 text-muted" : "bg-accent text-on-accent hover:bg-[#f48b5c]")}>
        Enviar avaliação
      </button>
      {!compact && <span className="text-sm text-muted">Sua avaliação vai para a gestão da Síntese.</span>}
      {warn && (
        <span role="alert" className="text-sm font-semibold text-yellow">
          Dê uma nota de 1 a 5 para os três itens.
        </span>
      )}
      <Status state={state} />
    </form>
  );
}

// ---------- Convidar colegas ----------

const INVITE_PT: Record<string, { text: string; tone: string }> = {
  convidado: { text: "Convite enviado", tone: "bg-blue-bg text-blue" },
  ja_tem_acesso: { text: "Já tem acesso", tone: "bg-line-2 text-[#e6d9f2]" },
  nao_cadastrado: { text: "Peça à Síntese para cadastrar este contato", tone: "bg-yellow-bg text-yellow" },
  revogado: { text: "Acesso retirado pela Síntese. Fale com a Síntese.", tone: "bg-yellow-bg text-yellow" },
  invalido: { text: "Não parece um e-mail válido", tone: "bg-red-bg text-red" },
};

export function InviteForm({ action, placeholder }: { action: (s: InviteState, f: FormData) => Promise<InviteState>; placeholder: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap gap-2.5">
        <label htmlFor="emails" className="sr-only">
          E-mails, separados por vírgula
        </label>
        <input id="emails" name="emails" required placeholder={placeholder} className="field min-h-12 min-w-0 flex-[1_1_300px] bg-bg text-[15px]" />
        <button disabled={pending} className="btn-primary min-h-12 px-5 font-extrabold">
          Enviar convites
        </button>
      </form>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={cx("text-sm font-semibold", state.ok ? "text-green" : "text-yellow")}>
          {state.msg}
        </p>
      )}
      {!!state?.results.length && (
        <ul className="flex flex-col">
          {state.results.map((r) => (
            <li key={r.email} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-3 py-2">
              <span className="min-w-0 text-sm break-all text-white">
                {r.name ? `${r.name} · ` : ""}
                {r.email}
              </span>
              <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", INVITE_PT[r.status].tone)}>{INVITE_PT[r.status].text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
