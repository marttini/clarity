import Link from "next/link";
import { requireClient } from "@/server/session";
import { toISODate } from "@/domain/dates";
import { portalFiles, visibleItems } from "@/server/services/portal";
import { cx } from "@/components/ui";
import { UploadForm } from "@/components/portal/forms";
import { fileExt, fileSize, fullDate } from "@/components/portal/format";
import { uploadFileAction } from "../actions";

export const metadata = { title: "Arquivos · Portal Síntese" };

const EXT: Record<string, string> = { pdf: "bg-red-bg text-red", xlsx: "bg-green-bg text-green", xls: "bg-green-bg text-green", csv: "bg-green-bg text-green", docx: "bg-blue-bg text-blue", doc: "bg-blue-bg text-blue" };

/** Arquivos trocados nos itens visíveis (US-39, US-42). Anexos internos nunca aparecem. */
export default async function Arquivos({ searchParams }: { searchParams: Promise<{ projeto?: string }> }) {
  const me = await requireClient();
  const { projeto } = await searchParams;
  const items = (await visibleItems(me)).filter((i) => i.clientApproval !== "recusada");
  const byId = new Map(items.map((i) => [i.id, i]));
  const projectOf = (id: string) => {
    const it = byId.get(id);
    if (!it) return null;
    return it.parentId && byId.has(it.parentId) ? byId.get(it.parentId)! : it;
  };
  const files = await portalFiles(me);
  const roots = items.filter((i) => i.kind === "projeto" || !i.parentId || !byId.has(i.parentId));
  const shown = files.filter((f) => !projeto || projectOf(f.itemId)?.id === projeto);
  const options = items.map((i) => ({ id: i.id, label: i.parentId && byId.has(i.parentId) ? `${byId.get(i.parentId)!.name} · ${i.name}` : i.name }));

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="h1">Arquivos</h1>
        <p className="text-base text-muted">Documentos trocados entre a {me.clientName} e a Síntese.</p>
      </div>
      {options.length > 0 ? (
        <UploadForm options={options} action={uploadFileAction} defaultItem={projeto && byId.has(projeto) ? projeto : undefined} />
      ) : (
        <p className="card p-6 text-muted">Quando houver projetos liberados, você poderá enviar arquivos aqui.</p>
      )}
      {roots.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por projeto">
          <Link href="/portal/arquivos" aria-pressed={!projeto} scroll={false} className="chip min-h-10 aria-pressed:!text-on-accent px-3.5 text-sm no-underline">
            Todos
          </Link>
          {roots.map((r) => (
            <Link key={r.id} href={`/portal/arquivos?projeto=${r.id}`} aria-pressed={projeto === r.id} scroll={false} className="chip min-h-10 aria-pressed:!text-on-accent px-3.5 text-sm no-underline">
              {r.name}
            </Link>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th scope="col" className="!px-[18px]">
                Arquivo
              </th>
              <th scope="col">Projeto</th>
              <th scope="col">Enviado por</th>
              <th scope="col">Data</th>
              <th scope="col" className="text-right">
                Tamanho
              </th>
              <th scope="col" className="!px-[18px]">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => {
              const ext = fileExt(f.filename);
              const proj = projectOf(f.itemId);
              const task = byId.get(f.itemId);
              return (
                <tr key={f.id}>
                  <td className="!px-[18px]">
                    <div className="flex items-center gap-3">
                      <span className={cx("num flex h-[30px] w-[46px] shrink-0 items-center justify-center rounded-lg text-[11px] font-bold uppercase", EXT[ext] ?? "bg-line-2 text-[#e6d9f2]")}>{ext}</span>
                      <span className="font-semibold break-words text-white">
                        {f.filename}
                        {f.version > 1 && <span className="ml-2 text-xs font-normal text-faint">versão {f.version}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="text-muted">
                    {proj?.name}
                    {task && proj && task.id !== proj.id && <span className="block text-xs text-faint">{task.name}</span>}
                  </td>
                  <td className="text-ink">{f.mine ? "Você" : f.by}</td>
                  <td className="num text-muted">{fullDate(toISODate(f.at))}</td>
                  <td className="num text-right text-muted">{fileSize(f.size)}</td>
                  <td className="!px-[18px] text-right">
                    <a href={`/portal/arquivos/${f.id}`} className="inline-flex min-h-11 items-center font-bold text-accent-soft">
                      Baixar
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p className="px-4 py-8 text-center text-muted">Nenhum arquivo por aqui ainda.</p>}
      </div>
    </div>
  );
}
