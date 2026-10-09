import { requireClient } from "@/server/session";
import { initials } from "@/server/data/common";
import { portalPeople } from "@/server/services/portal";
import { Avatar } from "@/components/ui";
import { InviteForm } from "@/components/portal/forms";
import { inviteAction } from "../actions";

export const metadata = { title: "Convidar colegas · Portal Síntese" };

/** US-31: o contato convida colegas que já estão cadastrados como contatos da empresa no Odoo. */
export default async function Convidar() {
  const me = await requireClient();
  const people = await portalPeople(me);
  const domain = me.email?.split("@")[1] ?? "empresa.com.br";
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="h1">Convidar colegas</h1>
        <p className="max-w-[70ch] text-base leading-normal text-muted">Quem você convidar vê os mesmos projetos e também pode aprovar demandas. O convite chega por e-mail.</p>
      </div>
      <section aria-labelledby="cv" className="card-strong flex flex-wrap items-start gap-x-8 gap-y-5 px-[22px] py-5">
        <div className="flex min-w-0 flex-[3_1_420px] flex-col gap-3">
          <h2 id="cv" className="text-[17px] font-bold text-white">
            Convidar colegas da {me.clientName}
          </h2>
          <span className="text-sm leading-snug text-muted">Escreva um ou mais e-mails, separados por vírgula. Só recebem convite as pessoas que a Síntese já tem como contato da {me.clientName}.</span>
          <InviteForm action={inviteAction} placeholder={`nome@${domain}, outro@${domain}`} />
        </div>
        <div className="flex min-w-0 flex-[2_1_300px] flex-col">
          <span className="pb-1.5 text-[13px] font-bold text-muted">Quem já tem acesso</span>
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-t border-line-3 py-2">
              <Avatar name={p.name} initials={initials(p.name)} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-white">
                  {p.name}
                  {p.id === me.id ? " (você)" : ""}
                </span>
                {p.jobTitle && <span className="text-[13px] text-faint">{p.jobTitle}</span>}
              </div>
              {p.lastAccessAt ? (
                <span className="text-xs text-faint">Acesso ativo</span>
              ) : (
                <span className="rounded-full bg-blue-bg px-2.5 py-1 text-xs font-bold text-blue">Convite enviado</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
