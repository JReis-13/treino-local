/** Local-only troubleshooting events. No free-form content is accepted into the log. */
export const DIAGNOSTIC_RETENTION = { maxEvents: 500, maxAgeDays: 7, maxBytes: 128 * 1024 } as const;
const DB_NAME = "treino-local-diagnostics-v1";
const STORE = "log";
const KEY = "events";
const TYPES = ["app_boot", "storage_migration", "plan_import_finished", "workout_started",
  "exercise_completed", "exercise_reopened", "exercise_skipped", "exercise_skip_undone",
  "workout_finish_started", "same_day_detected", "same_day_add", "same_day_replace",
  "workout_cancelled", "workout_persisted", "history_deleted", "source_sync_success",
  "source_sync_failed", "social_publish_queued", "social_publish_success", "social_publish_failed",
  "social_delete_queued", "social_delete_success", "social_delete_failed", "friend_reaction_sent",
  "pwa_update_detected", "pwa_update_started", "pwa_update_finished", "app_error"] as const;
const REASONS = new Set(["OK", "FAILED", "STORAGE_ERROR", "LEGACY", "WINDOW_ERROR", "UNHANDLED_REJECTION",
  "REACTION_FAILED", "QUEUED", "SUCCESS", "NETWORK_ERROR", "OFFLINE_QUEUED",
  "NOT_COMPLETED", "DATE_MISSING", "DATE_MISMATCH", "PLAN_LINEAGE_MISMATCH", "MATCH_EXACT_ID",
  "MATCH_WORKOUT_LINEAGE", "WORKOUT_LINEAGE_MISMATCH", "LEGACY_IDENTITY_AMBIGUOUS", "MATCH_UNIQUE_TITLE",
  "READBACK_MISMATCH", "SOURCE_CHANGED", "AUTH_REQUIRED", "CONFLICT"]);
export type DiagnosticEventType = typeof TYPES[number];
export interface DiagnosticEvent {
  type: DiagnosticEventType;
  timestamp: string;
  session?: string;
  source?: "builtin" | "excel" | "google";
  operation?: "completion" | "load" | "publish" | "delete" | "reaction";
  reason?: string;
  retry?: number;
}
export type DiagnosticMetadata = { sessionId?: string; source?: unknown; operation?: unknown; reason?: unknown; retry?: unknown };

function idFingerprint(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function safeDiagnosticEvent(type: unknown, metadata: DiagnosticMetadata = {}, now = new Date()): DiagnosticEvent | null {
  if (typeof type !== "string" || !TYPES.includes(type as DiagnosticEventType)) return null;
  const event: DiagnosticEvent = { type: type as DiagnosticEventType, timestamp: now.toISOString() };
  if (typeof metadata.sessionId === "string") event.session = idFingerprint(metadata.sessionId);
  if (["builtin", "excel", "google"].includes(String(metadata.source))) event.source = metadata.source as DiagnosticEvent["source"];
  if (["completion", "load", "publish", "delete", "reaction"].includes(String(metadata.operation)))
    event.operation = metadata.operation as DiagnosticEvent["operation"];
  if (typeof metadata.reason === "string") event.reason = REASONS.has(metadata.reason) ? metadata.reason :
    /^HTTP_[45]\d\d$/.test(metadata.reason) ? metadata.reason : "UNCLASSIFIED";
  if (Number.isInteger(metadata.retry) && Number(metadata.retry) >= 0 && Number(metadata.retry) <= 99)
    event.retry = Number(metadata.retry);
  return event;
}
function cleanStored(value: unknown): DiagnosticEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DiagnosticEvent[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.timestamp !== "string" || !Number.isFinite(Date.parse(row.timestamp))) return [];
    const safe = safeDiagnosticEvent(row.type, { source: row.source, operation: row.operation,
      reason: row.reason, retry: row.retry }, new Date(row.timestamp));
    if (!safe) return [];
    if (typeof row.session === "string" && /^[a-f0-9]{8}$/.test(row.session)) safe.session = row.session;
    return [safe];
  });
}
export function appendBoundedEvents(prior: DiagnosticEvent[], next: DiagnosticEvent, now = new Date()): DiagnosticEvent[] {
  const minimum = now.getTime() - DIAGNOSTIC_RETENTION.maxAgeDays * 86400000;
  const events = [...cleanStored(prior), next].filter((item) => Date.parse(item.timestamp) >= minimum)
    .slice(-DIAGNOSTIC_RETENTION.maxEvents);
  while (events.length && new TextEncoder().encode(JSON.stringify(events)).byteLength > DIAGNOSTIC_RETENTION.maxBytes)
    events.shift();
  return events;
}

let database: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((cause) => { database = null; throw cause; });
  return database;
}
async function readStored(): Promise<DiagnosticEvent[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(cleanStored(request.result));
    request.onerror = () => reject(request.error);
  });
}
async function writeStored(events: DiagnosticEvent[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(events, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
let writes: Promise<void> = Promise.resolve();
export function recordDiagnosticEvent(type: DiagnosticEventType, metadata: DiagnosticMetadata = {}): void {
  if (typeof indexedDB === "undefined") return;
  const event = safeDiagnosticEvent(type, metadata);
  if (!event) return;
  writes = writes.then(async () => writeStored(appendBoundedEvents(await readStored(), event))).catch(() => {});
}
export async function readDiagnosticLog(): Promise<DiagnosticEvent[]> {
  await writes;
  try { return (await readStored()).filter((item) => Date.parse(item.timestamp) >= Date.now() -
    DIAGNOSTIC_RETENTION.maxAgeDays * 86400000).slice(-DIAGNOSTIC_RETENTION.maxEvents); }
  catch { return []; }
}
export async function clearDiagnosticLog(): Promise<void> {
  await writes;
  await writeStored([]);
}
