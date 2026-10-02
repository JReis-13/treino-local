import { isLocalDate } from "@/lib/dates";
import type { TrainingData, TrainingPlanRecord, TrainingSession, TrainingWorkout } from "@/types/training";

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
    blocks: workout.blocks.map((block) => ({ blockId: block.id, completed: false })),
    syncStatus: plan.source.kind === "builtin" ? "notApplicable" : "pending",
  };
  return { data: { ...data, sessions: [session, ...data.sessions] }, session };
}

export function updateTrainingBlock(data: TrainingData, sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }): TrainingData {
  return { ...data, sessions: data.sessions.map((session) => session.id === sessionId && session.status === "inProgress"
    ? { ...session, blocks: session.blocks.map((block) => block.blockId === blockId ? { ...block, ...change } : block) } : session) };
}

export function finishTrainingSession(data: TrainingData, sessionId: string, date: string, now = new Date()): TrainingData {
  if (!isLocalDate(date)) throw new Error("Choose a valid workout date.");
  const session = data.sessions.find((item) => item.id === sessionId && item.status === "inProgress");
  if (!session) throw new Error("No in-progress workout was found.");
  return { ...data, sessions: data.sessions.map((item) => item.id === sessionId
    ? { ...item, status: "completed" as const, completedAt: now.toISOString(), localDate: date } : item) };
}

export function workoutForSession(session: TrainingSession): TrainingWorkout { return session.workoutSnapshot; }

export function planSessions(data: TrainingData, planId: string): TrainingSession[] {
  return data.sessions.filter((session) => session.planId === planId);
}

export function pendingPlanSessions(data: TrainingData, planId: string): TrainingSession[] {
  return planSessions(data, planId).filter((session) => session.status === "completed" &&
    session.syncStatus !== "synced" && session.syncStatus !== "notApplicable");
}
