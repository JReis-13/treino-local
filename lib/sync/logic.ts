import type { CompletionMapping, ImportedTraining, TrainingSession } from "@/types/training";
import { aggregateSync } from "@/lib/training/sync-state";

export type SyncDecision = { kind: "write"; slot: string } | { kind: "duplicate" | "full"; message: string };

export function chooseCompletionSlot(mapping: CompletionMapping, dates: Array<string | null>, date: string, allowDuplicate = false): SyncDecision {
  if (mapping.slots.length !== dates.length || mapping.slots.length === 0) throw new Error("Source completion mapping changed.");
  if (dates.includes(date) && !allowDuplicate) return { kind: "duplicate", message: "This workout/date already exists in the source; review before treating it as the same session." };
  const index = dates.findIndex((value) => value === null);
  return index < 0 ? { kind: "full", message: "All source completion slots are full. The local workout remains saved." }
    : { kind: "write", slot: mapping.slots[index] };
}

export function sessionsWaitingForSource(sessions: TrainingSession[], planId: string): TrainingSession[] {
  return sessions.filter((session) => session.planId === planId && session.status === "completed" &&
    !["synced", "notApplicable"].includes(aggregateSync(session)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Persist the intended empty occurrence before a Google write, so an interrupted retry can verify that exact slot. */
export function plannedCompletionSlot(imported: ImportedTraining, workoutId: string): string | undefined {
  if (imported.source.kind !== "google") return undefined;
  const occupied = new Set(imported.legacyCompletions.filter((entry) => entry.workoutId === workoutId).map((entry) => entry.sourceSlot));
  return imported.source.mappings[workoutId]?.slots.find((slot) => !occupied.has(slot));
}
