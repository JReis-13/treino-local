import { WORKOUTS } from "@/data/workouts";
import { isLocalDate } from "@/lib/dates";
import type { AppData, WorkoutId, WorkoutSession } from "@/types/workout";

export function startSession(data: AppData, workoutId: WorkoutId, now = new Date(), id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`): { data: AppData; session: WorkoutSession } {
  const existing = data.sessions.find((session) => session.status === "inProgress");
  if (existing) return { data, session: existing };
  const plan = WORKOUTS[workoutId];
  const session: WorkoutSession = {
    id, workoutId, planVersion: plan.planVersion, status: "inProgress", startedAt: now.toISOString(),
    exercises: plan.exercises.map((exercise) => ({ exerciseId: exercise.id, completed: false })),
    syncStatus: data.excel ? "pending" : "notConfigured",
  };
  return { data: { ...data, sessions: [session, ...data.sessions] }, session };
}

export function updateExercise(data: AppData, sessionId: string, exerciseId: string, change: { completed?: boolean; actualLoad?: string }): AppData {
  return {
    ...data,
    sessions: data.sessions.map((session) => session.id === sessionId && session.status === "inProgress"
      ? { ...session, exercises: session.exercises.map((exercise) => exercise.exerciseId === exerciseId ? { ...exercise, ...change } : exercise) }
      : session),
  };
}

export function finishSession(data: AppData, sessionId: string, date: string, now = new Date()): AppData {
  if (!isLocalDate(date)) throw new Error("Choose a valid workout date.");
  const session = data.sessions.find((item) => item.id === sessionId);
  if (!session || session.status !== "inProgress") throw new Error("No in-progress workout was found.");
  return {
    ...data,
    sessions: data.sessions.map((item) => item.id === sessionId ? {
      ...item, status: "completed" as const, completedAt: now.toISOString(), localDate: date,
      syncStatus: data.excel ? "pending" as const : "notConfigured" as const,
    } : item),
  };
}

export function pendingSessions(data: AppData): WorkoutSession[] {
  return data.sessions.filter((session) => session.status === "completed" && session.syncStatus !== "synced")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
