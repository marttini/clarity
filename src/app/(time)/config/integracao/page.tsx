import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { today } from "@/lib/clock";
import { getOdooFields } from "@/server/odoo/fields";
import { Badge, cx, type Tone } from "@/components/ui";
import { ActionForm } from "@/components/config/forms";
import { whenShort } from "@/components/portal/format";
import { requireAdminPage } from "../_guard";
import { saveOdooFieldsAction, syncNowAction } from "../actions";

export const metadata = { title: "Integração Odoo · Configurações" };

const MODELS: Record<string, string> = {
  "hr.employee": "Funcionários",
  "project.project": "Projetos anuais",
  "res.partner": "Clientes e contatos",
  "project.task": "Projetos e tarefas",
  "sale.order.line": "Pedidos de venda",
};

const LEVELS: { key: string; label: string; tone: Tone }[] = [
  { key: "error", label: "Erros", tone: "red" },
  { key: "conflito", label: "Conflitos", tone: "yellow" },
  { key: "pendencia", label: "Pendências", tone: "blue" },
  { key: "warn", label: "Avisos", tone: "neutral" },
];

const FIELDS = [
  { k: "entryType", label: "Tipo de apontamento", where: "account.analytic.line, seleção" },
  { k: "sustentacao", label: "Sustentação", where: "project.task e account.analytic.line, sim/não" },
  { k: "clarityId", label: "ID Clarity", where: "project.task e account.analytic.line, texto" },
  { k: "consultor", label: "Consultor", where: "hr.employee, sim/não" },
  { k: "novoModeloTag", label: "Etiqueta do novo modelo", where: "nome da etiqueta em project.project" },
] as const;

