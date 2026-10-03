import type { TrainingData, TrainingSession } from "@/types/training";

export function normalizeLoad(value: string): string {
  const trimmed = value.trim();
  return /^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
}

export function lastUsedLoad(data: TrainingData, planId: string, blockId: string): string | undefined {
  return data.sessions.filter((session) => session.status === "completed" && session.planId === planId)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .map((session) => session.blocks.find((block) => block.blockId === blockId && block.completed)?.actualLoad?.trim())
    .find((value): value is string => Boolean(value));
}

export function changedLoads(session: TrainingSession): Array<{ blockId: string; load: string }> {
  return session.blocks.flatMap((state) => {
    const block = session.workoutSnapshot.blocks.find((item) => item.id === state.blockId);
    if (!state.completed || block?.kind !== "exercise" || !state.actualLoad?.trim() ||
        normalizeLoad(state.actualLoad) === normalizeLoad(block.defaultLoad ?? "")) return [];
    return [{ blockId: state.blockId, load: normalizeLoad(state.actualLoad) }];
  });
}
