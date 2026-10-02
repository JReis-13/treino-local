"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { readDiagnostics, type DiagnosticsState } from "@/lib/diagnostics";

export default function DebugPage() {
  const { data, error } = useApp();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({});
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  useEffect(() => {
    let storage = "available";
    try { const key = "treino-local:probe"; localStorage.setItem(key, "1"); localStorage.removeItem(key); }
    catch (cause) { storage = cause instanceof Error ? cause.message : "unavailable"; }
    setDiagnostics(readDiagnostics());
    setEnvironment({
      Version: "0.2.0", Build: process.env.NEXT_PUBLIC_TREINO_BUILD_ID ?? "development",
      "Built at": process.env.NEXT_PUBLIC_TREINO_BUILT_AT ?? "development", URL: window.location.href, Origin: window.location.origin,
      "Secure context": String(window.isSecureContext), Online: String(navigator.onLine), "Local storage": storage,
      "Service worker": navigator.serviceWorker?.controller?.scriptURL ?? "not controlling this page",
      "Direct file access": String(Boolean(window.isSecureContext && "showOpenFilePicker" in window)),
      "Web Share": String("share" in navigator), "Google connector": "available when a /exec URL and key are connected",
    });
  }, []);
  const plan = data?.plans.find((item) => item.id === data.activePlanId);
  const session = data?.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  return <div className="page-stack"><div className="page-heading"><p className="eyebrow">LOCAL TROUBLESHOOTING</p><h1>Diagnostics.</h1><p>Use this on your phone when a button appears to do nothing. No credentials are shown here.</p></div>
    <div className="debug-grid">{Object.entries({ ...environment, "Active plan ID": plan?.id ?? "none", "Active session ID": session?.id ?? "none", "Last action": diagnostics.lastAction ?? "none", "Last client error": diagnostics.lastError ?? error ?? "none" }).map(([key, value]) => <div key={key}><small>{key.toUpperCase()}</small><strong>{value}</strong></div>)}</div>
    <button type="button" className="secondary-button" onClick={() => { setDiagnostics(readDiagnostics()); setEnvironment((current) => ({ ...current, Online: String(navigator.onLine), URL: window.location.href })); }}>Refresh diagnostics</button>
    <Link className="back-link" href="/">← Home</Link>
  </div>;
}
