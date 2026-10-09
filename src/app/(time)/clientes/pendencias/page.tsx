import Link from "next/link";
import { requireTeam } from "@/server/session";
import { shortDate, toISODate } from "@/domain/dates";
import { hhmm, syncPendencies } from "@/server/queries/clients";
import { cx } from "@/components/ui";

export const metadata = { title: "Pendências do Odoo · Clarity" };

const MODEL_LABEL: Record<string, string> = {
  "project.project": "Projeto anual",
  "project.task": "Tarefa",
  "hr.employee": "Funcionário",
  "res.partner": "Cliente ou contato",
};

/** US-28: projetos anuais sem cliente no Odoo (e outras pendências da sincronização) para correção. */
export default async function PendenciasPage() {
  await requireTeam();
  const rows = await syncPendencies();
  const projects = rows.filter((r) => r.model === "project.project");
  const others = rows.filter((r) => r.model !== "project.project");
  const open = projects.filter((r) => !r.resolved).length;

  const table = (list: typeof rows, showStatus: boolean) => (
    <div className="table-wrap">
      {list.length === 0 ? (
        <p className="p-6 text-center text-muted">Nada pendente.</p>
      ) : (
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th scope="col" className="pl-4!">Visto em</th>
              <th scope="col">No Odoo</th>
              <th scope="col">O que corrigir</th>
              {showStatus && <th scope="col" className="pr-4!">Situação</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="num pl-4! text-[13px] whitespace-nowrap text-muted">
                  {shortDate(toISODate(r.at))} {hhmm(r.at)}
                </td>
                <td className="whitespace-nowrap">
                  {MODEL_LABEL[r.model] ?? r.model}
                  {r.odooId !== null && <span className="num ml-1.5 text-xs text-faint">#{r.odooId}</span>}
                </td>
                <td className="text-ink">{r.message}</td>
                {showStatus && (
                  <td className="pr-4!">
                    {r.resolved ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-green-bg px-2.5 py-1 text-xs font-bold text-green">Corrigido</span>
                        {r.resolvedClient && (
                          <Link href={`/clientes/${r.resolvedClient.id}`} className="text-[13px]">
                            {r.resolvedClient.name}
                          </Link>
                        )}
                      </span>
                    ) : (
                      <span className="rounded-full bg-yellow-bg px-2.5 py-1 text-xs font-bold text-yellow">Aguardando correção</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-sm text-faint">
          <Link href="/clientes" className="font-semibold no-underline">
            Clientes
          </Link>
          <span aria-hidden>/</span>
          <span className="font-semibold text-white">Pendências do Odoo</span>
        </nav>
        <h1 className="h1">Pendências do Odoo</h1>
        <p className={cx("text-[15px]", open ? "text-yellow" : "text-muted")}>
          {open
            ? `${open} ${open === 1 ? "projeto anual está" : "projetos anuais estão"} sem cliente no Odoo. Informe o cliente no projeto, no Odoo; na próxima sincronização ele entra no Clarity.`
            : "Nenhum projeto anual sem cliente. A sincronização roda a cada 15 minutos."}
        </p>
      </div>
      <section aria-labelledby="pp" className="flex flex-col gap-3">
        <h2 id="pp" className="h2">
          Projetos anuais sem cliente
        </h2>
        {table(projects, true)}
      </section>
      {others.length > 0 && (
        <section aria-labelledby="po" className="flex flex-col gap-3">
          <h2 id="po" className="h2">
            Outras pendências da sincronização
          </h2>
          {table(others, false)}
        </section>
      )}
    </>
  );
}
