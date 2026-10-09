import Link from "next/link";
import type { TeamUser } from "@/server/session";
import { getHolidays } from "@/server/data/common";
import { teamPeople } from "@/server/queries/clients";
import { agendaOf, chargeFollowUps, doneToday, openChargesByItem, openItems, staleClients, waitingSince, WAIT_TAGS } from "@/server/queries/fila";
import { now as clockNow, today as clockToday } from "@/lib/clock";
import { addWorkdays, diffDays, longDate, shortDate, workdaysSince, type ISODate } from "@/domain/dates";
import { Segmented, cx } from "@/components/ui";
import { contactTypeLabel } from "@/components/contatos/labels";
import { ContactIcon, InfoNote, dayMonth } from "./bits";
import { ContactAgenda, followUpDeadlines } from "./agenda";
import { ContactResult, QuickSchedule } from "./contact-forms";
import { firstName, greeting } from "./consultant-view";

const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dueLabel(d: ISODate, today: ISODate) {
  const n = diffDays(d, today);
  if (n === 0) return { text: "hoje", tone: "text-yellow" };
  if (n === -1) return { text: "venceu ontem", tone: "text-red" };
  if (n < -1) return { text: `venceu ${dayMonth(d)}`, tone: "text-red" };
  if (n === 1) return { text: "amanhã", tone: "text-muted" };
  return { text: dayMonth(d), tone: "text-muted" };
}

/**
 * Minha fila do administrativo (V3 Administrativo.dc.html): contatos, clientes sem contato,
 * follow-ups de cobrança e itens esperando o cliente. Sem horas, faixas nem ranking.
 */
