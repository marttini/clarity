import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // Em Server Components não dá para gravar cookie; o proxy renova a sessão.
        }
      },
    },
  });
}
