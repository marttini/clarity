import { requireClient } from "@/server/session";
import { toISODate } from "@/domain/dates";
import { myEvaluations, pendingEvaluations } from "@/server/services/portal";
import { RatingForm } from "@/components/portal/forms";
import { fullDate } from "@/components/portal/format";
import { evaluateAction } from "../actions";

export const metadata = { title: "Avaliar · Portal Síntese" };

/** Avaliação do cliente: Resultado, Consultor e Time, de 1 a 5. Nasce oculta; só a gestão vê. */
export default async function Avaliar() {
  const me = await requireClient();
  const [pending, mine] = await Promise.all([pendingEvaluations(me), myEvaluations(me)]);
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="h1">Avaliar</h1>
        <p className="max-w-[70ch] text-base leading-normal text-muted">Conte como foi cada entrega. Leva um minuto e ajuda a Síntese a melhorar. Sua avaliação vai para a gestão da Síntese.</p>
      </div>
      {pending.length === 0 && <p className="rounded-2xl bg-green-bg px-5 py-4 text-[15px] text-green">Nenhuma entrega esperando sua avaliação agora.</p>}
      <div className="flex flex-wrap items-start gap-6">
        {pending.map((p) => (
          <section key={p.id} id={p.id} aria-labelledby={`av-${p.id}`} className="card-strong flex min-w-0 flex-[1_1_360px] flex-col gap-3.5 px-[22px] py-5">
            <div className="flex flex-col gap-1">
              <h2 id={`av-${p.id}`} className="text-[17px] font-bold text-white">
                {p.name}
              </h2>
              <span className="text-sm text-muted">
                {p.kind === "projeto" ? "Projeto concluído" : "Concluída"} em {fullDate(toISODate(p.completedAt))}
                {p.consultant ? ` por ${p.consultant}` : ""}.
              </span>
            </div>
            <RatingForm itemId={p.id} action={evaluateAction} compact />
          </section>
        ))}
      </div>
      {mine.length > 0 && (
        <section aria-labelledby="feitas" className="flex flex-col gap-3">
          <h2 id="feitas" className="text-[17px] font-bold text-white">
            Suas avaliações
          </h2>
          <div className="table-wrap">
            <table className="tbl min-w-[520px]">
              <thead>
                <tr>
                  <th scope="col">Entrega</th>
                  <th scope="col">Data</th>
                  <th scope="col" className="text-right">
                    Resultado
                  </th>
                  <th scope="col" className="text-right">
                    Consultor
                  </th>
                  <th scope="col" className="text-right">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {mine.map((e) => (
                  <tr key={e.id}>
                    <td className="text-white">{e.item ?? "Avaliação geral"}</td>
                    <td className="num text-muted">{fullDate(toISODate(e.at))}</td>
                    <td className="num text-right text-white">{e.r}</td>
                    <td className="num text-right text-white">{e.c}</td>
                    <td className="num text-right text-white">{e.t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
