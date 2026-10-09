import { count, eq, inArray, max } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ConfigNav } from "@/components/config/forms";
import { requireAdminPage } from "./_guard";

/** Configurações (só Administrador): navegação lateral da V3. */
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const [[people], [types], [errs], [last]] = await Promise.all([
    db.select({ n: count() }).from(s.people).where(eq(s.people.active, true)),
    db.select({ n: count() }).from(s.entryTypes).where(eq(s.entryTypes.active, true)),
    db.select({ n: count() }).from(s.syncQueue).where(inArray(s.syncQueue.status, ["erro"])),
    db.select({ at: max(s.syncState.lastRunAt) }).from(s.syncState),
  ]);
  const items = [
    { href: "/config", label: "Pessoas e perfis", hint: `${people.n} pessoas` },
    { href: "/config/tipos", label: "Tipos de apontamento", hint: `${types.n} ativos` },
    { href: "/config/metas", label: "Metas e faixas", hint: "cota, faixas, time" },
    { href: "/config/regras", label: "Regras", hint: "prazos e alertas" },
    { href: "/config/feriados", label: "Feriados", hint: "dias não úteis" },
    { href: "/config/ausencias", label: "Motivos de ausência", hint: "justificativas" },
    { href: "/config/integracao", label: "Integração Odoo", hint: errs.n ? `${errs.n} com erro na fila` : last.at ? "sincronizando" : "nunca sincronizado" },
    { href: "/config/tv", label: "Links de TV", hint: "modo TV" },
    { href: "/config/notificacoes", label: "Notificações", hint: "Slack e e-mail" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">Configurações</h1>
          <p className="text-base text-muted">Regras, metas e integrações do Clarity. Mudanças valem para todo o time.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-line-5 px-3 py-1.5 text-[13px] font-semibold text-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Só Administrador vê esta tela
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <ConfigNav items={items} />
        <div className="flex min-w-0 flex-[4_1_640px] flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}
