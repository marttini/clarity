import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireClient, devAuthAllowed } from "@/server/session";
import { initials } from "@/server/data/common";
import { listDemands, pendingEvaluations, touchAccess } from "@/server/services/portal";
import { PortalNav } from "@/components/portal/forms";
import { Avatar } from "@/components/ui";

/** Portal do cliente: cabeçalho próprio, só para contatos com acesso (US-31). */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireClient();
  await touchAccess(me);
  const [[client], demands, evals] = await Promise.all([
    db.select({ name: s.clients.name, color: s.clients.color }).from(s.clients).where(eq(s.clients.id, me.clientId)),
    listDemands(me),
    pendingEvaluations(me),
  ]);
  const waiting = demands.filter((d) => d.status === "aguardando").length;

  return (
    <div className="flex min-h-dvh flex-col">
      {devAuthAllowed() && process.env.NODE_ENV === "production" && (
        <div className="bg-yellow-bg px-4 py-1.5 text-center text-xs font-bold text-yellow">Ambiente de teste: dados fictícios e login sem senha.</div>
      )}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-3 px-[clamp(16px,3vw,32px)] py-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <Link href="/portal" className="font-display text-[19px] font-bold tracking-[-0.02em] text-white no-underline">
              clarity
            </Link>
            <span className="inline-flex min-w-0 items-center gap-2 border-l border-line-3 pl-3.5 text-sm font-semibold text-muted">
              Síntese <span aria-hidden className="text-faint">×</span>
              <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: client?.color ?? "#9C93AE" }} />
              <span className="truncate text-white">{client?.name ?? me.clientName}</span>
            </span>
          </div>
          <PortalNav
            items={[
              { href: "/portal", label: "Andamento" },
              { href: "/portal/demandas", label: "Demandas adicionais", badge: waiting },
              { href: "/portal/mensagens", label: "Mensagens" },
              { href: "/portal/arquivos", label: "Arquivos" },
              { href: "/portal/avaliar", label: "Avaliar", badge: evals.length },
            ]}
          />
          <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2.5">
            <Link href="/portal/convidar" className="btn-ghost min-h-11 gap-2 text-sm font-bold !text-accent-soft no-underline">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="9" cy="8" r="4" />
                <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M19 8v6M16 11h6" />
              </svg>
              Convidar colegas
            </Link>
            <span role="img" aria-label={`${me.name}, ${me.clientName}`}>
              <Avatar name={me.name} initials={initials(me.name)} size={36} color={client?.color ?? "#F59A6B"} />
            </span>
            <form action="/sair" method="post"><button className="btn-quiet text-sm text-muted">Sair</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto box-border flex w-full max-w-[1280px] flex-1 flex-col gap-7 px-[clamp(16px,3vw,32px)] pt-[30px] pb-14">{children}</main>
      <footer className="flex flex-col items-center gap-1 border-t border-line px-[clamp(16px,3vw,32px)] py-5 text-center text-[13px] text-faint">
        <span>Dúvidas sobre o portal? Fale com a Síntese pela aba Mensagens.</span>
        <span className="font-semibold text-muted">Síntese · Presente na sua gestão</span>
      </footer>
    </div>
  );
}
