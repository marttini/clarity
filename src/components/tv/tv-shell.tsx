"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Modo TV (US-49): tela fixa de 1920x1080 escalada para caber na janela,
 * alterna as cenas a cada 15 s e busca dados novos a cada 60 s, sem ninguém mexer.
 */
export function TvShell({ header, scenes, labels, footerNote, dateLabel }: { header: ReactNode; scenes: ReactNode[]; labels: string[]; footerNote: string; dateLabel: string }) {
  const router = useRouter();
  const [scene, setScene] = useState(0);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fit, setFit] = useState({ scale: 1, dx: 0 });
  const [clock, setClock] = useState<string | null>(null);
  const SECONDS = 15;

  useEffect(() => {
    const onResize = () => {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      setFit({ scale, dx: Math.max(0, (window.innerWidth - 1920 * scale) / 2) });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    const fmt = () => setClock(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date()));
    fmt();
    const id = setInterval(() => {
      fmt();
      if (paused) return;
      setTick((t) => {
        if (t + 1 >= SECONDS) {
          setScene((s) => (s + 1) % scenes.length);
          return 0;
        }
        return t + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [paused, scenes.length]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      <div
        className="absolute top-0 left-0 flex h-[1080px] w-[1920px] origin-top-left flex-col gap-[26px] px-14 pt-9 pb-8"
        style={{ transform: `translate(${fit.dx}px, 0) scale(${fit.scale})` }}
      >
        <header className="flex items-stretch gap-6">
          <div className="flex w-[300px] shrink-0 flex-col justify-center gap-1">
            <span className="num text-[64px] leading-none font-bold text-white" suppressHydrationWarning>
              {clock ?? "--:--"}
            </span>
            <span className="text-2xl text-muted">{dateLabel}</span>
          </div>
          {header}
        </header>
        <div key={scene} className="tv-scene flex min-h-0 flex-1 flex-col">
          {scenes[scene]}
        </div>
        <footer className="flex items-center gap-4">
          <span className="font-display text-2xl font-bold tracking-[-0.02em] text-white">clarity</span>
          <span className="text-lg text-faint">{footerNote}</span>
          <div role="tablist" aria-label="Cenas" className="ml-auto flex gap-2">
            {labels.map((l, i) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={i === scene}
                onClick={() => {
                  setScene(i);
                  setTick(0);
                }}
                className={cx("flex min-h-12 min-w-[150px] cursor-pointer flex-col justify-center gap-1.5 rounded-xl border px-4 text-lg font-bold", i === scene ? "border-line-5 bg-line-2 text-white" : "border-line-3 text-muted")}
              >
                <span>{l}</span>
                <span className="block h-[3px] w-full overflow-hidden rounded-full bg-line-2">
                  <span className="block h-full bg-accent" style={{ width: i === scene ? `${(tick / SECONDS) * 100}%` : 0 }} />
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Retomar a troca de cenas" : "Pausar a troca de cenas"}
            className="inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-xl border border-line-3 text-muted"
          >
            {paused ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 5l12 7-12 7z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            )}
          </button>
        </footer>
      </div>
      <style>{`@keyframes tvIn{from{opacity:0}to{opacity:1}}.tv-scene{animation:tvIn 500ms ease-out}@media (prefers-reduced-motion:reduce){.tv-scene{animation:none}}`}</style>
    </div>
  );
}

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
