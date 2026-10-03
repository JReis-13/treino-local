import { exerciseKey } from "@/lib/training/exercise-notes";
import { numericLoad } from "@/lib/training/statistics";
import type { TrainingData } from "@/types/training";

export function exerciseLoadHistory(data: TrainingData, planId: string, name: string) {
  const key = exerciseKey(name);
  return data.sessions.filter((session) => session.status === "completed" && session.planId === planId)
    .flatMap((session) => session.workoutSnapshot.blocks.flatMap((block) => {
      if (block.kind !== "exercise" || exerciseKey(block.name) !== key) return [];
      const state = session.blocks.find((item) => item.blockId === block.id);
      return state?.completed && state.actualLoad?.trim() ? [{
        date: session.localDate!, completedAt: session.completedAt!, load: state.actualLoad.trim(),
      }] : [];
    })).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function comparableLoadSummary(history: ReturnType<typeof exerciseLoadHistory>) {
  const numeric = history.map((item) => numericLoad(item.load)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const sameUnit = new Set(numeric.map((item) => item.unit)).size <= 1;
  return { numeric: sameUnit ? numeric : [], highest: numeric.length && sameUnit ? Math.max(...numeric.map((item) => item.amount)) : undefined,
    unit: sameUnit ? numeric[0]?.unit ?? "" : "", mixedUnits: !sameUnit };
}
