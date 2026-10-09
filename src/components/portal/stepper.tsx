import { cx } from "@/components/ui";

export const PORTAL_STAGES = [
  { key: "analise", label: "Análise e aprovação" },
  { key: "estimativa", label: "Estimativa de esforço" },
  { key: "alocacao", label: "Alocação da equipe" },
  { key: "andamento", label: "Em andamento" },
  { key: "concluido", label: "Concluído" },
] as const;

/** "Rastreio" do projeto em 5 etapas, com o "Estamos aqui" na etapa atual. */
export function Stepper({ current, dates }: { current: number; dates: string[] }) {
  return (
    <ol aria-label="Etapas do projeto" className="m-0 grid list-none grid-cols-5 p-0">
      {PORTAL_STAGES.map((st, i) => {
        const done = i < current || (current === 4 && i === 4);
        const now = i === current && current !== 4;
        return (
          <li key={st.key} aria-current={i === current ? "step" : undefined} className="relative flex min-w-0 flex-col items-center gap-2.5 px-1.5 text-center">
            {i > 0 && <span aria-hidden className={cx("absolute top-4 left-0 z-0 h-1 w-1/2", i <= current ? "bg-[#7A5A9A]" : "bg-line-2")} />}
            {i < 4 && <span aria-hidden className={cx("absolute top-4 right-0 z-0 h-1 w-1/2", i < current ? "bg-[#7A5A9A]" : "bg-line-2")} />}
            <span
              aria-hidden
              className={cx(
                "relative z-[1] box-border flex h-9 w-9 items-center justify-center rounded-full",
                done ? "bg-[#7A5A9A]" : now ? "border-[6px] border-[#3A1E12] bg-accent" : "border-[3px] border-line-4 bg-surface",
              )}
            >
              {done && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </span>
            <span className={cx("text-[13px] leading-tight sm:text-[15px]", now ? "font-extrabold text-white" : done ? "font-semibold text-[#e6d9f2]" : "font-semibold text-faint")}>{st.label}</span>
            <span className="text-[13px] text-faint">{dates[i] || ""}</span>
            {now && <span className="rounded-full bg-accent px-2.5 py-[3px] text-xs font-extrabold text-on-accent">Estamos aqui</span>}
          </li>
        );
      })}
    </ol>
  );
}
