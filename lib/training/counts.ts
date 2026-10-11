import type { TrainingData, TrainingPlanRecord } from "@/types/training";
import { hiddenLegacyRecord, legacyIsHidden, pendingLegacyDeletion } from "@/lib/training/history-delete";
import { historyEntries } from "@/lib/training/statistics";
import { matchingLocalSession } from "@/lib/training/history-match";

export type SourceOccurrenceStatus = "hidden" | "represented by local session" | "source record";
export type SourceOccurrenceReason = "PENDING_DELETION" | "HISTORY_DELETE" | "LEGACY_UNATTRIBUTED" |
  "SOURCE_LINKED_LOCAL" | "SOURCE_RECORD" | "RECONCILIATION_CONFLICT";

/** One logical History entry per source occurrence, with exact-receipt local duplicates collapsed. */
export function planSessionCount(data: TrainingData, planId: string): number {
  return historyEntries(data).filter((entry) => entry.planId === planId).length;
}

export function sourceOccurrenceAudit(data: TrainingData, plan: TrainingPlanRecord) {
  return plan.legacyCompletions.map((legacy) => {
    const hidden = legacyIsHidden(data, plan.id, legacy);
    const pending = pendingLegacyDeletion(data, plan.id, legacy);
    const hiddenRecord = hiddenLegacyRecord(data, plan.id, legacy);
    const local = matchingLocalSession(data, plan, legacy);
    const reason: SourceOccurrenceReason = pending ? "PENDING_DELETION" : hiddenRecord ?
      hiddenRecord.reason === "history_delete" ? "HISTORY_DELETE" : "LEGACY_UNATTRIBUTED" :
      local?.sourceReconciliation === "conflict" ? "RECONCILIATION_CONFLICT" :
      local ? "SOURCE_LINKED_LOCAL" : "SOURCE_RECORD";
    return { workoutId: legacy.workoutId, sourceSlot: legacy.sourceSlot, date: legacy.date,
      status: hidden ? "hidden" as const : local ? "represented by local session" as const : "source record" as const,
      reason, reviewed: Boolean(hiddenRecord?.reviewedAt), includedInHome: !hidden || Boolean(local), localSessionId: local?.id };
  });
}
