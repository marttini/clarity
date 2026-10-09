import "server-only";
import { redirect } from "next/navigation";
import { requireTeam, isAdmin } from "@/server/session";

/** Configurações: só Administrador. Os demais voltam para a fila. */
export async function requireAdminPage() {
  const me = await requireTeam();
  if (!isAdmin(me)) redirect("/fila");
  return me;
}
