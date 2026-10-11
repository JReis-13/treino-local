import type { LegacyCompletion, TrainingData, TrainingPlanRecord, TrainingSession } from "@/types/training";

export function matchingLocalSession(data: TrainingData, plan: TrainingPlanRecord,
  legacy: LegacyCompletion): TrainingSession | undefined {
  return data.sessions.find((session) => session.status === "completed" &&
    session.sourceReconciliation !== "removed" && session.planId === plan.id &&
    session.workoutId === legacy.workoutId && session.localDate === legacy.date &&
    (session.completionReceipt?.slot === legacy.sourceSlot || (!session.completionReceipt &&
      (plan.source.kind === "google" ? session.syncStatus === "synced" && !session.duplicateDateAllowed &&
        plan.legacyCompletions.filter((item) => item.workoutId === legacy.workoutId && item.date === legacy.date).length === 1 :
        session.syncStatus === "synced"))));
}
