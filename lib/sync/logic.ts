import type { CompletionMapping, TrainingSession } from "@/types/training";

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
    session.syncStatus !== "synced" && session.syncStatus !== "notApplicable")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
