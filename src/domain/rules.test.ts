import { describe, it, expect } from "vitest";
import {
  addDays,
  easterSunday,
  nationalHolidays,
  isWorkday,
  workdaysSince,
  parseDuration,
  formatMinutes,
  minutesToOdooHours,
  longDate,
  addMonths,
  endOfMonth,
  addWorkdays,
} from "./dates";
import {
  dayColor,
  consultantBand,
  teamGoalStatus,
  projectMonth,
  compareMonthly,
  canEditFreely,
  editDeadline,
  validateEntry,
  currentMissingStreak,
  monthMissingRule,
  isClientActive,
  inactiveMonths,
  contactAlert,
  clientHealth,
  nextBusinessInstant,
  type EntryTypeInfo,
  type ItemInfo,
} from "./rules";
import { parseQuickEntry } from "./quickEntry";

const H = new Set([...nationalHolidays(2026), ...nationalHolidays(2027)].map((h) => h.date));

describe("datas e feriados", () => {
  it("calcula a Páscoa e a Sexta-feira Santa", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(nationalHolidays(2026).find((h) => h.name === "Sexta-feira Santa")?.date).toBe("2026-04-03");
  });
  it("12/out/2026 é feriado e fim de semana não é dia útil", () => {
    expect(isWorkday("2026-10-12", H)).toBe(false);
    expect(isWorkday("2026-10-10", H)).toBe(false);
    expect(isWorkday("2026-10-08", H)).toBe(true);
  });
  it("conta dias úteis pulando feriado", () => {
    // sexta 9/out → terça 13/out: só 13 é útil (12 é feriado)
    expect(workdaysSince("2026-10-09", "2026-10-13", H)).toBe(1);
    expect(addWorkdays("2026-10-09", 1, H)).toBe("2026-10-13");
  });
  it("lê horas em vários formatos", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("2h30")).toBe(150);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("abc")).toBeNull();
    expect(formatMinutes(90)).toBe("1:30");
    expect(minutesToOdooHours(90)).toBe(1.5);
  });
  it("datas por extenso e meses", () => {
    expect(longDate("2026-10-08")).toBe("quinta, 8 de outubro");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("cores do dia (US-06)", () => {
  it("segue as faixas vermelho/amarelo/azul/verde", () => {
    expect(dayColor(0)).toBe("vermelho");
    expect(dayColor(1)).toBe("amarelo");
    expect(dayColor(239)).toBe("amarelo");
    expect(dayColor(240)).toBe("azul");
    expect(dayColor(360)).toBe("azul");
    expect(dayColor(361)).toBe("verde");
  });
});

describe("faixas do consultor (US-50)", () => {
  it("limite inferior pertence à faixa de cima", () => {
    expect(consultantBand(59 * 60).key).toBe("abaixo");
    expect(consultantBand(60 * 60).key).toBe("cota");
    expect(consultantBand(90 * 60).key).toBe("faixa1");
    expect(consultantBand(139 * 60 + 59).key).toBe("faixa1");
    expect(consultantBand(140 * 60).key).toBe("faixa2");
    expect(consultantBand(175 * 60).key).toBe("faixa3");
  });
  it("diz quanto falta para a próxima", () => {
    const b = consultantBand(42 * 60 + 30);
    expect(b.next?.label).toBe("Cota atingida");
    expect(b.missingMinutes).toBe(17 * 60 + 30);
    const top = consultantBand(200 * 60);
    expect(top.next?.label).toBe("Bônus extra");
    expect(consultantBand(241 * 60).extra).toBe(true);
    expect(consultantBand(241 * 60).next).toBeNull();
  });
  it("metas da equipe", () => {
    const t = teamGoalStatus(412 * 60);
    expect(t.reached).toBeNull();
    expect(t.next?.name).toBe("Cota");
    expect(teamGoalStatus(1500 * 60).reached?.name).toBe("Meta");
  });
});

describe("projeção e comparação (US-33)", () => {
  it("projeta o mês pelo ritmo dos dias úteis passados", () => {
    // outubro/2026: 21 dias úteis (12 é feriado). Até 7/out (exclusive hoje 8): 5 dias úteis.
    expect(projectMonth(50 * 60, "2026-10-08", H)).toBe(Math.round((3000 / 5) * 21));
  });
  it("médias de 3, 6 e 12 meses usam só meses existentes", () => {
    const c = compareMonthly(100, 200, [150, 120, 90, 60]);
    expect(c.previous).toBe(150);
    expect(c.avg3).toBe(120);
    expect(c.avg6).toBe(105);
    expect(c.avg12).toBe(105);
    expect(compareMonthly(1, 1, []).avg3).toBeNull();
  });
});

describe("regra das 48 horas (US-04, US-12)", () => {
  const created = new Date("2026-10-06T12:00:00Z");
  it("libera edição por 48 h a partir do lançamento", () => {
    const e = { createdAt: created, date: "2026-10-01", isProvisioning: false };
    expect(canEditFreely(e, new Date("2026-10-08T11:59:00Z"))).toBe(true);
    expect(canEditFreely(e, new Date("2026-10-08T12:00:00Z"))).toBe(false);
  });
  it("no provisionamento, conta a partir da data provisionada", () => {
    const e = { createdAt: created, date: "2026-10-20", isProvisioning: true };
    // 20/out 00:00 BRT = 03:00Z; +48h = 22/out 03:00Z
    expect(editDeadline(e).toISOString()).toBe("2026-10-22T03:00:00.000Z");
    expect(canEditFreely(e, new Date("2026-10-21T20:00:00Z"))).toBe(true);
  });
});

describe("validação do apontamento (US-01, US-02, US-27)", () => {
  const fat: EntryTypeInfo = { id: "f", code: "faturavel", acceptsSalesOrder: true, isInternal: false, isProvisioning: false, active: true };
  const bon: EntryTypeInfo = { ...fat, id: "b", code: "bonificado", acceptsSalesOrder: false };
  const prov: EntryTypeInfo = { ...fat, id: "p", code: "provisionamento", acceptsSalesOrder: false, isProvisioning: true };
  const intr: EntryTypeInfo = { ...fat, id: "i", code: "interno", acceptsSalesOrder: false, isInternal: true };
  const task: ItemInfo = { id: "t", kind: "tarefa", scopeStatus: "confirmado", outOfScope: false, clientApproval: "nao_se_aplica", isInternalProject: false, archived: false, stage: "andamento" };
  const me = { isConsultor: true, active: true };
  const base = { date: "2026-10-08", minutes: 60, description: "Ajuste", type: fat, item: task };

  it("aceita um lançamento normal", () => {
    expect(validateEntry(base, "2026-10-08", me)).toEqual({});
  });
  it("data futura só com provisionamento", () => {
    expect(validateEntry({ ...base, date: "2026-10-09" }, "2026-10-08", me).date).toBeTruthy();
    expect(validateEntry({ ...base, date: "2026-10-09", type: prov }, "2026-10-08", me)).toEqual({});
    expect(validateEntry({ ...base, type: prov }, "2026-10-08", me).date).toBeTruthy();
  });
  it("trava o pedido de venda fora do Faturável", () => {
    expect(validateEntry({ ...base, type: bon, salesOrderLineId: "x" }, "2026-10-08", me).salesOrder).toBeTruthy();
    expect(validateEntry({ ...base, salesOrderLineId: "x" }, "2026-10-08", me)).toEqual({});
  });
  it("demanda adicional só aceita horas aprovada pelo cliente", () => {
    const dem = { ...task, outOfScope: true, clientApproval: "aguardando" as const };
    expect(validateEntry({ ...base, item: dem }, "2026-10-08", me).item).toMatch(/aguardando/);
    expect(validateEntry({ ...base, item: { ...dem, clientApproval: "aprovada" } }, "2026-10-08", me)).toEqual({});
  });
  it("rascunho não recebe horas", () => {
    expect(validateEntry({ ...base, item: { ...task, parentScopeStatus: "rascunho" } }, "2026-10-08", me).item).toMatch(/rascunho/);
  });
  it("Interno só no projeto Síntese", () => {
    expect(validateEntry({ ...base, type: intr }, "2026-10-08", me).type).toBeTruthy();
    expect(validateEntry({ ...base, type: intr, item: { ...task, isInternalProject: true } }, "2026-10-08", me)).toEqual({});
  });
  it("quem não é consultor não aponta", () => {
    expect(validateEntry(base, "2026-10-08", { isConsultor: false, active: true }).item).toBeTruthy();
  });
});

describe("regra dos 3 dias (US-11)", () => {
  it("conta a sequência atual de dias úteis sem apontamento", () => {
    const s = currentMissingStreak({
      today: "2026-10-14",
      daysWithEntries: new Set(["2026-10-08"]),
      justifiedDays: new Set(),
      holidays: H,
    });
    // 9 (sex), 13 (ter); 12 é feriado, 10-11 fim de semana
    expect(s).toEqual(["2026-10-09", "2026-10-13"]);
  });
  it("justificativa quebra a sequência e o mês avalia o bônus", () => {
    const r = monthMissingRule({
      month: "2026-10-01",
      today: "2026-10-31",
      daysWithEntries: new Set(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-09", "2026-10-13"]),
      justifiedDays: new Set(["2026-10-07"]),
      holidays: H,
    });
    expect(r.worstStreak).toBeGreaterThanOrEqual(3); // 14 em diante sem nada
    expect(r.lostBonus).toBe(true);
    const ok = monthMissingRule({
      month: "2026-10-01",
      today: "2026-10-08",
      daysWithEntries: new Set(["2026-10-01", "2026-10-05", "2026-10-07"]),
      justifiedDays: new Set(["2026-10-06"]),
      holidays: H,
    });
    expect(ok.missing).toEqual(["2026-10-02"]);
    expect(ok.lostBonus).toBe(false);
  });
});

describe("clientes e contatos (US-30, US-37, US-45)", () => {
  it("ativo = horas reais nos últimos 6 meses", () => {
    expect(isClientActive("2026-04-09", "2026-10-08")).toBe(true);
    expect(isClientActive("2026-04-07", "2026-10-08")).toBe(false);
    expect(inactiveMonths("2026-01-15", "2026-10-08")).toBe(8);
  });
  it("alerta após 5 dias úteis sem contato", () => {
    expect(contactAlert("2026-10-01", "2026-10-08", H).alert).toBe(true);
    expect(contactAlert("2026-10-02", "2026-10-08", H)).toEqual({ alert: false, workdays: 4 });
  });
  it("semáforo de saúde", () => {
    const base = { today: "2026-10-08", holidays: H, openDeadlines: [], unansweredClientCommentsSince: [], lastRealizedContact: "2026-10-07", active: true, demandsAwaitingClient: 0 };
    expect(clientHealth(base).health).toBe("verde");
    expect(clientHealth({ ...base, demandsAwaitingClient: 1 }).health).toBe("amarelo");
    expect(clientHealth({ ...base, openDeadlines: ["2026-10-10"] }).health).toBe("amarelo");
    expect(clientHealth({ ...base, openDeadlines: ["2026-10-07"] }).health).toBe("vermelho");
    expect(clientHealth({ ...base, unansweredClientCommentsSince: [new Date("2026-10-07T13:00:00Z")] }).health).toBe("vermelho");
    expect(clientHealth({ ...base, lastRealizedContact: "2026-09-29" }).reasons[0]).toMatch(/sem contato há 7 dias úteis/);
  });
});

describe("horário comercial dos avisos", () => {
  it("adia avisos da noite e do fim de semana para 8h do próximo dia útil", () => {
    expect(nextBusinessInstant(new Date("2026-10-08T15:00:00Z"), H).toISOString()).toBe("2026-10-08T15:00:00.000Z");
    // quinta 22h BRT → sexta 8h BRT
    expect(nextBusinessInstant(new Date("2026-10-09T01:00:00Z"), H).toISOString()).toBe("2026-10-09T11:00:00.000Z");
    // sexta 19h BRT → terça 13/out (12 é feriado) 8h
    expect(nextBusinessInstant(new Date("2026-10-09T22:00:00Z"), H).toISOString()).toBe("2026-10-13T11:00:00.000Z");
    // quinta 6h BRT → mesmo dia 8h
    expect(nextBusinessInstant(new Date("2026-10-08T09:00:00Z"), H).toISOString()).toBe("2026-10-08T11:00:00.000Z");
  });
});

describe("lançamento rápido", () => {
  const clients = [
    { id: "k", name: "Kari-Kari Alimentos" },
    { id: "b", name: "Brava Soluções" },
    { id: "r", name: "Radar Rolamentos" },
    { id: "s", name: "Síntese", isInternal: true },
  ];
  const tasks = [
    { id: "t1", clientId: "k", name: "Erro na importação", parentName: "Broker" },
    { id: "t2", clientId: "k", name: "Ajuste de relatório de vendas", parentName: null },
    { id: "t3", clientId: "b", name: "Suporte fiscal: rejeição de NF-e", parentName: null, isSustentacao: true },
    { id: "t4", clientId: "s", name: "Reuniões internas", parentName: null },
  ];
  it("entende horas, cliente, tarefa e sustentação", () => {
    const r = parseQuickEntry("2h30 kari broker corrigi o erro de importação sust", { clients, tasks });
    expect(r.minutes).toBe(150);
    expect(r.client?.id).toBe("k");
    expect(r.task?.id).toBe("t1");
    expect(r.sustentacao).toBe(true);
    expect(r.typeCode).toBe("faturavel");
    expect(r.missing).toBeNull();
  });
  it("herda sustentação da tarefa e entende bonificado", () => {
    const r = parseQuickEntry("1:00 brava fiscal nfe rejeitada bonif", { clients, tasks });
    expect(r.task?.id).toBe("t3");
    expect(r.sustentacao).toBe(true);
    expect(r.typeCode).toBe("bonificado");
  });
  it("Interno vai para a Síntese", () => {
    const r = parseQuickEntry("interno 45min reuniões", { clients, tasks });
    expect(r.client?.id).toBe("s");
    expect(r.task?.id).toBe("t4");
    expect(r.minutes).toBe(45);
  });
  it("aponta o que falta", () => {
    expect(parseQuickEntry("2h", { clients, tasks }).missing).toBe("Falta o cliente.");
    expect(parseQuickEntry("radar 2h", { clients, tasks }).missing).toMatch(/tarefa/);
  });
});
