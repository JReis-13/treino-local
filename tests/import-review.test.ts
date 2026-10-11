import assert from "node:assert/strict";
import test from "node:test";
import { warningExercises } from "../lib/import/review-notes";
import type { ImportedTraining } from "../types/training";

const imported: ImportedTraining = { name: "Synthetic", sourceFingerprint: "synthetic", warnings: [], legacyCompletions: [],
  source: { kind: "excel", filename: "synthetic.xlsx", template: "test", mode: "copy", mappings: {
    A: { sheetName: "TREINO A", slots: [], ordinalCells: [] }, B: { sheetName: "TREINO B", slots: [], ordinalCells: [] } } },
  workouts: ["A", "B"].map((id) => ({ id, title: `Workout ${id}`, description: "", blocks: ["Alpha", "Beta"].map((name, index) => ({
    kind: "exercise" as const, id: `${id}-${index}`, name, section: "Strength", prescription: "3 x 10", sourceCell: "E28", defaultLoad: index ? undefined : "8" })) })) };
test("warning cells and grouped ranges resolve only their sheet's logical exercises without guessing loads", () => {
  for (const location of ["TREINO A!H28", "TREINO A!G28:I28", "TREINO A!28"]) {
    const result = warningExercises(imported, { code: "uncertain-load", message: "Review", severity: "warning", location });
    assert.deepEqual(result.map(({ block }) => block.id), ["A-0", "A-1"]);
    assert.equal(result[1].block.defaultLoad, undefined);
  }
  for (const location of ["OTHER!H28", "TREINO A!H29", "TREINO A", "invalid"]) assert.equal(
    warningExercises(imported, { code: "test", message: "Review", severity: "warning", location }).length, 0);
});
