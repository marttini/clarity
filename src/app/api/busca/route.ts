import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getSession } from "@/server/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "team") return NextResponse.json([], { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json([]);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const [clients, items, people] = await Promise.all([
    db.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(and(eq(s.clients.active, true), ilike(s.clients.name, like))).limit(5),
    db
      .select({ id: s.items.id, name: s.items.name, kind: s.items.kind, client: s.clients.name })
      .from(s.items)
      .innerJoin(s.annualProjects, eq(s.annualProjects.id, s.items.annualProjectId))
      .innerJoin(s.clients, eq(s.clients.id, s.annualProjects.clientId))
      .where(and(eq(s.items.archived, false), or(ilike(s.items.name, like), ilike(s.clients.name, like))))
      .limit(8),
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(and(eq(s.people.active, true), ilike(s.people.name, like))).limit(5),
  ]);
  return NextResponse.json([
    ...clients.map((c) => ({ label: c.name, hint: "Cliente", href: `/clientes/${c.id}` })),
    ...people.map((p) => ({ label: p.name, hint: "Pessoa", href: `/time/${p.id}` })),
    ...items.map((i) => ({ label: i.name, hint: `${i.kind === "projeto" ? "Projeto" : "Tarefa"} · ${i.client}`, href: `/projetos/${i.id}` })),
  ]);
}
