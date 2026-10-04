import type { PublishActivity, SocialActivity } from "@/lib/social/model";
import { parsePublishActivity } from "@/lib/social/model";
import { shareSummaryFromSession } from "@/lib/training/share-summary";
import type { TrainingSession } from "@/types/training";

const PREFERENCE_KEY = "treino-social-preference-v1";
const OUTBOX_KEY = "treino-social-outbox-v1";
const DIAGNOSTICS_KEY = "treino-social-diagnostics-v1";
interface Preference { email: string; accountId?: string; sharingEnabled: boolean }
interface QueuedActivity { ownerEmail: string; ownerAccountId?: string; activity: PublishActivity }
interface SocialDiagnostics { lastPublishResult?: string; lastPublishAt?: string; lastHomeFetchResult?: string }
export interface SocialFriend { id: string; status: "pending" | "accepted" | "declined"; direction: "incoming" | "outgoing"; displayName: string; email: string }
export interface SocialHome { activities: SocialActivity[]; received: Array<{ displayName: string; emoji: string; workoutName: string }>; friendCount: number }
export type SocialMe = { email: string; displayName: string; sharingEnabled: boolean; accountId?: string };
let preferenceRevision = 0;
export function socialPreferenceRevision(): number { return preferenceRevision; }

function safeResult(cause: unknown): string {
  const status = (cause as { status?: unknown })?.status;
  return Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599 ? `http_${status}` : "network_error";
}
function recordDiagnostic(change: Partial<SocialDiagnostics>): void {
  try {
    const prior = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? "{}") as SocialDiagnostics;
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ ...prior, ...change }));
  } catch { /* Diagnostics must never affect a local workout. */ }
}
export function recordSocialHomeFetch(success: boolean, cause?: unknown): void {
  recordDiagnostic({ lastHomeFetchResult: success ? "success" : safeResult(cause) });
}
export function readSocialDiagnostics(): { sharingCached: string; accountBound: boolean; outboxCount: number;
  lastPublishResult: string; lastPublishAt: string; lastHomeFetchResult: string } {
  const preference = readPreference();
  let diagnostics: SocialDiagnostics = {};
  try { diagnostics = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? "{}") as SocialDiagnostics; } catch { /* Empty. */ }
  const allowed = /^(none|queued|success|offline_queued|account_not_cached|invalid_final_session|outbox_write_failed|different_account_queued|sharing_disabled|network_error|http_[45]\d\d)$/;
  const safe = (value: unknown) => typeof value === "string" && allowed.test(value) ? value : "none";
  const timestamp = typeof diagnostics.lastPublishAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(diagnostics.lastPublishAt)
    ? diagnostics.lastPublishAt : "none";
  return { sharingCached: preference ? String(preference.sharingEnabled) : "unknown", accountBound: Boolean(preference?.accountId),
    outboxCount: readOutbox().length, lastPublishResult: safe(diagnostics.lastPublishResult),
    lastPublishAt: timestamp, lastHomeFetchResult: safe(diagnostics.lastHomeFetchResult) };
}
function publishResult(result: string): void {
  recordDiagnostic({ lastPublishResult: result, lastPublishAt: new Date().toISOString() });
}

export async function socialFetch<T>(path: string, method = "GET", body?: object,
  options?: { expectedAccountId?: string; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`/api/social/${path}`, { method, cache: "no-store", credentials: "same-origin",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}),
      ...(options?.expectedAccountId ? { "X-Treino-Social-Account": options.expectedAccountId } : {}) },
    signal: options?.signal, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Social features are temporarily unavailable."), { code: data.code, status: response.status });
  return data as T;
}
export function cacheSocialPreference(me: SocialMe, expectedRevision?: number, changedOnServer = false): void {
  if (expectedRevision !== undefined && expectedRevision !== preferenceRevision) return;
  try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ email: me.email, accountId: me.accountId,
    sharingEnabled: me.sharingEnabled } satisfies Preference)); if (changedOnServer) preferenceRevision++; }
  catch { /* No persistent storage. Workout saving still works. */ }
}
export function clearSocialPreference(): void {
  try { localStorage.removeItem(PREFERENCE_KEY); preferenceRevision++; } catch { /* Keep local workouts. */ }
}
export async function refreshSocialPreference(): Promise<SocialMe | null> {
  const revision = preferenceRevision;
  try {
    const me = await socialFetch<SocialMe>("me", "GET", undefined, { signal: AbortSignal.timeout(15000) });
    cacheSocialPreference(me, revision);
    return me;
  } catch (cause) {
    if ((cause as { status?: number })?.status === 401 && revision === preferenceRevision) clearSocialPreference();
    return null;
  }
}
function readPreference(): Preference | null {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null");
    return value && typeof value.email === "string" && typeof value.sharingEnabled === "boolean" &&
      (value.accountId === undefined || typeof value.accountId === "string") ? value : null;
  } catch { return null; }
}
function readOutbox(): QueuedActivity[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is QueuedActivity => item && typeof item.ownerEmail === "string" &&
      (item.ownerAccountId === undefined || typeof item.ownerAccountId === "string") && parsePublishActivity(item.activity) !== null) : [];
  } catch { return []; }
}
function writeOutbox(items: QueuedActivity[]): void {
  if (items.length > 500) throw new Error("Social outbox is full.");
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}
function sameOwner(item: QueuedActivity, me: SocialMe): boolean {
  return item.ownerAccountId && me.accountId ? item.ownerAccountId === me.accountId : item.ownerEmail === me.email;
}

