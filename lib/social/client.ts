import type { PublishActivity, SocialActivity } from "@/lib/social/model";
import { parsePublishActivity } from "@/lib/social/model";
import { shareSummaryFromSession } from "@/lib/training/share-summary";
import type { TrainingSession } from "@/types/training";
import { recordDiagnosticEvent } from "@/lib/diagnostic-log";

const PREFERENCE_KEY = "treino-social-preference-v1";
const OUTBOX_KEY = "treino-social-outbox-v1";
const ELIGIBILITY_KEY = "treino-social-eligibility-v1";
const RECEIPTS_KEY = "treino-social-receipts-v1";
const DELETE_OUTBOX_KEY = "treino-social-delete-outbox-v1";
const DIAGNOSTICS_KEY = "treino-social-diagnostics-v1";
interface Preference { email: string; accountId?: string; sharingEnabled: boolean }
interface QueuedActivity { ownerEmail: string; ownerAccountId?: string; activity: PublishActivity; manual?: boolean }
interface PendingEligibility { activity: PublishActivity; ownerAccountId?: string; ownerEmail?: string }
interface SocialReceipt { clientSessionId: string; ownerAccountId?: string; ownerEmail: string; activityId: string }
interface QueuedDeletion { clientSessionId: string; ownerAccountId?: string; ownerEmail?: string; ready?: boolean }
interface SocialDiagnostics { lastPublishResult?: string; lastPublishAt?: string; lastHomeFetchResult?: string; lastPublishSessionId?: string;
  lastDeleteResult?: string; lastDeleteAt?: string; lastReactionResult?: string;
  lastHomeActivity?: string; displayedActivity?: string; lastReactionActivity?: string }
