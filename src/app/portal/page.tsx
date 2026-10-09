import Link from "next/link";
import { requireClient } from "@/server/session";
import { today as todayFn } from "@/lib/clock";
import { addDays } from "@/domain/dates";
import { addMonths, formatMinutes, longDate, monthName, parseISO, shortDate, startOfMonth, toISODate } from "@/domain/dates";
import {
  assigneesOf,
  confirmedScope,
  groupItems,
  hoursByItem,
  lastUpdate,
  listDemands,
  pendingEvaluations,
  stageDates,
  threadHeads,
  visibleItems,
} from "@/server/services/portal";
import { stageIndex } from "@/server/data/common";
import { Avatar, cx } from "@/components/ui";
import { Stepper } from "@/components/portal/stepper";
import { RatingForm } from "@/components/portal/forms";
import { dayMon, firstName, fullDate, whenShort } from "@/components/portal/format";
import { initials } from "@/server/data/common";
import { evaluateAction } from "./actions";

export const metadata = { title: "Andamento · Portal Síntese" };

type Item = Awaited<ReturnType<typeof visibleItems>>[number];

const CHIP = {
  ok: { label: "Concluída", cls: "bg-green-bg text-green" },
  run: { label: "Em andamento", cls: "bg-blue-bg text-blue" },
  todo: { label: "A fazer", cls: "bg-line-2 text-[#e6d9f2]" },
  appr: { label: "Aguarda sua aprovação", cls: "bg-[#3A1E12] text-accent-soft" },
} as const;

function taskState(t: Item): keyof typeof CHIP {
  if (t.outOfScope && t.clientApproval === "aguardando") return "appr";
  if (t.stage === "concluido") return "ok";
  if (t.stage === "andamento") return "run";
  return "todo";
}

