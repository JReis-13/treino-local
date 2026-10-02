"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { loadDeviceConnector } from "@/lib/connector/credentials";
import { readDiagnostics, safeDiagnostic, type DiagnosticsState } from "@/lib/diagnostics";

export default function DebugPage() {
  const { data, error } = useApp();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({});
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    let storage = "available";
    try { const key = "treino-local:probe"; localStorage.setItem(key, "1"); localStorage.removeItem(key); }
    catch (cause) { storage = cause instanceof Error ? cause.message : "unavailable"; }
    setDiagnostics(readDiagnostics());
    setEnvironment({
      Version: "0.2.0", Build: process.env.NEXT_PUBLIC_TREINO_BUILD_ID ?? "development",
      "Built at": process.env.NEXT_PUBLIC_TREINO_BUILT_AT ?? "development", Path: window.location.pathname, Origin: window.location.origin,
      "Secure context": String(window.isSecureContext), Online: String(navigator.onLine), "Local storage": storage,
      "Service worker": navigator.serviceWorker?.controller?.scriptURL ?? "not controlling this page",
      "Direct file access": String(Boolean(window.isSecureContext && "showOpenFilePicker" in window)),
      "Web Share": String("share" in navigator), "Google Sheets": "available after server-side Google OAuth connection",
      "PWA standalone": String(window.matchMedia("(display-mode: standalone)").matches),
    });
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
    <div className="debug-grid">{Object.entries({ ...environment, "Active plan ID": plan?.id ?? "none", "Active session ID": session?.id ?? "none", "Last action": diagnostics.lastAction ?? "none", "Last client error": diagnostics.lastError ?? error ?? "none" }).map(([key, value]) => <div key={key}><small>{key.toUpperCase()}</small><strong>{value}</strong></div>)}</div>
    {message && <p className="context-note" role="status">{message}</p>}
    <button type="button" className="secondary-button" onClick={() => { setDiagnostics(readDiagnostics()); setEnvironment((current) => ({ ...current, Online: String(navigator.onLine), Path: window.location.pathname })); }}>Refresh diagnostics</button>
    <button type="button" className="secondary-button" onClick={() => void copyReport()}>Copy safe diagnostic report</button>
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
