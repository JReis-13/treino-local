import type { SourceSyncStatus, TrainingSession } from "@/types/training";
import { changedLoads } from "@/lib/training/loads";

export function completionState(session: TrainingSession): SourceSyncStatus {
  if (session.completionReceipt) return "synced";
  return session.completionSyncStatus ?? session.syncStatus;
}

export function loadState(session: TrainingSession): SourceSyncStatus {
  if (!session.loadCorrectionPending && !changedLoads(session).length) return "notApplicable";
  return session.loadSyncStatus ?? "pending";
}

export function aggregateSync(session: TrainingSession): SourceSyncStatus {
  const states = [completionState(session), loadState(session)];
  const active = states.filter((status) => status !== "notApplicable");
  if (!active.length) return "notApplicable";
  if (active.every((status) => status === "synced")) return "synced";
  if (active.includes("synced") && active.some((status) => !["synced", "syncing", "pending"].includes(status))) return "partial";
  for (const status of ["authRequired", "sourceUnavailable", "failed", "conflict", "syncing", "pending", "partial"] as const) {
    if (active.includes(status)) return status;
  }
  return "pending";
}

export function withSyncStatus(session: TrainingSession, patch: Partial<TrainingSession>): TrainingSession {
  const updated = { ...session, ...patch };
  return { ...updated, completionSyncStatus: completionState(updated), loadSyncStatus: loadState(updated), syncStatus: aggregateSync(updated) };
}
