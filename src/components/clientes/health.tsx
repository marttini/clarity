import type { Health } from "@/domain/rules";
import { HEALTH } from "@/components/contatos/labels";
import { cx } from "@/components/ui";

export function HealthDot({ health, size = 12 }: { health: Health; size?: number }) {
  return (
    <span
      role="img"
      aria-label={`Saúde: ${HEALTH[health].label.toLowerCase()}`}
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: HEALTH[health].dot }}
    />
  );
}

export function HealthChip({ health, className }: { health: Health; className?: string }) {
  const h = HEALTH[health];
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-bold whitespace-nowrap", className)} style={{ background: h.bg, color: h.fg }}>
      <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: h.dot }} />
      Saúde: {h.label}
    </span>
  );
}

/** "Comentário sem resposta e 1 prazo vencido." */
export function reasonsText(reasons: string[], health: Health): string {
  if (!reasons.length) return health === "verde" ? "Tudo em dia." : "";
  const t = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")} e ${reasons.at(-1)}`;
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

export function Swatch({ color, size = 12, radius = 3 }: { color: string; size?: number; radius?: number }) {
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size, borderRadius: radius, background: color }} />;
}
