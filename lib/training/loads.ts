import type { ExerciseBlock, TrainingData, TrainingSession, TrainingWorkout } from "@/types/training";
import { exerciseKey } from "@/lib/training/exercise-notes";
import { planLineageKey, sessionPlanLineageKey, workoutLineageKey } from "@/lib/training/identity";

export function normalizeLoad(value: string): string {
  const trimmed = value.trim();
  return /^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
}

export type LoadMatchReason = "MATCH_EXACT_ID" | "MATCH_UNIQUE_NAME" | "NO_HISTORY" |
  "PLAN_LINEAGE_MISMATCH" | "WORKOUT_LINEAGE_MISMATCH" | "EXERCISE_IDENTITY_MISMATCH" |
  "AMBIGUOUS_EXERCISE" | "LEGACY_UNVERIFIED_SOURCE" | "SOURCE_MAPPING_MISMATCH";

export interface ResolvedLoad {
  load: string;
  session: TrainingSession;
  reason: "MATCH_EXACT_ID" | "MATCH_UNIQUE_NAME";
}

export function resolveLoadHistory(data: TrainingData, planId: string, workout: TrainingWorkout,
  exercise: ExerciseBlock): { matches: ResolvedLoad[]; reason: LoadMatchReason } {
  const plan = data.plans.find((item) => item.id === planId);
  if (!plan) return { matches: [], reason: "NO_HISTORY" };
  const key = exerciseKey(exercise.name);
  const currentNames = workout.blocks.filter((item): item is ExerciseBlock =>
    item.kind === "exercise" && exerciseKey(item.name) === key);
  const matches: ResolvedLoad[] = [];
  let rejected: LoadMatchReason = "NO_HISTORY";
  const sessions = data.sessions.filter((session) => session.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  for (const session of sessions) {
    if (sessionPlanLineageKey(data, session) !== planLineageKey(plan)) {
      if (session.planId === planId) rejected = "PLAN_LINEAGE_MISMATCH";
      continue;
    }
    if ((session.workoutLineageKey ?? workoutLineageKey(session.workoutSnapshot)) !== workoutLineageKey(workout)) {
      rejected = "WORKOUT_LINEAGE_MISMATCH"; continue;
    }
    const oldNames = session.workoutSnapshot.blocks.filter((item): item is ExerciseBlock =>
      item.kind === "exercise" && exerciseKey(item.name) === key);
    if (!oldNames.length) { rejected = "EXERCISE_IDENTITY_MISMATCH"; continue; }
    const historical = oldNames.length === 1 && currentNames.length === 1 ? oldNames[0] :
      oldNames.find((item) => item.id === exercise.id && item.sourceCell && item.sourceCell === exercise.sourceCell &&
        item.loadSource?.cell === exercise.loadSource?.cell && item.loadSource?.part === exercise.loadSource?.part);
    if (!historical || historical.kind !== "exercise") { rejected = "AMBIGUOUS_EXERCISE"; continue; }
    const state = session.blocks.find((item) => item.blockId === historical.id && item.completed && item.actualLoad?.trim());
    if (!state?.actualLoad?.trim()) continue;
    if (plan.source.kind !== "builtin" && exercise.loadSource) {
      if (!historical.loadSource) {
        if (normalizeLoad(state.actualLoad) === normalizeLoad(historical.defaultLoad ?? "")) {
          rejected = "LEGACY_UNVERIFIED_SOURCE"; continue;
        }
      } else if (historical.id === exercise.id && (historical.loadSource.cell !== exercise.loadSource.cell ||
          historical.loadSource.part !== exercise.loadSource.part)) {
        rejected = "SOURCE_MAPPING_MISMATCH"; continue;
      }
    }
    matches.push({ load: state.actualLoad.trim(), session,
      reason: historical.id === exercise.id ? "MATCH_EXACT_ID" : "MATCH_UNIQUE_NAME" });
  }
  return { matches, reason: matches[0]?.reason ?? rejected };
}

export function lastUsedLoad(data: TrainingData, planId: string, blockId: string): string | undefined {
  const plan = data.plans.find((item) => item.id === planId);
  const candidates = plan?.workouts.flatMap((workout) => workout.blocks.flatMap((block) =>
    block.kind === "exercise" && block.id === blockId ? [{ workout, block }] : [])) ?? [];
  if (candidates.length !== 1) return undefined;
  return resolveLoadHistory(data, planId, candidates[0].workout, candidates[0].block).matches[0]?.load;
}

/** A saved load may only be sent back to the same source exercise and cell. */
export function sameSourceLoadAssociation(session: TrainingSession, workout: TrainingWorkout | undefined,
  blockId: string): boolean {
  const old = session.workoutSnapshot.blocks.find((item) => item.kind === "exercise" && item.id === blockId);
  const current = workout?.blocks.find((item) => item.kind === "exercise" && item.id === blockId);
  return Boolean(old?.kind === "exercise" && current?.kind === "exercise" &&
    exerciseKey(old.name) === exerciseKey(current.name) && old.loadSource && current.loadSource &&
    old.loadSource.cell === current.loadSource.cell && old.loadSource.part === current.loadSource.part &&
    old.loadSource.parts === current.loadSource.parts);
}

export function changedLoads(session: TrainingSession): Array<{ blockId: string; load: string }> {
  return session.blocks.flatMap((state) => {
    const block = session.workoutSnapshot.blocks.find((item) => item.id === state.blockId);
    if (!state.completed || block?.kind !== "exercise" || !state.actualLoad?.trim() ||
        normalizeLoad(state.actualLoad) === normalizeLoad(block.defaultLoad ?? "")) return [];
    return [{ blockId: state.blockId, load: normalizeLoad(state.actualLoad) }];
  });
}
