"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useApp } from "@/components/app-provider";
import { hasActiveWorkout } from "@/lib/training/active-workout";
import { getPwaUpdateSnapshot, subscribePwaUpdate } from "@/lib/pwa/update-manager";
import { loadDeviceConnector } from "@/lib/connector/credentials";
import { readDiagnostics, type DiagnosticsState } from "@/lib/diagnostics";
import { localSocialPublishState, readSocialDiagnostics } from "@/lib/social/client";
import { socialFetch, type SocialMe, type SocialFriend } from "@/lib/social/client";
import { localDateString } from "@/lib/dates";
import { planLineageKey, sameDayDecision, sessionPlanLineageKey, workoutLineageKey } from "@/lib/training/identity";
import type { TrainingData } from "@/types/training";
import { collectDebugReport } from "@/lib/diagnostics-report";

function short(value: string | undefined): string { return value ? `${value.slice(0, 8)}…` : "none"; }
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function sameDayReport(data: TrainingData | null, date: string) {
  const plan = data?.plans.find((item) => item.id === data.activePlanId);
  const current = data?.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  const completed = (data?.sessions ?? []).filter((item) => item.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const recent = completed.slice(0, 10);
  const rows = recent.map((item) => ({ session: short(item.id), date: item.localDate ?? "missing",
    plan: short(item.planId), planLineage: fingerprint(sessionPlanLineageKey(data!, item)), version: item.planVersion,
    workout: short(item.workoutId), workoutLineage: fingerprint(item.workoutLineageKey ?? item.workoutId),
    name: item.workoutSnapshot.title.slice(0, 80),
    decision: current ? sameDayDecision(data!, current, item, date) : { match: false, reason: "NO_ACTIVE_WORKOUT" } }));
  return { date, activePlan: short(plan?.id), planLineage: plan ? fingerprint(planLineageKey(plan)) : "none",
    planVersion: plan?.version ?? "none", currentWorkout: short(current?.workoutId),
    workoutLineage: current ? fingerprint(current.workoutLineageKey ??
      workoutLineageKey(current.workoutSnapshot)) : "none", currentName: current?.workoutSnapshot.title.slice(0, 80) ?? "none",
    candidates: current ? completed.filter((item) => sameDayDecision(data!, current, item, date).match).length : 0, rows };
}

const serverUpdateSnapshot = { phase: "idle", lastResult: "none", registration: "checking", controller: "none",
  installing: "none", waiting: "none", active: "none" } as const;

export default function DebugPage() {
  const { data, error } = useApp();
  const [dateReady, setDateReady] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({});
  const [social, setSocial] = useState<ReturnType<typeof readSocialDiagnostics> | null>(null);
  const [socialServer, setSocialServer] = useState<{ authenticated: string; ready: string; sharing: string; friends: string }>({
    authenticated: "unknown", ready: "unknown", sharing: "unknown", friends: "unknown" });
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const update = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot, () => serverUpdateSnapshot);
  useEffect(() => {
    setDateReady(true);
    let storage = "available";
    try { const key = "treino-local:probe"; localStorage.setItem(key, "1"); localStorage.removeItem(key); }
    catch (cause) { storage = cause instanceof Error ? cause.message : "unavailable"; }
    setDiagnostics(readDiagnostics());
    setSocial(readSocialDiagnostics());
    void Promise.all([socialFetch<SocialMe>("me"), socialFetch<{ friends: SocialFriend[] }>("friends")])
      .then(([me, friends]) => setSocialServer({ authenticated: "yes", ready: "yes",
        sharing: String(me.sharingEnabled), friends: String(friends.friends.filter((friend) => friend.status === "accepted").length) }))
      .catch((cause) => setSocialServer({ authenticated: (cause as { status?: number }).status === 401 ? "no" : "unknown",
        ready: "unknown", sharing: "unknown", friends: "unknown" }));
    setEnvironment({
      Version: "0.2.0", Build: process.env.NEXT_PUBLIC_TREINO_BUILD_ID ?? "development",
      "Built at": process.env.NEXT_PUBLIC_TREINO_BUILT_AT ?? "development", Path: window.location.pathname, Origin: window.location.origin,
      "Secure context": String(window.isSecureContext), Online: String(navigator.onLine), "Local storage": storage,
      "SW supported": String("serviceWorker" in navigator),
      "Service worker": navigator.serviceWorker?.controller?.scriptURL ?? "not controlling this page",
      "Controller build ID": navigator.serviceWorker?.controller ? "unavailable from older worker" : "none",
      "Direct file access": String(Boolean(window.isSecureContext && "showOpenFilePicker" in window)),
      "Web Share": String("share" in navigator), "Google Sheets": "available after server-side Google OAuth connection",
      "PWA standalone": String(window.matchMedia("(display-mode: standalone)").matches),
    });
    const controller = navigator.serviceWorker?.controller;
    if (controller) {
      const channel = new MessageChannel();
      const timer = setTimeout(() => channel.port1.close(), 1500);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        setEnvironment((current) => ({ ...current, "Controller build ID": typeof event.data === "string" ? event.data : "unknown" }));
        channel.port1.close();
      };
      try { controller.postMessage("GET_BUILD_ID", [channel.port2]); }
      catch { clearTimeout(timer); channel.port1.close(); }
    }
    loadDeviceConnector().then((connector) => setEnvironment((current) => ({ ...current,
      "Device connector version": connector?.version ? String(connector.version) : "not configured" }))).catch(() => {});
  }, []);
  const plan = data?.plans.find((item) => item.id === data.activePlanId);
  const session = data?.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  const lastCompleted = data?.sessions.filter((item) => item.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
  const sameDay = sameDayReport(data, dateReady ? localDateString() : "loading");
  async function copyReport() {
    try { await navigator.clipboard.writeText(JSON.stringify(await collectDebugReport(data), null, 2)); setMessage("Safe diagnostic report copied."); }
    catch { setMessage("Clipboard unavailable. Use the values shown above."); }
  }
  return <div className="page-stack"><div className="page-heading"><p className="eyebrow">LOCAL TROUBLESHOOTING</p><h1>Diagnostics.</h1><p>Use this on your phone when a button appears to do nothing. No credentials are shown here.</p></div>
    <div className="debug-grid">{Object.entries({ ...environment,
      "SW registration": update.registration, "SW controller": update.controller,
      "SW installing": update.installing, "SW waiting": update.waiting, "SW active": update.active,
      "Update UI state": update.phase, "Active workout detected": String(hasActiveWorkout(data)),
      "Last update result": update.lastResult,
      "Social account provisioned (cached)": social ? String(social.accountBound) : "unknown",
      "Social sharing (cached)": social?.sharingCached ?? "unknown",
      "Social outbox items": String(social?.outboxCount ?? "unknown"),
      "Last completed session": short(lastCompleted?.id),
      "Last session Friends state": lastCompleted ? localSocialPublishState(lastCompleted.id) : "none",
      "Social authenticated": socialServer.authenticated, "Social user ready": socialServer.ready,
      "Friends connected": socialServer.friends, "Auto share on server": socialServer.sharing,
      "Last social publish result": social?.lastPublishResult ?? "none",
      "Last social publish at": social?.lastPublishAt ?? "none",
      "Last Friends Home fetch": social?.lastHomeFetchResult ?? "none",
      "Same-day candidates": String(sameDay.candidates),
      "Active plan ID": short(plan?.id), "Active session ID": short(session?.id), "Last action": diagnostics.lastAction ?? "none", "Last client error": diagnostics.lastError ?? error ?? "none" }).map(([key, value]) => <div key={key}><small>{key.toUpperCase()}</small><strong>{value}</strong></div>)}</div>
    <section className="review-card"><p className="eyebrow">SAME-DAY MATCHING</p><h2>Phone History check</h2>
      <p>Local date: {sameDay.date} · Plan: {sameDay.activePlan} · Lineage: {sameDay.planLineage} · Version: {sameDay.planVersion}</p>
      <p>Current workout: {sameDay.currentName} · ID: {sameDay.currentWorkout} · Lineage: {sameDay.workoutLineage}</p>
      <p>Same-day candidates: {sameDay.candidates}</p>
      {sameDay.rows.map((row) => <p key={`${row.session}-${row.date}`} className="quiet-note">
        {row.decision.match ? "MATCH" : "NO MATCH"} · {row.decision.reason} · {row.date} · {row.name} · session {row.session} · plan {row.plan} ({row.planLineage}, v{row.version}) · workout {row.workout} ({row.workoutLineage})
      </p>)}
    </section>
    {message && <p className="context-note" role="status">{message}</p>}
    <button type="button" className="secondary-button" onClick={() => { setDiagnostics(readDiagnostics()); setSocial(readSocialDiagnostics()); setEnvironment((current) => ({ ...current, Online: String(navigator.onLine), Path: window.location.pathname })); }}>Refresh diagnostics</button>
    <button type="button" className="secondary-button" onClick={() => void copyReport()}>Copy diagnostics</button>
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
