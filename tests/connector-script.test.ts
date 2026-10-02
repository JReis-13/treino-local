import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const key = "a".repeat(64);

async function fixture(options: { occupyOnGet?: boolean; discardWrite?: boolean } = {}) {
  const cells = new Map<string, { value: unknown; format: string }>();
  const put = (ref: string, value: unknown, format = "General") => cells.set(ref, { value, format });
  put("C1", "PLANO DE TREINO"); put("E4", "DIAS DE TREINO"); put("E18", "Aquecimento");
  put("E24", "Força"); put("E26", "Agachamento goblet");
  for (let row = 5; row <= 16; row++) { put(`D${row}`, `${row - 4}º`); put(`E${row}`, "", "dd/mm"); }
  const writes: string[] = [];
  const refFor = (row: number, col: number) => `${String.fromCharCode(64 + col)}${row}`;
  const get = (ref: string) => cells.get(ref) ?? { value: "", format: "General" };
  const range = (refs: string[][]) => ({
    getValues: () => refs.map((line) => line.map((ref) => get(ref).value)),
    getDisplayValues: () => refs.map((line) => line.map((ref) => get(ref).value instanceof Date ? "30/09" : String(get(ref).value))),
    getNumberFormats: () => refs.map((line) => line.map((ref) => get(ref).format)),
    getFormulas: () => refs.map((line) => line.map(() => "")),
    getRichTextValues: () => refs.map((line) => line.map(() => null)),
    getDisplayValue: () => String(get(refs[0][0]).value),
    getValue: () => { if (options.occupyOnGet) put(refs[0][0], new Date(Date.UTC(2026, 8, 1)), "dd/mm"); return get(refs[0][0]).value; },
    setValue: (value: unknown) => { writes.push(refs[0][0]); if (!options.discardWrite) put(refs[0][0], value, get(refs[0][0]).format); },
  });
  const sheet = {
    getName: () => "TREINO A", getSheetId: () => 42,
    getRange: (first: string | number, col?: number) => {
      if (typeof first === "number") return range([[refFor(first, col!)]]);
      if (!first.includes(":")) return range([[first]]);
      const [start, end] = first.split(":");
      const a = /^([A-Z]+)(\d+)$/.exec(start)!; const b = /^([A-Z]+)(\d+)$/.exec(end)!;
      const refs: string[][] = [];
      for (let row = Number(a[2]); row <= Number(b[2]); row++) {
        const line: string[] = [];
        for (let c = a[1].charCodeAt(0); c <= b[1].charCodeAt(0); c++) line.push(`${String.fromCharCode(c)}${row}`);
        refs.push(line);
      }
      return range(refs);
    },
  };
  let releases = 0;
  const sandbox = {
    Date, Number, JSON, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => key, setProperty: () => undefined }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getName: () => "Test Copy", getUrl: () => "https://docs.google.com/spreadsheets/d/copy",
      getSpreadsheetTimeZone: () => "UTC", getSheets: () => [sheet], getSheetByName: (name: string) => name === "TREINO A" ? sheet : null }), flush: () => undefined },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text: string) => ({ setMimeType: () => text }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { releases++; } }) },
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10), parseDate: (value: string) => new Date(`${value}T00:00:00Z`), getUuid: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(await readFile(join(process.cwd(), "google-apps-script", "WorkoutConnector.gs"), "utf8"), context);
  const request = (operation: string, payload?: object, credential = key) => JSON.parse(vm.runInContext(
    `doPost({postData:{contents:${JSON.stringify(JSON.stringify({ operation, payload, key: credential }))}}})`, context));
  return { request, put, writes, get releases() { return releases; } };
}

test("Apps Script connector limits operations and rejects wrong keys", async () => {
  const app = await fixture();
  assert.equal(app.request("ping", undefined, "bad").error.code, "UNAUTHORIZED");
  assert.equal(app.request("writeRange").error.code, "UNKNOWN_OPERATION");
  assert.deepEqual(app.request("ping").result.workoutSheets, ["TREINO A"]);
  assert.equal(app.writes.length, 0);
});

test("Apps Script connector writes one verified bounded date, then detects duplicate", async () => {
  const app = await fixture();
  const mappingId = app.request("getWorkbookSnapshot").result.mappingId;
  assert.match(mappingId, /^[0-9a-f]{8}$/);
  const payload = { workoutId: "A", localDate: "2026-09-30", mappingId };
  assert.equal(app.request("registerWorkoutCompletion", payload).result.status, "synced");
  assert.deepEqual(app.writes, ["E5"]);
  assert.equal(app.request("registerWorkoutCompletion", payload).result.status, "duplicate");
  assert.deepEqual(app.writes, ["E5"]);
  assert.equal(app.releases, 2);
});

test("Apps Script connector refuses drift, full grids and invalid dates without writing", async () => {
  const app = await fixture();
  const mappingId = app.request("getWorkbookSnapshot").result.mappingId;
  const payload = { workoutId: "A", localDate: "2026-09-30", mappingId };
  assert.equal(app.request("registerWorkoutCompletion", { ...payload, localDate: "2026-02-30" }).error.code, "BAD_REQUEST");
  app.put("E26", "Changed exercise");
  assert.equal(app.request("registerWorkoutCompletion", payload).error.code, "SOURCE_CHANGED");
  app.put("E26", "Agachamento goblet");
  for (let row = 5; row <= 16; row++) app.put(`E${row}`, new Date(Date.UTC(2026, 7, row)), "dd/mm");
  assert.equal(app.request("registerWorkoutCompletion", payload).result.status, "full");
  assert.equal(app.writes.length, 0);
});

test("Apps Script connector refuses a newly occupied slot and failed readback", async () => {
  const occupied = await fixture({ occupyOnGet: true });
  const mappingId = occupied.request("getWorkbookSnapshot").result.mappingId;
  const payload = { workoutId: "A", localDate: "2026-09-30", mappingId };
  assert.equal(occupied.request("registerWorkoutCompletion", payload).error.code, "OCCUPIED");
  assert.equal(occupied.writes.length, 0);
  const unverified = await fixture({ discardWrite: true });
  const otherMapping = unverified.request("getWorkbookSnapshot").result.mappingId;
  assert.equal(unverified.request("registerWorkoutCompletion", { ...payload, mappingId: otherMapping }).error.code, "VERIFY_FAILED");
  assert.deepEqual(unverified.writes, ["E5"]);
});
