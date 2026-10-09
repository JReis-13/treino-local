import assert from "node:assert/strict";
import test from "node:test";
import { exerciseNote, updateExerciseNote } from "../lib/training/exercise-notes";
import { addTraining, refreshTraining } from "../lib/training/library";
import { createBackup, parseBackup } from "../lib/training/backup";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import type { ImportedTraining } from "../types/training";

const sheet = "A_credible_sheet_identity_12345";
const imported = (spreadsheetId: string, secondEquipment = "Barbell"): ImportedTraining => ({
  name: "Training", source: { kind: "google", filename: "Training", template: "generic", mappings: {},
    spreadsheetId, authMode: "oauth" }, sourceFingerprint: "source-layout",
  warnings: [], legacyCompletions: [], workouts: [
    { id: "A", title: "Workout A", description: "", blocks: [{ kind: "exercise", id: "a1", section: "Strength",
      name: "Hip thrust", equipment: "Barbell", prescription: "3x10" }] },
    { id: "B", title: "Workout B", description: "", blocks: [{ kind: "exercise", id: "b1", section: "Strength",
      name: "Hip thrust", equipment: secondEquipment, prescription: "4x8" }] },
  ],
});

test("persistent note survives a session, plan refresh, reimport and backup without leaking to unrelated plans", () => {
  let data = addTraining(emptyTrainingData(), imported(sheet), undefined, "2026-10-01T00:00:00Z", "first");
  data = updateExerciseNote(data, "first", "Hip thrust", "Keep shoulders stable");
  assert.equal(exerciseNote(data, "first", "Hip thrust"), "Keep shoulders stable");
  data = refreshTraining(data, "first", imported(sheet));
  data = parseTrainingData(JSON.stringify(data));
  assert.equal(exerciseNote(data, "first", "Hip thrust"), "Keep shoulders stable");
  data = addTraining(data, imported(sheet), undefined, "2026-10-02T00:00:00Z", "reimported");
  assert.equal(exerciseNote(data, "reimported", "Hip thrust"), "Keep shoulders stable");
  data = addTraining(data, imported("different_sheet_identity_12345"), undefined,
    "2026-10-02T00:00:00Z", "unrelated");
  assert.equal(exerciseNote(data, "unrelated", "Hip thrust"), "");
  assert.equal(exerciseNote(parseBackup(createBackup(data)).data, "first", "Hip thrust"), "Keep shoulders stable");
});

test("cross-plan note lookup declines equipment variants and preserves old note entries", () => {
  let data = addTraining(emptyTrainingData(), imported(sheet), undefined, "2026-10-01T00:00:00Z", "first");
  data = updateExerciseNote(data, "first", "Hip thrust", "Original note");
  const oldNotes = structuredClone(data.exerciseNotes);
  data = addTraining(data, imported(sheet, "Machine"), undefined, "2026-10-02T00:00:00Z", "variant");
  assert.equal(exerciseNote(data, "variant", "Hip thrust"), "");
  assert.deepEqual(data.exerciseNotes, oldNotes);
});
