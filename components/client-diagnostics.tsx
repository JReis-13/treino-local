"use client";

import { useEffect } from "react";
import { recordDiagnostic } from "@/lib/diagnostics";
import { recordDiagnosticEvent } from "@/lib/diagnostic-log";

export function ClientDiagnostics() {
  useEffect(() => {
    const error = () => { recordDiagnostic({ lastError: "Client error" }); recordDiagnosticEvent("app_error", { reason: "WINDOW_ERROR" }); };
    const rejection = () => { recordDiagnostic({ lastError: "Unhandled rejection" }); recordDiagnosticEvent("app_error", { reason: "UNHANDLED_REJECTION" }); };
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => { window.removeEventListener("error", error); window.removeEventListener("unhandledrejection", rejection); };
  }, []);
  return null;
}
