import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining, migrateGoogleTraining } from "../lib/training/library";
import { finishTrainingSession, startTrainingSession } from "../lib/training/session";
import { emptyTrainingData } from "../lib/training/storage";
import { fixturePath } from "./fixture-path";

const spreadsheetId = "a".repeat(44);
async function setup(connectorVersion: 1 | 2) {
  const snapshot = await snapshotFromXlsx(new Uint8Array(await readFile(fixturePath("TREINO 1 JONATHA.xlsx"))));
  const old = parseTrainingSnapshot(snapshot, { kind: "google", filename: "Copy", template: "", mappings: {},
    connectorVersion, sourceMode: connectorVersion === 1 ? "bound" : "standalone",
    connectorUrl: "https://script.google.com/macros/s/legacy/exec", spreadsheetId, syncEnabled: true }, "Copy");
  const next = parseTrainingSnapshot(snapshot, { kind: "google", filename: "Copy", template: "", mappings: {},
    authMode: "oauth", spreadsheetId, sourceProof: "a".repeat(43), syncEnabled: true }, "Copy");
  const added = addTraining(emptyTrainingData(), old, undefined, "2026-10-02T00:00:00Z", "stable-id");
  const started = startTrainingSession(added, "stable-id", "A", new Date("2026-10-02T08:00:00Z"), "session-id");
  const data = finishTrainingSession(started.data, "session-id", "2026-10-02");
  data.plans[0].version = 3;
  return { data, next };
}
for (const connectorVersion of [1, 2] as const) {
  test(`legacy connector v${connectorVersion} migrates source without changing plan ID, version or session`, async () => {
    const { data, next } = await setup(connectorVersion);
    const migrated = migrateGoogleTraining(data, "stable-id", next);
    assert.equal(migrated.plans[0].id, "stable-id");
    assert.equal(migrated.plans[0].version, 3);
    assert.deepEqual(migrated.sessions, data.sessions);
    assert.deepEqual(migrated.plans[0].workouts, data.plans[0].workouts);
    assert(migrated.plans[0].source.kind === "google");
    assert.equal(migrated.plans[0].source.authMode, "oauth");
    assert.equal(migrated.plans[0].source.connectorUrl, undefined);
  });
}
test("failed legacy migration leaves original data intact", async () => {
  const { data, next } = await setup(2);
  assert(next.source.kind === "google");
  next.source.spreadsheetId = "b".repeat(44);
  assert.throws(() => migrateGoogleTraining(data, "stable-id", next), /identity/);
  assert.equal(data.plans[0].source.kind, "google");
  if (data.plans[0].source.kind === "google") assert.equal(data.plans[0].source.connectorVersion, 2);
});
