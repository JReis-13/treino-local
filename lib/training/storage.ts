import { isLocalDate } from "@/lib/dates";
import { legacyPlan, migrateLegacySession } from "@/lib/training/builtin";
import { parseStoredData } from "@/lib/storage";
import type { TrainingData, TrainingPlanRecord, TrainingSession, WorkoutBlock } from "@/types/training";

export const TRAINING_STORAGE_KEY = "treino-local:v2";
const OLD_KEY = "treino-local:v1";
export const emptyTrainingData = (): TrainingData => ({ schemaVersion: 2, plans: [], sessions: [] });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validBlock(value: unknown): value is WorkoutBlock {
  return record(value) && typeof value.id === "string" && typeof value.section === "string" &&
    (value.kind === "exercise" ? typeof value.name === "string" && typeof value.prescription === "string" &&
      (value.defaultLoad === undefined || typeof value.defaultLoad === "string") &&
      (value.videoUrl === undefined || typeof value.videoUrl === "string") :
      value.kind === "instruction" && typeof value.heading === "string" && typeof value.text === "string");
}

function validPlan(value: unknown): value is TrainingPlanRecord {
  return record(value) && typeof value.id === "string" && typeof value.name === "string" &&
    Number.isInteger(value.version) && Number(value.version) > 0 &&
    typeof value.importedAt === "string" && typeof value.updatedAt === "string" &&
    record(value.source) && ["builtin", "excel", "google"].includes(String(value.source.kind)) &&
    Array.isArray(value.workouts) && value.workouts.length > 0 && value.workouts.every((workout: unknown) =>
      record(workout) && typeof workout.id === "string" && typeof workout.title === "string" &&
      Array.isArray(workout.blocks) && workout.blocks.length > 0 && workout.blocks.every(validBlock)) &&
    Array.isArray(value.importWarnings) && Array.isArray(value.legacyCompletions) &&
    value.legacyCompletions.every((item: unknown) => record(item) && typeof item.id === "string" &&
      typeof item.workoutId === "string" && typeof item.date === "string" && isLocalDate(item.date));
}

function validSession(value: unknown): value is TrainingSession {
  return record(value) && typeof value.id === "string" && typeof value.planId === "string" &&
    Number.isInteger(value.planVersion) && typeof value.workoutId === "string" &&
    record(value.workoutSnapshot) && Array.isArray(value.workoutSnapshot.blocks) &&
    value.workoutSnapshot.blocks.every(validBlock) &&
    ["inProgress", "completed"].includes(String(value.status)) && typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) && Array.isArray(value.blocks) &&
    value.blocks.every((item: unknown) => record(item) && typeof item.blockId === "string" &&
      typeof item.completed === "boolean" && (item.actualLoad === undefined || typeof item.actualLoad === "string")) &&
    ["notApplicable", "pending", "synced", "conflict", "authRequired", "sourceUnavailable", "failed"].includes(String(value.syncStatus)) &&
    (value.status !== "completed" || (typeof value.localDate === "string" && isLocalDate(value.localDate) &&
      typeof value.completedAt === "string" && Number.isFinite(Date.parse(value.completedAt))));
}

export function parseTrainingData(raw: string): TrainingData {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schemaVersion !== 2 || !Array.isArray(value.plans) || !value.plans.every(validPlan) ||
    !Array.isArray(value.sessions) || !value.sessions.every(validSession) ||
    (value.activePlanId !== undefined && typeof value.activePlanId !== "string") ||
    (value.archivedSources !== undefined && (!Array.isArray(value.archivedSources) || !value.archivedSources.every((source: unknown) =>
      record(source) && typeof source.planId === "string" && typeof source.planName === "string" && Array.isArray(source.legacyCompletions)))) ||
    new Set(value.plans.map((plan: TrainingPlanRecord) => plan.id)).size !== value.plans.length ||
    new Set(value.sessions.map((session: TrainingSession) => session.id)).size !== value.sessions.length) {
    throw new Error("Saved training data is invalid. It was left untouched.");
  }
  return value as unknown as TrainingData;
}

export function migrateV1(raw: string, now = new Date().toISOString()): TrainingData {
  const old = parseStoredData(raw);
  if (old.sessions.length === 0 && !old.excel) return emptyTrainingData();
  const plan = legacyPlan(old, now);
  return { schemaVersion: 2, plans: [plan], activePlanId: plan.id,
    sessions: old.sessions.map((session) => migrateLegacySession(session, plan)) };
}

export interface TrainingStorage {
  load(): { data: TrainingData; error?: string; migrated?: boolean };
  save(data: TrainingData): void;
}

export const trainingStorage: TrainingStorage = {
  load() {
    try {
      const latest = localStorage.getItem(TRAINING_STORAGE_KEY);
      if (latest !== null) return { data: parseTrainingData(latest) };
      const old = localStorage.getItem(OLD_KEY);
      if (old === null) return { data: emptyTrainingData() };
      const migrated = migrateV1(old);
      localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(migrated));
      return { data: migrated, migrated: true };
    } catch (error) {
      return { data: emptyTrainingData(), error: error instanceof Error ? error.message : "Could not access local training data." };
    }
  },
  save(data) { localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(data)); },
};
