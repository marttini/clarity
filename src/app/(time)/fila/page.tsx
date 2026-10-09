import type { Metadata } from "next";
import { requireTeam } from "@/server/session";
import { ConsultantQueue } from "@/components/fila/consultant-view";
import { AdminQueue } from "@/components/fila/admin-view";
import { ManagerQueue } from "@/components/fila/manager-view";

export const metadata: Metadata = { title: "Minha fila" };

/**
 * US-46: Minha fila, a tela inicial do consultor.
 * - Consultor (inclui gestores que apontam, como Richard e Luiz): horas, itens, agenda e lançador.
 * - Administrativo (Maria, Ana Clara): só contatos, follow-ups e cobranças; nada de horas, faixas ou ranking.
 * - Administrador que não aponta (Marttini): o essencial da gestão e a agenda; a visão completa fica em /gestao.
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const data = typeof sp.data === "string" ? sp.data : null;
  if (me.isConsultor) return <ConsultantQueue me={me} initialDate={data} />;
  if (me.role === "administrativo") return <AdminQueue me={me} view={sp.ver === "semana" ? "semana" : "hoje"} />;
  return <ManagerQueue me={me} />;
}
