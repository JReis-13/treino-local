import type { LegacyCompletion, TrainingData, TrainingSession } from "@/types/training";

type HiddenLegacy = NonNullable<TrainingData["hiddenLegacyCompletions"]>[number];

export function legacyIsHidden(data: TrainingData, planId: string, legacy: LegacyCompletion): boolean {
  return (data.hiddenLegacyCompletions ?? []).some((item) => item.planId === planId &&
    (item.id === legacy.id || (item.workoutId === legacy.workoutId && item.date === legacy.date &&
      item.sourceSlot === legacy.sourceSlot)));
}

function rememberLegacy(data: TrainingData, planId: string, legacy: LegacyCompletion): HiddenLegacy[] {
  const hidden = data.hiddenLegacyCompletions ?? [];
  return legacyIsHidden(data, planId, legacy) ? hidden : [...hidden, { planId, id: legacy.id,
    workoutId: legacy.workoutId, date: legacy.date, sourceSlot: legacy.sourceSlot }];
}

/** Remove only a completed local record; source spreadsheets and active drafts are untouched. */
export function deleteCompletedHistory(data: TrainingData, sessionId: string): TrainingData {
  const session = data.sessions.find((item) => item.id === sessionId && item.status === "completed");
  if (!session) throw new Error("Completed workout record not found.");
  const plan = data.plans.find((item) => item.id === session.planId);
  const matching = plan?.legacyCompletions.filter((item) => item.workoutId === session.workoutId &&
    item.date === session.localDate && (!session.completionReceipt || item.sourceSlot === session.completionReceipt.slot)) ?? [];
  const linked = session.completionReceipt ? matching : matching.length === 1 ? matching : [];
  const hiddenLegacyCompletions = linked.reduce((current, legacy) => rememberLegacy({ ...data,
    hiddenLegacyCompletions: current }, session.planId, legacy), data.hiddenLegacyCompletions ?? []);
  return { ...data, sessions: data.sessions.filter((item) => item.id !== sessionId), hiddenLegacyCompletions };
}

export function deleteLegacyHistory(data: TrainingData, planId: string, legacyId: string): TrainingData {
  const source = data.plans.find((item) => item.id === planId) ??
    data.archivedSources?.find((item) => item.planId === planId);
  const legacy = source?.legacyCompletions.find((item) => item.id === legacyId);
  if (!legacy) throw new Error("Imported date not found.");
  return { ...data, hiddenLegacyCompletions: rememberLegacy(data, planId, legacy) };
}

export function completedSessionForDeletion(data: TrainingData, sessionId: string): TrainingSession | undefined {
  return data.sessions.find((item) => item.id === sessionId && item.status === "completed");
}
