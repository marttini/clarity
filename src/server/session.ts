import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { supabaseServer } from "./supabase";

export type TeamUser = typeof s.people.$inferSelect;
export type ClientUser = typeof s.clientContacts.$inferSelect & { clientName: string };

export type Session =
  | { kind: "team"; person: TeamUser }
  | { kind: "client"; contact: ClientUser }
  | null;

export const DEV_COOKIE = "clarity_dev_user";

export function authMode(): "dev" | "supabase" {
  return process.env.AUTH_MODE === "supabase" ? "supabase" : "dev";
}

/** Login de teste só é aceito fora de produção, ou com liberação explícita (ambiente de homologação). */
export function devAuthAllowed(): boolean {
  if (authMode() !== "dev") return false;
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_AUTH === "true";
}

async function loadByEmail(email: string): Promise<Session> {
  const e = email.toLowerCase();
  const domain = (process.env.TEAM_EMAIL_DOMAIN ?? "sintesebrasil.com").toLowerCase();
  if (e.endsWith("@" + domain)) {
    const [person] = await db.select().from(s.people).where(and(eq(s.people.email, e), eq(s.people.active, true)));
    return person ? { kind: "team", person } : null;
  }
  const rows = await db
    .select({ c: s.clientContacts, clientName: s.clients.name })
    .from(s.clientContacts)
    .innerJoin(s.clients, eq(s.clients.id, s.clientContacts.clientId))
    .where(and(eq(s.clientContacts.email, e), eq(s.clientContacts.portalAccess, true), eq(s.clientContacts.active, true)));
  if (!rows[0]) return null;
  return { kind: "client", contact: { ...rows[0].c, clientName: rows[0].clientName } };
}

export const getSession = cache(async (): Promise<Session> => {
  if (authMode() === "dev") {
    if (!devAuthAllowed()) return null;
    const jar = await cookies();
    const v = jar.get(DEV_COOKIE)?.value;
    if (!v) return null;
    if (v.startsWith("contact:")) {
      const id = v.slice(8);
      const rows = await db
        .select({ c: s.clientContacts, clientName: s.clients.name })
        .from(s.clientContacts)
        .innerJoin(s.clients, eq(s.clients.id, s.clientContacts.clientId))
        .where(and(eq(s.clientContacts.id, id), eq(s.clientContacts.portalAccess, true)));
      return rows[0] ? { kind: "client", contact: { ...rows[0].c, clientName: rows[0].clientName } } : null;
    }
    const [person] = await db.select().from(s.people).where(and(eq(s.people.id, v), eq(s.people.active, true)));
    return person ? { kind: "team", person } : null;
  }
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user?.email) return null;
  return loadByEmail(data.user.email);
});

/** Exige alguém do time. Use em toda página e ação interna. */
export async function requireTeam(): Promise<TeamUser> {
  const s = await getSession();
  if (!s) redirect("/entrar");
  if (s.kind !== "team") redirect("/portal");
  return s.person;
}

export async function requireClient(): Promise<ClientUser> {
  const s = await getSession();
  if (!s) redirect("/entrar");
  if (s.kind !== "client") redirect("/");
  return s.contact;
}

export function isManager(p: TeamUser): boolean {
  return p.role === "administrador" || p.role === "gestor";
}

export function isAdmin(p: TeamUser): boolean {
  return p.role === "administrador";
}

export class Forbidden extends Error {
  constructor(msg = "Você não tem permissão para isso.") {
    super(msg);
  }
}
