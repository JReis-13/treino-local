import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { inspectWorkbook, prepareWorkbookCopy, dateToExcelSerial, writeCompletionDateToSlot } from "../lib/excel/adapter";
import { SOURCE_WORKBOOK_SHA256 } from "../lib/excel/mapping";
import { startSession, finishSession } from "../lib/session";
import type { AppData, WorkoutId, WorkoutSession } from "../types/workout";
import { reviewedJonathaPath } from "./fixture-path";

const source = process.env.WORKBOOK_FIXTURE || reviewedJonathaPath();

async function disposable<T>(run: (bytes: Uint8Array, tempPath: string) => Promise<T>): Promise<T> {
  const before = createHash("sha256").update(await readFile(source!)).digest("hex").toUpperCase();
  const folder = await mkdtemp(join(tmpdir(), "treino-excel-"));
  const target = join(folder, basename(source!));
  const resolvedTemp = resolve(tmpdir()) + sep;
  if (!resolve(folder).startsWith(resolvedTemp) || resolve(target) === resolve(source!)) throw new Error("Unsafe test output path.");
  try {
    await copyFile(source!, target);
    return await run(new Uint8Array(await readFile(target)), target);
  } finally {
    await rm(folder, { recursive: true, force: true });
    const after = createHash("sha256").update(await readFile(source!)).digest("hex").toUpperCase();
    assert.equal(after, before, "Original workbook changed during tests");
  }
}

async function alterEntry(bytes: Uint8Array, path: string, change: (xml: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  zip.file(path, change(await zip.file(path)!.async("string")));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function seedDates(bytes: Uint8Array, id: WorkoutId, rows: number[]): Promise<Uint8Array> {
  const path = id === "A" ? "xl/worksheets/sheet2.xml" : "xl/worksheets/sheet3.xml";
  return alterEntry(bytes, path, (original) => rows.reduce((xml, row) => {
    const cell = new RegExp(`<c r="E${row}" s="(\\d+)"\\/>`);
    assert.match(xml, cell);
    return xml.replace(cell, `<c r="E${row}" s="$1"><v>${dateToExcelSerial(`2026-09-${String(row).padStart(2, "0")}`)}</v></c>`);
  }, original));
}

function completed(id: WorkoutId, date: string, sessionId = `${id}-${date}`): WorkoutSession {
  const created = startSession({ schemaVersion: 1, sessions: [] } satisfies AppData, id, new Date("2026-09-30T08:00:00Z"), sessionId);
  return finishSession(created.data, sessionId, date).sessions[0];
}

test("source workbook is the reviewed fixture and validates without trusting used range", async () => disposable(async (bytes) => {
  const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (!process.env.WORKBOOK_FIXTURE) assert.equal(hash, SOURCE_WORKBOOK_SHA256);
  const result = await inspectWorkbook(bytes);
  assert.equal(result.remaining.A, 12);
  assert.equal(result.remaining.B, 12);
  assert.equal(result.dates.B.length, 12);
}));

test("rejects changed dashboard formula and preserves source", async () => disposable(async (bytes) => {
  const changed = await alterEntry(bytes, "xl/worksheets/sheet1.xml", (xml) => xml.replace("E5:E16", "E5:E17"));
  await assert.rejects(inspectWorkbook(changed), /Dashboard formula/);
}));

test("writes first A and B slots as numeric Excel dates with dd/mm style", async () => disposable(async (bytes, tempPath) => {
  let updated = await writeCompletionDateToSlot(bytes, "A", "E5", "2026-09-30");
  updated = await writeCompletionDateToSlot(updated, "B", "E5", "2026-09-30");
  await writeFile(tempPath, updated); // disposable copy only
  const reopened = await inspectWorkbook(new Uint8Array(await readFile(tempPath)));
  assert.equal(reopened.dates.A[0], "2026-09-30");
  assert.equal(reopened.dates.B[0], "2026-09-30");
  const zip = await JSZip.loadAsync(updated, { checkCRC32: true });
  for (const path of ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]) {
    const xml = await zip.file(path)!.async("string");
    assert.match(xml, new RegExp(`<c r="E5" s="\\d+"><v>${dateToExcelSerial("2026-09-30")}<\\/v><\\/c>`));
  }
}));

test("uses a gap, rejects occupied cells and E17, and catches duplicates", async () => disposable(async (bytes) => {
  const withGap = await seedDates(bytes, "A", [5, 7]);
  const result = await prepareWorkbookCopy(withGap, [completed("A", "2026-09-30")]);
  assert.equal(result.outcomes[0].kind, "written");
  assert.equal(result.snapshot.dates.A[1], "2026-09-30");
  await assert.rejects(writeCompletionDateToSlot(withGap, "A", "E5", "2026-10-01"), /occupied/);
  await assert.rejects(writeCompletionDateToSlot(withGap, "A", "E17", "2026-10-01"), /outside E5:E16/);
  const duplicate = await prepareWorkbookCopy(withGap, [completed("A", "2026-09-05")]);
  assert.equal(duplicate.outcomes[0].kind, "alreadyPresent");
  assert.equal(duplicate.bytes, undefined);
}));

test("full 12-slot grid leaves completed local workout and workbook unchanged", async () => disposable(async (bytes) => {
  const full = await seedDates(bytes, "B", Array.from({ length: 12 }, (_, index) => index + 5));
  const session = completed("B", "2026-09-30");
  const result = await prepareWorkbookCopy(full, [session]);
  assert.equal(result.outcomes[0].kind, "full");
  assert.equal(result.bytes, undefined);
  assert.equal(session.status, "completed");
  assert.equal((await inspectWorkbook(full)).remaining.B, 0);
}));

test("one-cell change preserves every unrelated OOXML package entry", async () => disposable(async (bytes) => {
  const updated = await writeCompletionDateToSlot(bytes, "A", "E5", "2026-09-30");
  const before = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const after = await JSZip.loadAsync(updated, { checkCRC32: true });
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort());
  for (const path of Object.keys(before.files)) {
    if (before.files[path].dir || path === "xl/worksheets/sheet2.xml") continue;
    assert.deepEqual(await after.file(path)!.async("uint8array"), await before.file(path)!.async("uint8array"), path);
  }
  const originalSheet = await before.file("xl/worksheets/sheet2.xml")!.async("string");
  const modifiedSheet = await after.file("xl/worksheets/sheet2.xml")!.async("string");
  const reverted = modifiedSheet.replace(new RegExp(`<c r="E5" s="(\\d+)"><v>${dateToExcelSerial("2026-09-30")}<\\/v><\\/c>`), '<c r="E5" s="$1"/>');
  assert.equal(reverted, originalSheet, "Only the target cell XML may change");
  for (const path of ["xl/worksheets/sheet1.xml", "xl/styles.xml", "xl/sharedStrings.xml", "xl/tables/table1.xml", "xl/drawings/drawing1.xml", "xl/drawings/drawing2.xml", "xl/drawings/drawing3.xml"]) {
    assert(before.file(path) && after.file(path), `${path} preserved`);
  }
  assert(originalSheet.includes("#REF!") && modifiedSheet.includes("#REF!"), "Existing broken CF references stay intact");
  assert.equal((await inspectWorkbook(updated)).dates.A[0], "2026-09-30");
}));
