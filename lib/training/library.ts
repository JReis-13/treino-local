import type { ImportedTraining, TrainingData, TrainingPlanRecord } from "@/types/training";
import { preserveWorkoutLineage } from "@/lib/training/identity";

function id(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function addTraining(data: TrainingData, imported: ImportedTraining, name?: string, now = new Date().toISOString(), planId = id()): TrainingData {
  const plan: TrainingPlanRecord = {
    id: planId, name: name?.trim() || imported.name, source: imported.source, sourceFingerprint: imported.sourceFingerprint,
    version: 1, importedAt: now, updatedAt: now, workouts: preserveWorkoutLineage([], imported.workouts),
    importWarnings: imported.warnings, legacyCompletions: imported.legacyCompletions,
  };
  return { ...data, plans: [...data.plans, plan], activePlanId: plan.id };
}

export function refreshTraining(data: TrainingData, planId: string, imported: ImportedTraining, now = new Date().toISOString()): TrainingData {
  const old = data.plans.find((plan) => plan.id === planId);
  if (!old) throw new Error("Training plan not found.");
  const oldSpreadsheetId = old.source.kind === "google" ? old.source.spreadsheetId : undefined;
  const verifiedGoogle = old.source.kind === "google" && imported.source.kind === "google" &&
    old.source.authMode === "oauth" && imported.source.authMode === "oauth" &&
    Boolean(old.source.spreadsheetId && old.source.spreadsheetId === imported.source.spreadsheetId &&
      imported.source.sourceProof &&
      [imported.sourceFingerprint, imported.legacyFingerprint].includes(old.sourceFingerprint ?? "") &&
      !imported.warnings.some((warning) => ["syncBlocker", "activationBlocker"].includes(warning.severity)));
  if (old.source.kind === "google" && old.source.authMode === "oauth" &&
      imported.source.kind === "google" && imported.source.sourceProof &&
      imported.source.authMode === "oauth" && !verifiedGoogle)
    throw new Error("Google Sheet identity or structure could not be verified. No History was changed.");
  if (verifiedGoogle) {
    const occurrence = (item: { workoutId: string; sourceSlot: string; date: string }) =>
      `${item.workoutId}\u0000${item.sourceSlot}\u0000${item.date}`;
    const current = new Map(imported.legacyCompletions.map((item) => [occurrence(item), item]));
    const oldItems = [...old.legacyCompletions, ...(old.removedSourceCompletions ?? [])];
    const removed = new Map(oldItems.filter((item) => !current.has(occurrence(item))).map((item) => [occurrence(item), item]));
    const previouslyActive = old.legacyCompletions.filter((item) => !current.has(occurrence(item)));
    let archivedSessions = 0, conflicts = 0;
    const sessions = data.sessions.map((session) => {
      if (session.planId !== planId || session.status !== "completed") return session;
      const receipt = session.completionReceipt;
      if (receipt?.sourceKind === "google" && receipt.sourceId === oldSpreadsheetId) {
        const present = current.has(occurrence({ workoutId: receipt.workoutId, sourceSlot: receipt.slot, date: session.localDate! }));
        if (!present) archivedSessions++;
        return { ...session, sourceReconciliation: present ? undefined : "removed" as const,
          ...(present ? {} : { syncMessage: "This completion was removed from Google Sheets; the local workout is preserved." }) };
      }
      // An interrupted write can be confirmed only at its exact source slot. If that
      // occurrence was deleted, never recreate it automatically from the old outbox.
      if (session.completionAttempted && session.preparedCompletionSlot) {
        const wasDeleted = previouslyActive.some((item) => item.workoutId === session.workoutId &&
          item.sourceSlot === session.preparedCompletionSlot && item.date === session.localDate);
        if (wasDeleted) {
          conflicts++;
          return { ...session, sourceReconciliation: "conflict" as const, completionSyncStatus: "conflict" as const,
            syncMessage: "A previously recorded Sheet date was removed. Review before syncing this local workout." };
        }
      }
      if (!receipt && session.syncStatus === "synced" && previouslyActive.some((item) =>
        item.workoutId === session.workoutId && item.date === session.localDate)) {
        conflicts++;
        return { ...session, sourceReconciliation: "conflict" as const,
          syncMessage: "A matching Sheet date was removed, but this older local workout has no exact source receipt. Review its origin." };
      }
      return session;
    });
    return { ...data, sessions, plans: data.plans.map((plan) => plan.id === planId ? {
      ...plan, source: imported.source, sourceFingerprint: imported.sourceFingerprint,
      version: plan.version + 1, updatedAt: now, workouts: preserveWorkoutLineage(plan.workouts, imported.workouts),
      importWarnings: imported.warnings, legacyCompletions: [...current.values()],
      removedSourceCompletions: [...removed.values()],
      lastReconciliation: { at: now, sourceCount: current.size, removedCount: previouslyActive.length,
        archivedSessions, conflicts },
    } : plan) };
  }
  const oldLegacy = new Map(old.legacyCompletions.map((item) => [item.id, item]));
  for (const item of imported.legacyCompletions) oldLegacy.set(item.id, item);
  return { ...data, plans: data.plans.map((plan) => plan.id === planId ? {
    ...plan, source: imported.source, sourceFingerprint: imported.sourceFingerprint,
    version: plan.version + 1, updatedAt: now, workouts: preserveWorkoutLineage(plan.workouts, imported.workouts),
    importWarnings: imported.warnings, legacyCompletions: [...oldLegacy.values()],
  } : plan) };
}

export function migrateGoogleTraining(data: TrainingData, planId: string, imported: ImportedTraining): TrainingData {
  const old = data.plans.find((plan) => plan.id === planId);
  if (!old || old.source.kind !== "google" || old.source.authMode === "oauth" ||
    imported.source.kind !== "google" || imported.source.authMode !== "oauth" || !imported.source.spreadsheetId) {
    throw new Error("Legacy Google plan is unavailable for migration.");
  }
  if (old.source.spreadsheetId && old.source.spreadsheetId !== imported.source.spreadsheetId) {
    throw new Error("Spreadsheet identity does not match the existing plan.");
  }
  if (old.sourceFingerprint && old.sourceFingerprint !== imported.sourceFingerprint) {
    throw new Error("Source layout differs. Add this Sheet as a new plan or refresh it separately.");
  }
  if (imported.warnings.some((warning) => warning.severity === "activationBlocker")) throw new Error("Source layout is not safe to migrate.");
  return { ...data, plans: data.plans.map((plan) => plan.id === planId ? { ...plan, source: imported.source } : plan) };
}

export function removeTraining(data: TrainingData, planId: string): TrainingData {
  const removed = data.plans.find((plan) => plan.id === planId);
  const plans = data.plans.filter((plan) => plan.id !== planId);
  return { ...data, plans, activePlanId: data.activePlanId === planId ? plans[0]?.id : data.activePlanId,
    archivedSources: removed?.legacyCompletions.length ? [...(data.archivedSources ?? []), {
      planId: removed.id, planName: removed.name, legacyCompletions: removed.legacyCompletions,
    }] : data.archivedSources };
}

export function renameTraining(data: TrainingData, planId: string, name: string): TrainingData {
  if (!name.trim()) throw new Error("Enter a training name.");
  return { ...data, plans: data.plans.map((plan) => plan.id === planId ? { ...plan, name: name.trim() } : plan) };
}

export function describeChanges(old: TrainingPlanRecord, next: ImportedTraining): string[] {
  const oldExercises = old.workouts.flatMap((workout) => workout.blocks.filter((block) => block.kind === "exercise").map((block) => `${workout.id}:${block.name}`));
  const newExercises = next.workouts.flatMap((workout) => workout.blocks.filter((block) => block.kind === "exercise").map((block) => `${workout.id}:${block.name}`));
  const added = newExercises.filter((name) => !oldExercises.includes(name)).length;
  const removed = oldExercises.filter((name) => !newExercises.includes(name)).length;
  const newWorkouts = next.workouts.filter((workout) => !old.workouts.some((item) => item.id === workout.id)).length;
  return [`${newWorkouts} workout${newWorkouts === 1 ? "" : "s"} added`, `${added} exercise${added === 1 ? "" : "s"} added`, `${removed} exercise${removed === 1 ? "" : "s"} removed`];
}
