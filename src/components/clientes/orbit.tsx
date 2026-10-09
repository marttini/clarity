"use client";
import Link from "next/link";
import { useState } from "react";
import type { Health } from "@/domain/rules";
import { HEALTH } from "@/components/contatos/labels";

export type OrbitClient = {
  id: string;
  name: string;
  color: string;
  health: Health;
  active: boolean;
  why: string;
  minutes: number;
  facts: { v: string; k: string; alert?: boolean }[];
  /** Fica apagado quando não passa no filtro rápido. */
  match: boolean;
};

// Raio (em % do lado) de cada zona: vermelho no centro, verde por fora.
const ZONES: Record<Health, number> = { vermelho: 12.5, amarelo: 27.5, verde: 40.5 };

function layout(list: OrbitClient[]) {
  const out = new Map<string, { x: number; y: number; size: number; labelUp: boolean }>();
  const max = Math.max(1, ...list.map((c) => c.minutes));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  (Object.keys(ZONES) as Health[]).forEach((z, zi) => {
    const group = list.filter((c) => c.health === z);
    const n = group.length;
    group.forEach((c, i) => {
      const ang = ((-90 + zi * 25 + ((i + 0.5) * 360) / Math.max(1, n)) * Math.PI) / 180;
      const r = n === 1 && z === "vermelho" ? 6 : ZONES[z] + (n > 3 ? (i % 2 ? 2.8 : -2.8) : 0);
      const y = 50 + Math.sin(ang) * r;
      out.set(c.id, { x: r2(50 + Math.cos(ang) * r), y: r2(y), size: Math.round(18 + Math.sqrt(c.minutes / max) * 28), labelUp: y < 50 && z === "amarelo" });
    });
  });
  return out;
}

/** US-45: visão Órbita da carteira. Quanto mais perto do centro, mais urgente. Tamanho = horas no período. */
export function Orbit({ clients, initial }: { clients: OrbitClient[]; initial?: string }) {
  const [sel, setSel] = useState(initial ?? clients.find((c) => c.match)?.id ?? clients[0]?.id);
  const pos = layout(clients);
  const c = clients.find((x) => x.id === sel) ?? clients[0];
  if (!c) return null;
  const z = HEALTH[c.health];
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="min-w-0 flex-[3_1_520px]">
        <div className="@container relative mx-auto aspect-square w-full max-w-[560px]">
          <div className="absolute inset-[3.5%] rounded-full border border-line-2 bg-[#150C1E]" />
          <div className="absolute inset-[16%] rounded-full border border-line-4 bg-[#1A0F25]" />
          <div className="absolute inset-[29%] rounded-full border-[1.5px] border-[#6E2A24] bg-[#23111C]" />
          <span className="absolute top-[30.5%] left-1/2 -translate-x-1/2 text-[11px] font-bold text-red">Agir agora</span>
          <span className="absolute top-[17.5%] left-1/2 -translate-x-1/2 text-[11px] font-bold text-yellow">Atenção</span>
          <span className="absolute top-[5.4%] left-1/2 -translate-x-1/2 text-[11px] font-bold text-green">Em dia</span>
          {clients.map((x) => {
            const p = pos.get(x.id)!;
            const on = x.id === c.id;
            return (
              <button
                key={x.id}
                type="button"
                aria-pressed={on}
                aria-label={`${x.name}, ${HEALTH[x.health].zone.toLowerCase()}${x.active ? "" : ", inativo"}`}
                onClick={() => setSel(x.id)}
                className={`absolute flex min-w-11 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 ${p.labelUp ? "flex-col-reverse" : "flex-col"}`}
                style={{ left: `${p.x}%`, top: `${p.y}%`, transform: p.labelUp ? `translate(-50%, calc(-100% + ${(p.size / 11.2).toFixed(2)}cqw))` : `translate(-50%, -${(p.size / 11.2).toFixed(2)}cqw)`, opacity: x.match ? (x.active ? 1 : 0.55) : 0.2, zIndex: on ? 2 : 1 }}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: `${(p.size / 5.6).toFixed(2)}cqw`,
                    height: `${(p.size / 5.6).toFixed(2)}cqw`,
                    background: x.color,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
                    outline: on ? "3px solid #FFFFFF" : undefined,
                    outlineOffset: on ? 4 : undefined,
                  }}
                />
                <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap sm:px-2 sm:text-[12px]" style={{ color: on ? "#120A19" : "#EDE6F3", background: on ? "#FFFFFF" : "rgba(18,10,25,0.85)" }}>
                  {x.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <aside aria-label="Cliente selecionado" aria-live="polite" className="flex min-w-0 flex-[2_1_320px] flex-col gap-4 rounded-[18px] border border-line-2 bg-surface-2 p-[22px]">
        <div className="flex items-center gap-3">
          <span aria-hidden className="size-4 shrink-0 rounded-full" style={{ background: c.color }} />
          <h3 className="font-display text-xl font-semibold text-white">{c.name}</h3>
        </div>
        <p className="rounded-xl px-3.5 py-3 text-sm leading-relaxed" style={{ background: z.bg, color: z.fg }}>
          {c.why}
        </p>
        <dl className="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
          {c.facts.map((f) => (
            <div key={f.k} className="flex flex-col-reverse gap-0.5">
              <dt className="text-xs text-muted">{f.k}</dt>
              <dd className={`num text-xl font-bold ${f.alert ? "text-red" : "text-white"}`}>{f.v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href={`/contatos?modo=agendar&cliente=${c.id}#form`} className="btn-primary flex-[1_1_auto] whitespace-nowrap no-underline text-on-accent! hover:text-on-accent!">
            Agendar contato
          </Link>
          <Link href={`/clientes/${c.id}`} className="btn-ghost flex-[1_1_auto] whitespace-nowrap no-underline">
            Abrir cliente
          </Link>
        </div>
      </aside>
    </div>
  );
}
