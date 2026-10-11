import type { LegacyCompletion, TrainingData, TrainingSession } from "@/types/training";

type HiddenLegacy = NonNullable<TrainingData["hiddenLegacyCompletions"]>[number];

function sameOccurrence(item: HiddenLegacy, planId: string, legacy: LegacyCompletion): boolean {
  return item.planId === planId && (item.id === legacy.id ||
    (item.workoutId === legacy.workoutId && item.date === legacy.date && item.sourceSlot === legacy.sourceSlot));
}

export function hiddenLegacyRecord(data: TrainingData, planId: string, legacy: LegacyCompletion): HiddenLegacy | undefined {
  return data.hiddenLegacyCompletions?.find((item) => sameOccurrence(item, planId, legacy));
}

export function pendingLegacyDeletion(data: TrainingData, planId: string, legacy: LegacyCompletion): boolean {
  return (data.pendingLegacyDeletions ?? []).some((item) => item.planId === planId && item.legacyId === legacy.id) ||
    (data.pendingHistoryDeletions ?? []).some(({ session }) => session.planId === planId &&
      session.workoutId === legacy.workoutId && session.localDate === legacy.date &&
      (session.completionReceipt?.slot === legacy.sourceSlot || (!session.completionReceipt &&
        data.plans.find((plan) => plan.id === planId)?.legacyCompletions.filter((item) =>
          item.workoutId === legacy.workoutId && item.date === legacy.date).length === 1)));
}

export function legacyIsHidden(data: TrainingData, planId: string, legacy: LegacyCompletion): boolean {
  return pendingLegacyDeletion(data, planId, legacy) || Boolean(hiddenLegacyRecord(data, planId, legacy));
}

export const HISTORY_UNDO_MS = 15_000;

/** The original session, including its IDs and source receipt, stays local until the grace period expires. */
export function stageHistoryDeletion(data: TrainingData, sessionId: string, now = Date.now()): TrainingData {
  const session = completedSessionForDeletion(data, sessionId);
  if (!session) throw new Error("Completed workout record not found.");
  return { ...data, sessions: data.sessions.filter((item) => item.id !== sessionId),
    pendingHistoryDeletions: [...(data.pendingHistoryDeletions ?? []),
      { session, expiresAt: new Date(now + HISTORY_UNDO_MS).toISOString() }] };
}

export function undoHistoryDeletion(data: TrainingData, sessionId: string, now = Date.now()): TrainingData {
  const pending = data.pendingHistoryDeletions?.find((item) => item.session.id === sessionId);
  if (!pending || Date.parse(pending.expiresAt) <= now) throw new Error("Undo time has expired.");
  return { ...data, sessions: [...data.sessions, pending.session],
    pendingHistoryDeletions: data.pendingHistoryDeletions!.filter((item) => item.session.id !== sessionId) };
}

export function finalizeHistoryDeletion(data: TrainingData, sessionId: string): TrainingData {
  const pending = data.pendingHistoryDeletions?.find((item) => item.session.id === sessionId);
  if (!pending) throw new Error("Pending deletion not found.");
  const withSession = { ...data, sessions: [...data.sessions, pending.session],
    pendingHistoryDeletions: data.pendingHistoryDeletions!.filter((item) => item.session.id !== sessionId) };
  return deleteCompletedHistory(withSession, sessionId);
}

function rememberLegacy(data: TrainingData, planId: string, legacy: LegacyCompletion): HiddenLegacy[] {
  const hidden = data.hiddenLegacyCompletions ?? [];
  return legacyIsHidden(data, planId, legacy) ? hidden : [...hidden, { planId, id: legacy.id,
    workoutId: legacy.workoutId, date: legacy.date, sourceSlot: legacy.sourceSlot,
    reason: "history_delete", hiddenAt: new Date().toISOString(), reviewedAt: new Date().toISOString() }];
}

/** A current verified Google occurrence can be made visible again without recreating a local session. */
export function restoreHiddenSourceDate(data: TrainingData, planId: string, legacyId: string): TrainingData {
  const plan = data.plans.find((item) => item.id === planId);
  const legacy = plan?.legacyCompletions.find((item) => item.id === legacyId);
  if (!plan || plan.source.kind !== "google" || !plan.lastReconciliation || !legacy)
    throw new Error("A current verified Sheet record is required for recovery.");
  if (pendingLegacyDeletion(data, planId, legacy)) throw new Error("Wait for the deletion Undo period to finish.");
  if (!hiddenLegacyRecord(data, planId, legacy)) throw new Error("This source record is already visible.");
  return { ...data, hiddenLegacyCompletions: (data.hiddenLegacyCompletions ?? []).filter((item) =>
    !sameOccurrence(item, planId, legacy)) };
}

export function keepHiddenSourceDate(data: TrainingData, planId: string, legacyId: string): TrainingData {
  const plan = data.plans.find((item) => item.id === planId);
  const legacy = plan?.legacyCompletions.find((item) => item.id === legacyId);
  if (!legacy || !hiddenLegacyRecord(data, planId, legacy)) throw new Error("Hidden source record not found.");
  return { ...data, hiddenLegacyCompletions: (data.hiddenLegacyCompletions ?? []).map((item) =>
    sameOccurrence(item, planId, legacy) ? { ...item, reviewedAt: new Date().toISOString() } : item) };
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

export function stageLegacyHistoryDeletion(data: TrainingData, planId: string, legacyId: string,
  now = Date.now()): TrainingData {
  const source = data.plans.find((item) => item.id === planId) ??
    data.archivedSources?.find((item) => item.planId === planId);
  if (!source?.legacyCompletions.some((item) => item.id === legacyId)) throw new Error("Imported date not found.");
  if ((data.pendingLegacyDeletions ?? []).some((item) => item.planId === planId && item.legacyId === legacyId))
    throw new Error("Imported date is already pending deletion.");
  return { ...data, pendingLegacyDeletions: [...(data.pendingLegacyDeletions ?? []),
    { planId, legacyId, expiresAt: new Date(now + HISTORY_UNDO_MS).toISOString() }] };
}

export function undoLegacyHistoryDeletion(data: TrainingData, planId: string, legacyId: string,
  now = Date.now()): TrainingData {
  const pending = data.pendingLegacyDeletions?.find((item) => item.planId === planId && item.legacyId === legacyId);
  if (!pending || Date.parse(pending.expiresAt) <= now) throw new Error("Undo time has expired.");
  return { ...data, pendingLegacyDeletions: data.pendingLegacyDeletions!.filter((item) =>
    item.planId !== planId || item.legacyId !== legacyId) };
}

export function finalizeLegacyHistoryDeletion(data: TrainingData, planId: string, legacyId: string): TrainingData {
  const pending = data.pendingLegacyDeletions?.find((item) => item.planId === planId && item.legacyId === legacyId);
  if (!pending) throw new Error("Pending imported date deletion not found.");
  const withoutPending = { ...data, pendingLegacyDeletions: data.pendingLegacyDeletions!.filter((item) =>
    item.planId !== planId || item.legacyId !== legacyId) };
  return deleteLegacyHistory(withoutPending, planId, legacyId);
}

export function completedSessionForDeletion(data: TrainingData, sessionId: string): TrainingSession | undefined {
  return data.sessions.find((item) => item.id === sessionId && item.status === "completed");
}
