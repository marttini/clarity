import Link from "next/link";
import type { TeamUser } from "@/server/session";
import { getHolidays, getSettings } from "@/server/data/common";
import { teamPeople } from "@/server/queries/clients";
import { managementCounts } from "@/server/queries/analytics";
import { agendaOf, openItems, unansweredClientComments, waitingText } from "@/server/queries/fila";
import { now as clockNow, today as clockToday } from "@/lib/clock";
import { formatMinutes, longDate, shortDate } from "@/domain/dates";
import { Arrow, cx } from "@/components/ui";
import { GroupTitle, InfoNote, QueueRow } from "./bits";
import { ContactAgenda } from "./agenda";
import { firstName, greeting } from "./consultant-view";

const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Minha fila de quem administra e não aponta horas (Marttini): o que precisa de decisão hoje,
 * a agenda de contatos e os itens em que é responsável. A visão completa da gestão fica em /gestao.
 */
export async function ManagerQueue({ me }: { me: TeamUser }) {
  const t = clockToday();
  const nowAt = clockNow();
  const [counts, agenda, items, comments, holidays, settings, people] = await Promise.all([
    managementCounts(t, nowAt),
    agendaOf(me.id, t),
    openItems({ personId: me.id }),
    unansweredClientComments(me.id),
    getHolidays(),
    getSettings(),
    teamPeople(),
  ]);
  const red = counts.portfolio.filter((c) => c.health === "vermelho");
  const streaks = counts.report.filter((r) => r.currentStreak > 0).sort((a, b) => b.currentStreak - a.currentStreak);
  const provLate = counts.prov;
  const rows: { n: number; tone: "red" | "yellow" | "accent" | "neutral"; what: string; detail: string; href: string; action: string }[] = [];
  if (counts.changes.length)
    rows.push({
      n: counts.changes.length,
      tone: "accent",
      what: me.canApproveHours ? "Pedidos de alteração aguardando você" : "Pedidos de alteração de horas",
      detail: counts.changes
        .slice(0, 3)
        .map((c) => `${firstName(c.person.name)} (${shortDate(c.entry.date)}, ${formatMinutes(c.entry.minutes)} h)`)
        .join(", "),
      href: "/gestao/pendencias",
      action: "Revisar",
    });
  if (streaks.length)
    rows.push({
      n: streaks.length,
      tone: streaks.some((r) => r.currentStreak >= settings.missingDaysLimit) ? "red" : "neutral",
      what: "Consultores com dias sem apontamento",
      detail: streaks
        .slice(0, 3)
        .map((r) => `${firstName(r.person.name)}: ${plural(r.currentStreak, "dia útil", "dias úteis")}`)
        .join(", "),
      href: "/gestao/pendencias?aba=dias",
      action: "Ver",
    });
  if (provLate.length)
    rows.push({
      n: provLate.length,
      tone: "yellow",
      what: "Provisionamentos vencidos sem conversão",
      detail: provLate
        .slice(0, 3)
        .map((p) => `${firstName(p.personName)} (${shortDate(p.date)})`)
        .join(", "),
      href: "/gestao/pendencias?aba=provisionamentos",
      action: "Ver",
    });
  if (counts.demands.length)
    rows.push({
      n: counts.demands.length,
      tone: "yellow",
      what: "Demandas adicionais com o cliente",
      detail: counts.demands[0] ? `a mais antiga parada há ${plural(counts.demands[0].days, "dia", "dias")}` : "",
      href: "/gestao/pendencias?aba=demandas",
      action: "Cobrar",
    });
  if (red.length)
    rows.push({ n: red.length, tone: "red", what: red.length === 1 ? "Cliente no vermelho" : "Clientes no vermelho", detail: red.slice(0, 3).map((c) => c.name).join(", "), href: "/gestao?carteira=vermelho#carteira", action: "Ver" });
  const syncN = counts.sync.entries.length + counts.sync.items.length;
  if (syncN) rows.push({ n: syncN, tone: "red", what: "Erros de envio ao Odoo", detail: "apontamentos ou itens que não chegaram", href: "/gestao/pendencias?aba=sincronizacao", action: "Resolver" });

  const late = items.filter((i) => i.deadline && i.deadline <= t);
  const contactsToday = agenda.today.length + agenda.late.length;
  const tone = { red: "bg-day-red text-on-accent", yellow: "bg-day-yellow text-on-accent", accent: "bg-accent text-on-accent", neutral: "bg-line-2 text-[#e6d9f2]" };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="h1">
            {greeting(nowAt)}, {firstName(me.name)}.
          </h1>
          <p className="text-[15px] text-muted">
            {cap(longDate(t))}. {rows.length ? `${plural(rows.length, "assunto precisa", "assuntos precisam")} de você` : "Nada esperando decisão"}
            {contactsToday ? ` e ${plural(contactsToday, "contato", "contatos")} na agenda` : ""}.
          </p>
          <InfoNote>Você não aponta horas, por isso esta fila não mostra régua nem faixas. A visão completa está em Gestão.</InfoNote>
        </div>
        <Link href="/gestao" className="btn-ghost no-underline">
          Abrir a gestão <Arrow dir="right" />
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-[26px]">
        <div className="flex min-w-0 flex-[3_1_540px] flex-col gap-[22px]">
          <section aria-labelledby="pv" className="flex flex-col">
            <GroupTitle id="pv" title="Precisa de você" n={rows.length} tone={rows.length ? "yellow" : "neutral"} />
            {rows.length === 0 && <p className="border-t border-line px-1 py-3 text-sm text-faint">Nenhuma pendência de gestão agora.</p>}
            {rows.map((r) => (
              <Link key={r.what} href={r.href} className="flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line px-1 py-2.5 text-ink no-underline hover:bg-surface">
                <span className={cx("num inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-extrabold", tone[r.tone])}>{r.n}</span>
                <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                  <span className="text-[15px] font-semibold text-white">{r.what}</span>
                  {r.detail && <span className="text-xs text-faint">{r.detail}</span>}
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-accent-soft">
                  {r.action} <Arrow dir="right" />
                </span>
              </Link>
            ))}
          </section>

          {comments.length > 0 && (
            <section aria-labelledby="cm" className="flex flex-col">
              <GroupTitle id="cm" title="Clientes esperando resposta" n={comments.length} tone="blue" />
              {comments.map((c) => (
                <Link key={c.id} href={`/projetos/${c.itemId}#conversa`} className="flex min-h-14 flex-wrap items-center gap-x-3.5 border-t border-line px-1 py-2.5 text-ink no-underline hover:bg-surface">
                  <span className="rounded-md px-2 py-[3px] text-xs font-extrabold" style={{ background: c.clientColor, color: "#1A0F22" }}>
                    {c.clientName}
                  </span>
                  <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                    <span className="text-sm font-semibold">{c.contactName} · {c.itemName}</span>
                    <span className="truncate text-xs text-faint">{c.body}</span>
                  </span>
                  <span className="text-xs font-bold text-accent-soft">{waitingText(c.at, nowAt, t, holidays).text}</span>
                </Link>
              ))}
            </section>
          )}

          {items.length > 0 && (
            <section aria-labelledby="it" className="flex flex-col">
              <GroupTitle id="it" title="Seus itens" n={items.length} tone={late.length ? "red" : "neutral"} />
              {items.slice(0, 10).map((it) => (
                <QueueRow key={it.id} it={it} today={t} />
              ))}
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-[2_1_380px] flex-col gap-[22px]">
          <section id="agenda" aria-labelledby="ag" className="flex flex-col">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="ag" className="h3 text-base">
                Contatos
              </h2>
              <Link href="/contatos" className="btn-quiet no-underline">
                Agenda completa <Arrow dir="right" />
              </Link>
            </div>
            <ContactAgenda
              late={agenda.late}
              todayList={agenda.today}
              next={agenda.next}
              people={people.filter((p) => p.isConsultor || p.id === me.id).map((p) => ({ id: p.id, name: p.name }))}
              meId={me.id}
              today={t}
              holidays={holidays}
              compact
            />
          </section>
        </aside>
      </div>
    </>
  );
}
