"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = { label: string; hint?: string; href: string };

const BASE: Hit[] = [
  { label: "Lançar horas", hint: "Minha fila", href: "/fila#lancar" },
  { label: "Minhas horas", href: "/horas" },
  { label: "Projetos e tarefas", href: "/projetos" },
  { label: "Carteira de clientes", href: "/clientes" },
  { label: "Agenda de contatos", href: "/contatos" },
  { label: "Carga do time", href: "/time" },
  { label: "A Síntese hoje", hint: "Gestão", href: "/gestao" },
  { label: "Pendências da gestão", href: "/gestao/pendencias" },
  { label: "Ranking e metas", href: "/ranking" },
  { label: "Avisos", href: "/avisos" },
];

/** Paleta de comandos (Ctrl K): navegar e buscar clientes, projetos e pessoas. */
export function CommandPalette({ isManager }: { isManager: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/busca?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then(setRemote)
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    const base = BASE.filter((h) => (isManager || h.href !== "/gestao/pendencias") && (!n || h.label.toLowerCase().includes(n)));
    return [...base, ...(n.length >= 2 ? remote : [])].slice(0, 12);
  }, [q, remote, isManager]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hidden min-h-10 items-center gap-2 rounded-lg border border-line-2 px-3 text-sm text-faint hover:text-white md:inline-flex">
        Buscar <kbd className="rounded bg-line-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(10,5,15,0.7)] px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Buscar" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-4 bg-surface-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setSel((x) => Math.min(x + 1, hits.length - 1));
                if (e.key === "ArrowUp") setSel((x) => Math.max(x - 1, 0));
                if (e.key === "Enter" && hits[sel]) go(hits[sel]);
              }}
              placeholder="Cliente, projeto, tarefa, pessoa ou tela"
              aria-label="Buscar"
              className="w-full border-b border-line bg-transparent px-5 py-4 text-base text-white outline-none placeholder:text-faint"
            />
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {hits.map((h, i) => (
                <li key={h.href + h.label}>
                  <button
                    type="button"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(h)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left ${i === sel ? "bg-line-2 text-white" : "text-ink"}`}
                  >
                    <span className="truncate">{h.label}</span>
                    {h.hint && <span className="shrink-0 text-xs text-faint">{h.hint}</span>}
                  </button>
                </li>
              ))}
              {hits.length === 0 && <li className="px-3 py-6 text-center text-muted">Nada encontrado.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