function statusSentence(p: Item, running: Item[]) {
  switch (p.stage) {
    case "analise":
      return "Em análise e aprovação.";
    case "estimativa":
      return "Estamos estimando o esforço.";
    case "alocacao":
      return `Equipe sendo alocada.${p.startDate ? ` Início previsto para ${shortDate(p.startDate)}.` : ""}`;
    case "andamento":
      return running.length ? `Em andamento: agora estamos em ${running.slice(0, 2).map((r) => `"${r.name}"`).join(" e ")}.` : "Em andamento.";
    default:
      return `Concluído${p.completedAt ? ` em ${shortDate(toISODate(p.completedAt))}` : ""}.`;
  }
}

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ projeto?: string; mes?: string }> }) {
  const me = await requireClient();
  const sp = await searchParams;
  const today = todayFn();
  const items = await visibleItems(me);
  const { projects, children, loose } = groupItems(items);
  const [demands, evals, heads] = await Promise.all([listDemands(me), pendingEvaluations(me), threadHeads(me)]);
  const waiting = demands.filter((d) => d.status === "aguardando");

  // Mês das horas: últimos 3 meses.
  const months = [-2, -1, 0].map((n) => startOfMonth(addMonths(today, n)));
  const month = months.find((m) => m.slice(0, 7) === sp.mes) ?? months[2];
  const hours = await hoursByItem(me, month);
  const hBy = new Map(hours.map((h) => [h.itemId, h]));
  const sumOf = (ids: string[]) =>
    ids.reduce((a, id) => ({ fat: a.fat + (hBy.get(id)?.faturavel ?? 0), bon: a.bon + (hBy.get(id)?.bonificado ?? 0) }), { fat: 0, bon: 0 });

  const groups = [
    ...projects.map((p) => ({ id: p.id, name: p.name, ids: [p.id, ...(children.get(p.id) ?? []).map((c) => c.id)] })),
    ...(loose.length ? [{ id: "outras", name: "Outras tarefas e sustentação", ids: loose.map((l) => l.id) }] : []),
  ];
  const hourRows = groups.map((g) => ({ ...g, ...sumOf(g.ids) }));
  const totFat = hourRows.reduce((a, r) => a + r.fat, 0);
  const totBon = hourRows.reduce((a, r) => a + r.bon, 0);
  const extra = sumOf(items.filter((i) => i.outOfScope).map((i) => i.id));

  // Projeto selecionado.
  const sel = projects.find((p) => p.id === sp.projeto) ?? projects.find((p) => p.stage !== "concluido") ?? projects[0] ?? null;
  const selKids = sel ? (children.get(sel.id) ?? []).filter((t) => t.clientApproval !== "recusada") : [];
  const [ass, hist, last, scope] = sel
    ? await Promise.all([assigneesOf([sel.id, ...selKids.map((k) => k.id)]), stageDates(me, sel.id), lastUpdate(me, sel, selKids), confirmedScope(me, sel.id)])
    : [new Map<string, { id: string; name: string }[]>(), [], null, null];
  const cur = sel ? stageIndex(sel.stage) : 0;
  const stepDates = ["analise", "estimativa", "alocacao", "andamento", "concluido"].map((k, i) => {
    const arrivals = hist.filter((h) => h.to === k);
    if (!arrivals.length) return "";
    const d = shortDate(toISODate((i === cur ? arrivals.at(-1)! : arrivals[0]).at));
    return i === cur && cur < 4 ? `desde ${d}` : d;
  });
  const consultant = sel ? (ass.get(sel.id)?.[0] ?? selKids.map((k) => ass.get(k.id)?.[0]).find(Boolean) ?? null) : null;
  const doneN = selKids.filter((k) => k.stage === "concluido").length;
  const selWaiting = waiting.filter((d) => selKids.some((k) => k.id === d.id));
  const evalIds = new Set(evals.map((e) => e.id));

  // Precisa de você.
  const replies = [...heads.entries()].filter(([, h]) => !h.fromClient && toISODate(h.at) >= addDays(today, -7));
  const todo = [
    waiting.length && { n: waiting.length, what: waiting.length > 1 ? "Demandas para aprovar" : "Demanda para aprovar", detail: "As horas só começam após o seu sim.", action: "Ver", href: "/portal/demandas", tone: "bg-accent text-on-accent" },
    replies.length && {
      n: replies.length,
      what: replies.length > 1 ? "Respostas da Síntese" : `Resposta de ${replies[0][1].who}`,
      detail: replies.length > 1 ? "Nas conversas dos seus projetos." : `Em "${items.find((i) => i.id === replies[0][0])?.name ?? ""}".`,
      action: "Ler",
      href: `/portal/mensagens?item=${replies[0][0]}`,
      tone: "bg-yellow-bg text-yellow",
    },
    evals.length && { n: evals.length, what: evals.length > 1 ? "Entregas para avaliar" : "Entrega para avaliar", detail: evals[0].name, action: "Avaliar", href: "/portal/avaliar", tone: "bg-line-2 text-[#e6d9f2]" },
  ].filter(Boolean) as { n: number; what: string; detail: string; action: string; href: string; tone: string }[];

  const hello = longDate(today);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="h1">Olá, {firstName(me.name)}.</h1>
        <p className="text-base text-muted">
          {hello.charAt(0).toUpperCase() + hello.slice(1)}. Veja em que ponto está cada projeto da {me.clientName}.
        </p>
      </div>

      <section aria-labelledby="pv" className="flex flex-wrap gap-3">
        <h2 id="pv" className="sr-only">
          Precisa de você
        </h2>
        {todo.map((t, i) => (
          <div key={t.what} className={cx("box-border flex min-w-0 flex-[1_1_300px] items-center gap-3 rounded-2xl px-3.5 py-3", i === 0 ? "border border-line-4 bg-surface-3" : "border border-line bg-surface")}>
            <span className={cx("num flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[19px] font-bold", t.tone)}>{t.n}</span>
            <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-0.5">
              <strong className="text-[15px] leading-tight text-white">{t.what}</strong>
              <span className="truncate text-[13px] text-muted">{t.detail}</span>
            </div>
            <Link href={t.href} className="btn-ghost min-h-11 text-sm font-bold whitespace-nowrap !text-accent-soft no-underline">
              {t.action}
            </Link>
          </div>
        ))}
        {!todo.length && <p className="w-full rounded-2xl bg-green-bg px-5 py-4 text-[15px] text-green">Nada pendente com você agora.</p>}
      </section>

      <section aria-labelledby="proj" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="proj" className="h2">
            Seus projetos
          </h2>
          {projects.length > 1 && (
            <div role="tablist" aria-label="Projetos" className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-surface-2 p-[3px]">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  role="tab"
                  aria-selected={p.id === sel?.id}
                  href={`/portal?projeto=${p.id}${sp.mes ? `&mes=${sp.mes}` : ""}`}
                  scroll={false}
                  className={cx("inline-flex min-h-[38px] items-center rounded-lg px-3 text-sm font-bold no-underline", p.id === sel?.id ? "bg-line-2 text-white" : "text-muted hover:text-white")}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {sel ? (
          <div className="card flex flex-col gap-[26px] px-[clamp(16px,3vw,28px)] py-6">
            <div className="flex flex-wrap items-start justify-between gap-[18px]">
              <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
                <h3 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-white">{sel.name}</h3>
                <p className="text-base leading-normal text-ink">{statusSentence(sel, selKids.filter((k) => k.stage === "andamento"))}</p>
                {selWaiting.length > 0 && (
                  <Link href="/portal/demandas" className="self-start rounded-full bg-yellow-bg px-[11px] py-1 text-[13px] font-bold text-yellow no-underline">
                    {selWaiting.length > 1 ? `${selWaiting.length} demandas aguardam sua aprovação` : "1 demanda aguarda sua aprovação"}
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap gap-7">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-muted">Previsão de entrega</span>
                  <span className="font-display text-2xl font-semibold text-accent-soft">{sel.deadline ? dayMon(sel.deadline) : "a definir"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-muted">Entregas</span>
                  <span className="text-[22px] font-bold text-white">
                    {doneN} de {selKids.length}
                  </span>
                </div>
                {consultant && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-muted">Consultor(a)</span>
                    <span className="flex items-center gap-2">
                      <Avatar name={consultant.name} initials={initials(consultant.name)} size={28} />
                      <strong className="text-[15px] text-white">{consultant.name}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
            <Stepper current={cur} dates={stepDates} />
            {last && (
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-line-2 bg-surface-2 px-4 py-3.5">
                <span className="text-[13px] font-bold text-muted">Última atualização</span>
                <span className="num text-[13px] font-semibold text-accent-soft">{whenShort(last.at, today)}</span>
                <span className="min-w-0 flex-[1_1_300px] text-[15px] text-ink">{last.text}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="card px-5 py-8 text-center text-muted">Ainda não há projetos visíveis para a {me.clientName}. Quando a Síntese liberar, eles aparecem aqui.</p>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-6">
          {sel && (
            <section aria-labelledby="tar" className="card flex flex-col px-[22px] pt-5 pb-2">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="tar" className="text-[17px] font-bold text-white">
                  Tarefas do projeto
                </h2>
                <span className="text-[13px] text-faint">Tarefas internas da equipe não aparecem aqui.</span>
              </div>
              {selKids.length === 0 && <p className="border-t border-line py-4 text-sm text-muted">Nenhuma tarefa liberada para vocês ainda.</p>}
              {selKids.map((t) => {
                const st = taskState(t);
                const who = ass.get(t.id)?.[0]?.name;
                const meta =
                  st === "ok"
                    ? `Concluída${t.completedAt ? ` em ${shortDate(toISODate(t.completedAt))}` : ""}`
                    : st === "appr"
                      ? `Pedida em ${shortDate(t.requestedAt ?? toISODate(t.createdAt))}`
                      : [t.deadline ? `Previsão ${shortDate(t.deadline)}` : t.startDate ? `Início ${shortDate(t.startDate)}` : "", who ? firstName(who) : ""].filter(Boolean).join(" · ");
                const go = st === "appr" ? { label: "Ver demanda", href: "/portal/demandas" } : evalIds.has(t.id) ? { label: "Avaliar", href: `/portal/avaliar#${t.id}` } : heads.has(t.id) ? { label: "Ver mensagens", href: `/portal/mensagens?item=${t.id}` } : null;
                return (
                  <div key={t.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line py-[13px]">
                    <span className={cx("box-border min-w-[104px] shrink-0 rounded-full px-[11px] py-1 text-center text-[13px] font-bold whitespace-nowrap", CHIP[st].cls)}>{CHIP[st].label}</span>
                    <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
                      <span className="text-[15px] font-semibold text-white">{t.name}</span>
                      <span className="text-[13px] text-muted">
                        {meta || "Sem data definida"}
                        {t.outOfScope ? " · Demanda adicional" : ""}
                      </span>
                    </div>
                    {go && (
                      <Link href={go.href} className="btn-quiet min-h-10 !text-accent-soft no-underline">
                        {go.label}
                      </Link>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {scope && (
            <section aria-labelledby="esc" className="card flex flex-col gap-4 px-[22px] py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="esc" className="text-[17px] font-bold text-white">
                  Escopo combinado
                </h2>
                <span className="text-[13px] text-faint">
                  Versão {scope.version}
                  {scope.confirmedAt ? `, confirmada em ${fullDate(toISODate(scope.confirmedAt))}` : ""} · só leitura
                </span>
              </div>
              {scope.objective && (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-muted">Objetivo</span>
                  <p className="text-[15px] leading-relaxed text-ink">{scope.objective}</p>
                </div>
              )}
              {scope.deliverables.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-muted">Entregáveis</span>
                  <ol className="m-0 flex list-none flex-col p-0">
                    {scope.deliverables.map((d) => (
                      <li key={d.number} className="flex gap-3 border-t border-line py-2.5">
                        <span className="num w-6 shrink-0 text-sm font-bold text-accent-soft">{d.number}</span>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-[15px] font-semibold text-white">{d.title}</span>
                          {d.description && <span className="text-sm text-muted">{d.description}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {scope.exclusions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-muted">Fora do escopo</span>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
                    {scope.exclusions.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {scope.assumptions && (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-muted">Premissas</span>
                  <p className="text-sm leading-relaxed text-ink">{scope.assumptions}</p>
                </div>
              )}
              <p className="text-[13px] text-faint">Pedidos além deste escopo viram demandas adicionais e só começam com a sua aprovação.</p>
            </section>
          )}

          {loose.length > 0 && (
            <section aria-labelledby="outras" className="card flex flex-col px-[22px] pt-5 pb-2">
              <h2 id="outras" className="mb-2 text-[17px] font-bold text-white">
                Outras tarefas e sustentação
              </h2>
              {loose.map((t) => {
                const st = taskState(t);
                return (
                  <div key={t.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line py-[13px]">
                    <span className={cx("box-border min-w-[104px] shrink-0 rounded-full px-[11px] py-1 text-center text-[13px] font-bold whitespace-nowrap", CHIP[st].cls)}>{CHIP[st].label}</span>
                    <span className="min-w-0 flex-[1_1_220px] text-[15px] font-semibold text-white">{t.name}</span>
                    <Link href={`/portal/mensagens?item=${t.id}`} className="btn-quiet min-h-10 !text-accent-soft no-underline">
                      Mensagens
                    </Link>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-[2_1_340px] flex-col gap-6">
          <section aria-labelledby="hr" className="card flex flex-col gap-3.5 px-[22px] py-5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <h2 id="hr" className="text-[17px] font-bold text-white">
                Horas do mês
              </h2>
              <div role="tablist" aria-label="Mês" className="flex gap-1 rounded-[10px] border border-line bg-surface-2 p-[3px]">
                {months.map((mo) => (
                  <Link
                    key={mo}
                    role="tab"
                    aria-selected={mo === month}
                    scroll={false}
                    href={`/portal?mes=${mo.slice(0, 7)}${sel ? `&projeto=${sel.id}` : ""}`}
                    className={cx("inline-flex min-h-[38px] items-center rounded-lg px-3 text-sm font-bold capitalize no-underline", mo === month ? "bg-line-2 text-white" : "text-muted hover:text-white")}
                  >
                    {monthName(parseISO(mo).m)}
                  </Link>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[300px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-faint">
                    <th scope="col" className="py-2 pr-1.5 font-bold">
                      Projeto
                    </th>
                    <th scope="col" className="px-1.5 py-2 text-right font-bold">
                      Cobradas
                    </th>
                    <th scope="col" className="px-1.5 py-2 text-right font-bold">
                      Bonificadas
                    </th>
                    <th scope="col" className="py-2 pl-1.5 text-right font-bold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hourRows.map((h) => {
                    const href = h.id === "outras" ? "/portal" : `/portal?projeto=${h.id}&mes=${month.slice(0, 7)}`;
                    return (
                      <tr key={h.id} className="border-t border-line">
                        <td className="py-2.5 pr-1.5 text-ink">{h.name}</td>
                        <td className="num px-1.5 py-1 text-right">
                          <Link href={href} scroll={false} className={cx("rounded-lg px-1 font-semibold text-accent-soft underline underline-offset-[3px]", h.id === sel?.id && "bg-line")}>
                            {formatMinutes(h.fat)}
                          </Link>
                        </td>
                        <td className="num px-1.5 py-1 text-right">
                          <Link href={href} scroll={false} className={cx("rounded-lg px-1 font-semibold text-accent-soft underline underline-offset-[3px]", h.id === sel?.id && "bg-line")}>
                            {formatMinutes(h.bon)}
                          </Link>
                        </td>
                        <td className="num py-2.5 pl-1.5 text-right font-bold text-white">{formatMinutes(h.fat + h.bon)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line-4">
                    <td className="pt-3 pr-1.5 pb-1 font-bold text-white">Total</td>
                    <td className="num px-2 pt-3 pb-1 text-right font-bold text-white">{formatMinutes(totFat)}</td>
                    <td className="num px-2 pt-3 pb-1 text-right font-bold text-white">{formatMinutes(totBon)}</td>
                    <td className="num pt-3 pb-1 pl-1.5 text-right font-bold text-accent-soft">{formatMinutes(totFat + totBon)}</td>
                  </tr>
                  {extra.fat + extra.bon > 0 && (
                    <tr>
                      <td className="py-1.5 pr-1.5 text-[13px] text-muted">
                        <Link href="/portal/demandas" className="text-muted">
                          Demandas adicionais
                        </Link>{" "}
                        (já no total)
                      </td>
                      <td className="num px-2 py-1.5 text-right text-[13px] text-muted">{formatMinutes(extra.fat)}</td>
                      <td className="num px-2 py-1.5 text-right text-[13px] text-muted">{formatMinutes(extra.bon)}</td>
                      <td className="num py-1.5 pl-1.5 text-right text-[13px] font-bold text-muted">{formatMinutes(extra.fat + extra.bon)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] leading-normal text-muted">Mostramos só horas já trabalhadas. Bonificadas são horas que a Síntese dedica sem cobrar.</p>
          </section>

          {evals[0] && (
            <section id="avaliar" aria-labelledby="av" className="card-strong flex flex-col gap-3.5 px-[22px] py-5">
              <div className="flex flex-col gap-1">
                <h2 id="av" className="text-[17px] font-bold text-white">
                  Como foi esta entrega?
                </h2>
                <span className="text-sm leading-snug text-muted">
                  {evals[0].name}, concluída em {shortDate(toISODate(evals[0].completedAt))}
                  {evals[0].consultant ? ` por ${evals[0].consultant}` : ""}.
                </span>
              </div>
              <RatingForm itemId={evals[0].id} action={evaluateAction} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