/** Integração com o Odoo (US-05, US-21, US-28, US-32): campos do Studio, situação e "Sincronizar agora". */
export default async function Integracao({ searchParams }: { searchParams: Promise<{ nivel?: string }> }) {
  await requireAdminPage();
  const { nivel } = await searchParams;
  const t = today();
  const level = LEVELS.find((l) => l.key === nivel)?.key ?? null;
  const [fields, states, queue, errors, logs, levelCounts] = await Promise.all([
    getOdooFields(),
    db.select().from(s.syncState),
    db.select({ status: s.syncQueue.status, n: count() }).from(s.syncQueue).groupBy(s.syncQueue.status),
    db.select().from(s.syncQueue).where(eq(s.syncQueue.status, "erro")).orderBy(desc(s.syncQueue.updatedAt)).limit(20),
    db
      .select()
      .from(s.syncLog)
      .where(level ? eq(s.syncLog.level, level) : inArray(s.syncLog.level, LEVELS.map((l) => l.key)))
      .orderBy(desc(s.syncLog.at))
      .limit(50),
    db.select({ level: s.syncLog.level, n: count() }).from(s.syncLog).where(and(inArray(s.syncLog.level, LEVELS.map((l) => l.key)))).groupBy(s.syncLog.level),
  ]);
  const q = Object.fromEntries(queue.map((r) => [r.status, r.n])) as Record<string, number>;
  const lc = Object.fromEntries(levelCounts.map((r) => [r.level, r.n])) as Record<string, number>;
  const byModel = new Map(states.map((st) => [st.model, st]));
  const lastRun = states.map((x) => x.lastRunAt).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
  const mode = process.env.ODOO_MODE === "fake" ? "Odoo de teste" : process.env.ODOO_URL ? new URL(process.env.ODOO_URL).host : "Odoo não configurado";
  const healthy = !(q.erro ?? 0) && states.every((x) => !x.lastError) && !!lastRun;

  return (
    <section aria-labelledby="h-o" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-o" className="h2">
          Integração Odoo
        </h2>
        <p className="text-sm text-muted">Clientes, projetos, tarefas, funcionários e horas vêm do Odoo e voltam para ele. A rotina roda a cada 15 minutos.</p>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold", healthy ? "bg-green-bg text-green" : lastRun ? "bg-yellow-bg text-yellow" : "bg-line-2 text-[#e6d9f2]")}>
            <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
            {healthy ? "Conectado e sincronizando" : lastRun ? "Sincronizando, com pendências" : "Ainda não sincronizado"} · {mode}
          </span>
          <ActionForm action={syncNowAction} className="flex max-w-[560px] flex-col items-end gap-1.5" statusClassName="text-right">
            <button className="btn-primary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />
              </svg>
              Sincronizar agora
            </button>
          </ActionForm>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {[
            { v: lastRun ? whenShort(lastRun, t) : "nunca", k: "última sincronização" },
            { v: String(q.pendente ?? 0), k: "na fila para enviar" },
            { v: String(q.erro ?? 0), k: "com erro na fila", bad: (q.erro ?? 0) > 0 },
            { v: String(q.feito ?? 0), k: "enviados" },
          ].map((f) => (
            <div key={f.k} className="flex flex-col">
              <span className={cx("num text-xl font-bold", f.bad ? "text-yellow" : "text-white")}>{f.v}</span>
              <span className="text-xs text-faint">{f.k}</span>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[620px]">
            <thead>
              <tr>
                <th scope="col">Modelo</th>
                <th scope="col">Última leitura</th>
                <th scope="col">Alterações até</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(MODELS).map(([m, label]) => {
                const st = byModel.get(m);
                return (
                  <tr key={m}>
                    <td>
                      <span className="text-white">{label}</span> <span className="num text-xs text-faint">{m}</span>
                    </td>
                    <td className="num text-muted">{st?.lastRunAt ? whenShort(st.lastRunAt, t) : "nunca"}</td>
                    <td className="num text-xs text-muted">{st?.lastWriteDate ?? "—"}</td>
                    <td>{st?.lastError ? <span className="text-sm text-red">{st.lastError}</span> : st?.lastRunAt ? <Badge tone="green">ok</Badge> : <Badge>aguardando</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="card flex flex-col gap-2 p-5">
          <h3 className="h3">Fila com erro ({q.erro})</h3>
          <p className="text-[13px] text-muted">Envios que esgotaram as tentativas. Corrija a causa (geralmente no Odoo) e use Reenviar na tela do item.</p>
          <ul className="flex flex-col">
            {errors.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line py-2.5 text-sm">
                <span className="num text-faint">{whenShort(e.updatedAt, t)}</span>
                <span className="text-white">{e.entity === "time_entry" ? "Apontamento" : e.entity === "item" ? "Tarefa" : "Anexo"}</span>
                <span className="min-w-0 flex-[1_1_300px] text-muted">{e.lastError ?? "erro sem detalhe"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="h3">Registro da sincronização</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar registro">
            <Link href="/config/integracao" aria-pressed={!level} className="chip no-underline aria-pressed:!text-on-accent">
              Todos
            </Link>
            {LEVELS.map((l) => (
              <Link key={l.key} href={`/config/integracao?nivel=${l.key}`} aria-pressed={level === l.key} className="chip no-underline aria-pressed:!text-on-accent">
                {l.label} ({lc[l.key] ?? 0})
              </Link>
            ))}
          </div>
        </div>
        <ul className="flex flex-col">
          {logs.map((l) => {
            const lv = LEVELS.find((x) => x.key === l.level)!;
            return (
              <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line py-2.5 text-sm">
                <span className="num w-[110px] shrink-0 text-faint">{whenShort(l.at, t)}</span>
                <Badge tone={lv.tone}>{lv.label.replace(/s$/, "").replace("Pendência", "Pendência")}</Badge>
                <span className="num shrink-0 text-xs text-faint">{l.model}</span>
                <span className="min-w-0 flex-[1_1_320px] text-ink">{l.message}</span>
              </li>
            );
          })}
        </ul>
        {!logs.length && <p className="py-4 text-center text-muted">Nada a resolver neste filtro.</p>}
      </div>

      <ActionForm action={saveOdooFieldsAction} className="card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="h3">Campos do Studio</h3>
          <p className="text-[13px] text-muted">Nomes técnicos dos campos criados no Odoo. Confirme no Odoo antes de mudar: nome errado faz a sincronização falhar.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.k} className="flex min-w-0 flex-col gap-1.5">
              <span className="label">{f.label}</span>
              <input name={f.k} required defaultValue={fields[f.k]} className="field num text-sm" />
              <span className="text-xs text-faint">{f.where}</span>
            </label>
          ))}
        </div>
        <button className="btn-primary self-start">Salvar campos</button>
      </ActionForm>
    </section>
  );
}
