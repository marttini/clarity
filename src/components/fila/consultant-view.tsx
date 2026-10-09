import Link from "next/link";
import type { ReactNode } from "react";
import type { TeamUser } from "@/server/session";
import { getHolidays } from "@/server/data/common";
import {
  absenceReasons,
  agendaOf,
  approvalsWaiting,
  launcherOptions,
  monthRuler,
  myChangeRequests,
  myEntries,
  openItems,
  provisioningToConvert,
  unansweredClientComments,
  waitingSince,
  waitingText,
  WAIT_TAGS,
} from "@/server/queries/fila";
import { teamPeople } from "@/server/queries/clients";
import { now as clockNow, today as clockToday } from "@/lib/clock";
import { addDays, formatMinutes, longDate, monthName, parseISO, shortDate, weekday, workdaysSince, type ISODate } from "@/domain/dates";
import { Arrow, cx } from "@/components/ui";
import { BandRail, GroupTitle, Legend, MonthRuler, QueueRow, WarnIcon, WeekStrip, dayMonth } from "./bits";
import { ContactAgenda, DayAgenda } from "./agenda";
import { Launcher } from "./launcher";
import { ConvertCard, JustifyForm } from "@/components/horas/entry-actions";

export function greeting(at: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(at)) % 24;
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function brMinutes(at: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(at).split(":").map(Number);
  return (h % 24) * 60 + m;
}

export const firstName = (n: string) => n.split(" ")[0];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;

function AlertLink({ href, tone, children }: { href: string; tone: "red" | "yellow" | "blue" | "accent" | "neutral"; children: ReactNode }) {
  const cls = {
    red: "bg-red-bg text-red",
    yellow: "bg-yellow-bg text-yellow",
    blue: "bg-blue-bg text-blue",
    accent: "bg-[#3A1E12] text-accent-soft",
    neutral: "bg-line-2 text-[#e6d9f2]",
  }[tone];
  return (
    <Link href={href} className={cx("inline-flex min-h-10 items-center gap-2 rounded-[10px] px-3 text-[13px] font-bold no-underline hover:brightness-125", cls)}>
      {children}
      <Arrow dir="right" />
    </Link>
  );
}

