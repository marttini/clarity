import { asc, count } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Switch } from "@/components/config/forms";
import { requireAdminPage } from "../_guard";
import { addReasonAction, updateReasonAction } from "../actions";

export const metadata = { title: "Motivos de ausência · Configurações" };

/** Motivos usados na justificativa de dia sem apontamento (US-11). */
export default async function Ausencias() {
  await requireAdminPage();
  const reasons = await db.select().from(s.absenceReasons).orderBy(asc(s.absenceReasons.name));
  const used = await db.select({ id: s.absenceJustifications.reasonId, n: count() }).from(s.absenceJustifications).groupBy(s.absenceJustifications.reasonId);
  const uses = new Map(used.map((u) => [u.id, u.n]));
  return (
    <section aria-labelledby="h-a" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-a" className="h2">
          Motivos de ausência
        </h2>
        <p className="text-sm text-muted">Aparecem na justificativa de dia sem apontamento, sempre com comprovante. Motivo desativado some da lista, mas o histórico fica.</p>
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[560px]">
          <thead>
            <tr>
              <th scope="col">Motivo</th>
              <th scope="col">Ativo</th>
              <th scope="col" className="text-right">
                Usos
              </th>
              <th scope="col">
                <span className="sr-only">Salvar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((r) => {
              const fid = `r-${r.id}`;
              return (
                <tr key={r.id}>
                  <td>
                    <input form={fid} name="name" aria-label={`Nome do motivo ${r.name}`} defaultValue={r.name} className="field min-h-10 w-[260px] text-sm" />
                  </td>
                  <td>
                    <Switch form={fid} name="active" defaultChecked={r.active} label={`${r.name} ativo`} />
                  </td>
                  <td className="num text-right text-muted">{uses.get(r.id) ?? 0}</td>
                  <td>
                    <ActionForm id={fid} action={updateReasonAction} className="flex flex-col items-start gap-1" statusClassName="text-xs">
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn-ghost min-h-10 text-sm">Salvar</button>
                    </ActionForm>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ActionForm action={addReasonAction} resetOnOk className="card flex flex-wrap items-end gap-3 p-5">
        <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
          <span className="label">Novo motivo</span>
          <input name="name" required minLength={2} maxLength={60} placeholder="Ex.: Licença" className="field" />
        </label>
        <button className="btn-primary">Adicionar</button>
      </ActionForm>
    </section>
  );
}
