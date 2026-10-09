import Link from "next/link";
import { and, desc, eq, gte, inArray, lt, or, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { now, today as todayFn } from "@/lib/clock";
import { addDays, longDate, startOfDayInstant } from "@/domain/dates";
import { MANDATORY } from "@/server/notify";
import { getMutes, mutableEvents } from "@/server/services/settings";
import { listMyNotifications } from "@/server/services/notifications";
import { Badge, cx, PhaseBadge, Segmented } from "@/components/ui";
import { ActionForm } from "@/components/config/forms";
import { hhmm, whenShort } from "@/components/portal/format";
import { markAllReadAction, markReadAction, resendAction, saveMutesAction } from "./actions";

export const metadata = { title: "Avisos · Clarity" };

const EVENT_PT: Record<string, string> = {
  mencao: "Menção em comentário",
  comentario_cliente: "Comentário do cliente",
  comentario_sem_resposta: "Comentário do cliente sem resposta",
  contato_agendado: "Contato agendado para você",
  contato_atrasado: "Contato atrasado",
  dia_sem_apontamento: "Dia útil sem apontamento",
  tres_dias_sem_apontamento: "3 dias úteis sem apontamento",
  provisionamento_converter: "Provisionamento a converter",
  prazo: "Prazo vence amanhã ou venceu",
  pedido_alteracao: "Pedido de alteração de horas",
  pedido_alteracao_decidido: "Pedido de alteração decidido",
  demanda_decidida: "Demanda adicional decidida pelo cliente",
  avaliacao_recebida: "Avaliação recebida",
  erro_sincronizacao: "Erro de sincronização",
  resumo_gestao: "Resumo diário da gestão",
};

const CH: Record<string, { label: string; tone: "neutral" | "blue" }> = {
  slack_dm: { label: "Slack", tone: "neutral" },
  slack_canal: { label: "Slack", tone: "neutral" },
  email: { label: "E-mail", tone: "blue" },
  google_agenda: { label: "Agenda", tone: "neutral" },
};

/** Sino (US-43) e, para a gestão, os avisos enviados (referência: aba "Avisos enviados" da V3). */
export default async function Avisos({ searchParams }: { searchParams: Promise<{ aba?: string; filtro?: string; dia?: string }> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const manager = isManager(me);
  const tab = sp.aba === "enviados" && manager ? "enviados" : sp.aba === "preferencias" ? "preferencias" : "sino";
  const today = todayFn();
  const tabs = [
    { value: "sino", label: "Meus avisos" },
    { value: "preferencias", label: "Silenciar" },
    ...(manager ? [{ value: "enviados", label: "Avisos enviados" }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">Avisos</h1>
          <p className="text-base text-muted">Tudo aparece aqui. No Slack, só o que pede ação, em horário comercial.</p>
        </div>
        <Segmented options={tabs} value={tab} hrefFor={(v) => (v === "sino" ? "/avisos" : `/avisos?aba=${v}`)} />
      </div>
      {tab === "sino" && <Bell personId={me.id} today={today} />}
      {tab === "preferencias" && <Prefs personId={me.id} />}
      {tab === "enviados" && <Sent today={today} filtro={sp.filtro} dia={sp.dia} />}
    </div>
  );
}

async function Bell({ personId, today }: { personId: string; today: string }) {
  const list = await listMyNotifications(personId, 150);
  const unread = list.filter((n) => !n.readAt).length;
  return (
    <section aria-labelledby="h-sino" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="h-sino" className="h2">
          {unread ? `${unread} não lido${unread > 1 ? "s" : ""}` : "Tudo lido"}
        </h2>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button className="btn-ghost">Marcar todos como lidos</button>
          </form>
        )}
      </div>
      <div className="card flex flex-col p-1">
        {list.map((n, i) => (
          <div key={n.id} className={cx("flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5", i > 0 && "border-t border-line", !n.readAt && "bg-surface-3")}>
            <span aria-hidden className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
              <span className="text-xs text-faint">
                {EVENT_PT[n.event] ?? n.event} · {whenShort(n.createdAt, today)}
              </span>
              {n.link ? (
                <Link href={n.link} className={cx("text-[15px] no-underline hover:underline", n.readAt ? "font-semibold !text-ink" : "font-bold !text-white")}>
                  {n.title}
                </Link>
              ) : (
                <span className={cx("text-[15px]", n.readAt ? "font-semibold text-ink" : "font-bold text-white")}>{n.title}</span>
              )}
              {n.body && <p className="line-clamp-4 text-sm whitespace-pre-line text-muted">{n.body}</p>}
            </div>
            {!n.readAt && (
              <form action={markReadAction}>
                <input type="hidden" name="id" value={n.id} />
                <button className="btn-quiet min-h-10 text-sm">
                  Marcar como lido<span className="sr-only">: {n.title}</span>
                </button>
              </form>
            )}
          </div>
        ))}
        {!list.length && <p className="px-4 py-10 text-center text-muted">Nenhum aviso por enquanto.</p>}
      </div>
    </section>
  );
}

async function Prefs({ personId }: { personId: string }) {
  const muted = new Set(await getMutes(personId));
  return (
    <section aria-labelledby="h-pref" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="h-pref" className="h2">
          Silenciar avisos informativos
        </h2>
        <p className="text-sm text-muted">Avisos silenciados continuam no sino, mas não chegam no Slack. Aprovações, prazos, a regra dos 3 dias e erros de sincronização não podem ser silenciados.</p>
      </div>
      <ActionForm action={saveMutesAction} className="card flex flex-col gap-1 px-5 py-3">
        {mutableEvents().map((e, i) => (
          <label key={e} className={cx("flex min-h-12 cursor-pointer items-center gap-3 py-1", i > 0 && "border-t border-line")}>
            <input type="checkbox" name="mute" value={e} defaultChecked={muted.has(e)} className="h-5 w-5" />
            <span className="text-[15px] text-white">{EVENT_PT[e]}</span>
          </label>
        ))}
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <span className="text-xs font-bold text-faint">Sempre avisados</span>
          <span className="text-sm text-muted">{MANDATORY.map((e) => EVENT_PT[e]).join(" · ")}</span>
        </div>
        <button className="btn-primary mt-3 self-start">Salvar</button>
      </ActionForm>
    </section>
  );
}

async function Sent({ today, filtro, dia }: { today: string; filtro?: string; dia?: string }) {
  const day = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : today;
  const from = startOfDayInstant(day);
  const to = startOfDayInstant(addDays(day, 1));
  const p = alias(s.people, "p");
  const f = ["slack", "email", "falhas"].includes(filtro ?? "") ? filtro! : "todos";
  const rows = await db
    .select({ o: s.outbox, person: p.name, contact: s.clientContacts.name, title: s.notifications.title })
    .from(s.outbox)
    .leftJoin(s.notifications, eq(s.notifications.id, s.outbox.notificationId))
    .leftJoin(p, eq(p.id, s.notifications.personId))
    .leftJoin(s.clientContacts, eq(s.clientContacts.id, s.notifications.contactId))
    .where(
      and(
        or(and(gte(s.outbox.sentAt, from), lt(s.outbox.sentAt, to)), and(isNull(s.outbox.sentAt), gte(s.outbox.createdAt, from), lt(s.outbox.createdAt, to))),
        f === "slack" ? inArray(s.outbox.channel, ["slack_dm", "slack_canal"]) : f === "email" ? eq(s.outbox.channel, "email") : f === "falhas" ? eq(s.outbox.status, "erro") : undefined,
      ),
    )
    .orderBy(desc(s.outbox.createdAt))
    .limit(300);
  const failed = rows.filter((r) => r.o.status === "erro").length;
  const href = (o: Record<string, string>) => `/avisos?${new URLSearchParams({ aba: "enviados", ...(day !== today ? { dia: day } : {}), ...o }).toString()}`;
  return (
    <section aria-labelledby="h-log" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="h-log" className="h2">
            Avisos enviados {day === today ? "hoje" : `em ${longDate(day)}`}
          </h2>
          <p className="text-sm text-muted">Time no Slack (#clarity-gestao, resumo das 8h e mensagens diretas). Clientes por e-mail. Só em horário comercial.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            ["todos", "Todos"],
            ["slack", "Slack"],
            ["email", "E-mail"],
            ["falhas", `Falhas${f === "todos" ? ` (${failed})` : ""}`],
          ].map(([k, l]) => (
            <Link key={k} href={href(k === "todos" ? {} : { filtro: k })} aria-pressed={f === k} className="chip no-underline aria-pressed:!text-on-accent">
              {l}
            </Link>
          ))}
          <span aria-disabled className="inline-flex min-h-9 items-center gap-2 rounded-full border border-dashed border-line-5 px-3 text-[13px] font-semibold text-faint">
            WhatsApp clientes <PhaseBadge />
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/avisos?aba=enviados&dia=${addDays(day, -1)}`} className="btn-quiet !text-accent-soft">
          Dia anterior
        </Link>
        {day !== today && (
          <Link href={`/avisos?aba=enviados&dia=${addDays(day, 1)}`} className="btn-quiet !text-accent-soft">
            Dia seguinte
          </Link>
        )}
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[1040px]">
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">Canal</th>
              <th scope="col">Para</th>
              <th scope="col">Mensagem</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, person, contact, title }) => {
              const payload = (o.payload ?? {}) as { title?: string };
              const to = o.channel === "slack_canal" ? o.target : o.channel === "email" ? o.target : person ? `DM ${person.split(" ")[0]}` : o.target;
              const st =
                o.status === "feito"
                  ? { l: "Entregue", t: "green" as const }
                  : o.status === "erro"
                    ? { l: "Falhou", t: "red" as const }
                    : o.status === "cancelado"
                      ? { l: "Não enviado", t: "neutral" as const }
                      : { l: o.sendAfter > now() ? `Sai às ${hhmm(o.sendAfter)}` : "Na fila", t: "yellow" as const };
              return (
                <tr key={o.id}>
                  <td className="num whitespace-nowrap text-muted">{hhmm(o.sentAt ?? o.createdAt)}</td>
                  <td>
                    <Badge tone={CH[o.channel].tone}>{CH[o.channel].label}</Badge>
                  </td>
                  <td className="whitespace-nowrap text-ink">
                    {to}
                    {contact && <span className="block text-xs text-faint">{contact}</span>}
                  </td>
                  <td className="text-ink">{payload.title ?? title}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.t}>{st.l}</Badge>
                      {o.lastError && <span className="text-xs text-muted">{o.lastError}</span>}
                      {o.status === "erro" && (
                        <ActionForm action={resendAction} className="flex items-center gap-1" statusClassName="text-xs">
                          <input type="hidden" name="id" value={o.id} />
                          <button className="btn-quiet min-h-10 text-sm">Reenviar</button>
                        </ActionForm>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-8 text-center text-muted">Nenhum aviso neste filtro.</p>}
      </div>
    </section>
  );
}
