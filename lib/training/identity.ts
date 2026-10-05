import type { TrainingData, TrainingPlanRecord, TrainingSession, TrainingWorkout } from "@/types/training";

export function normalizedWorkoutName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function planLineageKey(plan: TrainingPlanRecord): string {
  return plan.source.kind === "google" && plan.source.spreadsheetId
    ? `google:${plan.source.spreadsheetId}` : `plan:${plan.id}`;
}

export function sessionPlanLineageKey(data: TrainingData, session: TrainingSession): string {
  if (session.planLineageKey) return session.planLineageKey;
  const plan = data.plans.find((item) => item.id === session.planId);
  if (plan) return planLineageKey(plan);
  const receipt = session.completionReceipt;
  if (receipt?.sourceKind === "google" && receipt.sourceId !== "legacy") return `google:${receipt.sourceId}`;
  return `plan:${session.planId}`;
}

export function workoutLineageKey(workout: TrainingWorkout): string {
  return workout.lineageKey ?? workout.id;
}

export function preserveWorkoutLineage(previous: TrainingWorkout[], imported: TrainingWorkout[]): TrainingWorkout[] {
  return imported.map((workout) => {
    const byId = previous.find((old) => old.id === workout.id);
    const name = normalizedWorkoutName(workout.title);
    const byTitle = name ? previous.filter((old) => normalizedWorkoutName(old.title) === name) : [];
    const sameCurrentTitle = imported.filter((item) => normalizedWorkoutName(item.title) === name);
    const prior = byId ?? (byTitle?.length === 1 && sameCurrentTitle.length === 1 ? byTitle[0] : undefined);
    return { ...workout, lineageKey: prior ? workoutLineageKey(prior) : workout.id };
  });
}

export type SameDayReason = "MATCH_EXACT_ID" | "MATCH_WORKOUT_LINEAGE" | "MATCH_UNIQUE_TITLE" |
  "DATE_MISMATCH" | "DATE_MISSING" | "PLAN_LINEAGE_MISMATCH" | "WORKOUT_LINEAGE_MISMATCH" |
  "LEGACY_IDENTITY_AMBIGUOUS" | "NOT_COMPLETED";

export function sameDayDecision(data: TrainingData, current: TrainingSession, historical: TrainingSession,
  date: string): { match: boolean; reason: SameDayReason } {
  if (historical.status !== "completed") return { match: false, reason: "NOT_COMPLETED" };
  if (!historical.localDate) return { match: false, reason: "DATE_MISSING" };
  if (historical.localDate !== date) return { match: false, reason: "DATE_MISMATCH" };
  if (sessionPlanLineageKey(data, current) !== sessionPlanLineageKey(data, historical))
    return { match: false, reason: "PLAN_LINEAGE_MISMATCH" };
  if (current.workoutId === historical.workoutId) return { match: true, reason: "MATCH_EXACT_ID" };
  const currentWorkout = data.plans.find((plan) => plan.id === current.planId)?.workouts.find((item) => item.id === current.workoutId);
  const currentKey = current.workoutLineageKey ?? (currentWorkout ? workoutLineageKey(currentWorkout) : current.workoutId);
  const oldKey = historical.workoutLineageKey ?? historical.workoutId;
  if (currentKey === oldKey) return { match: true, reason: "MATCH_WORKOUT_LINEAGE" };
  const currentName = normalizedWorkoutName(current.workoutSnapshot.title);
  const oldName = normalizedWorkoutName(historical.workoutSnapshot.title);
  if (!currentName || currentName !== oldName) return { match: false, reason: "WORKOUT_LINEAGE_MISMATCH" };
  const currentPlan = data.plans.find((plan) => plan.id === current.planId);
  const currentTitleCount = currentPlan?.workouts.filter((item) => normalizedWorkoutName(item.title) === currentName).length ?? 0;
  const historicalIds = new Set(data.sessions.filter((item) => item.status === "completed" &&
    item.planId === historical.planId && item.planVersion === historical.planVersion &&
    normalizedWorkoutName(item.workoutSnapshot.title) === oldName).map((item) => item.workoutId));
  if (currentTitleCount !== 1 || historicalIds.size > 1) return { match: false, reason: "LEGACY_IDENTITY_AMBIGUOUS" };
  return { match: true, reason: "MATCH_UNIQUE_TITLE" };
}
