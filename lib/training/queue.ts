import type { TrainingSession } from "@/types/training";

export function planExerciseOrder(session: TrainingSession): string[] {
  return session.workoutSnapshot.blocks.filter((block) => block.kind === "exercise").map((block) => block.id);
}

export function sessionExerciseOrder(session: TrainingSession): string[] {
  const original = planExerciseOrder(session);
  const valid = new Set(original);
  const saved = (session.queueOrder ?? []).filter((id, index, array) => valid.has(id) && array.indexOf(id) === index);
  return [...saved, ...original.filter((id) => !saved.includes(id))];
}

export function remainingExerciseOrder(session: TrainingSession): string[] {
  const pending = new Set(session.blocks.filter((block) => !block.completed && !block.skipped).map((block) => block.blockId));
  return sessionExerciseOrder(session).filter((id) => pending.has(id));
}

export function currentFocusId(session: TrainingSession): string | undefined {
  const remaining = remainingExerciseOrder(session);
  return remaining.includes(session.focusBlockId ?? "") ? session.focusBlockId : remaining[0];
}

export function moveExerciseLater(session: TrainingSession, blockId: string): TrainingSession {
  const remaining = remainingExerciseOrder(session);
  if (!remaining.includes(blockId)) return session;
  const block = session.workoutSnapshot.blocks.find((item) => item.id === blockId);
  // A source group is a pair or row of separately tracked exercises. Move its pending members together.
  const moving = block?.kind === "exercise" && block.groupId
    ? remaining.filter((id) => session.workoutSnapshot.blocks.some((item) => item.kind === "exercise" && item.id === id && item.groupId === block.groupId))
    : [blockId];
  const order = sessionExerciseOrder(session);
  const queueOrder = [...order.filter((id) => !moving.includes(id)), ...moving];
  const next = remaining.filter((id) => !moving.includes(id))[0] ?? moving[0];
  return { ...session, queueOrder, focusBlockId: next };
}

export function setExerciseSkipped(session: TrainingSession, blockId: string, skipped: boolean): TrainingSession {
  if (!session.workoutSnapshot.blocks.some((block) => block.kind === "exercise" && block.id === blockId)) return session;
  const state = session.blocks.find((block) => block.blockId === blockId);
  if (!state || (skipped && state.completed)) return session;
  const blocks = session.blocks.map((block) => block.blockId === blockId ? { ...block, skipped } : block);
  const updated = { ...session, blocks };
  return { ...updated, focusBlockId: skipped ? remainingExerciseOrder(updated)[0] : blockId };
}
