"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeam } from "@/server/session";
import { parseDuration } from "@/domain/dates";
import {
  ItemError,
  changeDeadline,
  changeStage,
  createProject,
  createTask,
  reclassifyDemand,
  registerExternalApproval,
  setAssignees,
  setTags,
  setVisibility,
  updateItem,
  uploadItemAttachments,
} from "@/server/services/items";
import { addMeeting, confirmScope, newScopeVersion, removeMeeting, saveScopeDraft, type DeliverableInput } from "@/server/services/scope";
import { addComment, deleteComment, editComment } from "@/server/services/comments";
import type { StageKey } from "@/server/data/common";

/** Estado devolvido às telas (useActionState). */
export type ActionState = { ok?: boolean; error?: string; fields?: Record<string, string>; needsConfirm?: boolean; at?: number };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
const all = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
const bool = (f: FormData, k: string) => ["on", "1", "true"].includes(str(f, k));
function hours(v: string): number | null {
  if (!v.trim()) return null;
  const m = parseDuration(v);
  if (m === null) throw new ItemError("Horas inválidas. Use 12, 12:30 ou 12h30.", { planned: "Horas inválidas." });
  return m;
}

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ItemError) return { error: e.message, fields: e.fields, needsConfirm: e.needsConfirm, at: Date.now() };
    if (e instanceof Error && /25 MB|executáveis|vazio/.test(e.message)) return { error: e.message, at: Date.now() };
    throw e;
  }
  for (const p of paths) revalidatePath(p);
  return { ok: true, at: Date.now() };
}

const itemPaths = (id: string) => [`/projetos/${id}`, `/projetos/${id}/escopo`, "/projetos"];

// ---------- Criar (US-14, US-15, US-24) ----------

export async function createItemAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  let newId = "";
  const res = await run(async () => {
    const common = {
      name: str(f, "name"),
      description: str(f, "description"),
      assigneeIds: all(f, "assignees"),
      startDate: str(f, "startDate") || null,
      deadline: str(f, "deadline") || null,
      plannedMinutes: hours(str(f, "planned")),
      isSustentacao: bool(f, "sustentacao"),
      tagIds: all(f, "tags"),
      visibleToClient: bool(f, "visible"),
    };
    if (str(f, "kind") === "projeto") {
      newId = (await createProject(me, { ...common, clientId: str(f, "clientId") })).id;
    } else {
      const deliverable = str(f, "deliverable");
      newId = (
        await createTask(me, {
          ...common,
          clientId: str(f, "clientId") || null,
          parentId: str(f, "parentId") || null,
          checklist: str(f, "checklist")
            .split("\n")
            .map((t) => ({ text: t, done: false })),
          deliverableId: deliverable && deliverable !== "adicional" ? deliverable : null,
          outOfScope: deliverable === "adicional",
          requestedByContactId: str(f, "requestedBy") || null,
          requestedAt: str(f, "requestedAt") || null,
          requestChannel: str(f, "requestChannel") || null,
        })
      ).id;
    }
  }, ["/projetos"]);
  if (res.ok && newId) redirect(`/projetos/${newId}`);
  return res;
}

// ---------- Item ----------

export async function stageAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => changeStage(me, id, str(f, "stage") as StageKey, { confirmOpenTasks: bool(f, "confirm") }), itemPaths(id));
}

export async function deadlineAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => changeDeadline(me, id, str(f, "deadline"), str(f, "reason")), itemPaths(id));
}

export async function tagsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => setTags(me, id, all(f, "tags")), itemPaths(id));
}

export async function assigneesAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => setAssignees(me, id, all(f, "assignees")), itemPaths(id));
}

export async function visibilityAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => setVisibility(me, id, bool(f, "visible"), { cascade: bool(f, "cascade") }), itemPaths(id));
}

export async function detailsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(
    () =>
      updateItem(me, id, {
        name: str(f, "name"),
        description: str(f, "description"),
        startDate: str(f, "startDate") || null,
        plannedMinutes: hours(str(f, "planned")),
        isSustentacao: bool(f, "sustentacao"),
      }),
    itemPaths(id),
  );
}