/** US-46: Minha fila do consultor (V3 Fila.dc.html). */
export async function ConsultantQueue({ me, initialDate }: { me: TeamUser; initialDate: string | null }) {
  const t = clockToday();
  const nowAt = clockNow();
  const [ruler, items, comments, prov, crs, approvals, agenda, todays, holidays, reasons, people] = await Promise.all([
    monthRuler(me.id, t),
    openItems({ personId: me.id }),
    unansweredClientComments(me.id),
    provisioningToConvert(me.id, t, clockNow()),
    myChangeRequests(me.id, clockNow()),
    me.canApproveHours ? approvalsWaiting() : Promise.resolve([]),
    agendaOf(me.id, t),
    myEntries(me.id, { from: t, to: t }),
    getHolidays(),
    absenceReasons(),
    teamPeople(),
  ]);
  const settings = ruler.settings;
  const opts = await launcherOptions(me.id, t, { includeItemIds: prov.map((p) => p.itemId) });
  const late = items.filter((i) => i.deadline && i.deadline < t);
  const dueToday = items.filter((i) => i.deadline === t);
  const rest = items.filter((i) => !i.deadline || i.deadline > t);
  const waitingItems = items.filter((i) => (i.outOfScope && i.clientApproval === "aguardando") || i.tags.some((g) => WAIT_TAGS.includes(g.name)));
  const since = await waitingSince(waitingItems);
  const restOpen = rest.filter((i) => !waitingItems.includes(i));
  const streak = ruler.streak;
  const limit = settings.missingDaysLimit;
  const pendingCrs = crs.filter((c) => c.status === "pendente");
  const decidedCrs = crs.filter((c) => c.status !== "pendente");
  const convertible = prov.filter((p) => !p.expired && !p.pendingChange);

  // Semana atual (seg a sex).
  const monday = addDays(t, -((weekday(t) + 6) % 7));
  const week = [0, 1, 2, 3, 4].map((i) => {
    const d = addDays(monday, i);
    return { date: d, minutes: ruler.daily.get(d)?.minutes ?? 0, isToday: d === t, future: d > t, holiday: holidays.has(d) };
  });

  const summary: string[] = [];
  if (late.length) summary.push(plural(late.length, "item atrasado", "itens atrasados"));
  const contactsToday = agenda.today.length + agenda.late.length;
  if (contactsToday) summary.push(plural(contactsToday, "contato", "contatos"));
  const waitingClients = new Set(comments.map((c) => c.clientName)).size;
  if (waitingClients) summary.push(plural(waitingClients, "cliente esperando resposta", "clientes esperando resposta"));
  const summaryText = summary.length ? summary.join(", ").replace(/, ([^,]*)$/, " e $1") + "." : "Nada atrasado. Bom trabalho.";

  const people4fu = people.filter((p) => p.isConsultor || p.id === me.id).map((p) => ({ id: p.id, name: p.name }));
  const strong = streak.length >= limit;
  const lastMissing = streak.at(-1);
  const missingText =
    streak.length === 1
      ? lastMissing === addDays(t, -1)
        ? `Ontem (${dayMonth(lastMissing)}) ficou sem apontamento.`
        : `${cap(longDate(lastMissing!).split(",")[0])} (${dayMonth(lastMissing!)}) ficou sem apontamento.`
      : `${streak.length} dias úteis seguidos sem apontamento: ${streak.map(dayMonth).join(", ").replace(/, ([^,]*)$/, " e $1")}.`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">
            {greeting(nowAt)}, {firstName(me.name)}.
          </h1>
          <p className="text-[15px] text-muted">
            {cap(longDate(t))}. {summaryText}
          </p>
        </div>
        <WeekStrip days={week} />
      </div>

      {(streak.length > 0 || convertible.length > 0 || pendingCrs.length > 0 || decidedCrs.length > 0 || comments.length > 0 || approvals.length > 0 || agenda.late.length > 0) && (
        <section aria-label="Alertas" className="flex flex-col gap-3">
          {streak.length > 0 && (
            <div
              className={cx(
                "flex flex-wrap items-center gap-3.5 rounded-[14px] border px-[18px] py-3.5",
                strong ? "border-[#5A2420] bg-[#2A1215]" : "border-[#5A4A1E] bg-[#2A2312]",
              )}
            >
              <WarnIcon color={strong ? "#FF8A80" : "#F2D27A"} />
              <div className="flex flex-[1_1_320px] flex-col gap-0.5">
                <strong className={cx("text-[15px]", strong ? "text-[#FFC9C3]" : "text-[#F6E3AE]")}>{missingText}</strong>
                <span className={cx("text-sm", strong ? "text-[#E4B4AE]" : "text-[#E2D3A6]")}>
                  {strong
                    ? `Chegou a ${streak.length} dias úteis seguidos: pela regra dos ${limit} dias o bônus do mês é perdido. Lance as horas ou justifique com comprovante.`
                    : `Com ${limit} dias úteis seguidos sem horas nem justificativa, o bônus do mês é perdido.`}
                </span>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <JustifyForm days={streak} reasons={reasons} defaultDate={lastMissing} compact />
                <Link
                  href={`/fila?data=${lastMissing}#lancar`}
                  className={cx("inline-flex min-h-[42px] items-center rounded-[10px] px-3.5 font-extrabold text-on-accent no-underline hover:text-on-accent", strong ? "bg-day-red" : "bg-day-yellow")}
                >
                  Lançar horas de {lastMissing === addDays(t, -1) ? "ontem" : dayMonth(lastMissing!)}
                </Link>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {convertible.length > 0 && (
              <AlertLink href="#converter" tone="accent">
                {plural(convertible.length, "provisionamento a converter", "provisionamentos a converter")}
              </AlertLink>
            )}
            {pendingCrs.length > 0 && (
              <AlertLink href="/horas?v=periodo#pedidos" tone="yellow">
                {plural(pendingCrs.length, "pedido de alteração em andamento", "pedidos de alteração em andamento")}
              </AlertLink>
            )}
            {decidedCrs.slice(0, 2).map((c) => (
              <AlertLink key={c.id} href="/horas?v=periodo#pedidos" tone={c.status === "aprovada" ? "neutral" : "red"}>
                Pedido de {shortDate(c.date)} {c.status === "aprovada" ? "aprovado" : `recusado${c.reason ? `: ${c.reason}` : ""}`}
              </AlertLink>
            ))}
            {comments.map((c) => (
              <AlertLink key={c.id} href="#comentarios" tone={waitingText(c.at, nowAt, t, holidays).workdays >= settings.clientCommentAlertWorkdays ? "red" : "blue"}>
                {c.contactName} ({c.clientName}) espera resposta {waitingText(c.at, nowAt, t, holidays).text}
              </AlertLink>
            ))}
            {agenda.late.length > 0 && (
              <AlertLink href="#agenda" tone="red">
                {plural(agenda.late.length, "contato atrasado", "contatos atrasados")}
              </AlertLink>
            )}
            {approvals.length > 0 && (
              <AlertLink href="/gestao/pendencias" tone="accent">
                {plural(approvals.length, "pedido aguardando sua aprovação", "pedidos aguardando sua aprovação")}
              </AlertLink>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="mes" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="mes" className="h3 text-base">
            {cap(monthName(parseISO(t).m))}, dia a dia
          </h2>
          <Legend />
        </div>
        <MonthRuler days={ruler.days} />
        <BandRail fatMinutes={ruler.fatMonth} settings={settings} />
      </section>

      {/* No celular o lançador vem logo depois da régua; no desktop fica à direita (V3). */}
      <div className="grid items-start gap-[26px] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="lg:col-start-2 lg:row-start-1">
          <Launcher key={initialDate ?? "hoje"} opts={opts} today={t} initialDate={initialDate} />
        </div>
        <div className="flex min-w-0 flex-col gap-[22px] lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {late.length > 0 && (
            <section aria-labelledby="g-late" className="flex flex-col">
              <GroupTitle id="g-late" title="Atrasadas" n={late.length} tone="red" />
              {late.map((it) => (
                <QueueRow key={it.id} it={it} today={t} />
              ))}
            </section>
          )}
          <section aria-labelledby="g-today" className="flex flex-col">
            <GroupTitle id="g-today" title="Prazo hoje" n={dueToday.length} tone="yellow" />
            {dueToday.length ? dueToday.map((it) => <QueueRow key={it.id} it={it} today={t} />) : <p className="border-t border-line px-1 py-3 text-sm text-faint">Nenhum prazo vence hoje.</p>}
          </section>

          {comments.length > 0 && (
            <div id="comentarios" className="flex scroll-mt-6 flex-col gap-3">
              {comments.map((c) => {
                const w = waitingText(c.at, nowAt, t, holidays);
                const alert = w.workdays >= settings.clientCommentAlertWorkdays;
                const ini = c.contactName
                  .split(/\s+/)
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                return (
                  <section key={c.id} aria-label={`${c.contactName} está esperando você`} className="flex gap-3.5 rounded-2xl border border-[#1F3E66] bg-[#10203A] p-[18px]">
                    <span aria-hidden className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-client-channel text-[13px] font-extrabold text-[#0B1A2C]">
                      {ini}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h2 className="m-0 text-[15px] font-bold text-white">{c.contactName} está esperando você</h2>
                        <span className="text-[13px] text-[#9FC4E4]">
                          {c.clientName} · {c.itemName}
                        </span>
                        <span className={cx("ml-auto text-xs font-bold", alert ? "text-red" : "text-accent-soft")}>
                          {w.text}
                          {alert ? " · em alerta" : ` · alerta em ${settings.clientCommentAlertWorkdays} dia útil`}
                        </span>
                      </div>
                      <p className="m-0 line-clamp-3 text-[15px] leading-[1.45] text-[#DCEBF6]">{c.body}</p>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/projetos/${c.itemId}#conversa`} className="inline-flex min-h-10 items-center rounded-[10px] bg-client-channel px-3.5 font-extrabold text-[#0B1A2C] no-underline hover:text-[#0B1A2C]">
                          Responder ao cliente
                        </Link>
                        <Link href={`/projetos/${c.itemId}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-[#2E5A8A] px-3.5 font-semibold text-[#DCEBF6] no-underline">
                          Abrir item
                        </Link>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {prov.length > 0 && (
            <div id="converter" className="flex scroll-mt-6 flex-col gap-3">
              {prov.map((p) => {
                const head = (
                  <>
                    <strong className="text-[15px] text-white">Provisionamento a converter · {p.annualName}</strong>
                    <span className="text-sm text-muted">
                      {dayMonth(p.date)} · {formatMinutes(p.minutes)} h reservadas em {p.itemName}.{" "}
                      {p.pendingChange
                        ? "Há um pedido de alteração pendente."
                        : p.expired
                          ? "Passou o prazo de 48 h: agora só com pedido aprovado."
                          : `Converta ${untilText(p.deadline)}, ou será preciso pedir aprovação.`}
                    </span>
                  </>
                );
                if (p.expired || p.pendingChange)
                  return (
                    <section key={p.id} className="flex flex-wrap items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-accent bg-[#1C1018] px-[18px] py-4">
                      <div className="flex flex-[1_1_280px] flex-col gap-1">{head}</div>
                      {!p.pendingChange && (
                        <Link href={`/horas?v=dia&d=${p.date}`} className="btn-ghost no-underline">
                          Solicitar alteração
                        </Link>
                      )}
                    </section>
                  );
                return (
                  <ConvertCard
                    key={p.id}
                    entry={{ id: p.id, date: p.date, minutes: p.minutes, description: p.description, itemId: p.itemId, clientId: opts.tasks.find((x) => x.id === p.itemId)?.clientId ?? "", typeId: "", sust: false, soId: null, isProvisioning: true }}
                    opts={opts}
                    today={t}
                  >
                    {head}
                  </ConvertCard>
                );
              })}
            </div>
          )}

          {waitingItems.length > 0 && (
            <section aria-labelledby="g-wait" className="flex flex-col">
              <GroupTitle id="g-wait" title="Esperando o cliente" n={waitingItems.length} tone="neutral" />
              {waitingItems.map((it) => {
                const d = since.get(it.id) ?? it.createdOn;
                const wd = workdaysSince(d, t, holidays);
                return (
                  <QueueRow
                    key={it.id}
                    it={it}
                    today={t}
                    extra={
                      <span className={cx("text-xs font-bold", wd >= 3 ? "text-red" : "text-yellow")}>
                        {it.outOfScope && it.clientApproval === "aguardando" ? "Aprovação da demanda adicional" : it.tags.find((g) => WAIT_TAGS.includes(g.name))?.name} · {wd ? `há ${plural(wd, "dia útil", "dias úteis")}` : "desde hoje"}
                      </span>
                    }
                  />
                );
              })}
            </section>
          )}

          {restOpen.length > 0 && (
            <section aria-labelledby="g-rest" className="flex flex-col">
              <GroupTitle id="g-rest" title="Demais abertas" n={restOpen.length} tone="neutral" />
              {restOpen.slice(0, 6).map((it) => (
                <QueueRow key={it.id} it={it} today={t} />
              ))}
              {restOpen.length > 6 && (
                <details className="group">
                  <summary className="btn-quiet min-h-11 cursor-pointer list-none border-t border-line px-1">Ver mais {restOpen.length - 6}</summary>
                  {restOpen.slice(6).map((it) => (
                    <QueueRow key={it.id} it={it} today={t} />
                  ))}
                </details>
              )}
            </section>
          )}

          {(pendingCrs.length > 0 || decidedCrs.length > 0) && (
            <section aria-labelledby="g-crs" className="flex flex-col">
              <GroupTitle id="g-crs" title="Pedidos de alteração" n={pendingCrs.length} tone="yellow" />
              {crs.map((c) => (
                <Link key={c.id} href={`/horas?v=dia&d=${c.date}`} className="flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line px-1 py-2.5 text-ink no-underline hover:bg-surface">
                  <span className="num w-14 text-sm font-bold text-white">{shortDate(c.date)}</span>
                  <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                    <span className="text-sm font-semibold">
                      {c.kind === "excluir" ? "Excluir" : "Alterar"} {formatMinutes(c.minutes)} h
                    </span>
                    <span className="truncate text-xs text-faint">{c.justification}</span>
                    {c.status === "recusada" && c.reason && <span className="text-xs font-semibold text-red">Motivo: {c.reason}</span>}
                  </span>
                  <span
                    className={cx(
                      "rounded-full px-2.5 py-1 text-xs font-bold",
                      c.status === "pendente" ? "bg-yellow-bg text-yellow" : c.status === "aprovada" ? "bg-green-bg text-green" : "bg-red-bg text-red",
                    )}
                  >
                    {c.status === "pendente" ? "Pendente" : c.status === "aprovada" ? `Aprovada${c.decider ? ` por ${firstName(c.decider)}` : ""}` : "Recusada"}
                  </span>
                </Link>
              ))}
            </section>
          )}

          {me.canApproveHours && (
            <section aria-labelledby="g-appr" className="flex flex-col">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <GroupTitle id="g-appr" title="Aguardando sua aprovação" n={approvals.length} tone={approvals.length ? "yellow" : "neutral"} />
                <Link href="/gestao/pendencias" className="btn-quiet no-underline">
                  Abrir pendências <Arrow dir="right" />
                </Link>
              </div>
              {approvals.length === 0 && <p className="border-t border-line px-1 py-3 text-sm text-faint">Nenhum pedido de alteração pendente.</p>}
              {approvals.slice(0, 5).map((a) => (
                <Link key={a.id} href="/gestao/pendencias" className="flex min-h-12 flex-wrap items-center gap-x-3.5 border-t border-line px-1 py-2 text-ink no-underline hover:bg-surface">
                  <strong className="text-sm text-white">{a.person}</strong>
                  <span className="text-sm text-muted">
                    {a.kind === "excluir" ? "excluir" : "alterar"} {formatMinutes(a.minutes)} h de {shortDate(a.date)}
                  </span>
                </Link>
              ))}
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-[22px] lg:col-start-2 lg:row-start-2">

          <section aria-labelledby="hoje" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="hoje" className="h3 text-base">
                Agenda de hoje
              </h2>
              <span className="text-xs text-faint">
                {todays.filter((e) => !e.isProvisioning).length ? `${formatMinutes(todays.filter((e) => !e.isProvisioning).reduce((a, e) => a + e.minutes, 0))} h lançadas` : "nenhuma hora lançada hoje"}
              </span>
            </div>
            <DayAgenda
              entries={todays
                .filter((e) => !e.isProvisioning)
                .slice()
                .reverse()
                .map((e) => ({ id: e.id, minutes: e.minutes, client: e.clientName.split(" ")[0], color: e.clientColor, task: e.itemName }))}
              contacts={agenda.today.map((c) => ({ id: c.id, time: c.time, type: c.type, color: c.color, who: c.with ?? c.client }))}
              nowMinutes={brMinutes(nowAt)}
            />
          </section>

          <section id="agenda" aria-labelledby="ag" className="flex scroll-mt-6 flex-col">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="ag" className="h3 text-base">
                Contatos
              </h2>
              <Link href="/contatos" className="btn-quiet no-underline">
                Agenda completa <Arrow dir="right" />
              </Link>
            </div>
            <ContactAgenda late={agenda.late} todayList={agenda.today} next={agenda.next} people={people4fu} meId={me.id} today={t} holidays={holidays} compact />
          </section>
        </aside>
      </div>
    </>
  );
}

function toISO(d: Date): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** "até o fim de 09/10" quando o prazo é meia-noite; senão "até 10/10 às 14:00". */
function untilText(d: Date) {
  const h = hm(d);
  if (h === "00:00") return `até o fim de ${shortDate(toISO(new Date(d.getTime() - 60_000)))}`;
  return `até ${shortDate(toISO(d))} às ${h}`;
}
function hm(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(d);
}
