import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE, authMode } from "@/server/session";
import { supabaseServer } from "@/server/supabase";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  jar.delete(DEV_COOKIE);
  if (authMode() === "supabase") await (await supabaseServer()).auth.signOut();
  return NextResponse.redirect(new URL("/entrar", req.url));
}
