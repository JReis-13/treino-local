import type { ImportedTraining, TrainingData, TrainingPlanRecord } from "@/types/training";

function id(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function addTraining(data: TrainingData, imported: ImportedTraining, name?: string, now = new Date().toISOString(), planId = id()): TrainingData {
  const plan: TrainingPlanRecord = {
    id: planId, name: name?.trim() || imported.name, source: imported.source, sourceFingerprint: imported.sourceFingerprint,
    version: 1, importedAt: now, updatedAt: now, workouts: imported.workouts,
    importWarnings: imported.warnings, legacyCompletions: imported.legacyCompletions,
  };
  return { ...data, plans: [...data.plans, plan], activePlanId: plan.id };
}

export function refreshTraining(data: TrainingData, planId: string, imported: ImportedTraining, now = new Date().toISOString()): TrainingData {
  const old = data.plans.find((plan) => plan.id === planId);
  if (!old) throw new Error("Training plan not found.");
  const oldLegacy = new Map(old.legacyCompletions.map((item) => [item.id, item]));
  for (const item of imported.legacyCompletions) oldLegacy.set(item.id, item);
  return { ...data, plans: data.plans.map((plan) => plan.id === planId ? {
    ...plan, source: imported.source, sourceFingerprint: imported.sourceFingerprint,
    version: plan.version + 1, updatedAt: now, workouts: imported.workouts,
    importWarnings: imported.warnings, legacyCompletions: [...oldLegacy.values()],
  } : plan) };
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