export interface SocialFriend { id: string; status: "pending" | "accepted" | "declined"; direction: "incoming" | "outgoing"; displayName: string; email: string }
export interface SocialHome { activities: SocialActivity[]; received: Array<{ displayName: string; emoji: string; workoutName: string }>; friendCount: number }
export type SocialMe = { email: string; displayName: string; sharingEnabled: boolean; accountId?: string };
let preferenceRevision = 0;
const unboundThisPage = new Set<string>();
const unboundDeleteThisPage = new Set<string>();
const publishing = new Set<string>();
function changed(): void { if (typeof window !== "undefined") window.dispatchEvent(new Event("treino-social-change")); }
export function subscribeSocialChange(listener: () => void): () => void {
  window.addEventListener("treino-social-change", listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener("treino-social-change", listener); window.removeEventListener("storage", listener); };
}
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
function activityFingerprint(id: string | undefined): string {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return "none";
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function recordSocialHomeFetch(success: boolean, cause?: unknown, activityId?: string): void {
  recordDiagnostic({ lastHomeFetchResult: success ? "success" : safeResult(cause),
    ...(success ? { lastHomeActivity: activityFingerprint(activityId) } : {}) });
}
export function recordSocialDisplayedActivity(activityId?: string): void {
  recordDiagnostic({ displayedActivity: activityFingerprint(activityId) });
}
export function recordSocialReaction(success: boolean, cause?: unknown, activityId?: string): void {
  recordDiagnostic({ lastReactionResult: success ? "success" : safeResult(cause),
    lastReactionActivity: activityFingerprint(activityId) });
  recordDiagnosticEvent(success ? "friend_reaction_sent" : "app_error", { operation: "reaction", reason: success ? "OK" : "REACTION_FAILED" });
}
export function readSocialDiagnostics(): { sharingCached: string; accountBound: boolean; outboxCount: number;
  deleteOutboxCount: number; lastPublishResult: string; lastPublishAt: string; lastHomeFetchResult: string;
  lastDeleteResult: string; lastDeleteAt: string; lastReactionResult: string;
  lastHomeActivity: string; displayedActivity: string; lastReactionActivity: string } {
  const preference = readPreference();
  let diagnostics: SocialDiagnostics = {};
  try { diagnostics = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? "{}") as SocialDiagnostics; } catch { /* Empty. */ }
  const allowed = /^(none|queued|eligibility_pending|success|offline_queued|account_not_cached|invalid_final_session|outbox_write_failed|different_account_queued|sharing_disabled|network_error|http_[45]\d\d)$/;
  const safe = (value: unknown) => typeof value === "string" && allowed.test(value) ? value : "none";
  const safeActivity = (value: unknown) => typeof value === "string" && (/^[a-f0-9]{8}$/.test(value) || value === "none") ? value : "none";
  const timestamp = typeof diagnostics.lastPublishAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(diagnostics.lastPublishAt)
    ? diagnostics.lastPublishAt : "none";
  const deleteTimestamp = typeof diagnostics.lastDeleteAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(diagnostics.lastDeleteAt)
    ? diagnostics.lastDeleteAt : "none";
  return { sharingCached: preference ? String(preference.sharingEnabled) : "unknown", accountBound: Boolean(preference?.accountId),
    outboxCount: readOutbox().length + readEligibility().length, lastPublishResult: safe(diagnostics.lastPublishResult),
    deleteOutboxCount: readDeleteOutbox().length, lastPublishAt: timestamp, lastHomeFetchResult: safe(diagnostics.lastHomeFetchResult),
    lastDeleteResult: safe(diagnostics.lastDeleteResult), lastDeleteAt: deleteTimestamp,
    lastReactionResult: safe(diagnostics.lastReactionResult),
    lastHomeActivity: safeActivity(diagnostics.lastHomeActivity),
    displayedActivity: safeActivity(diagnostics.displayedActivity),
    lastReactionActivity: safeActivity(diagnostics.lastReactionActivity) };
}
function publishResult(result: string, sessionId?: string): void {
  recordDiagnostic({ lastPublishResult: result, lastPublishAt: new Date().toISOString(), lastPublishSessionId: sessionId });
  if (["queued", "success"].includes(result) || result === "network_error" || result.startsWith("http_"))
    recordDiagnosticEvent(result === "queued" ? "social_publish_queued" : result === "success" ? "social_publish_success" : "social_publish_failed",
      { sessionId, operation: "publish", reason: result.toUpperCase() });
  changed();
}
function deleteResult(result: string): void {
  recordDiagnostic({ lastDeleteResult: result, lastDeleteAt: new Date().toISOString() }); changed();
  recordDiagnosticEvent(result === "queued" ? "social_delete_queued" : result === "success" ? "social_delete_success" : "social_delete_failed",
    { operation: "delete", reason: result.toUpperCase() });
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
    sharingEnabled: me.sharingEnabled } satisfies Preference)); if (changedOnServer) preferenceRevision++; changed(); }
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
    reconcileEligibility(me);
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
function readDeleteOutbox(): QueuedDeletion[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DELETE_OUTBOX_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is QueuedDeletion => Boolean(item) &&
      typeof item.clientSessionId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(item.clientSessionId) &&
      (item.ownerAccountId === undefined || typeof item.ownerAccountId === "string") &&
      (item.ownerEmail === undefined || typeof item.ownerEmail === "string") &&
      (item.ready === undefined || typeof item.ready === "boolean")) : [];
  } catch { return []; }
}
function writeDeleteOutbox(items: QueuedDeletion[]): void {
  if (items.length > 500) throw new Error("Social delete queue is full.");
  localStorage.setItem(DELETE_OUTBOX_KEY, JSON.stringify(items)); changed();
}
function readEligibility(): PendingEligibility[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ELIGIBILITY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is PendingEligibility => Boolean(item) &&
      parsePublishActivity(item.activity) !== null &&
      (item.ownerAccountId === undefined || typeof item.ownerAccountId === "string") &&
      (item.ownerEmail === undefined || typeof item.ownerEmail === "string")) : [];
  } catch { return []; }
}
function writeEligibility(items: PendingEligibility[]): void {
  if (items.length > 500) throw new Error("Social eligibility queue is full.");
  localStorage.setItem(ELIGIBILITY_KEY, JSON.stringify(items)); changed();
}
function readReceipts(): SocialReceipt[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is SocialReceipt => Boolean(item) &&
      typeof item.clientSessionId === "string" && typeof item.ownerEmail === "string" &&
      typeof item.activityId === "string" && (item.ownerAccountId === undefined || typeof item.ownerAccountId === "string")) : [];
  } catch { return []; }
}
function saveReceipt(item: QueuedActivity, activityId: string): void {
  if (!activityId) return;
  try {
    const prior = readReceipts().filter((receipt) => !(receipt.clientSessionId === item.activity.clientSessionId &&
      (receipt.ownerAccountId && item.ownerAccountId ? receipt.ownerAccountId === item.ownerAccountId : receipt.ownerEmail === item.ownerEmail)));
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...prior, { clientSessionId: item.activity.clientSessionId,
      ownerAccountId: item.ownerAccountId, ownerEmail: item.ownerEmail, activityId }].slice(-500)));
    changed();
  } catch { /* A receipt cache failure never changes the server result. */ }
}
function removeReceipt(sessionId: string, me: SocialMe): void {
  try { localStorage.setItem(RECEIPTS_KEY, JSON.stringify(readReceipts().filter((item) =>
    !(item.clientSessionId === sessionId && (item.ownerAccountId && me.accountId
      ? item.ownerAccountId === me.accountId : item.ownerEmail === me.email))))); changed(); }
  catch { /* A stale cache will be corrected by the next server check. */ }
}
function writeOutbox(items: QueuedActivity[]): void {
  if (items.length > 500) throw new Error("Social outbox is full.");
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); changed();
}
function sameOwner(item: QueuedActivity, me: SocialMe): boolean {
  return item.ownerAccountId && me.accountId ? item.ownerAccountId === me.accountId : item.ownerEmail === me.email;
}
function sameDeleteOwner(item: QueuedDeletion, me: SocialMe): boolean {
  return item.ownerAccountId ? item.ownerAccountId === me.accountId :
    item.ownerEmail ? item.ownerEmail === me.email : unboundDeleteThisPage.has(item.clientSessionId);
}
/** Stage a deletion locally without network access; activation follows the saved History change. */
export function queueSocialDeletion(clientSessionId: string): boolean {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(clientSessionId)) return false;
  try {
    const preference = readPreference();
    const receipt = readReceipts().find((item) => item.clientSessionId === clientSessionId);
    const ownerAccountId = preference?.accountId ?? receipt?.ownerAccountId;
    const ownerEmail = preference?.email ?? receipt?.ownerEmail;
    const prior = readDeleteOutbox().filter((item) => item.clientSessionId !== clientSessionId);
    writeDeleteOutbox([...prior, { clientSessionId, ownerAccountId, ownerEmail, ready: false }]);
    if (!ownerAccountId && !ownerEmail) unboundDeleteThisPage.add(clientSessionId);
    deleteResult("queued");
    return true;
  } catch { deleteResult("outbox_write_failed"); return false; }
}
export function activateQueuedSocialDeletion(clientSessionId: string): void {
  try {
    writeDeleteOutbox(readDeleteOutbox().map((item) => item.clientSessionId === clientSessionId ? { ...item, ready: true } : item));
    // A deleted workout must never be published by an older pending automatic or manual task.
    writeOutbox(readOutbox().filter((item) => item.activity.clientSessionId !== clientSessionId));
    writeEligibility(readEligibility().filter((item) => item.activity.clientSessionId !== clientSessionId));
    if (flushing) flushAgain = true;
    void flushSocialOutbox();
  } catch { deleteResult("outbox_write_failed"); }
}
export function reconcileQueuedSocialDeletions(existingSessionIds: Set<string>): void {
  for (const item of readDeleteOutbox().filter((entry) => entry.ready === false)) {
    if (existingSessionIds.has(item.clientSessionId)) undoQueuedSocialDeletion(item.clientSessionId);
    else activateQueuedSocialDeletion(item.clientSessionId);
  }
}
export function undoQueuedSocialDeletion(clientSessionId: string): void {
  try { writeDeleteOutbox(readDeleteOutbox().filter((item) => item.clientSessionId !== clientSessionId)); }
  catch { /* A failed local History write is reported by AppProvider. */ }
}
export async function retrySocialDeletionsForCurrentAccount(): Promise<void> {
  const me = await refreshSocialPreference();
  if (!me) return;
  try { writeDeleteOutbox(readDeleteOutbox().map((item) => item.ownerAccountId || item.ownerEmail ? item :
    { ...item, ownerAccountId: me.accountId, ownerEmail: me.email })); }
  catch { deleteResult("outbox_write_failed"); return; }
  await flushSocialOutbox();
}
function addToOutbox(activity: PublishActivity, me: SocialMe, manual = false): void {
  const items = readOutbox().filter((item) => !(sameOwner(item, me) && item.activity.clientSessionId === activity.clientSessionId));
  writeOutbox([...items, { ownerEmail: me.email, ownerAccountId: me.accountId, activity, manual }]);
  publishResult("queued");
  if (flushing) flushAgain = true;
}
function reconcileEligibility(me: SocialMe): void {
  const pending = readEligibility();
  for (const item of pending) {
    const belongs = item.ownerAccountId ? item.ownerAccountId === me.accountId :
      item.ownerEmail ? item.ownerEmail === me.email : unboundThisPage.has(item.activity.clientSessionId);
    if (!belongs) continue;
    if (me.sharingEnabled) {
      try { addToOutbox(item.activity, me); } catch { publishResult("outbox_write_failed"); continue; }
    }
    try { writeEligibility(readEligibility().filter((entry) => entry !== item &&
      !(entry.activity.clientSessionId === item.activity.clientSessionId && entry.ownerAccountId === item.ownerAccountId)));
      unboundThisPage.delete(item.activity.clientSessionId); }
    catch { publishResult("outbox_write_failed"); }
  }
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
    const activity = buildSocialWorkoutActivity(session);
    if (!activity) { publishResult("invalid_final_session"); return false; }
    if (!preference || !preference.sharingEnabled) {
      writeEligibility([...readEligibility().filter((item) => item.activity.clientSessionId !== activity.clientSessionId),
        { activity, ownerAccountId: preference?.accountId, ownerEmail: preference?.email }]);
      if (!preference) unboundThisPage.add(activity.clientSessionId);
      publishResult("eligibility_pending");
      void refreshSocialPreference().then(() => flushSocialOutbox());
    } else {
      addToOutbox(activity, { ...preference, displayName: "" });
      void flushSocialOutbox();
    }
    return true;
  } catch { publishResult("outbox_write_failed"); return false; }
}

