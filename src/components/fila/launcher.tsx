"use client";
import { useActionState, useMemo, useState } from "react";
import { launchAction } from "@/app/(time)/fila/actions";
import type { EntryState } from "@/app/(time)/horas/_form";
import { cx } from "@/components/ui";
import { addDays, formatMinutes, parseDuration, shortDate } from "@/domain/dates";
import { parseQuickEntry, type QuickTask } from "@/domain/quickEntry";
import { applyChange, emptyValues, EntryFields, EntryHidden, taskLabel, type EntryOptions, type EntryValues } from "@/components/horas/entry-fields";

type DateKey = "ontem" | "hoje" | "amanha" | "outra";

const firstWord = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((w) => w.length > 3) ?? "";

/**
 * Lançador de horas (US-01, US-02, US-03) com âncora #lancar (paleta Ctrl K).
 * Texto livre ("2h30 kari broker erro importação sust") preenche os campos; o formulário completo confere e troca tudo.
 */
export function Launcher({ opts, today, initialDate }: { opts: EntryOptions; today: string; initialDate?: string | null }) {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const start = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today;
  const [values, setValues] = useState<EntryValues>(() => applyChange(emptyValues(today, opts), { date: start }, opts, today).values);
  const [text, setText] = useState("");
  const [manual, setManual] = useState(false);
  const [expanded, setExpanded] = useState(start !== today && start !== yesterday && start !== tomorrow);
  const [notice, setNotice] = useState<string | null>(null);

  const quick = useMemo(() => {
    const clients = opts.clients.map((c) => ({ id: c.id, name: c.name, isInternal: c.isInternal }));
    const toQ = (t: EntryOptions["tasks"][number]): QuickTask => ({ id: t.id, clientId: t.clientId, name: t.name, parentName: t.parentName, isSustentacao: t.isSustentacao });
    const usable = opts.tasks.filter((t) => !t.disabled);
    // As tarefas da pessoa vêm primeiro: no empate, ganham.
    const all = [...usable.filter((t) => t.mine), ...usable.filter((t) => !t.mine)].map(toQ);
    const mine = usable.filter((t) => t.mine).map(toQ);
    return { clients, all, mine };
  }, [opts]);

  const [state, formAction, pending] = useActionState(async (prev: EntryState, f: FormData) => {
    const r = await launchAction(prev, f);
    if (r?.ok) {
      setText("");
      setManual(false);
      setNotice(null);
      setValues(applyChange(emptyValues(today, opts), { date: values.date }, opts, today).values);
    } else if (r?.fields && Object.keys(r.fields).length) setExpanded(true);
    return r;
  }, null);

  const dateKey: DateKey = values.date === today ? "hoje" : values.date === yesterday ? "ontem" : values.date === tomorrow ? "amanha" : "outra";

  function change(patch: Partial<EntryValues>, byHand = true) {
    const r = applyChange(values, patch, opts, today);
    setValues(r.values);
    if (r.notice) setNotice(r.notice);
    if (byHand) setManual(true);
  }

  function onText(t: string) {
    setText(t);
    const force = values.date > today;
    let r = parseQuickEntry(t, { clients: quick.clients, tasks: quick.all, forceProvisioning: force });
    if (r.client && !r.task) r = parseQuickEntry(t, { clients: quick.clients, tasks: quick.mine, forceProvisioning: force });
    const type = opts.types.find((x) => x.code === r.typeCode);
    const patch: Partial<EntryValues> = { description: r.description };
    if (type) patch.typeId = type.id;
    if (r.minutes) patch.horas = formatMinutes(r.minutes);
    else if (!manual) patch.horas = "";
    if (r.client) patch.clientId = r.client.id;
    else if (!manual && !type?.isInternal) patch.clientId = "";
    if (r.task) patch.itemId = r.task.id;
    else if (!manual) patch.itemId = "";
    if (r.sustentacao !== null) patch.sust = r.sustentacao;
    const res = applyChange(values, patch, opts, today);
    if (r.task && r.sustentacao === null) res.values.sust = !!opts.tasks.find((x) => x.id === r.task!.id)?.isSustentacao;
    setValues(res.values);
    if (res.notice) setNotice(res.notice);
  }

  function pickDate(k: DateKey) {
    const d = k === "ontem" ? yesterday : k === "amanha" ? tomorrow : today;
    change({ date: d }, false);
  }

  const client = opts.clients.find((c) => c.id === values.clientId);
  const task = opts.tasks.find((t) => t.id === values.itemId);
  const type = opts.types.find((t) => t.id === values.typeId);
  const minutes = values.horas ? parseDuration(values.horas) : null;
  const so = opts.salesOrders.find((x) => x.id === values.soId);
  const clientSOs = opts.salesOrders.filter((x) => x.clientId === values.clientId);
  const missing = !values.clientId
    ? "Falta o cliente."
    : !values.itemId
      ? "Falta a tarefa: escreva uma palavra dela."
      : !minutes
        ? "Falta a quantidade de horas."
        : !values.description.trim()
          ? "Falta a descrição do que foi feito."
          : null;
  const fieldErrors = state && !state.ok ? state.fields : undefined;

  const examples = useMemo(() => {
    const internalIds = new Set(opts.clients.filter((c) => c.isInternal).map((c) => c.id));
    const mine = opts.tasks.filter((t) => t.mine && !t.disabled && !internalIds.has(t.clientId));
    const internal = opts.clients.find((c) => c.isInternal);
    const out: string[] = [];
    const a = mine[0];
    if (a) {
      const c = opts.clients.find((x) => x.id === a.clientId);
      out.push(`1h ${firstWord(c?.name ?? "")} ${firstWord(a.name)}`.replace(/\s+/g, " ").trim());
    }
    const it = opts.tasks.find((t) => t.clientId === internal?.id && !t.disabled);
    if (it) out.push(`30min interno ${firstWord(it.name)}`);
    const b = mine.find((t) => t.clientId !== a?.clientId) ?? mine[1];
    if (b) out.push(`4h prov ${firstWord(opts.clients.find((x) => x.id === b.clientId)?.name ?? "")} ${firstWord(b.name)}`.trim());
    return out.slice(0, 3);
  }, [opts]);

  const dateLabel = dateKey === "hoje" ? `hoje, ${shortDate(today)}` : dateKey === "ontem" ? `ontem, ${shortDate(yesterday)}` : dateKey === "amanha" ? `amanhã, ${shortDate(tomorrow)}` : shortDate(values.date);
  const chipBase = "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold";

  return (
    <section id="lancar" aria-labelledby="lanc" className="card-strong flex scroll-mt-6 flex-col gap-3.5 p-5">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 id="lanc" className="h3 text-base">
          Lançar horas
        </h2>
        <span className="num text-xs text-accent-soft">{dateLabel}</span>
      </div>
      <form action={formAction} className="flex flex-col gap-3.5">
        <EntryHidden values={values} />
        <div className="flex gap-1.5" role="group" aria-label="Dia">
          {(
            [
              ["ontem", "Ontem"],
              ["hoje", "Hoje"],
              ["amanha", "Amanhã"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={dateKey === k}
              onClick={() => pickDate(k)}
              className={cx(
                "min-h-11 flex-1 cursor-pointer rounded-[10px] border text-[13px] font-bold",
                dateKey === k ? "border-white bg-white text-on-accent" : "border-line-5 bg-transparent text-[#e6d9f2] hover:bg-line",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-2 text-[13px] text-muted">
          Escreva como falaria
          <input
            type="text"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="2h30 kari broker sustentação"
            autoComplete="off"
            enterKeyHint="send"
            className="num min-h-[52px] w-full rounded-xl border border-line-5 bg-bg px-3.5 text-[17px] text-white placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" aria-live="polite">
          {client && !client.isInternal && (
            <span className={chipBase} style={{ background: client.color, color: "#1A0F22" }}>
              <span className="opacity-75">Cliente</span> {client.name}
            </span>
          )}
          {task && (
            <span className={cx(chipBase, "bg-line-2 text-[#e6d9f2]")}>
              <span className="opacity-75">Tarefa</span> {taskLabel(task)}
            </span>
          )}
          {minutes ? (
            <span className={cx(chipBase, "bg-line-2 text-[#e6d9f2]")}>
              <span className="opacity-75">Horas</span> <span className="num">{formatMinutes(minutes)}</span>
            </span>
          ) : null}
          {type && (
            <span className={cx(chipBase, "bg-line-2 text-[#e6d9f2]")}>
              <span className="opacity-75">Tipo</span> {type.name}
            </span>
          )}
          {values.sust && !type?.isInternal && <span className={cx(chipBase, "bg-blue-bg text-blue")}>Sustentação</span>}
        </div>
        <span className={cx("rounded-[10px] px-3 py-2.5 text-[13px]", type?.acceptsSalesOrder ? "bg-surface text-muted" : "bg-line-2 text-accent-soft")}>
          {type?.acceptsSalesOrder
            ? so
              ? `Pedido de venda: ${so.label} (opcional)`
              : clientSOs.length
                ? `Pedido de venda: nenhum escolhido (opcional, ${clientSOs.length} do cliente)`
                : "Pedido de venda: opcional"
            : type?.isProvisioning
              ? "Provisionamento: não aparece ao cliente nem entra no faturamento."
              : type?.isInternal
                ? `Interno: vai para o projeto Síntese ${opts.year}, sem pedido de venda.`
                : `${type?.name ?? "Este tipo"}: pedido de venda bloqueado.`}
        </span>
        {notice && <span className="text-[13px] font-semibold text-accent-soft">{notice}</span>}
        {text && missing && <span className="text-[13px] text-accent-soft">{missing}</span>}
        <button
          type="button"
          className="btn-quiet self-start px-0 text-[13px]"
          aria-expanded={expanded}
          aria-controls="lancar-form"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Recolher o formulário" : "Conferir ou trocar os campos"}
        </button>
        {expanded && (
          <div id="lancar-form" className="rounded-[14px] border border-line-3 bg-surface-2 p-3.5">
            <EntryFields idp="lc" values={values} onChange={(p) => change(p)} opts={opts} today={today} errors={fieldErrors} />
          </div>
        )}
        <button className="btn-primary min-h-[46px] rounded-xl text-[15px] font-extrabold" disabled={pending}>
          {pending ? "Salvando..." : `${type?.isProvisioning ? "Provisionar" : "Lançar"}${minutes ? ` ${formatMinutes(minutes)} h` : ""}`}
        </button>
        {state && (
          <div role="status" className={cx("rounded-xl px-3.5 py-3 text-sm font-semibold", state.ok ? "bg-green-bg text-green" : "bg-red-bg text-red")}>
            {state.message}
          </div>
        )}
        {examples.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-faint">Exemplos:</span>
            {examples.map((t) => (
              <button key={t} type="button" onClick={() => onText(t)} className="num min-h-8 cursor-pointer rounded-full border border-line-3 bg-surface px-2.5 text-xs text-muted hover:text-white">
                {t}
              </button>
            ))}
          </div>
        )}
      </form>
    </section>
  );
}
