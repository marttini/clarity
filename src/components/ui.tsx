import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Avatar({ name, initials, size = 32, color }: { name: string; initials: string; size?: number; color?: string }) {
  return (
    <span
      title={name}
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold"
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34), background: color ?? "#2A1B37", color: color ? "#120A19" : "#fff" }}
    >
      {initials}
    </span>
  );
}

export function ClientSwatch({ color, size = 10, shape = "dot" }: { color: string; size?: number; shape?: "dot" | "bar" }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={shape === "bar" ? { width: 4, height: 18, borderRadius: 2, background: color } : { width: size, height: size, borderRadius: 99, background: color }}
    />
  );
}

export function ClientChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-bold whitespace-nowrap" style={{ background: color, color: "#1A0F22" }}>
      {name}
    </span>
  );
}

const TONES = {
  red: "bg-red-bg text-red",
  yellow: "bg-yellow-bg text-yellow",
  green: "bg-green-bg text-green",
  blue: "bg-blue-bg text-blue",
  neutral: "bg-line-2 text-[#e6d9f2]",
  accent: "bg-accent text-on-accent",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function PhaseBadge() {
  return <Badge tone="neutral" className="border border-line-5 bg-transparent text-faint">Fase 2</Badge>;
}

export function Section({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className, strong }: { children: ReactNode; className?: string; strong?: boolean }) {
  return <div className={cx(strong ? "card-strong" : "card", "p-5", className)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-muted">{children}</p>;
}

export function Segmented<T extends string>({ options, value, hrefFor }: { options: { value: T; label: string }[]; value: T; hrefFor: (v: T) => string }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-[10px] border border-line bg-surface-2 p-[3px]">
      {options.map((o) => (
        <Link
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          href={hrefFor(o.value)}
          scroll={false}
          className={cx(
            "inline-flex min-h-[34px] items-center rounded-lg px-3 text-[13px] font-bold no-underline",
            o.value === value ? "bg-line-2 text-white" : "text-muted hover:text-white",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function Arrow({ dir, className }: { dir: "up" | "down" | "right"; className?: string }) {
  const d = dir === "up" ? "M12 19V5M6 11l6-6 6 6" : dir === "down" ? "M12 5v14M6 13l6 6 6-6" : "M5 12h14M13 6l6 6-6 6";
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={d} />
    </svg>
  );
}
