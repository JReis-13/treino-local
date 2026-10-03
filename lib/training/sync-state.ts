import type { SourceSyncStatus, TrainingSession } from "@/types/training";

export function aggregateSync(session: TrainingSession): SourceSyncStatus {
  const states = [session.completionSyncStatus ?? session.syncStatus, session.loadSyncStatus ?? "notApplicable"];
  for (const status of ["authRequired", "sourceUnavailable", "failed", "conflict"] as const) {
    if (states.includes(status)) return status;
  }
  return states.every((status) => status === "synced" || status === "notApplicable") ?
    states.every((status) => status === "notApplicable") ? "notApplicable" : "synced" : "pending";
}

export function withSyncStatus(session: TrainingSession, patch: Partial<TrainingSession>): TrainingSession {
  const updated = { ...session, ...patch };
  return { ...updated, syncStatus: aggregateSync(updated) };
}
