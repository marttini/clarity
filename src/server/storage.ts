import "server-only";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * Arquivos (anexos, comprovantes, prints). Produção: Supabase Storage (bucket privado "anexos").
 * Desenvolvimento e testes: pasta ./storage local.
 */
export const MAX_BYTES = 25 * 1024 * 1024;
const BLOCKED = /\.(exe|bat|cmd|com|msi|sh|ps1|js|vbs|scr|jar|apk|dll)$/i;

export function checkFile(name: string, size: number): string | null {
  if (size > MAX_BYTES) return "O arquivo passa de 25 MB.";
  if (BLOCKED.test(name)) return "Arquivos executáveis não são aceitos.";
  if (size === 0) return "O arquivo está vazio.";
  return null;
}

function supabaseConfigured() {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export async function putFile(key: string, data: Buffer, mime: string): Promise<string> {
  if (supabaseConfigured()) {
    const { error } = await admin().storage.from("anexos").upload(key, data, { contentType: mime, upsert: false });
    if (error) throw new Error("Falha ao guardar o arquivo: " + error.message);
    return key;
  }
  const full = path.join(process.cwd(), "storage", key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  if (supabaseConfigured()) {
    const { data, error } = await admin().storage.from("anexos").download(key);
    if (error || !data) throw new Error("Arquivo não encontrado.");
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(path.join(process.cwd(), "storage", key));
}
