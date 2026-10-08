import { exerciseKey } from "@/lib/training/exercise-notes";
import { resolveLoadHistory } from "@/lib/training/loads";
import { numericLoad } from "@/lib/training/statistics";
import type { TrainingData } from "@/types/training";

export function exerciseLoadHistory(data: TrainingData, planId: string, name: string, workoutId?: string) {
  const key = exerciseKey(name);
  const plan = data.plans.find((item) => item.id === planId);
  const candidates = plan?.workouts.filter((workout) => !workoutId || workout.id === workoutId)
    .flatMap((workout) => workout.blocks.flatMap((block) => block.kind === "exercise" &&
      exerciseKey(block.name) === key ? [{ workout, block }] : [])) ?? [];
  if (candidates.length !== 1) return [];
  return resolveLoadHistory(data, planId, candidates[0].workout, candidates[0].block).matches.map((item) => ({
    date: item.session.localDate!, completedAt: item.session.completedAt!, load: item.load,
  }));
}

export function comparableLoadSummary(history: ReturnType<typeof exerciseLoadHistory>) {
  const numeric = history.map((item) => numericLoad(item.load)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const sameUnit = new Set(numeric.map((item) => item.unit)).size <= 1;
  return { numeric: sameUnit ? numeric : [], highest: numeric.length && sameUnit ? Math.max(...numeric.map((item) => item.amount)) : undefined,
    unit: sameUnit ? numeric[0]?.unit ?? "" : "", mixedUnits: !sameUnit };
}
