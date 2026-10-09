import { asc, count } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { Badge } from "@/components/ui";
import { ActionForm, Switch } from "@/components/config/forms";
import { requireAdminPage } from "../_guard";
import { createTypeAction, deleteTypeAction, updateTypeAction } from "../actions";

export const metadata = { title: "Tipos de apontamento · Configurações" };

/** US-08: criar, renomear e desativar tipos. Os 4 padrão não se excluem; tipo usado só se desativa. */
export default async function Tipos() {
  await requireAdminPage();
  const types = await db.select().from(s.entryTypes).orderBy(asc(s.entryTypes.sort), asc(s.entryTypes.name));
  const used = await db.select({ typeId: s.timeEntries.typeId, n: count() }).from(s.timeEntries).groupBy(s.timeEntries.typeId);
  const uses = new Map(used.map((u) => [u.typeId, u.n]));
  return (
    <section aria-labelledby="h-t" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-t" className="h2">
          Tipos de apontamento
        </h2>
        <p className="text-sm text-muted">Só Faturável conta para cota, faixas e metas. Provisionamento nunca soma em realizado. Tipo já usado não se exclui: desative.</p>
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Código no Odoo</th>
              <th scope="col">Aceita pedido de venda</th>
              <th scope="col">Ativo</th>
              <th scope="col" className="text-right">
                Lançamentos
              </th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const fid = `t-${t.id}`;
              const n = uses.get(t.id) ?? 0;
              return (
                <tr key={t.id} className={t.active ? "" : "opacity-70"}>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`${fid}-n`}>
                        Nome do tipo {t.name}
                      </label>
                      <input id={`${fid}-n`} form={fid} name="name" defaultValue={t.name} className="field min-h-10 w-[200px] text-sm" />
                      {t.builtin && <Badge>Padrão</Badge>}
                      {t.countsForBonus && <Badge tone="green">Conta para faixas</Badge>}
                    </div>
                  </td>
                  <td className="num text-muted">{t.code}</td>
                  <td>
                    <Switch form={fid} name="acceptsSalesOrder" defaultChecked={t.acceptsSalesOrder} disabled={t.builtin} label={`${t.name} aceita pedido de venda`} />
                  </td>
                  <td>
                    <Switch form={fid} name="active" defaultChecked={t.active} disabled={t.builtin} label={`${t.name} ativo`} />
                  </td>
                  <td className="num text-right text-muted">{n}</td>
                  <td className="min-w-[220px]">
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionForm id={fid} action={updateTypeAction} className="flex flex-col items-start gap-1" statusClassName="text-xs">
                        <input type="hidden" name="id" value={t.id} />
                        {t.builtin && <input type="hidden" name="builtin" value="1" />}
                        <button className="btn-ghost min-h-10 text-sm">Salvar</button>
                      </ActionForm>
                      {!t.builtin && n === 0 && (
                        <ActionForm action={deleteTypeAction} confirm={`Excluir o tipo "${t.name}"?`} className="flex flex-col items-start gap-1" statusClassName="text-xs">
                          <input type="hidden" name="id" value={t.id} />
                          <button className="btn-quiet min-h-10 text-sm !text-red">Excluir</button>
                        </ActionForm>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ActionForm action={createTypeAction} resetOnOk className="card flex flex-wrap items-end gap-4 p-5">
        <h3 className="h3 basis-full">Novo tipo</h3>
        <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
          <span className="label">Nome</span>
          <input name="name" required minLength={2} maxLength={60} placeholder="Ex.: Treinamento" className="field" />
        </label>
        <div className="flex items-center gap-2">
          <Switch name="acceptsSalesOrder" label="Aceita pedido de venda" />
          <span className="text-sm text-ink">Aceita pedido de venda</span>
        </div>
        <button className="btn-primary">Criar tipo</button>
        <p className="basis-full text-[13px] text-faint">O código gerado precisa existir como opção do campo Tipo de apontamento no Odoo (Studio). Avise quem cuida do Odoo antes de usar o tipo novo.</p>
      </ActionForm>
    </section>
  );
}
