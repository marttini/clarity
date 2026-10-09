import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { authMode, devAuthAllowed, getSession } from "@/server/session";
import { devLogin } from "./actions";
import { GoogleButton, MagicLinkForm } from "./forms";

export const metadata = { title: "Entrar" };

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ erro?: string; enviado?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) redirect(session.kind === "team" ? "/fila" : "/portal");

  const dev = devAuthAllowed();
  const people = dev ? await db.select().from(s.people).where(eq(s.people.active, true)).orderBy(asc(s.people.name)) : [];
  const contacts = dev
    ? await db
        .select({ id: s.clientContacts.id, name: s.clientContacts.name, client: s.clients.name })
        .from(s.clientContacts)
        .innerJoin(s.clients, eq(s.clients.id, s.clientContacts.clientId))
        .where(eq(s.clientContacts.portalAccess, true))
        .orderBy(asc(s.clients.name))
    : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <span className="font-display text-3xl font-bold tracking-[-0.02em] text-white">clarity</span>
        <p className="text-muted">Projetos, tarefas, horas e clientes da Síntese em um só lugar.</p>
      </div>
      {sp.erro && <p className="rounded-xl bg-red-bg px-4 py-3 text-red">{sp.erro}</p>}
      {sp.enviado && <p className="rounded-xl bg-green-bg px-4 py-3 text-green">Enviamos um link de acesso para o seu e-mail.</p>}

      {authMode() === "supabase" && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card flex flex-col gap-3 p-6">
            <h2 className="h3">Sou da Síntese</h2>
            <p className="text-sm text-muted">Entre com a sua conta Google da Síntese.</p>
            <GoogleButton />
          </div>
          <div className="card flex flex-col gap-3 p-6">
            <h2 className="h3">Sou cliente</h2>
            <p className="text-sm text-muted">Receba um link de acesso no seu e-mail. Não precisa de senha.</p>
            <MagicLinkForm />
          </div>
        </div>
      )}

      {dev && (
        <div className="flex flex-col gap-6">
          <p className="rounded-xl bg-yellow-bg px-4 py-3 text-sm text-yellow">Ambiente de teste: escolha quem você quer ser. Em produção, o login é pelo Google da Síntese.</p>
          <form action={devLogin} className="flex flex-col gap-3">
            <h2 className="h3">Time</h2>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <button key={p.id} name="id" value={p.id} className="chip min-h-11 px-4 hover:bg-line">
                  {p.name} <span className="ml-1.5 text-faint">{p.role === "administrador" ? "admin" : p.role}</span>
                </button>
              ))}
            </div>
            <h2 className="h3 mt-4">Clientes (portal)</h2>
            <div className="flex flex-wrap gap-2">
              {contacts.map((c) => (
                <button key={c.id} name="id" value={`contact:${c.id}`} className="chip min-h-11 px-4 hover:bg-line">
                  {c.name} <span className="ml-1.5 text-faint">{c.client}</span>
                </button>
              ))}
            </div>
          </form>
        </div>
      )}
      {!dev && authMode() === "dev" && <p className="text-red">Login de teste desligado em produção. Configure AUTH_MODE=supabase.</p>}
    </main>
  );
}
