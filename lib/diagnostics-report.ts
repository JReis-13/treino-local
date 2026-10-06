import { localDateString } from "@/lib/dates";
import { readDiagnosticLog } from "@/lib/diagnostic-log";
import { getPwaUpdateSnapshot } from "@/lib/pwa/update-manager";
import { localSocialPublishState, readSocialDiagnostics, socialFetch, type SocialFriend, type SocialMe } from "@/lib/social/client";
import { hasActiveWorkout } from "@/lib/training/active-workout";
import { planLineageKey, sameDayDecision, sessionPlanLineageKey, workoutLineageKey } from "@/lib/training/identity";
import { aggregateSync } from "@/lib/training/sync-state";
import type { TrainingData } from "@/types/training";

function fingerprint(value: string | undefined): string {
  if (!value) return "none";
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function safeSameDaySummary(data: TrainingData | null) {
  const date = localDateString();
  const plan = data?.plans.find((item) => item.id === data.activePlanId);
  const current = data?.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  const completed = (data?.sessions ?? []).filter((item) => item.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const rows = completed.slice(0, 10).map((item) => ({ session: fingerprint(item.id), localDate: item.localDate ?? "missing",
    plan: fingerprint(item.planId), planLineage: fingerprint(sessionPlanLineageKey(data!, item)),
    planVersion: item.planVersion, workout: fingerprint(item.workoutId),
    workoutLineage: fingerprint(item.workoutLineageKey ?? item.workoutId),
    match: current ? sameDayDecision(data!, current, item, date).match : false,
    reason: current ? sameDayDecision(data!, current, item, date).reason : "NO_ACTIVE_WORKOUT" }));
  return { date, activePlan: fingerprint(plan?.id), planLineage: fingerprint(plan ? planLineageKey(plan) : undefined),
    planVersion: plan?.version ?? null, currentWorkout: fingerprint(current?.workoutId),
    workoutLineage: fingerprint(current ? current.workoutLineageKey ?? workoutLineageKey(current.workoutSnapshot) : undefined),
    candidates: current ? completed.filter((item) => sameDayDecision(data!, current, item, date).match).length : 0, rows };
}

async function safeSocialServer() {
  try {
    const me = await socialFetch<SocialMe>("me", "GET", undefined, { signal: AbortSignal.timeout(4000) });
    let friends: number | null = null;
    try {
      const list = await socialFetch<{ friends: SocialFriend[] }>("friends", "GET", undefined,
        { signal: AbortSignal.timeout(4000) });
      friends = list.friends.filter((item) => item.status === "accepted").length;
    } catch { /* Account status remains useful without a friend count. */ }
    return { authenticated: "yes", userReady: "yes", autoShare: String(me.sharingEnabled), friendCount: friends };
  } catch (cause) {
    return { authenticated: (cause as { status?: number })?.status === 401 ? "no" : "unknown",
      userReady: "unknown", autoShare: "unknown", friendCount: null };
  }
}
async function controllerBuildId(): Promise<string> {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return "none";
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve("unavailable"); }, 1200);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer); channel.port1.close();
      resolve(typeof event.data === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(event.data) ? event.data : "unknown");
    };
    try { controller.postMessage("GET_BUILD_ID", [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); resolve("unavailable"); }
  });
}
const pwaResults = new Set(["none", "registration failed", "new controller; reloading", "another window activated update",
  "update check completed", "update check failed; will retry", "reloading with active update", "update check failed",
  "already current", "activation requested", "activation timed out", "activation request failed"]);
function safePwa(value: string): string { return /^(none|checking|registered|unavailable|installing|installed|activating|activated|redundant|waiting|active|controlled|uncontrolled|ready|error|idle|updating)$/.test(value) ? value : "unknown"; }
const knownRoutes = new Set(["/", "/debug", "/settings", "/settings/friends", "/history", "/history/session",
  "/stats", "/plans", "/source", "/workout", "/finish", "/share", "/excel"]);

