import { isLocalDate } from "@/lib/dates";
import type { TrainingData, TrainingPlanRecord, TrainingSession, TrainingWorkout } from "@/types/training";
import { lastUsedLoad, normalizeLoad } from "@/lib/training/loads";
import { changedLoads } from "@/lib/training/loads";
import { withSyncStatus } from "@/lib/training/sync-state";

export function activePlan(data: TrainingData): TrainingPlanRecord | undefined {
  return data.plans.find((plan) => plan.id === data.activePlanId);
}

export function startTrainingSession(data: TrainingData, planId: string, workoutId: string,
  now = new Date(), id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`): { data: TrainingData; session: TrainingSession } {
  const existing = data.sessions.find((session) => session.status === "inProgress" && session.planId === planId);
  if (existing) return { data, session: existing };
  const plan = data.plans.find((item) => item.id === planId);
  const workout = plan?.workouts.find((item) => item.id === workoutId);
  if (!plan || !workout) throw new Error("This training or workout is unavailable.");
  const session: TrainingSession = {
    id, planId, planVersion: plan.version, workoutId, workoutSnapshot: structuredClone(workout),
    status: "inProgress", startedAt: now.toISOString(),
    blocks: workout.blocks.map((block) => ({ blockId: block.id, completed: false,
      actualLoad: block.kind === "exercise" ? lastUsedLoad(data, planId, block.id) ?? block.defaultLoad : undefined })),
    syncStatus: plan.source.kind === "builtin" ? "notApplicable" : "pending",
  };
  return { data: { ...data, sessions: [session, ...data.sessions] }, session };
}

export function updateTrainingBlock(data: TrainingData, sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }): TrainingData {
  return { ...data, sessions: data.sessions.map((session) => session.id === sessionId && session.status === "inProgress"
    ? { ...session, blocks: session.blocks.map((block) => block.blockId === blockId ? { ...block, ...change } : block) } : session) };
}

export function sameDaySessions(data: TrainingData, sessionId: string, date: string): TrainingSession[] {
  const current = data.sessions.find((item) => item.id === sessionId);
  return current ? data.sessions.filter((item) => item.status === "completed" && item.planId === current.planId &&
    item.workoutId === current.workoutId && item.localDate === date)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")) : [];
}

export function finishTrainingSession(data: TrainingData, sessionId: string, date: string, now = new Date(),
  choice: "normal" | "add" | "replace" = "normal", replaceId?: string, sessionNote = ""): TrainingData {
  if (!isLocalDate(date)) throw new Error("Choose a valid workout date.");
  const session = data.sessions.find((item) => item.id === sessionId && item.status === "inProgress");
  if (!session) throw new Error("No in-progress workout was found.");
  const matches = sameDaySessions(data, sessionId, date);
  if (matches.length && choice === "normal") throw new Error("Choose whether to add or replace today's workout.");
  if (!matches.length && choice === "replace") throw new Error("No previous workout matches this date.");
  const previous = choice === "replace" ? matches.find((item) => item.id === (replaceId ?? matches[0]?.id)) : undefined;
  if (choice === "replace" && !previous) throw new Error("The previous workout to replace was not found.");
  const completedBase: TrainingSession = { ...session, id: previous?.id ?? session.id, status: "completed", completedAt: now.toISOString(),
    localDate: date, replacedAt: previous ? now.toISOString() : undefined,
    sessionNote: sessionNote.trim().slice(0, 500) || previous?.sessionNote,
    blocks: session.blocks.map((block) => ({ ...block, actualLoad: block.actualLoad === undefined ? undefined : normalizeLoad(block.actualLoad) })),
    duplicateDateAllowed: choice === "add" && matches.length > 0,
    completionReceipt: previous?.completionReceipt,
    completionSyncStatus: previous?.completionSyncStatus ?? (previous?.syncStatus === "synced" ? "synced" : session.syncStatus),
    loadSyncStatus: session.syncStatus,
    syncStatus: previous?.completionReceipt || previous?.syncStatus === "synced" ? "pending" : session.syncStatus,
  };
  const completed = withSyncStatus(completedBase, { loadSyncStatus: changedLoads(completedBase).length ? session.syncStatus : "notApplicable" });
  return { ...data, restTimer: data.restTimer?.sessionId === sessionId ? undefined : data.restTimer,
    sessions: data.sessions.filter((item) => item.id !== sessionId && item.id !== previous?.id)
    .concat(completed).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
}

export function workoutForSession(session: TrainingSession): TrainingWorkout { return session.workoutSnapshot; }

export function planSessions(data: TrainingData, planId: string): TrainingSession[] {
  return data.sessions.filter((session) => session.planId === planId);
}

export function pendingPlanSessions(data: TrainingData, planId: string): TrainingSession[] {
  return planSessions(data, planId).filter((session) => session.status === "completed" &&
    session.syncStatus !== "synced" && session.syncStatus !== "notApplicable");
}
