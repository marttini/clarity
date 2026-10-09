import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema as s } from "@/db";
import { readRules } from "@/server/services/settings";
import { initials } from "@/server/data/common";
import { Avatar } from "@/components/ui";
import { ActionForm } from "@/components/config/forms";
import { requireAdminPage } from "../_guard";
import { saveRulesAction } from "../actions";

export const metadata = { title: "Regras · Configurações" };

const pad = (n: number) => String(n).padStart(2, "0") + ":00";

/** Prazos e limites que geram alertas e pedidos de aprovação (US-04, US-11, US-37, US-41, US-43). */
export default async function Regras() {
  await requireAdminPage();
  const st = await readRules();
  const approvers = await db.select().from(s.people).where(and(eq(s.people.canApproveHours, true), eq(s.people.active, true))).orderBy(asc(s.people.name));
  const rows = [
    { k: "editWindowHours", title: "Prazo para editar horas", desc: "Depois disso, mudar um lançamento exige pedido de alteração aprovado.", unit: "horas", v: st.editWindowHours },
    { k: "missingDaysLimit", title: "Regra dos dias sem apontar", desc: "Dias úteis seguidos sem horas viram alerta. Ausência justificada com comprovante não conta.", unit: "dias úteis", v: st.missingDaysLimit },
    { k: "contactAlertWorkdays", title: "Cliente sem contato", desc: "Cliente ativo sem contato registrado por esse tempo vira alerta para a gestão.", unit: "dias úteis", v: st.contactAlertWorkdays },
    { k: "activeClientMonths", title: "Cliente ativo", desc: "Cliente com horas lançadas nesse período. Os demais aparecem como inativos.", unit: "meses", v: st.activeClientMonths },
    { k: "clientCommentAlertWorkdays", title: "Comentário do cliente sem resposta", desc: "Depois desse tempo, vira alerta para o responsável e entra no resumo da gestão.", unit: "dias úteis", v: st.clientCommentAlertWorkdays },
    { k: "deadlineSoonDays", title: "Prazo perto de vencer", desc: "Prazos dentro desse período deixam o cliente em amarelo na carteira.", unit: "dias", v: st.deadlineSoonDays },
  ];
  return (
    <section aria-labelledby="h-r" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-r" className="h2">
          Regras
        </h2>
        <p className="text-sm text-muted">Prazos e limites que geram alertas e pedidos de aprovação.</p>
      </div>
      <ActionForm action={saveRulesAction} className="card flex flex-col px-5 py-2">
        {rows.map((r, i) => (
          <div key={r.k} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 ${i ? "border-t border-line" : ""}`}>
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
              <strong className="text-[15px] text-white">{r.title}</strong>
              <span className="text-[13px] text-muted">{r.desc}</span>
            </div>
            <span className="flex items-center gap-2">
              <input type="number" name={r.k} aria-label={r.title} defaultValue={r.v} min={1} required className="field num w-[84px] text-[15px] font-bold" />
              <span className="text-sm text-muted">{r.unit}</span>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line py-4">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
            <strong className="text-[15px] text-white">Quem aprova alterações de horas</strong>
            <span className="text-[13px] text-muted">Recebem o pedido no Slack e na tela de Pendências. Mude em Pessoas e perfis.</span>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            {approvers.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-line-2 py-1 pr-3 pl-1 text-sm text-white">
                <Avatar name={p.name} initials={initials(p.name)} size={24} />
                {p.name}
              </span>
            ))}
            <Link href="/config" className="btn-quiet !text-accent-soft">
              Alterar
            </Link>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line py-4">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
            <strong className="text-[15px] text-white">Horário comercial dos avisos</strong>
            <span className="text-[13px] text-muted">Slack e e-mail só saem nesse horário. Fora dele, ficam para o próximo dia útil. Erro de sincronização sai na hora.</span>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            <input type="time" step={3600} name="start" aria-label="Início dos avisos" defaultValue={pad(st.businessHours.start)} className="field num w-[120px]" />
            <span className="text-sm text-muted">até</span>
            <input type="time" step={3600} name="end" aria-label="Fim dos avisos" defaultValue={pad(st.businessHours.end)} className="field num w-[120px]" />
            <span className="text-sm text-muted">dias úteis</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line py-4">
          <button className="btn-primary">Salvar alterações</button>
          <span className="text-[13px] text-faint">Horários contam em horas cheias, no horário de Brasília.</span>
        </div>
      </ActionForm>
    </section>
  );
}
