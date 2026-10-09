import { redirect } from "next/navigation";
import { getSession, isManager } from "@/server/session";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/entrar");
  if (s.kind === "client") redirect("/portal");
  redirect(isManager(s.person) ? "/gestao" : "/fila");
}
