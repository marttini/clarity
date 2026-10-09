"use server";
import { revalidatePath } from "next/cache";
import { requireTeam, Forbidden, type TeamUser } from "@/server/session";
import * as svc from "@/server/services/settings";
import type { FormState } from "@/components/config/forms";

/** Ações das Configurações: finas; o serviço confere que é Administrador. */
async function run(fn: (me: TeamUser) => Promise<string | void>, okMsg: string, path = "/config"): Promise<FormState> {
  const me = await requireTeam();
  try {
    const msg = await fn(me);
    revalidatePath(path, "layout");
    return { ok: true, msg: msg || okMsg, key: Date.now() };
  } catch (e) {
    if (e instanceof svc.SettingsError || e instanceof Forbidden) return { ok: false, msg: e.message, key: Date.now() };
    console.error(e);
    return { ok: false, msg: "Não deu certo. Tente de novo em instantes.", key: Date.now() };
  }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const bool = (f: FormData, k: string) => f.get(k) === "1" || f.get(k) === "on";
const num = (f: FormData, k: string) => Number(str(f, k).replace(",", "."));

export async function updatePersonAction(_: FormState, f: FormData) {
  return run(
    (me) =>
      svc.updatePerson(me, str(f, "id"), {
        role: str(f, "role") as TeamUser["role"],
        canApproveHours: bool(f, "canApproveHours"),
        canConfirmScope: bool(f, "canConfirmScope"),
        slackUserId: str(f, "slackUserId"),
      }),
    "Salvo.",
  );
}

export async function createTypeAction(_: FormState, f: FormData) {
  return run(async (me) => {
    const t = await svc.createEntryType(me, { name: str(f, "name"), acceptsSalesOrder: bool(f, "acceptsSalesOrder") });
    return `Tipo "${t.name}" criado (código ${t.code}).`;
  }, "Criado.", "/config/tipos");
}

export async function updateTypeAction(_: FormState, f: FormData) {
  return run(
    (me) => svc.updateEntryType(me, str(f, "id"), { name: str(f, "name"), acceptsSalesOrder: f.has("builtin") ? undefined : bool(f, "acceptsSalesOrder"), active: f.has("builtin") ? undefined : bool(f, "active") }).then(() => undefined),
    "Salvo.",
    "/config/tipos",
  );
}

export async function deleteTypeAction(_: FormState, f: FormData) {
  return run((me) => svc.deleteEntryType(me, str(f, "id")), "Tipo excluído.", "/config/tipos");
}

export async function saveGoalsAction(_: FormState, f: FormData) {
  const names = f.getAll("goalName").map(String);
  const hours = f.getAll("goalHours").map(String);
  return run(
    (me) =>
      svc.saveBandsAndGoals(me, {
        bands: { quota: num(f, "quota"), band1: num(f, "band1"), band2: num(f, "band2"), band3: num(f, "band3"), extra: num(f, "extra") },
        teamGoals: names.map((n, i) => ({ name: n, hours: hours[i] === "" ? (NaN as number) : Number(hours[i]) })).filter((g) => g.name.trim() || !Number.isNaN(g.hours)),
      }),
    "Salvo. As telas já usam os novos valores.",
    "/config/metas",
  );
}

export async function saveRulesAction(_: FormState, f: FormData) {
  return run(
    (me) =>
      svc.saveRules(me, {
        editWindowHours: num(f, "editWindowHours"),
        missingDaysLimit: num(f, "missingDaysLimit"),
        contactAlertWorkdays: num(f, "contactAlertWorkdays"),
        activeClientMonths: num(f, "activeClientMonths"),
        clientCommentAlertWorkdays: num(f, "clientCommentAlertWorkdays"),
        deadlineSoonDays: num(f, "deadlineSoonDays"),
        businessHours: { start: Number(str(f, "start").split(":")[0]), end: Number(str(f, "end").split(":")[0]) },
      }),
    "Salvo. As telas já usam os novos valores.",
    "/config/regras",
  );
}

export async function addHolidayAction(_: FormState, f: FormData) {
  return run((me) => svc.addHoliday(me, { date: str(f, "date"), name: str(f, "name") }), "Feriado incluído.", "/config/feriados");
}

export async function removeHolidayAction(_: FormState, f: FormData) {
  return run((me) => svc.removeHoliday(me, str(f, "date")), "Feriado removido.", "/config/feriados");
}

export async function generateHolidaysAction(_: FormState, f: FormData) {
  return run(async (me) => {
    const n = await svc.generateNationalHolidays(me, num(f, "year"));
    return n ? `${n} feriado${n > 1 ? "s" : ""} nacional${n > 1 ? "is" : ""} incluído${n > 1 ? "s" : ""}.` : "Os feriados nacionais deste ano já estavam na lista.";
  }, "Pronto.", "/config/feriados");
}

export async function addReasonAction(_: FormState, f: FormData) {
  return run((me) => svc.addAbsenceReason(me, str(f, "name")), "Motivo incluído.", "/config/ausencias");
}

export async function updateReasonAction(_: FormState, f: FormData) {
  return run((me) => svc.updateAbsenceReason(me, str(f, "id"), { name: str(f, "name"), active: bool(f, "active") }), "Salvo.", "/config/ausencias");
}

export async function saveOdooFieldsAction(_: FormState, f: FormData) {
  return run(
    (me) =>
      svc.saveOdooFields(me, {
        entryType: str(f, "entryType"),
        sustentacao: str(f, "sustentacao"),
        clarityId: str(f, "clarityId"),
        consultor: str(f, "consultor"),
        novoModeloTag: str(f, "novoModeloTag"),
      }),
    "Salvo. A próxima sincronização já usa estes nomes.",
    "/config/integracao",
  );
}

export async function syncNowAction(_: FormState, f: FormData) {
  void f;
  return run(async (me) => {
    const r = await svc.syncNow(me);
    const parts: string[] = [];
    if (r.pullError) parts.push(`Leitura do Odoo falhou: ${r.pullError}`);
    else if (r.pull) {
      const c = r.pull;
      const n = (x: { created: number; updated: number }) => x.created + x.updated;
      parts.push(`Lidos do Odoo: ${n(c.items)} tarefas, ${n(c.clients)} clientes, ${n(c.people)} pessoas${c.conflicts ? `, ${c.conflicts} conflitos` : ""}${c.pending ? `, ${c.pending} pendências` : ""}.`);
    }
    if (r.pushError) parts.push(`Envio falhou: ${r.pushError}`);
    else if (r.push) parts.push(`Enviados: ${r.push.sent}${r.push.failed ? `, ${r.push.failed} com erro` : ""}${r.push.retrying ? `, ${r.push.retrying} vão tentar de novo` : ""}.`);
    if (r.pullError || r.pushError) throw new svc.SettingsError(parts.join(" "));
    return parts.join(" ");
  }, "Sincronizado.", "/config/integracao");
}

export async function createTvAction(_: FormState, f: FormData) {
  return run(async (me) => {
    const t = await svc.createTvToken(me, str(f, "label"));
    return `Link criado: ${t.label}. Copie o endereço na lista abaixo.`;
  }, "Criado.", "/config/tv");
}

export async function revokeTvAction(_: FormState, f: FormData) {
  return run((me) => svc.revokeTvToken(me, str(f, "id")), "Link revogado: a TV perde o acesso na próxima atualização.", "/config/tv");
}
