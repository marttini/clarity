"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_COOKIE, devAuthAllowed } from "@/server/session";
import { supabaseServer } from "@/server/supabase";

export async function devLogin(form: FormData) {
  if (!devAuthAllowed()) throw new Error("Login de teste desligado.");
  const id = String(form.get("id") ?? "");
  const jar = await cookies();
  jar.set(DEV_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect(id.startsWith("contact:") ? "/portal" : "/fila");
}

export async function googleLogin() {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.APP_URL}/auth/callback`,
      queryParams: { hd: process.env.TEAM_EMAIL_DOMAIN ?? "sintesebrasil.com", prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/entrar?erro=" + encodeURIComponent("Não foi possível iniciar o login com o Google."));
  redirect(data.url);
}

export async function magicLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) redirect("/entrar?erro=" + encodeURIComponent("Informe um e-mail válido."));
  const sb = await supabaseServer();
  // shouldCreateUser:false → só quem foi convidado ao portal recebe o link.
  await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${process.env.APP_URL}/auth/callback` } });
  // Mesmo se o e-mail não existir, a resposta é igual (não revela quem é cliente).
  redirect("/entrar?enviado=1");
}
