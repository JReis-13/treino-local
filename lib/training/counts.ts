import type { TrainingData, TrainingPlanRecord } from "@/types/training";
import { legacyIsHidden } from "@/lib/training/history-delete";
import { historyEntries } from "@/lib/training/statistics";
import { matchingLocalSession } from "@/lib/training/history-match";

export type SourceOccurrenceStatus = "hidden" | "represented by local session" | "source record";

/** One logical History entry per source occurrence, with exact-receipt local duplicates collapsed. */
export function planSessionCount(data: TrainingData, planId: string): number {
  return historyEntries(data).filter((entry) => entry.planId === planId).length;
}

export function sourceOccurrenceAudit(data: TrainingData, plan: TrainingPlanRecord) {
  return plan.legacyCompletions.map((legacy) => {
    const hidden = legacyIsHidden(data, plan.id, legacy);
    const local = matchingLocalSession(data, plan, legacy);
    return { workoutId: legacy.workoutId, sourceSlot: legacy.sourceSlot, date: legacy.date,
      status: hidden ? "hidden" as const : local ? "represented by local session" as const : "source record" as const,
      includedInHome: !hidden || Boolean(local), localSessionId: local?.id };
  });
}
