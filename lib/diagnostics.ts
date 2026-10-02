export const DIAGNOSTICS_KEY = "treino-local:diagnostics";
export interface DiagnosticsState { lastAction?: string; lastError?: string; updatedAt?: string; }

export function safeDiagnostic(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[url]").replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]")
    .replace(/\b(?:key|token|secret)\s*[:=]\s*\S+/gi, "credential=[redacted]").slice(0, 300);
}

export function readDiagnostics(): DiagnosticsState {
  try {
    const value = JSON.parse(sessionStorage.getItem(DIAGNOSTICS_KEY) ?? "{}") as DiagnosticsState;
    return { lastAction: value.lastAction ? safeDiagnostic(value.lastAction) : undefined,
      lastError: value.lastError ? safeDiagnostic(value.lastError) : undefined, updatedAt: value.updatedAt };
  }
  catch { return {}; }
}

export function recordDiagnostic(change: Partial<DiagnosticsState>): void {
  try { sessionStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ ...readDiagnostics(),
    ...(change.lastAction ? { lastAction: safeDiagnostic(change.lastAction) } : {}),
    ...(change.lastError ? { lastError: safeDiagnostic(change.lastError) } : {}), updatedAt: new Date().toISOString() })); }
  catch { /* Diagnostics must never block a workout. */ }
}
