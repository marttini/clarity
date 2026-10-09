import Link from "next/link";
import { requireTeam } from "@/server/session";
import { today } from "@/lib/clock";
import { REQUEST_CHANNELS } from "@/server/services/items";
import { NewItemForm } from "@/components/projetos/new-item-form";
import { filterOptions, parentOptions } from "../_data";

export const metadata = { title: "Novo item · Clarity" };

export default async function NovoItemPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireTeam();
  const sp = await searchParams;
  const kind = sp.tipo === "tarefa" ? "tarefa" : "projeto";
  const [opts, parents] = await Promise.all([filterOptions(), parentOptions()]);
  const year = Number(today().slice(0, 4));
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-faint">
        <Link href="/projetos" className="font-semibold text-[#e6d9f2] no-underline">
          Projetos
        </Link>
        <span aria-hidden>/</span>
        <span className="font-semibold text-white">{kind === "projeto" ? "Novo projeto" : "Nova tarefa"}</span>
      </div>
      <h1 className="h1 m-0">{kind === "projeto" ? "Novo projeto" : "Nova tarefa"}</h1>
      <div className="card p-5 sm:p-6">
        <NewItemForm
          kind={kind}
          clients={opts.clients}
          people={opts.people}
          tags={opts.tags}
          projects={parents.projects.filter((p) => p.year === year)}
          contacts={parents.contacts}
          channels={REQUEST_CHANNELS}
          today={today()}
          me={me.id}
          initial={{ clientId: sp.cliente, parentId: sp.pai, extra: sp.adicional === "1" }}
        />
      </div>
    </div>
  );
}
