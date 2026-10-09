import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE, authMode } from "@/server/session";
import { supabaseServer } from "@/server/supabase";

/** Sair só por POST: um link externo não consegue deslogar ninguém. */
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/", req.url));
}

export async function POST(req: NextRequest) {
  const jar = await cookies();
  jar.delete(DEV_COOKIE);
  if (authMode() === "supabase") await (await supabaseServer()).auth.signOut();
  return NextResponse.redirect(new URL("/entrar", req.url), 303);
}
