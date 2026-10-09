import { desc } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Badge } from "@/components/ui";
import { ActionForm } from "@/components/config/forms";
import { dateTime } from "@/components/portal/format";
import { requireAdminPage } from "../_guard";
import { createTvAction, revokeTvAction } from "../actions";

export const metadata = { title: "Links de TV · Configurações" };

/** US-49: link próprio de TV, só leitura, revogável. */
export default async function Tv() {
  await requireAdminPage();
  const rows = await db.select().from(s.tvTokens).orderBy(desc(s.tvTokens.createdAt));
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  return (
    <section aria-labelledby="h-tv" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-tv" className="h2">
          Links de TV
        </h2>
        <p className="text-sm text-muted">Cada TV usa um link próprio, só de leitura, sem login. Revogue quando a TV sair do escritório ou o link vazar.</p>
      </div>
      <ActionForm action={createTvAction} resetOnOk className="card flex flex-wrap items-end gap-3 p-5">
        <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
          <span className="label">Nome do link</span>
          <input name="label" required maxLength={60} placeholder="Ex.: TV da sala de reunião" className="field" />
        </label>
        <button className="btn-primary">Criar link</button>
      </ActionForm>
      <div className="table-wrap">
        <table className="tbl min-w-[720px]">
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Endereço</th>
              <th scope="col">Criado em</th>
              <th scope="col">Situação</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.revokedAt ? "opacity-70" : ""}>
                <td className="text-white">{t.label}</td>
                <td>
                  {t.revokedAt ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <code className="num rounded-md bg-surface-2 px-2 py-1 text-xs break-all text-accent-soft">
                      {base}/tv/{t.token}
                    </code>
                  )}
                </td>
                <td className="num text-muted">{dateTime(t.createdAt)}</td>
                <td>{t.revokedAt ? <Badge>Revogado em {dateTime(t.revokedAt)}</Badge> : <Badge tone="green">Ativo</Badge>}</td>
                <td className="text-right">
                  {!t.revokedAt && (
                    <ActionForm action={revokeTvAction} confirm={`Revogar "${t.label}"? A TV deixa de mostrar os painéis.`} className="flex flex-col items-end gap-1" statusClassName="text-xs">
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn-quiet min-h-10 text-sm !text-red">Revogar</button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-8 text-center text-muted">Nenhum link de TV ainda.</p>}
      </div>
    </section>
  );
}