/** Build the complete public allowlist only from the definitive saved session. */
export function buildSocialWorkoutActivity(session: TrainingSession): PublishActivity | null {
  if (session.status !== "completed" || !session.completedAt) return null;
  const summary = shareSummaryFromSession(session);
  return parsePublishActivity({ clientSessionId: session.id, workoutName: summary.workoutName.slice(0, 120),
    completedAt: session.completedAt, localDate: summary.localDate,
    durationMinutes: summary.durationMinutes !== undefined && summary.durationMinutes <= 1440 ? summary.durationMinutes : null,
    completedExercises: summary.completedExercises !== undefined && summary.completedExercises <= 500 ? summary.completedExercises : null,
    totalExercises: summary.totalExercises !== undefined && summary.totalExercises <= 500 ? summary.totalExercises : null });
}

let flushing: Promise<void> | null = null;
let flushAgain = false;
export function queueSocialActivity(session: TrainingSession): boolean {
  try {
    const preference = readPreference();
    if (!preference) { publishResult("account_not_cached"); return false; }
    const activity = buildSocialWorkoutActivity(session);
    if (!activity) { publishResult("invalid_final_session"); return false; }
    const items = readOutbox().filter((item) => !(sameOwner(item, { email: preference.email, accountId: preference.accountId,
      displayName: "", sharingEnabled: preference.sharingEnabled }) && item.activity.clientSessionId === activity.clientSessionId));
    writeOutbox([...items, { ownerEmail: preference.email, ownerAccountId: preference.accountId, activity }]);
    publishResult("queued");
    if (flushing) flushAgain = true;
    void flushSocialOutbox();
    return true;
  } catch { publishResult("outbox_write_failed"); return false; }
}

async function drainSocialOutbox(): Promise<void> {
    if (typeof navigator !== "undefined" && !navigator.onLine) { publishResult("offline_queued"); return; }
    if (!readOutbox().length) return;
    let me: SocialMe;
    try { me = await socialFetch<SocialMe>("me", "GET", undefined, { signal: AbortSignal.timeout(15000) });
      cacheSocialPreference(me); }
    catch (cause) { publishResult(safeResult(cause)); return; }
    for (let processed = 0; processed < 500; processed++) {
      const item = readOutbox().find((entry) => sameOwner(entry, me));
      if (!item) {
        if (readOutbox().length) publishResult("different_account_queued");
        return;
      }
      if (!me.sharingEnabled) {
        try { writeOutbox(readOutbox().filter((entry) => !sameOwner(entry, me))); publishResult("sharing_disabled"); }
        catch { publishResult("outbox_write_failed"); }
        return;
      }
      try {
        await socialFetch("activities", "POST", item.activity,
          { expectedAccountId: me.accountId, signal: AbortSignal.timeout(15000) });
        writeOutbox(readOutbox().filter((entry) => !(sameOwner(entry, me) &&
          entry.activity.clientSessionId === item.activity.clientSessionId && entry.activity.completedAt === item.activity.completedAt)));
        publishResult("success");
      } catch (cause) { publishResult(safeResult(cause)); return; }
    }
}
export function flushSocialOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    do { flushAgain = false; await drainSocialOutbox(); } while (flushAgain);
  })().finally(() => { flushing = null; });
  return flushing;
}
export function discardQueuedSocialForCurrentUser(): void {
  const preference = readPreference();
  if (preference) try { writeOutbox(readOutbox().filter((item) => !sameOwner(item, { email: preference.email,
    accountId: preference.accountId, displayName: "", sharingEnabled: false }))); }
  catch { publishResult("outbox_write_failed"); }
}
