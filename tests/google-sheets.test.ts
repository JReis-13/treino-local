import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dateToSerial, snapshotFromXlsx, type GoogleGrid } from "../lib/import/snapshot";
import { readGoogleTraining, registerCompletion, sourceProof, writeGoogleLoads } from "../lib/google/sheets";
import { fixturePath } from "./fixture-path";

process.env.APP_BASE_URL = "http://localhost:3000";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_SESSION_SECRET = "a".repeat(64);
const spreadsheetId = "a".repeat(44);

async function fixtureGrid(filename = "TREINO 1 JONATHA.xlsx"): Promise<GoogleGrid> {
  const snapshot = await snapshotFromXlsx(new Uint8Array(await readFile(fixturePath(filename))));
  return { sheets: snapshot.sheets.filter((sheet) => /^TREINO\s/i.test(sheet.name)).map((sheet) => {
    const rows: Array<{ values: Array<Record<string, unknown>> }> = Array.from({ length: 45 }, () => ({ values: Array.from({ length: 13 }, () => ({})) }));
    for (const value of Object.values(sheet.cells)) {
      const match = /^([A-Z]+)(\d+)$/.exec(value.ref)!;
      const row = Number(match[2]) - 1;
      const col = [...match[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      if (row >= 45 || col >= 13) continue;
      const numeric = value.rawType === "n" || value.rawType === "" && value.raw && !Number.isNaN(Number(value.raw));
      rows[row].values[col] = { formattedValue: value.displayed,
        effectiveValue: value.raw ? numeric ? { numberValue: Number(value.raw) } : { stringValue: value.raw } : undefined,
        effectiveFormat: value.numberFormat ? { numberFormat: { pattern: value.numberFormat } } : undefined,
        hyperlink: value.hyperlink };
    }
    return { properties: { title: sheet.name, sheetId: sheet.sheetId! }, data: [{ startRow: 0, startColumn: 0, rowData: rows }] };
  }) };
}

test("Google grid adapter preserves parsed workouts, formatted loads and date slots", async () => {
  const grid = await fixtureGrid("TREINO 4 MILENA.xlsx");
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    return Response.json(url.includes("fields=") ? { properties: { title: "Milena" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "mock-access-token");
    assert.deepEqual(imported.workouts.map((workout) => workout.id), ["A", "B", "C"]);
    assert.equal(imported.legacyCompletions.length, 20);
    assert(imported.source.kind === "google");
    assert.deepEqual(imported.source.mappings.A.slots, Array.from({ length: 12 }, (_, i) => `E${i + 5}`));
    const block = imported.workouts[0].blocks.find((item) => item.kind === "exercise" && item.name === "Desenvolvimento na máquina");
    assert(block?.kind === "exercise");
    assert.equal(block.defaultLoad, "7.5");
  } finally { globalThis.fetch = oldFetch; }
});

test("completion write derives E5 from parser, verifies readback and reconciles duplicate", async () => {
  const grid = await fixtureGrid();
  let writeCount = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes(":batchUpdate")) {
      const body = JSON.parse(String(init?.body));
      const update = body.requests[0].updateCells;
      assert.equal(update.start.columnIndex, 4);
      assert.equal(update.start.rowIndex, 4);
      assert.equal(update.fields, "userEnteredValue");
      const cell = grid.sheets.find((sheet) => sheet.properties.sheetId === update.start.sheetId)!.data![0].rowData![4].values![4];
      cell.effectiveValue = { numberValue: update.rows[0].values[0].userEnteredValue.numberValue };
      cell.formattedValue = "02/10";
      writeCount++;
      return Response.json({ replies: [{}] });
    }
    return Response.json(url.includes("fields=") ? { properties: { title: "Jonatha" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "mock-access-token");
    const input = { spreadsheetId, sourceFingerprint: imported.sourceFingerprint,
      sourceProof: sourceProof(spreadsheetId, imported.sourceFingerprint), workoutId: "A", localDate: "2026-10-02" };
    assert.deepEqual(await registerCompletion(input, "mock-access-token"), { status: "synced", sourceSlot: "E5" });
    assert.equal(grid.sheets[0].data![0].rowData![4].values![4].effectiveValue?.numberValue, dateToSerial("2026-10-02"));
    assert.deepEqual(await registerCompletion(input, "mock-access-token"), { status: "duplicate" });
    assert.equal(writeCount, 1);
    await assert.rejects(() => registerCompletion({ ...input, sourceProof: "z".repeat(43) }, "mock-access-token"));
  } finally { globalThis.fetch = oldFetch; }
});

test("source drift blocks completion before any write", async () => {
  const grid = await fixtureGrid();
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(":batchUpdate")) { writes++; return Response.json({}); }
    return Response.json(url.includes("fields=") ? { properties: { title: "Jonatha" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "token");
    const cell = grid.sheets[0].data![0].rowData![25].values![4];
    cell.formattedValue = "Changed exercise";
    cell.effectiveValue = { stringValue: "Changed exercise" };
    await assert.rejects(() => registerCompletion({ spreadsheetId, sourceFingerprint: imported.sourceFingerprint,
      sourceProof: sourceProof(spreadsheetId, imported.sourceFingerprint), workoutId: "A", localDate: "2026-10-02" }, "token"), /structure changed/);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = original; }
});

test("uncertain timeout after Google write reconciles from readback", async () => {
  const grid = await fixtureGrid();
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes(":batchUpdate")) {
      const update = JSON.parse(String(init?.body)).requests[0].updateCells;
      const cell = grid.sheets[0].data![0].rowData![update.start.rowIndex].values![update.start.columnIndex];
      cell.effectiveValue = { numberValue: update.rows[0].values[0].userEnteredValue.numberValue };
      cell.formattedValue = "02/10";
      writes++;
      throw new Error("simulated response loss");
    }
    return Response.json(url.includes("fields=") ? { properties: { title: "Jonatha" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "token");
    const result = await registerCompletion({ spreadsheetId, sourceFingerprint: imported.sourceFingerprint,
      sourceProof: sourceProof(spreadsheetId, imported.sourceFingerprint), workoutId: "A", localDate: "2026-10-02" }, "token");
    assert.deepEqual(result, { status: "synced", sourceSlot: "E5" });
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test("Google load sync updates only the mapped slash segment and reconciles a lost response", async () => {
  const grid = await fixtureGrid();
  const original = globalThis.fetch;
  let writes = 0;
  const before = String(grid.sheets[0].data![0].rowData![25].values![7].formattedValue);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes(":batchUpdate")) {
      const update = JSON.parse(String(init?.body)).requests[0].updateCells;
      assert.deepEqual([update.start.rowIndex, update.start.columnIndex], [25, 7]);
      const value = update.rows[0].values[0].userEnteredValue.stringValue;
      const cell = grid.sheets[0].data![0].rowData![25].values![7];
      cell.effectiveValue = { stringValue: value }; cell.formattedValue = value;
      writes++;
      throw new Error("response lost after write");
    }
    return Response.json(url.includes("fields=") ? { properties: { title: "Jonatha" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "token");
    const block = imported.workouts[0].blocks.find((item) => item.kind === "exercise" && item.loadSource?.cell === "H26" && item.loadSource.part === 0);
    assert(block?.kind === "exercise");
    const next = "9.5";
    const request = { spreadsheetId, sourceFingerprint: imported.sourceFingerprint,
      sourceProof: sourceProof(spreadsheetId, imported.sourceFingerprint), workoutId: "A",
      changes: [{ blockId: block.id, expected: block.defaultLoad ?? "", load: next }] };
    const result = await writeGoogleLoads(request, "token");
    assert.equal(result.imported.workouts[0].blocks.find((item) => item.id === block.id)?.kind, "exercise");
    assert.equal(grid.sheets[0].data![0].rowData![25].values![7].formattedValue, `${next}/${before.split("/")[1].trim()}`);
    assert.equal(writes, 1);
    await writeGoogleLoads(request, "token");
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test("Google date-formatted decimal load is written as text and stale mapping writes nothing", async () => {
  const grid = await fixtureGrid("TREINO 4 MILENA.xlsx");
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes(":batchUpdate")) {
      const update = JSON.parse(String(init?.body)).requests[0].updateCells;
      assert.deepEqual([update.start.rowIndex, update.start.columnIndex], [27, 7]);
      assert.deepEqual(update.rows[0].values[0].userEnteredValue, { stringValue: "8.5" });
      const cell = grid.sheets[0].data![0].rowData![27].values![7];
      cell.effectiveValue = { stringValue: "8.5" }; cell.formattedValue = "8.5";
      writes++;
      return Response.json({ replies: [{}] });
    }
    return Response.json(url.includes("fields=") ? { properties: { title: "Milena" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "token");
    const block = imported.workouts[0].blocks.find((item) => item.kind === "exercise" && item.loadSource?.cell === "H28");
    assert(block?.kind === "exercise");
    const request = { spreadsheetId, sourceFingerprint: imported.sourceFingerprint,
      sourceProof: sourceProof(spreadsheetId, imported.sourceFingerprint), workoutId: "A",
      changes: [{ blockId: block.id, expected: block.defaultLoad ?? "", load: "8.5" }] };
    await assert.rejects(() => writeGoogleLoads({ ...request, sourceFingerprint: "f".repeat(8) }, "token"));
    assert.equal(writes, 0);
    await writeGoogleLoads(request, "token");
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test("explicit same-day Add writes a second date slot while ordinary retry reports duplicate", async () => {
  const grid = await fixtureGrid();
  const original = globalThis.fetch;
  const slots: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes(":batchUpdate")) {
      const update = JSON.parse(String(init?.body)).requests[0].updateCells;
      const row = update.start.rowIndex;
      slots.push(`E${row + 1}`);
      const cell = grid.sheets[0].data![0].rowData![row].values![4];
      cell.effectiveValue = { numberValue: update.rows[0].values[0].userEnteredValue.numberValue };
      cell.formattedValue = "02/10";
      return Response.json({ replies: [{}] });
    }
    return Response.json(url.includes("fields=") ? { properties: { title: "Jonatha" }, sheets: grid.sheets.map((sheet) => ({ properties: sheet.properties })) } : grid);
  };
  try {
    const { imported } = await readGoogleTraining(spreadsheetId, "token");
    const request = { spreadsheetId, sourceFingerprint: imported.sourceFingerprint,
      sourceProof: sourceProof(spreadsheetId, imported.sourceFingerprint), workoutId: "A", localDate: "2026-10-02" };
    assert.deepEqual(await registerCompletion(request, "token"), { status: "synced", sourceSlot: "E5" });
    assert.deepEqual(await registerCompletion(request, "token"), { status: "duplicate" });
    assert.deepEqual(await registerCompletion({ ...request, allowDuplicate: true }, "token"), { status: "synced", sourceSlot: "E6" });
    assert.deepEqual(slots, ["E5", "E6"]);
  } finally { globalThis.fetch = original; }
});
