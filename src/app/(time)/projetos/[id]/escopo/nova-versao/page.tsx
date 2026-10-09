import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireTeam, isManager } from "@/server/session";
import { ItemError, loadItemCtx } from "@/server/services/items";
import { currentVersion, getDeliverables } from "@/server/services/scope";
import { hoursText } from "@/components/projetos/bits";
import { ScopeEditor } from "@/components/projetos/scope-editor";
import { newVersionAction } from "../../../actions";
import { extrasOf } from "../../../_data";

export const metadata = { title: "Nova versão do escopo · Clarity" };

/** US-26: a gestão gera nova versão do escopo, com motivo, e pode incorporar demandas adicionais. */
export default async function NovaVersaoPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTeam();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let ctx;
  try {
    ctx = await loadItemCtx(id);
  } catch (e) {
    if (e instanceof ItemError) notFound();
    throw e;
  }
  const { item, client } = ctx;
  if (item.kind !== "projeto") notFound();
  const allowed = isManager(me) || me.canConfirmScope;
  const v = await currentVersion(id);
  const ds = v ? await getDeliverables([v.id]) : [];
  const [people, extras] = await Promise.all([
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(eq(s.people.active, true)).orderBy(asc(s.people.name)),
    extrasOf(id),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-6">
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-sm text-faint">
        <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: client.color }} />
        <span className="font-semibold text-[#e6d9f2]">{client.name}</span>
        <span aria-hidden>/</span>
        <Link href={`/projetos/${id}`} className="text-[#e6d9f2] no-underline">
          {item.name}
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/projetos/${id}/escopo`} className="text-[#e6d9f2] no-underline">
          Escopo
        </Link>
        <span aria-hidden>/</span>
        <span className="font-semibold text-white">Nova versão</span>
      </nav>
      <div className="flex flex-col gap-2">
        <h1 className="h1 m-0">Nova versão do escopo</h1>
        <p className="m-0 text-[15px] text-muted">
          Parte da versão {v?.version ?? 1}. A versão atual fica guardada e pode ser comparada depois.
        </p>
      </div>
      {item.scopeStatus !== "confirmado" ? (
        <p className="m-0 rounded-xl bg-yellow-bg px-4 py-3 text-sm text-yellow">O escopo ainda está em rascunho: edite e confirme antes de gerar novas versões.</p>
      ) : !allowed ? (
        <p className="m-0 rounded-xl bg-yellow-bg px-4 py-3 text-sm text-yellow">Só a gestão gera nova versão do escopo.</p>
      ) : (
        <ScopeEditor
          action={newVersionAction}
          id={id}
          people={people}
          mode="nova_versao"
          extras={extras}
          initial={{
            objective: v?.objective ?? "",
            assumptions: v?.assumptions ?? "",
            exclusions: v?.exclusions ?? [],
            deliverables: ds.map((d) => ({ id: d.id, title: d.title, description: d.description ?? "", hours: hoursText(d.estimateMinutes), person: d.suggestedPersonId ?? "" })),
          }}
        />
      )}
    </div>
  );
}
