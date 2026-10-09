import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager, isAdmin, devAuthAllowed } from "@/server/session";
import { initials } from "@/server/data/common";
import { MainNav, type NavItem } from "@/components/nav";
import { Avatar } from "@/components/ui";
import { CommandPalette } from "@/components/command-palette";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const me = await requireTeam();
  const [{ unread }] = await db
    .select({ unread: count() })
    .from(s.notifications)
    .where(and(eq(s.notifications.personId, me.id), isNull(s.notifications.readAt)));

  const items: NavItem[] = [
    { href: "/fila", label: "Minha fila" },
    ...(me.isConsultor ? [{ href: "/horas", label: "Horas" }] : []),
    { href: "/projetos", label: "Projetos" },
    { href: "/clientes", label: "Clientes" },
    { href: "/contatos", label: "Contatos" },
    { href: "/time", label: "Time" },
    { href: "/gestao", label: "Gestão" },
    { href: "/ranking", label: "Ranking" },
    ...(isAdmin(me) ? [{ href: "/config", label: "Configurações" }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      {devAuthAllowed() && process.env.NODE_ENV === "production" && (
        <div className="bg-yellow-bg px-4 py-1.5 text-center text-xs font-bold text-yellow">Ambiente de teste: dados fictícios e login sem senha.</div>
      )}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-[clamp(16px,3vw,32px)] py-3">
        <Link href="/fila" className="font-display text-[19px] font-bold tracking-[-0.02em] text-white no-underline">
          clarity
        </Link>
        <MainNav items={items} />
        <div className="ml-auto flex items-center gap-2">
          <CommandPalette isManager={isManager(me)} />
          <Link href="/avisos" className="relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-muted no-underline hover:text-white" aria-label={`Avisos${unread ? `: ${unread} não lidos` : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-extrabold text-on-accent">{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
          <Link href={`/time/${me.id}`} className="no-underline" aria-label="Minha ficha">
            <Avatar name={me.name} initials={initials(me.name)} size={34} color="#A897F5" />
          </Link>
          <Link href="/sair" className="btn-quiet text-sm text-muted" prefetch={false}>Sair</Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-8 px-[clamp(16px,3vw,32px)] pt-6 pb-12">{children}</main>
    </div>
  );
}
