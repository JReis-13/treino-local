import type { SourceSyncStatus } from "@/types/training";

export const syncLabel: Record<SourceSyncStatus, string> = {
  notApplicable: "Stored locally",
  pending: "Saved · syncing when source is available",
  syncing: "Saved · syncing",
  synced: "Synced to source",
  partial: "Sync needs attention",
  conflict: "Source needs review",
  authRequired: "Reconnect source",
  sourceUnavailable: "Source unavailable",
  failed: "Source sync failed",
};
