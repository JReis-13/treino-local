import type { TrainingData } from "@/types/training";

/** Only the selected plan's resumable session is active in the current UI.
 * Other plans' durable drafts survive updates without holding Home hostage. */
export function hasActiveWorkout(data: TrainingData | null): boolean {
  const plan=data?.plans.find(plan=>plan.id===data.activePlanId);
  if (!data || !plan) return false;
  return data.sessions.some((session) => session.status === "inProgress" &&
    session.planId===plan.id && plan.workouts.some(workout=>workout.id===session.workoutId) &&
    session.workoutSnapshot?.id === session.workoutId &&
    session.planId===data.activePlanId);
}

export type LocalWriteState="loading"|"writing"|"ready"|"failed";
export function pwaUpdateBlocker(data:TrainingData|null,writeState:LocalWriteState):"loading"|"local_write"|"active_workout"|null {
  if(!data||writeState==="loading")return "loading";
  if(writeState!=="ready")return "local_write";
  return hasActiveWorkout(data)?"active_workout":null;
}
