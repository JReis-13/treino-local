import assert from "node:assert/strict";
import test from "node:test";
import { collectDebugReport } from "../lib/diagnostics-report";
import type { TrainingData } from "../types/training";

test("downloadable report uses safe fields even when local workout records contain secrets", async () => {
  const prior = { window: globalThis.window, navigator: globalThis.navigator, localStorage: globalThis.localStorage,
    fetch: globalThis.fetch };
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/settings/" },
    matchMedia: () => ({ matches: false }) } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => ({ ok: false, status: 401,
    json: async () => ({ error: "private response body" }) }) });
  const secrets = ["ACCESS_TOKEN_FIXTURE", "REFRESH_TOKEN_FIXTURE", "postgres://DATABASE_URL_FIXTURE",
    "CLIENT_SECRET_FIXTURE", "https://docs.google.com/spreadsheets/d/SHEET_ID_FIXTURE",
    "EXERCISE_NOTE_FIXTURE", "WORKOUT_NOTE_FIXTURE", "PRIVATE_LOAD_99", "private@example.invalid",
    "https://push.example.com/private-endpoint", "P256DH_PRIVATE_FIXTURE", "AUTH_PRIVATE_FIXTURE",
    "VAPID_PRIVATE_KEY_FIXTURE"];
  try {
    const data: TrainingData = { schemaVersion: 5, activePlanId: "plan", exerciseNotes: [
      { planId: "plan", exerciseKey: "EXERCISE_NOTE_FIXTURE", text: "EXERCISE_NOTE_FIXTURE", updatedAt: "2026-10-01T00:00:00Z" }],
    plans: [{ id: "plan", name: "CLIENT_SECRET_FIXTURE", source: { kind: "builtin", label: "Local" },
      version: 1, importedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", importWarnings: [],
      legacyCompletions: [], workouts: [{ id: "A", title: "SHEET_ID_FIXTURE", description: "WORKOUT_NOTE_FIXTURE",
        blocks: [{ kind: "exercise", id: "one", section: "Strength", name: "SECRET", prescription: "3x10" }] }] }],
    sessions: [{ id: "session", planId: "plan", planVersion: 1, workoutId: "A", status: "completed",
      workoutSnapshot: { id: "A", title: "SHEET_ID_FIXTURE", description: "", blocks: [] },
      startedAt: "2026-10-04T08:00:00Z", completedAt: "2026-10-04T08:40:00Z", localDate: "2026-10-04",
      blocks: [{ blockId: "one", completed: true, actualLoad: "PRIVATE_LOAD_99" }],
      sessionNote: "WORKOUT_NOTE_FIXTURE", syncStatus: "notApplicable" }] };
    store.set("treino-social-preference-v1", JSON.stringify({ email: "private@example.invalid", accountId: "full-google-sub-SECRET", sharingEnabled: true }));
    store.set("treino-social-diagnostics-v1", JSON.stringify({ lastPublishResult: secrets[0] }));
    store.set("treino-push-diagnostics-v1", JSON.stringify({ endpoint: secrets[9], p256dh: secrets[10],
      auth: secrets[11], privateKey: secrets[12] }));
    const report = await collectDebugReport(data);
    const serialized = JSON.stringify(report);
    assert.equal(report.debugReportVersion, 1);
    for (const secret of secrets) assert(!serialized.includes(secret), `report leaked ${secret}`);
    assert(!serialized.includes("full-google-sub-SECRET"));
    assert(!serialized.includes("private response body"));
  } finally {
    for (const [key, value] of Object.entries(prior)) Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
