import type { TrainingData } from "@/types/training";
import { planLineageKey } from "@/lib/training/identity";

export function exerciseKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function exerciseNote(data: TrainingData, planId: string, name: string): string {
  const key = exerciseKey(name);
  const own = data.exerciseNotes.find((note) => note.planId === planId && note.exerciseKey === key);
  if (own) return own.text;
  const target = data.plans.find((plan) => plan.id === planId);
  if (!target || target.source.kind !== "google" || !target.source.spreadsheetId) return "";
  const variants = (planIdToCheck: string) => new Set(data.plans.find((plan) => plan.id === planIdToCheck)?.workouts
    .flatMap((workout) => workout.blocks.filter((block) => block.kind === "exercise" && exerciseKey(block.name) === key)
      .map((block) => block.kind === "exercise" ? exerciseKey(block.equipment ?? "") : "")) ?? []);
  const targetVariants = variants(planId);
  if (targetVariants.size !== 1) return "";
  const matches = data.exerciseNotes.filter((note) => note.planId !== planId && note.exerciseKey === key)
    .filter((note) => {
      const source = data.plans.find((plan) => plan.id === note.planId);
      const sourceVariants = variants(note.planId);
      return source && planLineageKey(source) === planLineageKey(target) && sourceVariants.size === 1 &&
        [...sourceVariants][0] === [...targetVariants][0];
    });
  return matches.length === 1 ? matches[0].text : "";
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
