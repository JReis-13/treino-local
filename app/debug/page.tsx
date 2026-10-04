"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useApp } from "@/components/app-provider";
import { hasActiveWorkout } from "@/lib/training/active-workout";
import { getPwaUpdateSnapshot, subscribePwaUpdate } from "@/lib/pwa/update-manager";
import { loadDeviceConnector } from "@/lib/connector/credentials";
import { readDiagnostics, safeDiagnostic, type DiagnosticsState } from "@/lib/diagnostics";
import { readSocialDiagnostics } from "@/lib/social/client";

const serverUpdateSnapshot = { phase: "idle", lastResult: "none", registration: "checking", controller: "none",
  installing: "none", waiting: "none", active: "none" } as const;

export default function DebugPage() {
  const { data, error } = useApp();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({});
  const [social, setSocial] = useState<ReturnType<typeof readSocialDiagnostics> | null>(null);
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const update = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot, () => serverUpdateSnapshot);
  useEffect(() => {
    let storage = "available";
    try { const key = "treino-local:probe"; localStorage.setItem(key, "1"); localStorage.removeItem(key); }
    catch (cause) { storage = cause instanceof Error ? cause.message : "unavailable"; }
    setDiagnostics(readDiagnostics());
    setSocial(readSocialDiagnostics());
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
  async function copyReport() {
    const report = { build: environment.Build, builtAt: environment["Built at"], browser: navigator.userAgent,
      origin: window.location.origin, path: window.location.pathname, standalone: environment["PWA standalone"],
      storageVersion: data?.schemaVersion ?? "unavailable", activePlanId: plan?.id ?? "none",
      connectorVersion: environment["Device connector version"] ?? (plan?.source.kind === "google" ? plan.source.connectorVersion ?? 1 : "none"),
      lastAction: safeDiagnostic(diagnostics.lastAction ?? "none"), lastError: safeDiagnostic(diagnostics.lastError ?? error ?? "none") };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setMessage("Safe diagnostic report copied."); }
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
      "Last social publish result": social?.lastPublishResult ?? "none",
      "Last social publish at": social?.lastPublishAt ?? "none",
      "Last Friends Home fetch": social?.lastHomeFetchResult ?? "none",
      "Active plan ID": plan?.id ?? "none", "Active session ID": session?.id ?? "none", "Last action": diagnostics.lastAction ?? "none", "Last client error": diagnostics.lastError ?? error ?? "none" }).map(([key, value]) => <div key={key}><small>{key.toUpperCase()}</small><strong>{value}</strong></div>)}</div>
    {message && <p className="context-note" role="status">{message}</p>}
    <button type="button" className="secondary-button" onClick={() => { setDiagnostics(readDiagnostics()); setSocial(readSocialDiagnostics()); setEnvironment((current) => ({ ...current, Online: String(navigator.onLine), Path: window.location.pathname })); }}>Refresh diagnostics</button>
    <button type="button" className="secondary-button" onClick={() => void copyReport()}>Copy safe diagnostic report</button>
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