export async function collectDebugReport(data: TrainingData | null) {
  const [events, socialServer, controllerBuild] = await Promise.all([readDiagnosticLog(), safeSocialServer(), controllerBuildId()]);
  const socialLocal = readSocialDiagnostics();
  const pwa = getPwaUpdateSnapshot();
  const plan = data?.plans.find((item) => item.id === data.activePlanId);
  const active = data?.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  const completed = data?.sessions.filter((item) => item.status === "completed") ?? [];
  const latest = [...completed].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  const source = plan?.source.kind ?? "none";
  const logBytes = new TextEncoder().encode(JSON.stringify(events)).byteLength;
  return {
    debugReportVersion: 1, timestamp: new Date().toISOString(),
    app: { buildId: process.env.NEXT_PUBLIC_TREINO_BUILD_ID ?? "development",
      builtAt: process.env.NEXT_PUBLIC_TREINO_BUILT_AT ?? "development",
      route: knownRoutes.has(window.location.pathname.replace(/\/$/, "") || "/") ? window.location.pathname : "other",
      installed: window.matchMedia("(display-mode: standalone)").matches, online: navigator.onLine,
      storageSchemaVersion: data?.schemaVersion ?? null },
    pwa: { supported: "serviceWorker" in navigator, controlled: Boolean(navigator.serviceWorker?.controller),
      controllerBuildId: controllerBuild, phase: pwa.phase, registration: safePwa(pwa.registration),
      installing: safePwa(pwa.installing), waiting: safePwa(pwa.waiting), active: safePwa(pwa.active),
      lastUpdateResult: pwaResults.has(pwa.lastResult) ? pwa.lastResult : "unknown", activeWorkout: hasActiveWorkout(data) },
    identity: { ...safeSameDaySummary(data), activeSession: fingerprint(active?.id),
      activeSessionState: active ? "inProgress" : "none" },
    source: { kind: source, completionSync: latest?.completionSyncStatus ?? "none", loadSync: latest?.loadSyncStatus ?? "none",
      aggregateSync: latest ? aggregateSync(latest) : "none", pendingSessions: completed.filter((item) =>
        !["synced", "notApplicable"].includes(aggregateSync(item))).length, receiptPresent: Boolean(latest?.completionReceipt) },
    social: { authenticated: socialServer.authenticated, userReady: socialServer.userReady,
      friendCount: socialServer.friendCount, autoShareLocal: socialLocal.sharingCached,
      autoShareServer: socialServer.autoShare, effectiveAutoShare: socialServer.autoShare !== "unknown" ?
        socialServer.autoShare : socialLocal.sharingCached, outboxCount: socialLocal.outboxCount,
      deleteOutboxCount: socialLocal.deleteOutboxCount, lastPublishResult: socialLocal.lastPublishResult,
      lastPublishAt: socialLocal.lastPublishAt, lastDeleteResult: socialLocal.lastDeleteResult,
      lastDeleteAt: socialLocal.lastDeleteAt, lastHomeFetchResult: socialLocal.lastHomeFetchResult,
      lastReactionResult: socialLocal.lastReactionResult, latestSessionState: latest ? localSocialPublishState(latest.id) : "none" },
    storage: { plans: data?.plans.length ?? 0, completedSessions: completed.length,
      activeSession: Boolean(active), legacyDates: data?.plans.reduce((total, item) => total + item.legacyCompletions.length, 0) ?? 0,
      hiddenLegacyDates: data?.hiddenLegacyCompletions?.length ?? 0,
      diagnosticEvents: events.length, diagnosticLogBytes: logBytes },
    events,
  };
}

export function downloadDebugReport(report: Awaited<ReturnType<typeof collectDebugReport>>): string {
  const filename = `treino-local-debug-${report.timestamp.replace(/[-:.]/g, "").replace(/Z$/, "Z")}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}
