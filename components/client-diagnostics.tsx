"use client";

import { useEffect } from "react";
import { recordDiagnostic } from "@/lib/diagnostics";

export function ClientDiagnostics() {
  useEffect(() => {
    const error = (event: ErrorEvent) => recordDiagnostic({ lastError: (event.message || "Unknown client error").slice(0, 300) });
    const rejection = (event: PromiseRejectionEvent) => recordDiagnostic({ lastError: String(event.reason instanceof Error ? event.reason.message : event.reason).slice(0, 300) });
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button, a") : null;
      if (target) recordDiagnostic({ lastAction: `${target.textContent?.trim().slice(0, 70) || target.tagName} · ${window.location.pathname}` });
    };
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("error", error); window.removeEventListener("unhandledrejection", rejection); document.removeEventListener("click", click, true); };
  }, []);
  return null;
}
