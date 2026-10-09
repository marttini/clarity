import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/server/supabase";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/entrar?erro=" + encodeURIComponent("Link inválido ou expirado."), req.url));
  }
  return NextResponse.redirect(new URL("/", req.url));
}