export async function shareSessionWithFriends(session: TrainingSession): Promise<boolean> {
  const activity = buildSocialWorkoutActivity(session);
  if (!activity) { publishResult("invalid_final_session"); return false; }
  const preference = readPreference();
  let me: SocialMe | null = null;
  if (typeof navigator !== "undefined" && navigator.onLine) me = await refreshSocialPreference();
  if (!me && preference) me = { ...preference, displayName: "" };
  if (!me) { publishResult("account_not_cached"); return false; }
  try {
    addToOutbox(activity, me, true);
    writeEligibility(readEligibility().filter((item) => item.activity.clientSessionId !== activity.clientSessionId));
    await flushSocialOutbox();
    return true;
  } catch { publishResult("outbox_write_failed"); return false; }
}

export type SocialPublishState = "not_shared" | "eligibility_pending" | "queued" | "publishing" | "shared" | "failed_retryable";
export function localSocialPublishState(sessionId: string): SocialPublishState {
  const me = readPreference();
  if (publishing.has(sessionId)) return "publishing";
  if (me && readOutbox().some((item) => sameOwner(item, { ...me, displayName: "" }) &&
    item.activity.clientSessionId === sessionId)) {
    try {
      const diagnostics = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? "{}");
      if (diagnostics.lastPublishSessionId === sessionId &&
        /^(network_error|http_[45]\d\d|outbox_write_failed)$/.test(diagnostics.lastPublishResult)) return "failed_retryable";
    } catch { /* Pending remains visible. */ }
    return "queued";
  }
  if (readEligibility().some((item) => item.activity.clientSessionId === sessionId)) return "eligibility_pending";
  if (me && readReceipts().some((item) => item.clientSessionId === sessionId &&
    (item.ownerAccountId && me.accountId ? item.ownerAccountId === me.accountId : item.ownerEmail === me.email))) return "shared";
  return "not_shared";
}
export async function serverSocialPublishState(sessionId: string): Promise<SocialPublishState> {
  const me = await refreshSocialPreference();
  if (!me) return localSocialPublishState(sessionId);
  const result = await socialFetch<{ activityId: string | null; shared: boolean }>(`activities?clientSessionId=${encodeURIComponent(sessionId)}`);
  const pending = localSocialPublishState(sessionId);
  if (["queued", "publishing", "failed_retryable", "eligibility_pending"].includes(pending)) return pending;
  if (result.shared && result.activityId) {
    saveReceipt({ ownerEmail: me.email, ownerAccountId: me.accountId,
      activity: { clientSessionId: sessionId } as PublishActivity }, result.activityId);
    return "shared";
  }
  removeReceipt(sessionId, me);
  return "not_shared";
}

