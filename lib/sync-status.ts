import type { SourceSyncStatus } from "@/types/training";

export const syncLabel: Record<SourceSyncStatus, string> = {
  notApplicable: "Stored locally",
  pending: "Waiting for source sync",
  synced: "Synced to source",
  conflict: "Source needs review",
  authRequired: "Reconnect source",
  sourceUnavailable: "Source unavailable",
  failed: "Source sync failed",
};
