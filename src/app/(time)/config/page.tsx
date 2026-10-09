import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { initials } from "@/server/data/common";
import { Avatar, cx } from "@/components/ui";
import { ActionForm, Switch } from "@/components/config/forms";
import { requireAdminPage } from "./_guard";
import { updatePersonAction } from "./actions";

export const metadata = { title: "Pessoas e perfis · Configurações" };

const ROLES = [
  { v: "administrador", label: "Administrador" },
  { v: "gestor", label: "Gestor" },
  { v: "consultor", label: "Consultor" },
  { v: "administrativo", label: "Administrativo" },
] as const;

const Lock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

/** US-32: perfis, permissões especiais e Slack de cada pessoa. O marcador Consultor vem do Odoo. */
export default async function Pessoas({ searchParams }: { searchParams: Promise<{ perfil?: string }> }) {
  await requireAdminPage();
  const { perfil } = await searchParams;
  const all = await db.select().from(s.people).orderBy(asc(s.people.name));
  const people = all.filter((p) => p.active && (!perfil || p.role === perfil));
  const inactive = all.filter((p) => !p.active);
  return (
    <section aria-labelledby="h-p" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="h-p" className="h2">
            Pessoas e perfis
          </h2>
          <p className="text-sm text-muted">Todos veem tudo. O perfil define quem pode aprovar, configurar e confirmar escopo.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por perfil">
          <Link href="/config" aria-pressed={!perfil} className="chip no-underline aria-pressed:!text-on-accent">
            Todos
          </Link>
          {ROLES.map((r) => (
            <Link key={r.v} href={`/config?perfil=${r.v}`} aria-pressed={perfil === r.v} className="chip no-underline aria-pressed:!text-on-accent">
              {r.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[1000px]">
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col">Perfil</th>
              <th scope="col">Consultor no Odoo</th>
              <th scope="col">Aprova horas</th>
              <th scope="col">Confirma escopo</th>
              <th scope="col">Slack (ID do membro)</th>
              <th scope="col">
                <span className="sr-only">Salvar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const fid = `p-${p.id}`;
              return (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={p.name} initials={initials(p.name)} size={32} color={p.role === "administrador" ? "#A897F5" : undefined} />
                      <div className="flex min-w-0 flex-col">
                        <strong className="text-white">{p.name}</strong>
                        <span className="text-xs text-faint">{p.jobTitle ?? p.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${fid}-role`}>
                      Perfil de {p.name}
                    </label>
                    <select id={`${fid}-role`} name="role" form={fid} defaultValue={p.role} className="field min-h-10 w-[170px] py-1 text-sm">
                      {ROLES.map((r) => (
                        <option key={r.v} value={r.v}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span title="Vem do cadastro do funcionário no Odoo" className={cx("inline-flex items-center gap-1.5 font-bold", p.isConsultor ? "text-white" : "text-faint")}>
                      <Lock />
                      {p.isConsultor ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td>
                    <Switch form={fid} name="canApproveHours" defaultChecked={p.canApproveHours} label={`${p.name} aprova alterações de horas`} />
                  </td>
                  <td>
                    <Switch form={fid} name="canConfirmScope" defaultChecked={p.canConfirmScope} label={`${p.name} confirma escopo`} />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${fid}-slack`}>
                      ID do Slack de {p.name}
                    </label>
                    <input id={`${fid}-slack`} name="slackUserId" form={fid} defaultValue={p.slackUserId ?? ""} placeholder="Sem Slack" className="field num min-h-10 w-[150px] text-sm" />
                  </td>
                  <td className="min-w-[160px]">
                    <ActionForm id={fid} action={updatePersonAction} className="flex flex-col items-start gap-1" statusClassName="text-xs">
                      <input type="hidden" name="id" value={p.id} />
                      <button className="btn-ghost min-h-10 text-sm">Salvar</button>
                    </ActionForm>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="inline-flex items-start gap-2 text-[13px] text-muted">
        <Lock />O marcador &quot;Consultor&quot; vem do cadastro do funcionário no Odoo: só consultores apontam horas e entram em carga, ranking, faixas e regra dos 3 dias. Aqui é só leitura; para mudar, ajuste no Odoo.
      </p>
      <p className="text-[13px] text-muted">O ID do Slack fica no perfil da pessoa no Slack, em &quot;Copiar ID do membro&quot;. Sem ele, os avisos dessa pessoa ficam só no sino.</p>
      {inactive.length > 0 && <p className="text-[13px] text-faint">Desligados no Odoo (sem acesso, histórico preservado): {inactive.map((p) => p.name).join(", ")}.</p>}
    </section>
  );
}

