import type { TrainingData } from "@/types/training";

/** An orphaned draft cannot be resumed, so it must not hold a PWA update hostage. */
export function hasActiveWorkout(data: TrainingData | null): boolean {
  if (!data) return false;
  return data.sessions.some((session) => session.status === "inProgress" &&
    session.workoutSnapshot?.id === session.workoutId &&
    data.plans.some((plan) => plan.id === session.planId));
}