export async function checklistAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  const texts = f.getAll("text").map(String);
  const done = new Set(all(f, "done"));
  const extra = str(f, "new").trim();
  const list = texts.map((text, i) => ({ text, done: done.has(String(i)) })).filter((_, i) => str(f, `remove${i}`) !== "1");
  if (extra) list.push({ text: extra, done: false });
  return run(() => updateItem(me, id, { checklist: list }), itemPaths(id));
}

export async function sustentacaoAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => updateItem(me, id, { isSustentacao: bool(f, "sustentacao") }), itemPaths(id));
}

// ---------- Demandas adicionais ----------

export async function approvalAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  const file = f.get("evidence");
  return run(() => registerExternalApproval(me, id, file instanceof File ? file : null, str(f, "note")), [...itemPaths(id), ...itemPaths(str(f, "projectId"))]);
}

export async function reclassifyAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  const target = str(f, "deliverable");
  return run(
    () => reclassifyDemand(me, id, { outOfScope: target === "adicional", deliverableId: target === "adicional" ? null : target, reason: str(f, "reason") }),
    [...itemPaths(id), ...itemPaths(str(f, "projectId"))],
  );
}

// ---------- Comentários e anexos ----------

export async function commentAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  const channel = str(f, "channel") === "cliente" ? "cliente" : "interno";
  return run(() => addComment(me, id, { channel, body: str(f, "body"), confirmClient: bool(f, "confirmClient") }), [`/projetos/${id}`]);
}

export async function editCommentAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  return run(() => editComment(me, str(f, "commentId"), str(f, "body")), [`/projetos/${str(f, "id")}`]);
}

export async function deleteCommentAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  return run(() => deleteComment(me, str(f, "commentId")), [`/projetos/${str(f, "id")}`]);
}

export async function uploadAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  const files = f.getAll("files").filter((x): x is File => x instanceof File);
  return run(() => uploadItemAttachments(me, id, files, { internal: bool(f, "internal") }), itemPaths(id));
}

// ---------- Escopo ----------

function parseDeliverables(f: FormData): DeliverableInput[] {
  const raw = str(f, "deliverables");
  let list: { id?: string; title?: string; description?: string; hours?: string; person?: string }[] = [];
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    throw new ItemError("Não foi possível ler os entregáveis. Recarregue a página.");
  }
  return list.map((d, i) => {
    const m = d.hours?.trim() ? parseDuration(d.hours) : null;
    if (d.hours?.trim() && m === null) throw new ItemError(`Horas inválidas no entregável E${i + 1}.`);
    return { id: d.id || null, title: d.title ?? "", description: d.description ?? "", estimateMinutes: m, suggestedPersonId: d.person || null };
  });
}

export async function saveScopeAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(
    () =>
      saveScopeDraft(me, id, {
        objective: str(f, "objective"),
        assumptions: str(f, "assumptions"),
        exclusions: JSON.parse(str(f, "exclusions") || "[]"),
        deliverables: parseDeliverables(f),
      }),
    itemPaths(id),
  );
}

export async function confirmScopeAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => confirmScope(me, id), itemPaths(id));
}

export async function newVersionAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  const res = await run(
    () =>
      newScopeVersion(me, id, {
        reason: str(f, "reason"),
        objective: str(f, "objective"),
        assumptions: str(f, "assumptions"),
        exclusions: JSON.parse(str(f, "exclusions") || "[]"),
        deliverables: parseDeliverables(f),
        incorporate: JSON.parse(str(f, "incorporate") || "[]"),
      }),
    itemPaths(id),
  );
  if (res.ok) redirect(`/projetos/${id}/escopo`);
  return res;
}

export async function meetingAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => addMeeting(me, id, { date: str(f, "date"), title: str(f, "title"), participants: str(f, "participants"), summary: str(f, "summary") }), itemPaths(id));
}

export async function removeMeetingAction(_: ActionState, f: FormData): Promise<ActionState> {
  const me = await requireTeam();
  const id = str(f, "id");
  return run(() => removeMeeting(me, str(f, "meetingId")), itemPaths(id));
}
