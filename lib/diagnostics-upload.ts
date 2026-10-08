/** Independent server-side allowlist for optional support uploads. */
type Dict = Record<string, unknown>;
const object = (value: unknown): Dict => value && typeof value === "object" && !Array.isArray(value) ? value as Dict : {};
const bounded = (value: unknown, max = 100000): number | undefined => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : undefined;
const boolean = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
const oneOf = (value: unknown, choices: readonly string[]): string | undefined => typeof value === "string" && choices.includes(value) ? value : undefined;
const buildId = (value: unknown): string | undefined => typeof value === "string" && (/^[a-f0-9]{8}-\d{8}T\d{6}$/.test(value) || ["development", "none", "unavailable", "unknown"].includes(value)) ? value : undefined;
const iso = (value: unknown): string | undefined => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
const fields = (input: unknown, spec: Record<string, (value: unknown) => unknown>): Dict => {
  const source = object(input), out: Dict = {};
  for (const [key, sanitize] of Object.entries(spec)) {
    const result = sanitize(source[key]);
    if (result !== undefined) out[key] = result;
  }
  return out;
};
const state = (value: unknown) => oneOf(value, ["none", "pending", "syncing", "synced", "partial", "conflict", "authRequired", "sourceUnavailable", "failed", "notApplicable", "unknown"]);
const yesNo = (value: unknown) => oneOf(value, ["yes", "no", "unknown"]);
const onOff = (value: unknown) => oneOf(value, ["on", "off", "unknown"]);
const socialShare = (value: unknown) => oneOf(value, ["true", "false", "unknown"]);
const pseudonym = (kind: "LOAD" | "PLAN" | "WORKOUT" | "EXERCISE") => (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" && new RegExp(`^${kind}_[a-f0-9]{20}$`).test(value) ? value : undefined;
const nullableIndex = (value: unknown): number | null | undefined => value === null ? null : bounded(value, 10000);
const loadReason = (value: unknown) => oneOf(value, ["MATCH_EXACT_ID", "MATCH_UNIQUE_NAME", "NO_HISTORY",
  "PLAN_LINEAGE_MISMATCH", "WORKOUT_LINEAGE_MISMATCH", "EXERCISE_IDENTITY_MISMATCH", "AMBIGUOUS_EXERCISE",
  "LEGACY_UNVERIFIED_SOURCE", "SOURCE_MAPPING_MISMATCH"]);
const mappingCode = (value: unknown) => oneOf(value, ["uncertain-load", "formatted-load", "load-formula-no-cache",
  "prescription-count", "shared-prescription", "equipment-count", "shared-equipment", "missing-video", "extra-video",
  "unclassified-row", "workout-content"]);
const importerCode = (value: unknown) => mappingCode(value) ?? oneOf(value, ["completion-grid", "partial-rir"]);
function sanitizeLoadTrace(input: unknown): Dict | undefined {
  const trace = object(input);
  if (trace.traceVersion !== 1 || !Array.isArray(trace.rows)) return undefined;
  const rows = trace.rows.slice(0, 120).map((value) => {
    const row = fields(value, { plan: pseudonym("PLAN"), planLineage: pseudonym("PLAN"),
      workout: pseudonym("WORKOUT"), workoutLineage: pseudonym("WORKOUT"), exercise: pseudonym("EXERCISE"),
      exerciseLineage: pseudonym("EXERCISE"),
      row: nullableIndex, column: nullableIndex, groupIndex: nullableIndex,
      loadRow: nullableIndex, loadColumn: nullableIndex,
      template: (v) => oneOf(v, ["jonatha-v1", "milena-v1", "unknown", "builtin"]),
      parserVersion: (v) => bounded(v, 100), planVersion: (v) => bounded(v, 100000),
      sourceLoad: pseudonym("LOAD"), planLoad: pseudonym("LOAD"), sessionLoad: pseudonym("LOAD"),
      lastLoad: pseudonym("LOAD"), todayLoad: pseudonym("LOAD"),
      missing: (v) => fields(v, { source: boolean, plan: boolean, session: boolean, last: boolean, today: boolean }),
      todayOrigin: (v) => oneOf(v, ["LAST", "PLAN", "USER", "UNKNOWN", "NONE"]),
      todayInitialOrigin: (v) => oneOf(v, ["LAST", "PLAN", "USER", "UNKNOWN", "NONE"]),
      historyReason: loadReason, identityMatch: boolean,
      mappingCodes: (v) => Array.isArray(v) ? [...new Set(v.flatMap((item) => mappingCode(item) ? [item as string] : []))].slice(0, 8) : undefined });
    return row.plan && row.workout && row.exercise ? row : null;
  }).filter((row): row is Dict => Boolean(row));
  return { traceVersion: 1, truncated: trace.truncated === true || trace.rows.length > 120, rows };
}
export const MAX_DIAGNOSTIC_UPLOAD_BYTES = 128 * 1024;

export function sanitizeDebugReport(input: unknown): Dict {
  const source = object(input);
  if (source.debugReportVersion !== 1) throw new Error("Unsupported diagnostic report version.");
  const app = fields(source.app, { buildId, builtAt: iso, route: (v) => oneOf(v, ["/", "/settings", "/settings/", "/plans", "/plans/", "/workout", "/workout/", "/history", "/history/", "/source", "/source/", "other"]),
    installed: boolean, online: boolean, storageSchemaVersion: (v) => bounded(v, 20) });
  const pwa = fields(source.pwa, { supported: boolean, controlled: boolean, controllerBuildId: buildId,
    phase: (v) => oneOf(v, ["none", "idle", "checking", "waiting", "activating", "reloading", "error", "unknown"]),
    registration: (v) => oneOf(v, ["none", "checking", "registered", "unavailable", "installing", "installed", "activating", "activated", "redundant", "waiting", "active", "controlled", "uncontrolled", "ready", "error", "idle", "updating", "unknown"]),
    installing: (v) => oneOf(v, ["none", "installing", "installed", "activating", "activated", "redundant", "unknown"]),
    waiting: (v) => oneOf(v, ["none", "waiting", "installed", "activated", "unknown"]),
    active: (v) => oneOf(v, ["none", "active", "activated", "controlled", "unknown"]),
    lastUpdateResult: (v) => oneOf(v, ["none", "registration failed", "new controller; reloading", "another window activated update", "update check completed", "update check failed; will retry", "reloading with active update", "update check failed", "already current", "activation requested", "activation timed out", "activation request failed", "unknown"]), activeWorkout: boolean });
  const sourceState = fields(source.source, { kind: (v) => oneOf(v, ["none", "builtin", "excel", "google"]),
    completionSync: state, loadSync: state, aggregateSync: state, latestSessionSync: state,
    pendingSessions: bounded, historicalPendingSessions: bounded, receiptPresent: boolean });
  const social = fields(source.social, { authenticated: yesNo, userReady: yesNo, friendCount: bounded,
    autoShareLocal: socialShare, autoShareServer: socialShare, effectiveAutoShare: socialShare,
    outboxCount: bounded, deleteOutboxCount: bounded });
  const push = fields(source.push, { supported: boolean,
    permission: (v) => oneOf(v, ["default", "granted", "denied", "unsupported"]), subscriptionPresent: boolean,
    serverRegistration: (v) => oneOf(v, ["success", "failure", "unknown", "none"]),
    friendWorkouts: onOff, reactions: onOff,
    lastSubscriptionResult: (v) => oneOf(v, ["none", "success", "failure", "removed"]),
    lastReceivedType: (v) => oneOf(v, ["none", "friend_workout", "reaction", "unknown"]),
    lastClickResult: (v) => oneOf(v, ["none", "focused", "opened"]), });
  const storage = fields(source.storage, { plans: bounded, completedSessions: bounded, activeSession: boolean,
    legacyDates: bounded, hiddenLegacyDates: bounded, diagnosticEvents: (v) => bounded(v, 500), diagnosticLogBytes: (v) => bounded(v, MAX_DIAGNOSTIC_UPLOAD_BYTES) });
  const importer = fields(source.importer, { template: (v) => oneOf(v, ["jonatha-v1", "milena-v1", "unknown", "none"]),
    parserVersion: (v) => bounded(v, 100), workoutCount: bounded, exerciseCount: bounded,
    loadBearingExercises: bounded, numericLoads: bounded, blankLoads: bounded, ambiguousLoads: bounded,
    warningCodes: (v) => Array.isArray(v) ? [...new Set(v.flatMap((item) => importerCode(item) ? [item as string] : []))].slice(0, 30) : undefined });
  const events = Array.isArray(source.events) ? source.events.slice(-500).flatMap((value) => {
    const event = fields(value, { type: (v) => oneOf(v, ["app_boot", "storage_migration", "plan_import_finished", "workout_started",
      "exercise_completed", "exercise_reopened", "exercise_skipped", "exercise_skip_undone", "workout_finish_started", "same_day_detected", "same_day_add", "same_day_replace", "workout_cancelled", "workout_persisted", "history_deleted", "source_sync_success", "source_sync_failed", "social_publish_queued", "social_publish_success", "social_publish_failed", "social_delete_queued", "social_delete_success", "social_delete_failed", "friend_reaction_sent", "pwa_update_detected", "pwa_update_started", "pwa_update_finished", "app_error", "push_permission_requested", "push_permission_granted", "push_permission_denied", "push_subscription_created", "push_subscription_registered", "push_subscription_failed", "push_received", "notification_shown", "notification_clicked", "push_subscription_removed", "diagnostic_upload_started", "diagnostic_upload_success", "diagnostic_upload_failed", "workbook_load_parsed", "exercise_load_mapping_completed", "plan_refreshed", "active_session_initialized", "last_load_resolved", "today_load_manually_changed", "load_mapping_ambiguity_detected"]),
      timestamp: iso, source: (v) => oneOf(v, ["builtin", "excel", "google"]),
      operation: (v) => oneOf(v, ["completion", "load", "publish", "delete", "reaction"]),
      reason: (v) => oneOf(v, ["OK", "FAILED", "STORAGE_ERROR", "NETWORK_ERROR", "AUTH_REQUIRED", "CONFLICT", "UNCLASSIFIED",
        "NO_HISTORY", "MATCH_EXACT_ID", "MATCH_UNIQUE_NAME", "PLAN_LINEAGE_MISMATCH", "WORKOUT_LINEAGE_MISMATCH",
        "EXERCISE_IDENTITY_MISMATCH", "AMBIGUOUS_EXERCISE", "LEGACY_UNVERIFIED_SOURCE", "SOURCE_MAPPING_MISMATCH"]), retry: (v) => bounded(v, 99) });
    return event.type && event.timestamp ? [event] : [];
  }) : [];
  return { debugReportVersion: 1, timestamp: iso(source.timestamp) ?? new Date().toISOString(), app, pwa,
    source: sourceState, social, push, storage, importer, loadTrace: sanitizeLoadTrace(source.loadTrace), events };
}
