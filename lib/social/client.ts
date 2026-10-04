import type { PublishActivity, SocialActivity } from "@/lib/social/model";
import { parsePublishActivity } from "@/lib/social/model";
import { shareSummaryFromSession } from "@/lib/training/share-summary";
import type { TrainingSession } from "@/types/training";

const PREFERENCE_KEY = "treino-social-preference-v1";
const OUTBOX_KEY = "treino-social-outbox-v1";
interface Preference { email: string; sharingEnabled: boolean }
interface QueuedActivity { ownerEmail: string; activity: PublishActivity }
export interface SocialFriend { id: string; status: "pending" | "accepted" | "declined"; direction: "incoming" | "outgoing"; displayName: string; email: string }
export interface SocialHome { activities: SocialActivity[]; received: Array<{ displayName: string; emoji: string; workoutName: string }>; friendCount: number }

export async function socialFetch<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(`/api/social/${path}`, { method, cache: "no-store", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Social features are temporarily unavailable."), { code: data.code, status: response.status });
  return data as T;
}
export type SocialMe = { email: string; displayName: string; sharingEnabled: boolean };
export function cacheSocialPreference(me: SocialMe) {
  try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ email: me.email, sharingEnabled: me.sharingEnabled } satisfies Preference)); }
  catch { /* No persistent storage. Workout saving still works. */ }
}
function readPreference(): Preference | null {
  try { const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null"); return value && typeof value.email === "string" && typeof value.sharingEnabled === "boolean" ? value : null; }
  catch { return null; }
}
function readOutbox(): QueuedActivity[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is QueuedActivity => item && typeof item.ownerEmail === "string" && parsePublishActivity(item.activity) !== null).slice(-30) : [];
  } catch { return []; }
}
function writeOutbox(items: QueuedActivity[]) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-30))); }
export function queueSocialActivity(session: TrainingSession) {
  try {
    const preference = readPreference();
    if (!preference?.sharingEnabled || session.status !== "completed" || !session.completedAt) return;
    const summary = shareSummaryFromSession(session);
    const activity = parsePublishActivity({ clientSessionId: session.id, workoutName: summary.workoutName.slice(0, 120),
      completedAt: session.completedAt, localDate: summary.localDate, durationMinutes: summary.durationMinutes ?? null,
      completedExercises: summary.completedExercises ?? null, totalExercises: summary.totalExercises ?? null });
    if (!activity) return;
    const items = readOutbox().filter((item) => !(item.ownerEmail === preference.email && item.activity.clientSessionId === activity.clientSessionId));
    writeOutbox([...items, { ownerEmail: preference.email, activity }]);
    void flushSocialOutbox();
  } catch { /* Social never blocks a locally saved workout. */ }
}
let flushing: Promise<void> | null = null;
export function flushSocialOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const queued = readOutbox();
    if (!queued.length) return;
    let me: SocialMe;
    try { me = await socialFetch<SocialMe>("me"); cacheSocialPreference(me); }
    catch { return; }
    if (!me.sharingEnabled) { writeOutbox(queued.filter((item) => item.ownerEmail !== me.email)); return; }
    for (const item of queued.filter((entry) => entry.ownerEmail === me.email)) {
      try {
        await socialFetch("activities", "POST", item.activity);
        writeOutbox(readOutbox().filter((entry) => !(entry.ownerEmail === item.ownerEmail &&
          entry.activity.clientSessionId === item.activity.clientSessionId && entry.activity.completedAt === item.activity.completedAt)));
      } catch { return; }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
export function discardQueuedSocialForCurrentUser() {
  const preference = readPreference();
  if (preference) try { writeOutbox(readOutbox().filter((item) => item.ownerEmail !== preference.email)); } catch { /* Ignore storage failure. */ }
}
