import Link from "next/link";
import { requireClient } from "@/server/session";
import { today as todayFn } from "@/lib/clock";
import { assigneesOf, itemThread, threadHeads, visibleItems } from "@/server/services/portal";
import { cx, PhaseBadge } from "@/components/ui";
import { MessageForm } from "@/components/portal/forms";
import { fileExt, fileSize, firstName, whenShort } from "@/components/portal/format";
import { sendMessageAction } from "../actions";

export const metadata = { title: "Mensagens · Portal Síntese" };

/** US-41 e US-42: conversa no canal Cliente de cada item visível, com arquivos. */
export default async function Mensagens({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const me = await requireClient();
  const { item } = await searchParams;
  const today = todayFn();
  const items = (await visibleItems(me)).filter((i) => i.clientApproval !== "recusada");
  const heads = await threadHeads(me);
  const names = new Map(items.map((i) => [i.id, i.name]));
  // Conversas: projetos e tarefas com mensagens primeiro (mais recentes), depois os projetos sem conversa.
  const threads = [...items]
    .filter((i) => heads.has(i.id) || i.kind === "projeto" || !i.parentId)
    .sort((a, b) => (heads.get(b.id)?.at.getTime() ?? 0) - (heads.get(a.id)?.at.getTime() ?? 0));
  const sel = threads.find((t) => t.id === item) ?? items.find((t) => t.id === item) ?? threads[0] ?? null;
  const [msgs, ass] = sel ? await Promise.all([itemThread(me, sel.id), assigneesOf([sel.id, ...(sel.parentId ? [sel.parentId] : [])])]) : [[], new Map()];
  const team = sel ? (ass.get(sel.id) ?? (sel.parentId ? ass.get(sel.parentId) : undefined) ?? []) : [];

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">Mensagens</h1>
          <p className="text-base text-muted">Converse com o time da Síntese sobre cada projeto. As respostas também chegam no seu e-mail.</p>
        </div>
        <span className="inline-flex items-center gap-2 text-[13px] text-muted">
          Avisos por WhatsApp <PhaseBadge />
        </span>
      </div>

      {!sel ? (
        <p className="card p-7 text-center text-muted">Ainda não há projetos liberados para conversar. Quando houver, as conversas aparecem aqui.</p>
      ) : (
        <div className="flex flex-wrap items-stretch gap-5">
          <nav aria-label="Conversas por projeto" className="card flex min-w-0 flex-[1_1_280px] flex-col gap-1 self-start p-2">
            {threads.map((t) => {
              const h = heads.get(t.id);
              const on = t.id === sel.id;
              const parent = t.parentId ? names.get(t.parentId) : null;
              return (
                <Link
                  key={t.id}
                  href={`/portal/mensagens?item=${t.id}`}
                  aria-current={on ? "page" : undefined}
                  scroll={false}
                  className={cx("flex min-h-16 items-center gap-2.5 rounded-xl px-3.5 py-2.5 no-underline", on ? "bg-line" : "hover:bg-surface-2")}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px] text-left">
                    <strong className="text-[15px] text-white">{t.name}</strong>
                    {parent && <span className="text-xs text-faint">{parent}</span>}
                    <span className="truncate text-[13px] text-muted">{h ? `${h.who}: ${h.body}` : "Sem mensagens ainda"}</span>
                  </span>
                  {h && !h.fromClient && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-extrabold text-on-accent">Síntese</span>}
                </Link>
              );
            })}
          </nav>
          <section aria-labelledby="chat" className="card flex min-w-0 flex-[3_1_560px] flex-col">
            <div className="flex flex-col gap-0.5 border-b border-line px-[22px] py-[18px]">
              <h2 id="chat" className="text-[17px] font-bold text-white">
                {sel.name}
              </h2>
              <span className="text-[13px] text-faint">Você{team.length ? `, ${team.map((p: { name: string }) => p.name).join(", ")} (Síntese)` : " e o time da Síntese"}</span>
            </div>
            <div className="flex flex-col gap-4 px-[22px] py-5">
              {msgs.length === 0 && <p className="py-6 text-center text-muted">Nenhuma mensagem ainda. Escreva abaixo: o time da Síntese recebe na hora.</p>}
              {msgs.map((m) => (
                <div key={m.id} className={cx("flex max-w-[78%] flex-col gap-1.5", m.fromClient ? "items-end self-end" : "self-start")}>
                  <span className="text-[13px] text-faint">
                    <strong className="text-[#e6d9f2]">{m.mine ? "Você" : m.fromClient ? m.who : `${firstName(m.who)} (Síntese)`}</strong> · {whenShort(m.at, today)}
                  </span>
                  {m.kind === "comment" ? (
                    <p
                      className={cx(
                        "m-0 rounded-2xl px-4 py-3 text-[15px] leading-normal break-words whitespace-pre-line",
                        m.fromClient ? "rounded-br-md bg-[#3A1E12] text-[#FBE3D6]" : "rounded-bl-md border border-line-3 bg-surface-3 text-ink",
                      )}
                    >
                      {m.body}
                    </p>
                  ) : (
                    <a
                      href={`/portal/arquivos/${m.id}`}
                      className={cx("flex items-center gap-3 rounded-2xl px-4 py-3 no-underline", m.fromClient ? "rounded-br-md bg-[#3A1E12]" : "rounded-bl-md border border-line-3 bg-surface-3")}
                    >
                      <span className="num flex h-[30px] w-[46px] shrink-0 items-center justify-center rounded-lg bg-line-2 text-[11px] font-bold text-[#e6d9f2] uppercase">{fileExt(m.filename)}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold break-all text-white">{m.filename}</span>
                        <span className="text-xs text-muted">{fileSize(m.size)} · Baixar</span>
                      </span>
                    </a>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-auto">
              <MessageForm key={sel.id} itemId={sel.id} action={sendMessageAction} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
