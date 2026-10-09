import { and, count, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { readRules } from "@/server/services/settings";
import { ActionForm } from "@/components/config/forms";
import { requireAdminPage } from "../_guard";
import { saveGoalsAction } from "../actions";

export const metadata = { title: "Metas e faixas · Configurações" };

const BAND_COLORS = ["#7A5A9A", "#4A3263", "#3B86C9", "#3FA06C", "#F07A45", "#F7B08C"];

/** US-50: cota, faixas e metas do time (horas Faturáveis no mês). Grava em settings "rules". */
export default async function Metas() {
  await requireAdminPage();
  const st = await readRules();
  const [{ n: consultores }] = await db.select({ n: count() }).from(s.people).where(and(eq(s.people.active, true), eq(s.people.isConsultor, true)));
  const b = st.bands;
  const cuts = [0, b.quota, b.band1, b.band2, b.band3, b.extra, b.extra + 20];
  const max = b.extra + 20;
  const labels = ["Abaixo da cota", "Cota", "Faixa 1", "Faixa 2", "Faixa 3", "Bônus"];
  const bar = labels.map((l, i) => ({
    l,
    c: BAND_COLORS[i],
    w: ((cuts[i + 1] - cuts[i]) / max) * 100,
    txt: i === 0 ? `${l} (até ${b.quota - 1} h)` : i === 5 ? `${l} (${b.extra} h ou mais)` : `${l} (${cuts[i]} a ${cuts[i + 1] - 1} h)`,
  }));
  const goals = [...st.teamGoals, { name: "", hours: NaN }];
  const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const bandInputs = [
    { k: "quota", label: "Cota", hint: "mínimo do mês", v: b.quota },
    { k: "band1", label: "Faixa 1", hint: "a partir de", v: b.band1 },
    { k: "band2", label: "Faixa 2", hint: "a partir de", v: b.band2 },
    { k: "band3", label: "Faixa 3", hint: "a partir de", v: b.band3 },
    { k: "extra", label: "Bônus extra", hint: "a partir de", v: b.extra },
  ];
  return (
    <section aria-labelledby="h-m" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="h-m" className="h2">
          Metas e faixas
        </h2>
        <p className="text-sm text-muted">Só horas Faturáveis contam. Bonificado, Interno e Provisionamento ficam fora.</p>
      </div>
      <ActionForm action={saveGoalsAction} className="flex flex-col gap-5">
        <div className="card flex flex-col gap-4 p-5">
          <h3 className="h3">Faixas por consultor (horas no mês)</h3>
          <div className="flex flex-wrap gap-4">
            {bandInputs.map((x) => (
              <label key={x.k} className="flex flex-col gap-1 text-sm font-bold text-white">
                {x.label}
                <span className="text-xs font-medium text-faint">{x.hint}</span>
                <span className="flex items-center gap-1.5">
                  <input type="number" inputMode="numeric" name={x.k} defaultValue={x.v} min={1} required className="field num w-24 text-[15px] font-bold" />
                  <span className="text-sm font-medium text-muted">h</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <div aria-hidden className="flex h-3 overflow-hidden rounded-full">
              {bar.map((g) => (
                <span key={g.l} style={{ flex: `0 0 ${g.w.toFixed(2)}%`, background: g.c }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {bar.map((g) => (
                <span key={g.l} className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: g.c }} />
                  {g.txt}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[13px] text-muted">O limite de baixo pertence à faixa de cima: quem fecha com exatamente {b.band1} h já está na Faixa 1. Os valores precisam crescer: cota menor que Faixa 1, que é menor que Faixa 2, e assim por diante.</p>
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="h3">Metas do time (horas faturáveis no mês)</h3>
            <span className="text-[13px] text-faint">Aparecem só na Gestão e na TV. Sem valores em R$.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead>
                <tr>
                  <th scope="col">Nível</th>
                  <th scope="col">Nome</th>
                  <th scope="col">Horas</th>
                  <th scope="col">Por consultor ({consultores} apontam)</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((g, i) => (
                  <tr key={i}>
                    <td className="num text-muted">{i + 1}</td>
                    <td>
                      <input name="goalName" aria-label={`Nome do nível ${i + 1}`} defaultValue={g.name} placeholder={i === goals.length - 1 ? "Novo nível (opcional)" : ""} className="field min-h-10 w-[220px] text-sm" />
                    </td>
                    <td>
                      <input name="goalHours" type="number" min={1} aria-label={`Horas do nível ${i + 1}`} defaultValue={Number.isNaN(g.hours) ? "" : g.hours} className="field num min-h-10 w-[120px] text-sm font-bold" />
                    </td>
                    <td className="num text-muted">{Number.isNaN(g.hours) || !consultores ? "" : `${fmt(g.hours / consultores)} h`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-muted">Cada meta precisa ser maior que a anterior. Para tirar um nível, apague o nome e as horas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary">Salvar alterações</button>
          <span className="text-[13px] text-faint">Valem para o mês corrente e os próximos.</span>
        </div>
      </ActionForm>
    </section>
  );
}
