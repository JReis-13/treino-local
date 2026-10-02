import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from "../lib/training/backup";
import { spreadsheetIdFromUrl } from "../lib/connector/sheet-url";
import { safeVideoUrl } from "../lib/video-url";
import type { TrainingData } from "../types/training";

const id = "a12345678901234567890123";
const data: TrainingData = { schemaVersion: 2, activePlanId: "p", sessions: [], plans: [{
  id: "p", name: "Test", source: { kind: "google", filename: "Copy", template: "jonatha-v1", mappings: {},
    connectorVersion: 2, sourceMode: "standalone", spreadsheetId: id, connectorUrl: "https://script.google.com/macros/s/secret/exec",
    sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, syncEnabled: true },
  version: 2, importedAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z",
  workouts: [{ id: "A", title: "Workout A", description: "", blocks: [{ kind: "instruction", id: "warmup", section: "Warm-up", heading: "Warm-up", text: "Test" }] }],
  importWarnings: [], legacyCompletions: [],
}] };

test("backup restores plans and history without exporting connector endpoint", () => {
  const raw = createBackup(data, "2026-10-02T00:00:00Z");
  assert(!raw.includes("script.google.com"));
  const restored = parseBackup(raw).data;
  assert.equal(restored.plans[0].version, 2);
  assert.equal(restored.plans[0].source.kind, "google");
  if (restored.plans[0].source.kind === "google") {
    assert.equal(restored.plans[0].source.connectorUrl, undefined);
    assert.equal(restored.plans[0].source.syncEnabled, false);
    assert.equal(restored.plans[0].source.spreadsheetId, id);
  }
});

test("OAuth plan backup retains Sheet identity but removes signed write proof and disables sync", () => {
  const oauth: TrainingData = { ...data, plans: data.plans.map((plan) => ({ ...plan,
    source: { kind: "google" as const, filename: "Copy", template: "jonatha-v1", mappings: {},
      authMode: "oauth" as const, spreadsheetId: id, sourceProof: "a".repeat(43), syncEnabled: true,
      refreshToken: "do-not-export" } as TrainingData["plans"][number]["source"] })) };
  const raw = createBackup(oauth);
  assert(!raw.includes("sourceProof"));
  assert(!raw.includes("do-not-export"));
  const restored = parseBackup(raw).data.plans[0];
  assert.equal(restored.version, data.plans[0].version);
  assert.equal(restored.source.kind, "google");
  if (restored.source.kind === "google") {
    assert.equal(restored.source.spreadsheetId, id);
    assert.equal(restored.source.authMode, "oauth");
    assert.equal(restored.source.syncEnabled, false);
  }
});

test("malformed, oversized, and unsafe backups are rejected before restore", () => {
  assert.throws(() => parseBackup("{"), /valid JSON/);
  assert.throws(() => parseBackup("x".repeat(MAX_BACKUP_BYTES + 1)), /too large/);
  assert.throws(() => parseBackup('{"format":"treino-local-backup","version":1,"createdAt":"2026-10-02T00:00:00Z","data":{"__proto__":{}}}'), /unsafe/);
  assert.throws(() => parseBackup(JSON.stringify({ format: "treino-local-backup", version: 1, createdAt: "2026-10-02T00:00:00Z", data: { schemaVersion: 2, plans: [], sessions: [{ bad: true }] } })), /invalid/);
});

test("Sheet and video URLs reject alternate hosts, protocols, and script links", () => {
  assert.equal(spreadsheetIdFromUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  for (const value of [`https://docs.google.com.evil.test/spreadsheets/d/${id}/edit`, `https://docs.google.com/document/d/${id}/edit`,
    `http://docs.google.com/spreadsheets/d/${id}/edit`, `https://evil@docs.google.com/spreadsheets/d/${id}/edit`])
    assert.throws(() => spreadsheetIdFromUrl(value));
  assert.equal(safeVideoUrl("javascript:alert(1)"), undefined);
  assert.equal(safeVideoUrl("https://youtube.com.evil.test/watch?v=abc"), undefined);
  assert.match(safeVideoUrl("https://www.youtube.com/shorts/spjnmreGb7U")!, /youtube/);
});
