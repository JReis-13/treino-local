import type { TrainingData } from "@/types/training";

export function exerciseKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function exerciseNote(data: TrainingData, planId: string, name: string): string {
  return data.exerciseNotes.find((note) => note.planId === planId && note.exerciseKey === exerciseKey(name))?.text ?? "";
}

export function updateExerciseNote(data: TrainingData, planId: string, name: string, text: string,
  now = new Date().toISOString()): TrainingData {
  if (!data.plans.some((plan) => plan.id === planId)) throw new Error("Training plan is unavailable.");
  const key = exerciseKey(name);
  if (!key) throw new Error("Exercise name is unavailable.");
  const next = text.trim();
  if (next.length > 1000) throw new Error("Exercise note is too long.");
  return { ...data, exerciseNotes: [
    ...data.exerciseNotes.filter((note) => note.planId !== planId || note.exerciseKey !== key),
    ...(next ? [{ planId, exerciseKey: key, text: next, updatedAt: now }] : []),
  ] };
}
