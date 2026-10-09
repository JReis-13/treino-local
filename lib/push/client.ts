import { recordDiagnosticEvent } from "@/lib/diagnostic-log";

export type PushStatus = { configured: boolean; publicKey: string | null; friendWorkouts: boolean;
  reactions: boolean; deviceRegistered: boolean;
  recentDeliveries?: Array<{ type: "workout" | "reaction" | "test"; eventId: string;
    result: "claimed" | "sent" | "expired" | "failed" }> };
export type PushDiagnosticState = { lastSubscriptionResult?: string; lastReceivedType?: string; lastClickResult?: string;
  serverRegistration?: string };
const DB = "treino-push-diagnostics-v1";
const safeResults = new Set(["none", "success", "failure", "removed", "unknown", "friend_workout", "reaction", "test", "opened", "focused"]);

export function pushSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator &&
    typeof window.PushManager !== "undefined" && typeof window.Notification !== "undefined";
}
export function notificationPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}
export async function deviceSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/push/${path}`, { method, credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(response.status === 401 ? "Connect Google to manage notifications." :
    "Could not update notifications. Try again.");
  return response.json() as Promise<T>;
}
export const getPushStatus = () => api<PushStatus>("status");
export const savePushPreferences = (friendWorkouts: boolean, reactions: boolean) =>
  api<Pick<PushStatus, "friendWorkouts" | "reactions">>("preferences", "PUT", { friendWorkouts, reactions });

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const key = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) key[i] = binary.charCodeAt(i);
  return key;
}
export async function enablePush(publicKey: string) {
  if (!pushSupported()) throw new Error("Notifications aren't available on this device/browser.");
  if (Notification.permission === "denied") throw new Error("Notifications are blocked for this site.");
  recordDiagnosticEvent("push_permission_requested");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  recordDiagnosticEvent(permission === "granted" ? "push_permission_granted" : "push_permission_denied");
  if (permission !== "granted") throw new Error("Notifications were not allowed.");
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey) });
      recordDiagnosticEvent("push_subscription_created");
    }
    await api("subscribe", "POST", { subscription: subscription.toJSON() });
    recordDiagnosticEvent("push_subscription_registered");
    await writePushDiagnostics({ lastSubscriptionResult: "success", serverRegistration: "success" });
  } catch (cause) {
    recordDiagnosticEvent("push_subscription_failed", { reason: "FAILED" });
    await writePushDiagnostics({ lastSubscriptionResult: "failure", serverRegistration: "failure" });
    throw cause;
  }
}
export async function disablePush() {
  const subscription = await deviceSubscription();
  if (subscription) await subscription.unsubscribe();
  try {
    await api("subscription", "DELETE");
    await writePushDiagnostics({ lastSubscriptionResult: "removed", serverRegistration: "success" });
    recordDiagnosticEvent("push_subscription_removed");
  } catch {
    await writePushDiagnostics({ lastSubscriptionResult: "removed", serverRegistration: "failure" });
    throw new Error("Notifications stopped on this device. Server cleanup will retry when you open Friends settings again.");
  }
}
export async function clearStalePushRegistration() {
  recordDiagnosticEvent("push_subscription_removed", { reason: "STALE_BROWSER_SUBSCRIPTION" });
  try { await api("subscription", "DELETE"); await writePushDiagnostics({ serverRegistration: "success" }); }
  catch { await writePushDiagnostics({ serverRegistration: "failure" }); }
}
export async function readPushDiagnostics(): Promise<PushDiagnosticState> {
  if (typeof indexedDB === "undefined") return {};
  return new Promise((resolve) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = () => resolve({});
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("state", "readonly").objectStore("state").get("safe");
      read.onerror = () => { db.close(); resolve({}); };
      read.onsuccess = () => {
        const value = read.result && typeof read.result === "object" ? read.result as PushDiagnosticState : {};
        db.close();
        resolve(Object.fromEntries(Object.entries(value).filter(([key, result]) =>
          ["lastSubscriptionResult", "lastReceivedType", "lastClickResult", "serverRegistration"].includes(key) &&
          safeResults.has(String(result)))) as PushDiagnosticState);
      };
    };
  });
}
export async function writePushDiagnostics(patch: PushDiagnosticState) {
  if (typeof indexedDB === "undefined") return;
  const safe = Object.fromEntries(Object.entries(patch).filter(([key, result]) =>
    ["lastSubscriptionResult", "lastReceivedType", "lastClickResult", "serverRegistration"].includes(key) &&
    safeResults.has(String(result))));
  const prior = await readPushDiagnostics();
  await new Promise<void>((resolve) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("state", "readwrite");
      transaction.objectStore("state").put({ ...prior, ...safe }, "safe");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); resolve(); };
    };
  });
}
