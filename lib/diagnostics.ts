export const DIAGNOSTICS_KEY = "treino-local:diagnostics";
export interface DiagnosticsState { lastAction?: string; lastError?: string; updatedAt?: string; }

export function readDiagnostics(): DiagnosticsState {
  try { return JSON.parse(sessionStorage.getItem(DIAGNOSTICS_KEY) ?? "{}"); }
  catch { return {}; }
}

export function recordDiagnostic(change: Partial<DiagnosticsState>): void {
  try { sessionStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ ...readDiagnostics(), ...change, updatedAt: new Date().toISOString() })); }
  catch { /* Diagnostics must never block a workout. */ }
}