async function drainSocialOutbox(): Promise<void> {
    if (typeof navigator !== "undefined" && !navigator.onLine) { publishResult("offline_queued"); return; }
    if (!readOutbox().length && !readEligibility().length && !readDeleteOutbox().some((item) => item.ready !== false)) return;
    let me: SocialMe;
    try { me = await socialFetch<SocialMe>("me", "GET", undefined, { signal: AbortSignal.timeout(15000) });
      cacheSocialPreference(me); reconcileEligibility(me); }
    catch (cause) { publishResult(safeResult(cause)); return; }
    for (const item of readDeleteOutbox().filter((entry) => entry.ready !== false)) {
      if (!sameDeleteOwner(item, me)) { deleteResult("different_account_queued"); continue; }
      try {
        // Clear every older publication before deleting; a failed local write keeps the deletion queued.
        writeOutbox(readOutbox().filter((entry) => entry.activity.clientSessionId !== item.clientSessionId));
        writeEligibility(readEligibility().filter((entry) => entry.activity.clientSessionId !== item.clientSessionId));
        await socialFetch("activities", "DELETE", { clientSessionId: item.clientSessionId },
          { expectedAccountId: me.accountId, signal: AbortSignal.timeout(15000) });
        writeDeleteOutbox(readDeleteOutbox().filter((entry) => entry.clientSessionId !== item.clientSessionId));
        removeReceipt(item.clientSessionId, me);
        unboundDeleteThisPage.delete(item.clientSessionId);
        deleteResult("success");
      } catch (cause) { deleteResult(safeResult(cause)); return; }
    }
    for (let processed = 0; processed < 500; processed++) {
      const item = readOutbox().find((entry) => sameOwner(entry, me));
      if (!item) {
        if (readOutbox().length) publishResult("different_account_queued");
        return;
      }
      if (!me.sharingEnabled && !item.manual) {
        try { writeOutbox(readOutbox().filter((entry) => !sameOwner(entry, me))); publishResult("sharing_disabled"); }
        catch { publishResult("outbox_write_failed"); }
        return;
      }
      try {
        publishing.add(item.activity.clientSessionId); changed();
        const response = await socialFetch<{ activityId?: string }>("activities", "POST",
          item.manual ? { ...item.activity, manualShare: true } : item.activity,
          { expectedAccountId: me.accountId, signal: AbortSignal.timeout(15000) });
        if (response.activityId) saveReceipt(item, response.activityId);
        writeOutbox(readOutbox().filter((entry) => !(sameOwner(entry, me) &&
          entry.activity.clientSessionId === item.activity.clientSessionId && entry.activity.completedAt === item.activity.completedAt)));
        publishResult("success", item.activity.clientSessionId);
      } catch (cause) { publishResult(safeResult(cause), item.activity.clientSessionId); return; }
      finally { publishing.delete(item.activity.clientSessionId); changed(); }
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
