import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { assertUsableImport, layoutGuidance } from "../lib/import/validation";
import { addTraining } from "../lib/training/library";
import { emptyTrainingData } from "../lib/training/storage";

test("public synthetic audit workbook uses the real safe-copy import pipeline", async () => {
  const bytes = new Uint8Array(await readFile("tests/fixtures/mobile-audit.xlsx"));
  const packageData = await JSZip.loadAsync(bytes);
  const coreEntry = packageData.file("docProps/core.xml");
  const core = coreEntry ? await coreEntry.async("string") : "";
  assert(!/creator|lastModifiedBy|created|modified/.test(core));
  const snapshot = await snapshotFromXlsx(bytes);
  const imported = parseTrainingSnapshot(snapshot, { kind: "excel", filename: "mobile-audit.xlsx", template: "", mappings: {}, mode: "copy" }, "Synthetic audit");
  assertUsableImport(imported);
  const strength = imported.workouts[0].blocks.filter((block) => block.kind === "exercise" && block.section === "Strength");
  assert.deepEqual(strength.map((block) => block.kind === "exercise" ? block.defaultLoad : undefined),
    ["12kg", "12,5 kg", "2x8kg", "20kg (17,5 no final)", undefined, "16"]);
  assert.equal(imported.workouts[0].blocks.filter((block) => block.kind === "exercise").length, 9);
  assert.equal(imported.source.kind, "excel");
  assert.equal(imported.legacyCompletions[0]?.date, "2001-01-02");
  assert.equal(imported.warnings.filter((warning) => warning.severity === "syncBlocker").length, 0);
  assert.equal(addTraining(emptyTrainingData(), imported).plans.length, 1);
});
test("unsupported headers and zero usable workouts cannot activate a plan or show raw private content", () => {
  const snapshot = { sheets: [{ name: "Unsupported", cells: {
    A1: { ref: "A1", raw: "Exercise", displayed: "Exercise", rawType: "s" },
    B1: { ref: "B1", raw: "PRIVATE NOTE", displayed: "PRIVATE NOTE", rawType: "s" } }, merges: [] }] };
  assert.match(layoutGuidance(snapshot), /Recognized headers: Exercise/);
  assert(!layoutGuidance(snapshot).includes("PRIVATE NOTE"));
  assert.throws(() => parseTrainingSnapshot(snapshot, { kind: "excel", filename: "test.xlsx", template: "", mappings: {}, mode: "copy" }, "test"), /supported.*TREINO/);
  assert.throws(() => addTraining(emptyTrainingData(), { name: "test", source: { kind: "builtin", label: "Local" }, sourceFingerprint: "test", workouts: [], warnings: [], legacyCompletions: [] }), /cannot be activated/);
  const cells = Object.fromEntries(Object.entries({ C1: "PLANO DE TREINO", E4: "DIAS DE TREINO", E18: "AQUECIMENTO", E24: "FORÇA", I25: "EQUIPAMENTO", J25: "VÍDEO" })
    .map(([ref, raw]) => [ref, { ref, raw, displayed: raw, rawType: "s" }]));
  assert.throws(() => parseTrainingSnapshot({ sheets: [{ name: "TREINO A", cells }] }, { kind: "excel", filename: "empty.xlsx", template: "", mappings: {}, mode: "copy" }, "test"), /No usable workouts/);
});
