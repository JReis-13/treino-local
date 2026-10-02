import { isLocalDate } from "@/lib/dates";
import type { AppData, ExerciseSession, WorkoutSession } from "@/types/workout";

const STORAGE_KEY = "treino-local:v1";
const emptyData = (): AppData => ({ schemaVersion: 1, sessions: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExerciseSession(value: unknown): value is ExerciseSession {
  return isRecord(value) && typeof value.exerciseId === "string" &&
    typeof value.completed === "boolean" &&
    (value.actualLoad === undefined || typeof value.actualLoad === "string");
}

function isSession(value: unknown): value is WorkoutSession {
  if (!isRecord(value) || (value.workoutId !== "A" && value.workoutId !== "B")) return false;
  if (typeof value.id !== "string" || typeof value.planVersion !== "string" || typeof value.startedAt !== "string") return false;
  if (!Number.isFinite(Date.parse(value.startedAt))) return false;
  if (value.status !== "inProgress" && value.status !== "completed") return false;
  if (!["notConfigured", "pending", "synced", "conflict", "failed"].includes(String(value.syncStatus))) return false;
  if (!Array.isArray(value.exercises) || !value.exercises.every(isExerciseSession)) return false;
  if (value.exercises.length === 0 || new Set(value.exercises.map((item) => item.exerciseId)).size !== value.exercises.length) return false;
  if (value.status === "completed") {
    if (typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt)) ||
        typeof value.localDate !== "string" || !isLocalDate(value.localDate)) return false;
  }
  return value.syncMessage === undefined || typeof value.syncMessage === "string";
}

export function parseStoredData(raw: string): AppData {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.sessions) ||
      !value.sessions.every(isSession) || new Set(value.sessions.map((session: WorkoutSession) => session.id)).size !== value.sessions.length) {
    throw new Error("Local workout data is invalid. Your saved data was left untouched.");
  }
  if (value.excel !== undefined && (!isRecord(value.excel) || typeof value.excel.filename !== "string" ||
      !["compatible", "incompatible"].includes(String(value.excel.validation)) ||
      typeof value.excel.validatedAt !== "string" ||
      !["direct", "copy"].includes(String(value.excel.mode)) ||
      (value.excel.lastSyncedAt !== undefined && typeof value.excel.lastSyncedAt !== "string"))) {
    throw new Error("Local Excel connection data is invalid. Your saved data was left untouched.");
  }
  return value as unknown as AppData;
}

export interface StorageAdapter {
  load(): { data: AppData; error?: string };
  save(data: AppData): void;
}

export const browserStorage: StorageAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return { data: raw === null ? emptyData() : parseStoredData(raw) };
    } catch (error) {
      return { data: emptyData(), error: error instanceof Error ? error.message : "Could not read local workout data." };
    }
  },
  save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
};
