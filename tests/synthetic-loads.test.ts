import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { snapshotFromGoogle, snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining, refreshTraining } from "../lib/training/library";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { finishTrainingSession, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { lastUsedLoad } from "../lib/training/loads";
import { prepareXlsxSync } from "../lib/sync/xlsx";
import type { SourceSnapshot } from "../lib/import/snapshot";

const source = { kind: "excel" as const, filename: "synthetic-loads.xlsx", template: "", mappings: {}, mode: "copy" as const };
async function fixture(): Promise<SourceSnapshot> {
  return snapshotFromXlsx(new Uint8Array(await readFile("tests/fixtures/synthetic-loads.xlsx")));
}
const parse = (snapshot: SourceSnapshot) => parseTrainingSnapshot(snapshot, source, "Synthetic");
const strength = (imported: ReturnType<typeof parse>) => imported.workouts[0].blocks.filter((block) => block.kind === "exercise" && block.section === "Strength");

test("sanitized XLSX maps paired loads independently, preserves decimals, text, zero and blanks", async () => {
  const snapshot = await fixture();
  const sheet = snapshot.sheets[0];
  assert.equal(sheet.cells.H28.raw, "7.5");
  assert.equal(sheet.cells.H28.numberFormat, "d.m");
  const imported = parse(snapshot);
  assert.deepEqual(strength(imported).map((block) => block.kind === "exercise" ? block.defaultLoad : undefined),
    ["7.5", "12.5", "7.5", "0", undefined, "BW", "band"]);
  assert.deepEqual(strength(imported).slice(0, 2).map((block) => block.kind === "exercise" ? block.loadSource?.part : undefined), [0, 1]);
  assert(!imported.warnings.some((warning) => warning.severity === "activationBlocker"));
});

test("Jonatha separate G/H columns pair each load and retain an optional final strength row", async () => {
  const snapshot = await fixture();
  const sheet = snapshot.sheets[0];
  sheet.cells.G26 = { ref: "G26", raw: "15", displayed: "15", rawType: "n", numberFormat: "General" };
  sheet.cells.H26 = { ref: "H26", raw: "8", displayed: "8", rawType: "n", numberFormat: "General" };
  sheet.cells.E28 = { ...sheet.cells.E28, raw: "Exercise Gamma\nExercise Delta", displayed: "Exercise Gamma\nExercise Delta" };
  sheet.cells.F28 = { ...sheet.cells.F28, raw: "3 x 8\n3 x 8", displayed: "3 x 8\n3 x 8" };
  sheet.cells.G28 = { ref: "G28", raw: "20", displayed: "20", rawType: "n", numberFormat: "General" };
  sheet.cells.H28 = { ...sheet.cells.H28, raw: "25", displayed: "25", rawType: "n", numberFormat: "General" };
  sheet.cells.E34 = { ref: "E34", raw: "Exercise Theta", displayed: "Exercise Theta", rawType: "s", numberFormat: "General" };
  sheet.cells.F34 = { ref: "F34", raw: "2 x 10", displayed: "2 x 10", rawType: "s", numberFormat: "General" };
  sheet.cells.G34 = { ref: "G34", raw: "50", displayed: "50", rawType: "n", numberFormat: "General" };
  const imported = parse(snapshot);
  const select = (row: number) => imported.workouts[0].blocks.filter((block) => block.kind === "exercise" && block.sourceCell === `E${row}`);
  assert.deepEqual(select(26).map((block) => block.kind === "exercise" ? block.defaultLoad : undefined), ["15", "8"]);
  assert.deepEqual(select(26).map((block) => block.kind === "exercise" ? block.loadSource?.cell : undefined), ["G26", "H26"]);
  assert.deepEqual(select(28).map((block) => block.kind === "exercise" ? block.defaultLoad : undefined), ["20", "25"]);
  assert.deepEqual(select(34).map((block) => block.kind === "exercise" ? block.defaultLoad : undefined), ["50"]);
  assert(!imported.warnings.some((warning) => warning.code === "uncertain-load" && /26|28/.test(warning.location)));
});

test("Excel sync writes one separate load cell without changing its grouped neighbor", async () => {
  const bytes = new Uint8Array(await readFile("tests/fixtures/synthetic-adjacent-loads.xlsx"));
  const imported = parse(await snapshotFromXlsx(bytes));
  let data = addTraining(emptyTrainingData(), imported, undefined, "2026-10-03T08:00:00Z", "synthetic");
  const alpha = imported.workouts[0].blocks.find((block) => block.kind === "exercise" && block.name === "Exercise Alpha");
  assert(alpha?.kind === "exercise");
  data = startTrainingSession(data, "synthetic", "A", new Date("2026-10-03T09:00:00Z"), "one").data;
  data = updateTrainingBlock(data, "one", alpha.id, { completed: true, actualLoad: "16" });
  data = finishTrainingSession(data, "one", "2026-10-03", new Date("2026-10-03T09:45:00Z"));
  data.sessions[0].completionSyncStatus = "synced";
  const output = await prepareXlsxSync(bytes, data.plans[0], data.sessions);
  assert(output.bytes);
  const sheet = (await snapshotFromXlsx(output.bytes)).sheets[0];
  assert.equal(sheet.cells.G26.displayed, "16");
  assert.equal(sheet.cells.H26.displayed, "8");
});

test("XLSX and equivalent Google grid produce identical normalized loads", async () => {
  const snapshot = await fixture();
  const google = snapshotFromGoogle({ sheets: snapshot.sheets.map((sheet) => ({
    properties: { title: sheet.name, sheetId: sheet.sheetId ?? 0 },
    data: [{ rowData: Array.from({ length: 33 }, (_, row) => ({ values: Array.from({ length: 10 }, (_, col) => {
      const ref = `${String.fromCharCode(65 + col)}${row + 1}`;
      const cell = sheet.cells[ref];
      return cell ? { formattedValue: cell.displayed, effectiveValue: cell.rawType === "n" || cell.rawType === "" && /^\d/.test(cell.raw)
        ? { numberValue: Number(cell.raw) } : { stringValue: cell.raw },
        effectiveFormat: { numberFormat: { pattern: cell.numberFormat } } } : {};
    }) })) }] })) });
  assert.deepEqual(strength(parse(google)).map((block) => block.kind === "exercise" ? block.defaultLoad : undefined),
    strength(parse(snapshot)).map((block) => block.kind === "exercise" ? block.defaultLoad : undefined));
});

test("sanitized triple-column group keeps each load in its own logical exercise", async () => {
  const snapshot = await fixture();
  const sheet = snapshot.sheets[0];
  sheet.cells.J25 = { ...sheet.cells.I25, ref: "J25", raw: "Equipamento", displayed: "Equipamento" };
  sheet.cells.K25 = { ...sheet.cells.J25, ref: "K25", raw: "Vídeo", displayed: "Vídeo" };
  sheet.cells.E26 = { ...sheet.cells.E26, raw: "Exercise Alpha\nExercise Beta\nExercise Gamma",
    displayed: "Exercise Alpha\nExercise Beta\nExercise Gamma" };
  sheet.cells.G26 = { ref: "G26", raw: "7,5", displayed: "7,5", rawType: "s", numberFormat: "General" };
  sheet.cells.H26 = { ...sheet.cells.H26, raw: "10", displayed: "10" };
  sheet.cells.I26 = { ...sheet.cells.H26, ref: "I26", raw: "12.5", displayed: "12.5" };
  const group = strength(parse(snapshot)).filter((block) => block.sourceCell === "E26");
  assert.deepEqual(group.map((block) => block.kind === "exercise" ? block.defaultLoad : undefined), ["7.5", "10", "12.5"]);
  assert.deepEqual(group.map((block) => block.kind === "exercise" ? block.loadSource?.cell : undefined),
    ["G26", "H26", "I26"]);
});

test("a three-part grouped cell survives storage without assigning a neighbor's load", async () => {
  const snapshot = await fixture();
  const sheet = snapshot.sheets[0];
  sheet.cells.E26 = { ...sheet.cells.E26, raw: "Exercise Alpha\nExercise Beta\nExercise Gamma",
    displayed: "Exercise Alpha\nExercise Beta\nExercise Gamma" };
  sheet.cells.H26 = { ...sheet.cells.H26, raw: "7.5/10/12.5", displayed: "7.5/10/12.5" };
  const imported = parse(snapshot);
  const data = parseTrainingData(JSON.stringify(addTraining(emptyTrainingData(), imported)));
  const group = data.plans[0].workouts[0].blocks.filter((block) => block.kind === "exercise" && block.sourceCell === "E26");
  assert.deepEqual(group.map((block) => block.kind === "exercise" ? block.defaultLoad : undefined), ["7.5", "10", "12.5"]);
  assert.deepEqual(group.map((block) => block.kind === "exercise" ? block.loadSource?.part : undefined), [0, 1, 2]);
});

test("a load formula without a cached result is left blank and warned about", async () => {
  const snapshot = await fixture();
  snapshot.sheets[0].cells.H28 = { ...snapshot.sheets[0].cells.H28, raw: "", displayed: "", formula: "2+2" };
  const imported = parse(snapshot);
  const block = strength(imported).find((item) => item.sourceCell === "E28");
  assert(block?.kind === "exercise");
  assert.equal(block.defaultLoad, undefined);
  assert(imported.warnings.some((warning) => warning.code === "load-formula-no-cache"));
});

test("import, local storage, refresh and session keep Plan, Last and Today distinct", async () => {
  const imported = parse(await fixture());
  let data = addTraining(emptyTrainingData(), imported, undefined, "2026-10-08T08:00:00Z", "synthetic");
  data = parseTrainingData(JSON.stringify(data));
  const block = strength(imported)[0];
  assert(block.kind === "exercise");
  assert.equal(data.plans[0].workouts[0].blocks.find((item) => item.id === block.id)?.kind === "exercise" &&
    (data.plans[0].workouts[0].blocks.find((item) => item.id === block.id) as typeof block).defaultLoad, "7.5");
  let started = startTrainingSession(data, "synthetic", "A", new Date("2026-10-08T09:00:00Z"), "one");
  assert.equal(started.session.blocks.find((item) => item.blockId === block.id)?.actualLoad, "7.5");
  data = updateTrainingBlock(started.data, "one", block.id, { completed: true, actualLoad: "10" });
  data = finishTrainingSession(data, "one", "2026-10-08", new Date("2026-10-08T09:40:00Z"));
  assert.equal(lastUsedLoad(data, "synthetic", block.id), "10");
  const changed = await fixture();
  changed.sheets[0].cells.H26.raw = "8/12.5";
  changed.sheets[0].cells.H26.displayed = "8/12.5";
  data = refreshTraining(data, "synthetic", parse(changed));
  assert.equal((data.plans[0].workouts[0].blocks.find((item) => item.id === block.id) as typeof block).defaultLoad, "8");
  assert.equal(lastUsedLoad(data, "synthetic", block.id), "10");
  started = startTrainingSession(data, "synthetic", "A", new Date("2026-10-09T09:00:00Z"), "two");
  assert.equal(started.session.blocks.find((item) => item.blockId === block.id)?.actualLoad, "10");
  assert.equal((started.session.workoutSnapshot.blocks.find((item) => item.id === block.id) as typeof block).defaultLoad, "8");
});
