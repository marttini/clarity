import Link from "next/link";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { now } from "@/lib/clock";
import { readRules } from "@/server/services/settings";
import { gestaoChannel, notifyMode } from "@/server/services/notifications";
import { Badge, PhaseBadge } from "@/components/ui";
import { requireAdminPage } from "../_guard";

export const metadata = { title: "Notificações · Configurações" };

/** Central de avisos (US-43): situação dos canais. Segredos ficam só em variáveis de ambiente. */
export default async function Notificacoes() {
  await requireAdminPage();
  const st = await readRules();
  const since = new Date(now().getTime() - 24 * 3_600_000);
  const [[noSlack], q] = await Promise.all([
    db.select({ n: count() }).from(s.people).where(and(eq(s.people.active, true), isNull(s.people.slackUserId))),
    db.select({ status: s.outbox.status, n: count() }).from(s.outbox).where(gte(s.outbox.createdAt, since)).groupBy(s.outbox.status),
  ]);
  const qs = Object.fromEntries(q.map((r) => [r.status, r.n])) as Record<string, number>;
  const slack = !!process.env.SLACK_BOT_TOKEN;
  const email = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
  const mode = notifyMode();
  const h = (n: number) => `${String(n).padStart(2, "0")}h`;
  return (
    <section aria-labelledby="h-n" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-n" className="h2">
          Notificações
        </h2>
        <p className="text-sm text-muted">
          Avisos externos só saem em horário comercial ({h(st.businessHours.start)} às {h(st.businessHours.end)}, dias úteis). O resto espera o próximo dia útil. Cada aviso vai ao sino e a no máximo um canal.
        </p>
      </div>
      {mode === "dry-run" && (
        <p role="status" className="rounded-xl bg-yellow-bg px-4 py-3 text-sm font-semibold text-yellow">
          Modo de teste: os avisos são registrados como enviados, mas nada sai para o Slack ou e-mail. Para enviar de verdade, configure NOTIFY_MODE=live no servidor.
        </p>
      )}
      <div className="flex flex-col gap-2.5 rounded-[18px] border border-line-2 bg-surface-2 px-5 pt-[18px] pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="h3">Slack do time</h3>
          {slack ? <Badge tone="green">Conectado</Badge> : <Badge tone="red">Não conectado</Badge>}
        </div>
        <p className="text-[13px] text-muted">
          Resumo diário às 8h em {gestaoChannel()} e mensagens diretas para cada pessoa. {slack ? "" : "Falta o token do bot (SLACK_BOT_TOKEN) no servidor."}
        </p>
        <p className="text-[13px] text-muted">
          {noSlack.n ? (
            <>
              {noSlack.n} pessoa{noSlack.n > 1 ? "s" : ""} sem ID do Slack: os avisos delas ficam só no sino. <Link href="/config" className="!text-accent-soft">Completar em Pessoas e perfis</Link>.
            </>
          ) : (
            "Todas as pessoas têm ID do Slack."
          )}
        </p>
      </div>
      <div className="flex flex-col gap-2.5 rounded-[18px] border border-line-2 bg-surface-2 px-5 pt-[18px] pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="h3">E-mail para clientes</h3>
          {email ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Não configurado</Badge>}
        </div>
        <p className="text-[13px] text-muted">
          Convite ao portal, demanda adicional aguardando aprovação (com lembrete a cada 2 dias úteis) e respostas da Síntese. {email ? `Remetente: ${process.env.EMAIL_FROM}.` : "Faltam RESEND_API_KEY e EMAIL_FROM no servidor."} O time nunca recebe e-mail, só Slack.
        </p>
      </div>
      <div className="flex flex-col gap-2.5 rounded-[18px] border border-dashed border-line-3 bg-surface px-5 pt-[18px] pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="h3 text-muted">WhatsApp para clientes</h3>
          <PhaseBadge />
        </div>
        <p className="text-[13px] text-faint">Mesmos avisos do e-mail.</p>
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-2.5">
          <span className="text-sm font-semibold text-muted">Status report semanal</span>
          <PhaseBadge />
        </div>
      </div>
      <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <h3 className="h3 basis-full">Últimas 24 horas</h3>
        {[
          ["feito", "enviados"],
          ["pendente", "aguardando horário"],
          ["erro", "falharam"],
          ["cancelado", "silenciados ou cancelados"],
        ].map(([k, l]) => (
          <div key={k} className="flex flex-col">
            <span className={`num text-xl font-bold ${k === "erro" && qs[k] ? "text-yellow" : "text-white"}`}>{qs[k] ?? 0}</span>
            <span className="text-xs text-faint">{l}</span>
          </div>
        ))}
        <Link href="/avisos?aba=enviados" className="btn-ghost ml-auto no-underline">
          Ver avisos enviados
        </Link>
      </div>
    </section>
  );
}
