import { WORKOUTS } from "@/data/workouts";
import type { AppData as OldData, WorkoutSession as OldSession } from "@/types/workout";
import type { TrainingPlanRecord, TrainingSession, TrainingWorkout, SourceSyncStatus } from "@/types/training";

export const LEGACY_PLAN_ID = "legacy-jonatha";

export function legacyWorkout(id: "A" | "B"): TrainingWorkout {
  const old = WORKOUTS[id];
  return {
    id, title: old.title, description: old.description, duration: `${old.expectedMinutes.min}–${old.expectedMinutes.max} min`,
    restNote: old.betweenSetRestNote, rirByOccurrence: [...old.rirByOccurrence],
    blocks: old.exercises.map((exercise) => ({
      kind: "exercise" as const, id: exercise.id, section: exercise.section === "warmup" ? "Warm-up" : "Strength",
      name: exercise.name, prescription: exercise.prescription.sourceText, equipment: exercise.equipment,
      defaultLoad: exercise.defaultLoad, videoUrl: exercise.videoUrl, groupId: exercise.pairId, note: exercise.note,
    })),
  };
}

export function legacyPlan(old: OldData, now = new Date().toISOString()): TrainingPlanRecord {
  return {
    id: LEGACY_PLAN_ID, name: "Original training", version: 1, importedAt: now, updatedAt: now,
    source: old.excel?.validation === "compatible" ? {
      kind: "excel", filename: old.excel.filename, template: "jonatha-v1", mode: old.excel.mode,
      mappings: Object.fromEntries(["A", "B"].map((id) => [id, {
        sheetName: `TREINO ${id}`, slots: Array.from({ length: 12 }, (_, index) => `E${index + 5}`),
        ordinalCells: Array.from({ length: 12 }, (_, index) => `D${index + 5}`),
      }])),
    } : { kind: "builtin", label: "Original reviewed workout plan" },
    workouts: [legacyWorkout("A"), legacyWorkout("B")], importWarnings: [], legacyCompletions: [],
  };
}

export function migrateLegacySession(old: OldSession, plan: TrainingPlanRecord): TrainingSession {
  const workout = plan.workouts.find((item) => item.id === old.workoutId)!;
  const status: SourceSyncStatus = old.syncStatus === "notConfigured" ? (plan.source.kind === "builtin" ? "notApplicable" : "pending") : old.syncStatus;
  return {
    id: old.id, planId: plan.id, planVersion: plan.version, workoutId: old.workoutId,
    workoutSnapshot: structuredClone(workout), status: old.status, startedAt: old.startedAt,
    completedAt: old.completedAt, localDate: old.localDate, syncStatus: status, syncMessage: old.syncMessage,
    blocks: old.exercises.map((exercise) => ({ blockId: exercise.exerciseId, completed: exercise.completed, actualLoad: exercise.actualLoad })),
  };
}