export async function AdminQueue({ me, view }: { me: TeamUser; view: "hoje" | "semana" }) {
  const t = clockToday();
  const nowAt = clockNow();
  const [agenda, done, stale, fus, waiting, holidays, people] = await Promise.all([
    agendaOf(me.id, t),
    doneToday(me.id, t),
    staleClients(t),
    chargeFollowUps(me.id, t),
    openItems({ withTags: WAIT_TAGS }),
    getHolidays(),
    teamPeople(),
  ]);
  const [since, charges] = await Promise.all([waitingSince(waiting), openChargesByItem(waiting.map((w) => w.id))]);
  const tomorrow = addWorkdays(t, 1, holidays);
  // Cobrança hoje, na próxima hora cheia; depois das 17h, no próximo dia útil às 10h.
  const nextHour = brHour(nowAt) + 1;
  const chargeDate = nextHour <= 17 ? t : tomorrow;
  const chargeTime = nextHour <= 17 ? `${String(nextHour).padStart(2, "0")}:00` : "10:00";
  const fuPeople = people.filter((p) => p.isConsultor || p.id === me.id).map((p) => ({ id: p.id, name: p.name }));
  const staleOpen = stale.rows.filter((r) => !r.next);
  const fuOpen = fus.filter((f) => f.status === "agendado");
  const waitOpen = waiting.filter((w) => !charges.has(w.id));
  const todayPending = agenda.today.length + agenda.late.length;
  const summary = `${cap(longDate(t))}. ${todayPending ? `${plural(todayPending, "contato", "contatos")} para hoje` : "Contatos de hoje feitos"}, ${plural(staleOpen.length, "cliente sem contato", "clientes sem contato")} há ${stale.limit}+ dias úteis, ${plural(fuOpen.length, "follow-up aberto", "follow-ups abertos")} e ${plural(waitOpen.length, "cliente para cobrar retorno", "clientes para cobrar retorno")}.`;
  const agendaSub = view === "hoje" ? `${plural(todayPending, "pendente", "pendentes")} hoje` : `${plural(agenda.next.length, "pendente", "pendentes")} nos próximos dias`;
  const sorted = [...waiting].sort((a, b) => (since.get(a.id) ?? a.createdOn).localeCompare(since.get(b.id) ?? b.createdOn));

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="h1">
          {greeting(nowAt)}, {firstName(me.name)}.
        </h1>
        <p className="text-[15px] text-muted">{summary}</p>
        <InfoNote>Seus contatos contam para o último contato do cliente. Você não entra em carga, ranking nem faixas.</InfoNote>
      </div>

      <div className="flex flex-wrap items-start gap-[26px]">
        <div className="flex min-w-0 flex-[3_1_600px] flex-col gap-[26px]">
          <section id="agenda" aria-labelledby="ag" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3.5">
                <h2 id="ag" className="h2">
                  Contatos
                </h2>
                <Segmented
                  options={[
                    { value: "hoje", label: "Hoje" },
                    { value: "semana", label: "Semana" },
                  ]}
                  value={view}
                  hrefFor={(v) => (v === "hoje" ? "/fila" : "/fila?ver=semana")}
                />
              </div>
              <span className="text-[13px] text-muted">{agendaSub}</span>
            </div>
            <ContactAgenda late={agenda.late} todayList={agenda.today} next={view === "semana" ? agenda.next : []} people={fuPeople} meId={me.id} today={t} holidays={holidays} showAsked />
            {done.length > 0 && (
              <div className="flex flex-col">
                <h3 className="mt-2.5 mb-1 text-[13px] font-bold text-muted">Feitos hoje</h3>
                {done.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line px-1 py-2.5 opacity-90">
                    <span className="num w-12 text-sm font-bold text-white">{c.time}</span>
                    <ContactIcon type={c.type} done />
                    <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md px-2 py-[3px] text-xs font-extrabold" style={{ background: c.color, color: "#1A0F22" }}>
                          {c.client}
                        </span>
                        {c.with && <strong className="text-[15px] text-white">{c.with}</strong>}
                      </div>
                      <span className="text-[13px] font-semibold text-green">
                        {contactTypeLabel(c.type)} · {c.status === "realizado" ? "Realizado" : "Não atendeu"}
                        {c.summary ? ` · ${c.summary}` : ""}
                        {c.nextStep ? ` · ${c.nextStep}` : ""}
                      </span>
                    </div>
                    <span className="rounded-full bg-green-bg px-3 py-[5px] text-xs font-bold text-green">Feito</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="fu" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="fu" className="font-display text-xl font-semibold text-white">
                Meus follow-ups
              </h2>
              <span className="rounded-full bg-line-2 px-2.5 py-[3px] text-xs font-bold text-[#e6d9f2]">{plural(fuOpen.length, "aberto", "abertos")}</span>
            </div>
            {fus.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">Nenhuma cobrança pedida para você. Elas aparecem aqui quando a gestão usa “Cobrar cliente”.</p>
            ) : (
              <div className="table-wrap">
                <table className="tbl min-w-[760px]">
                  <thead>
                    <tr>
                      <th scope="col" className="pl-4">
                        O que cobrar
                      </th>
                      <th scope="col">Cliente</th>
                      <th scope="col" className="whitespace-nowrap">Pedido por</th>
                      <th scope="col">Prazo</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Ação</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fus.map((f) => {
                      const open = f.status === "agendado";
                      const due = dueLabel(f.date, t);
                      const late = open && f.date < t;
                      const tag = f.outOfScope ? "Demanda adicional" : /documento/i.test(f.objective) ? "Pend. doc. cliente" : f.itemName ? "Ag. retorno cliente" : null;
                      return (
                        <tr key={f.id}>
                          <td className="pl-4">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-white">{f.objective}</span>
                              {f.itemName && <span className="text-[13px] text-muted">{f.itemName}</span>}
                              {tag && (
                                <span className={cx("self-start rounded-full px-2 py-0.5 text-[11px] font-bold", tag === "Demanda adicional" ? "bg-[#3A1E12] text-accent-soft" : "bg-yellow-bg text-yellow")}>{tag}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="inline-block rounded-md px-[9px] py-1 text-xs font-extrabold whitespace-nowrap" style={{ background: f.clientColor, color: "#1A0F22" }}>
                              {f.clientName}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-muted">{f.byId === me.id ? "Você" : f.by}</td>
                          <td className={cx("text-[13px] font-bold whitespace-nowrap", open ? due.tone : "text-faint")}>
                            {due.text}
                            {open && <span className="block text-xs font-normal text-faint">{f.time}</span>}
                          </td>
                          <td>
                            <span
                              className={cx(
                                "inline-block rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap",
                                !open ? (f.status === "realizado" ? "bg-green-bg text-green" : "bg-yellow-bg text-yellow") : late ? "bg-red-bg text-red" : "bg-line-2 text-[#e6d9f2]",
                              )}
                            >
                              {!open ? (f.status === "realizado" ? "Concluído" : "Não atendeu") : late ? "Atrasado" : "A fazer"}
                            </span>
                          </td>
                          <td className="pr-4 text-right">
                            {open && <ContactResult contactId={f.id} people={fuPeople} meId={me.id} today={t} workdayOptions={followUpDeadlines(t, holidays)} label="Registrar cobrança" followUpLabel="Criar tarefa de follow-up para um consultor" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-[2_1_380px] flex-col gap-[22px]">
          <section aria-labelledby="sc" className="card-strong flex flex-col px-5 py-[18px]">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="sc" className="h3 text-base">
                Clientes sem contato
              </h2>
              <span className="text-xs text-faint">cadência semanal · alerta com {stale.limit}+ dias úteis</span>
            </div>
            {stale.rows.length === 0 && <p className="border-t border-line-2 pt-3.5 pb-1 text-sm text-green">Todos os clientes ativos tiveram contato nesta semana.</p>}
            {stale.rows.map((k) => {
              const days = k.contactWorkdays;
              return (
                <div key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-2 py-2">
                  <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ background: k.color }} />
                  <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-0.5">
                    <Link href={`/clientes/${k.id}`} className="text-[15px] font-bold text-white no-underline">
                      {k.name}
                    </Link>
                    <span className="text-xs text-faint">{k.last ? `Último: ${dayMonth(toDate(k.last.at))} · ${contactTypeLabel(k.last.type).toLowerCase()} (${firstName(k.last.who)})` : "Nenhum contato registrado"}</span>
                  </div>
                  <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap", days === null || days >= 7 ? "bg-red-bg text-red" : "bg-yellow-bg text-yellow")}>
                    {days === null ? "nunca" : `${days} dias úteis`}
                  </span>
                  {k.next ? (
                    <span className={cx("rounded-full px-2.5 py-[5px] text-xs font-bold", toDate(k.next.at) < t ? "bg-red-bg text-red" : "bg-blue-bg text-blue")}>
                      {toDate(k.next.at) < t ? "Atrasado" : "Agendado"}: {shortDate(toDate(k.next.at))} ({firstName(k.next.who)})
                    </span>
                  ) : (
                    <QuickSchedule clientId={k.id} objective={`Contato semanal: ${days === null ? "nenhum contato registrado" : `${days} dias úteis sem falar com o cliente`}.`} defaultDate={tomorrow} today={t} label="Agendar" primary />
                  )}
                </div>
              );
            })}
          </section>

          <section aria-labelledby="ar" className="card flex flex-col px-5 py-[18px]">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h2 id="ar" className="h3 text-base">
                Aguardando retorno do cliente
              </h2>
              <span className="rounded-full bg-yellow-bg px-[9px] py-[3px] text-xs font-bold text-yellow">Ag. retorno · Pend. doc.</span>
            </div>
            {sorted.length === 0 && <p className="border-t border-line pt-3.5 text-sm text-muted">Nenhum item esperando o cliente.</p>}
            {sorted.map((w) => {
              const d = since.get(w.id) ?? w.createdOn;
              const wd = workdaysSince(d, t, holidays);
              const tag = w.tags.find((g) => WAIT_TAGS.includes(g.name))?.name ?? "Ag. retorno cliente";
              const charge = charges.get(w.id);
              return (
                <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5">
                  <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md px-2 py-[3px] text-xs font-extrabold" style={{ background: w.clientColor, color: "#1A0F22" }}>
                        {w.clientName}
                      </span>
                      <Link href={`/projetos/${w.id}`} className="text-sm font-semibold text-white no-underline">
                        {w.name}
                      </Link>
                    </div>
                    <span className="text-[13px] text-muted">{tag === "Pend. doc. cliente" ? "Documento pendente do cliente." : "Retorno do cliente pendente."}</span>
                    <span className={cx("text-xs font-bold", wd >= 3 ? "text-red" : "text-yellow")}>{wd ? `há ${plural(wd, "dia útil", "dias úteis")}` : "desde hoje"}</span>
                  </div>
                  {charge ? (
                    <span className="rounded-full bg-green-bg px-2.5 py-[5px] text-xs font-bold text-green">
                      {toDate(charge.at) === t ? "Cobrança hoje" : `Cobrança ${shortDate(toDate(charge.at))}`} ({firstName(charge.who)})
                    </span>
                  ) : (
                    <QuickSchedule
                      clientId={w.clientId}
                      relatedItemId={w.id}
                      objective={tag === "Pend. doc. cliente" ? `Cobrar documento pendente: ${w.name}` : `Cobrar retorno do cliente: ${w.name}`}
                      defaultDate={chargeDate}
                      defaultTime={chargeTime}
                      today={t}
                      label="Cobrar"
                    />
                  )}
                </div>
              );
            })}
          </section>
        </aside>
      </div>
    </>
  );
}

function brHour(at: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(at)) % 24;
}

function toDate(at: Date): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

