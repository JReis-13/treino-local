import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { WORKOUTS } from "@/data/workouts";
import { isLocalDate } from "@/lib/dates";
import { DATE_SLOTS, EXCEL_MAPPING } from "@/lib/excel/mapping";
import type { WorkoutId, WorkoutSession } from "@/types/workout";

type XmlObject = Record<string, unknown>;
type SheetState = { path: string; xml: string; cells: Map<string, XmlObject>; hyperlinks: Map<string, string> };

export interface WorkbookSnapshot {
  filename?: string;
  dates: Record<WorkoutId, Array<string | null>>;
  remaining: Record<WorkoutId, number>;
}

export type SyncOutcome = { sessionId: string; kind: "written" | "alreadyPresent" | "full"; message?: string };

export class WorkbookCompatibilityError extends Error {
  constructor(detail: string) {
    super(`This workbook appears to be a different version of the workout plan. No changes were made. ${detail}`);
    this.name = "WorkbookCompatibilityError";
  }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: false });
const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const obj = (value: unknown): XmlObject => value && typeof value === "object" ? value as XmlObject : {};
const attr = (value: XmlObject, name: string): string => String(value[`@_${name}`] ?? "");
const parseXml = (xml: string): XmlObject => obj(parser.parse(xml));

async function textEntry(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new WorkbookCompatibilityError(`Missing package entry ${path}.`);
  return entry.async("string");
}

function resolveTarget(target: string): string {
  const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  if (!normalized.startsWith("xl/worksheets/") || normalized.includes("..")) {
    throw new WorkbookCompatibilityError("Unexpected worksheet relationship path.");
  }
  return normalized;
}

function cellMap(sheetDoc: XmlObject): Map<string, XmlObject> {
  const cells = new Map<string, XmlObject>();
  for (const row of asArray(obj(obj(sheetDoc.worksheet).sheetData).row)) {
    for (const cell of asArray(obj(row).c)) {
      const node = obj(cell);
      const ref = attr(node, "r");
      if (cells.has(ref)) throw new WorkbookCompatibilityError(`Duplicate cell ${ref}.`);
      cells.set(ref, node);
    }
  }
  return cells;
}

function sharedText(node: unknown): string {
  const value = obj(node);
  if (typeof value.t === "string") return value.t;
  if (value.t && typeof obj(value.t)["#text"] === "string") return String(obj(value.t)["#text"]);
  return asArray(value.r).map((part) => sharedText(part)).join("");
}

function displayValue(cell: XmlObject | undefined, strings: string[]): string {
  if (!cell) return "";
  const type = attr(cell, "t");
  if (type === "s") return strings[Number(cell.v)] ?? "";
  if (type === "inlineStr") return sharedText(cell.is);
  return cell.v === undefined ? "" : String(cell.v);
}

function getSheetLinks(sheetDoc: XmlObject, relsDoc: XmlObject): Map<string, string> {
  const rels = new Map(asArray(obj(relsDoc.Relationships).Relationship).map((item) => {
    const relation = obj(item);
    return [attr(relation, "Id"), attr(relation, "Target")];
  }));
  const links = new Map<string, string>();
  for (const item of asArray(obj(obj(sheetDoc.worksheet).hyperlinks).hyperlink)) {
    const link = obj(item);
    const target = rels.get(attr(link, "r:id"));
    if (target) links.set(attr(link, "ref"), target);
  }
  return links;
}

function styleIsDayMonth(stylesDoc: XmlObject, cell: XmlObject): boolean {
  const styleIndex = Number(attr(cell, "s"));
  const styles = obj(stylesDoc.styleSheet);
  const xfs = asArray(obj(styles.cellXfs).xf);
  const xf = obj(xfs[styleIndex]);
  const id = Number(attr(xf, "numFmtId"));
  const formats = asArray(obj(styles.numFmts).numFmt);
  const format = formats.find((item) => Number(attr(obj(item), "numFmtId")) === id);
  return attr(obj(format), "formatCode").toLowerCase() === "dd/mm";
}

function serialToDate(serial: number): string {
  if (!Number.isInteger(serial) || serial < 1) throw new WorkbookCompatibilityError("A completion slot contains an invalid date serial.");
  const date = new Date((serial - 25569) * 86400000);
  if (!Number.isFinite(date.getTime())) throw new WorkbookCompatibilityError("A completion slot contains an invalid date.");
  return date.toISOString().slice(0, 10);
}

export function dateToExcelSerial(date: string): number {
  if (!isLocalDate(date)) throw new Error(`Invalid local date: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000 + 25569);
}

class LoadedWorkbook {
  constructor(
    readonly zip: JSZip,
    readonly sheets: Record<"JONATHA" | "TREINO A" | "TREINO B", SheetState>,
    readonly snapshot: WorkbookSnapshot,
  ) {}
}

async function loadWorkbook(bytes: Uint8Array): Promise<LoadedWorkbook> {
  if (bytes.byteLength > 20_000_000) throw new WorkbookCompatibilityError("Workbook is too large for this local adapter.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new WorkbookCompatibilityError("The file is not a valid .xlsx package."); }
  const workbookDoc = parseXml(await textEntry(zip, "xl/workbook.xml"));
  if (["1", "true"].includes(attr(obj(obj(workbookDoc.workbook).workbookPr), "date1904"))) {
    throw new WorkbookCompatibilityError("The 1904 date system is not supported by this mapping.");
  }
  const relsDoc = parseXml(await textEntry(zip, "xl/_rels/workbook.xml.rels"));
  const relationships = new Map(asArray(obj(relsDoc.Relationships).Relationship).map((item) => {
    const relation = obj(item);
    return [attr(relation, "Id"), attr(relation, "Target")];
  }));
  const sheetNodes = asArray(obj(obj(workbookDoc.workbook).sheets).sheet).map(obj);
  const expected = ["JONATHA", "TREINO A", "TREINO B"] as const;
  if (sheetNodes.length !== 3 || expected.some((name) => !sheetNodes.some((sheet) => attr(sheet, "name") === name))) {
    throw new WorkbookCompatibilityError("Expected worksheets JONATHA, TREINO A, and TREINO B.");
  }
  const stringsDoc = parseXml(await textEntry(zip, "xl/sharedStrings.xml"));
  const strings = asArray(obj(stringsDoc.sst).si).map(sharedText);
  const stylesDoc = parseXml(await textEntry(zip, "xl/styles.xml"));
  const sheets = {} as LoadedWorkbook["sheets"];
  for (const name of expected) {
    const sheetNode = sheetNodes.find((sheet) => attr(sheet, "name") === name)!;
    const target = relationships.get(attr(sheetNode, "r:id"));
    if (!target) throw new WorkbookCompatibilityError(`Missing relationship for ${name}.`);
    const path = resolveTarget(target);
    const xml = await textEntry(zip, path);
    const doc = parseXml(xml);
    const relPath = path.replace("/worksheets/", "/worksheets/_rels/") + ".rels";
    const rels = zip.file(relPath) ? parseXml(await textEntry(zip, relPath)) : {};
    sheets[name] = { path, xml, cells: cellMap(doc), hyperlinks: getSheetLinks(doc, rels) };
  }
  const dashboard = sheets.JONATHA.cells;
  for (const id of ["A", "B"] as const) {
    const mapping = EXCEL_MAPPING[id];
    const formula = String(dashboard.get(mapping.counterCell)?.f ?? "").replace(/\s/g, "");
    if (formula !== mapping.counterFormula.replace(/\s/g, "")) {
      throw new WorkbookCompatibilityError(`Dashboard formula ${mapping.counterCell} changed.`);
    }
    const sheet = sheets[mapping.sheet as "TREINO A" | "TREINO B"];
    if (displayValue(sheet.cells.get("B3"), strings) !== `TREINO ${id}` ||
        !displayValue(sheet.cells.get("E18"), strings).includes("AQUECIMENTO") ||
        !displayValue(sheet.cells.get("E24"), strings).includes("FORÇA")) {
      throw new WorkbookCompatibilityError(`${mapping.sheet} workout markers changed.`);
    }
    const plan = WORKOUTS[id];
    for (let index = 0; index < 3; index++) {
      const ref = `E${20 + index}`;
      if (displayValue(sheet.cells.get(ref), strings).trim() !== plan.exercises[index].name ||
          sheet.hyperlinks.get(`G${20 + index}`) !== plan.exercises[index].videoUrl) {
        throw new WorkbookCompatibilityError(`${mapping.sheet} warm-up or video at row ${20 + index} changed.`);
      }
    }
    for (let pair = 0; pair < 4; pair++) {
      const row = 26 + pair * 2;
      const names = displayValue(sheet.cells.get(`E${row}`), strings).split("\n").map((value) => value.trim().replace(/\s+/g, " "));
      const pairExercises = plan.exercises.slice(3 + pair * 2, 5 + pair * 2);
      if (names.length !== 2 || names.some((name, index) => name !== pairExercises[index].name) ||
          sheet.hyperlinks.get(`J${row}`) !== pairExercises[0].videoUrl ||
          sheet.hyperlinks.get(`K${row}`) !== pairExercises[1].videoUrl) {
        throw new WorkbookCompatibilityError(`${mapping.sheet} exercise pair or video at row ${row} changed.`);
      }
    }
    for (let index = 0; index < DATE_SLOTS.length; index++) {
      const row = index + 5;
      const dateCell = sheet.cells.get(DATE_SLOTS[index]);
      if (!dateCell || !styleIsDayMonth(stylesDoc, dateCell) ||
          displayValue(sheet.cells.get(`D${row}`), strings) !== `${index + 1}º` ||
          Number(displayValue(sheet.cells.get(`G${row}`), strings)) !== plan.rirByOccurrence[index]) {
        throw new WorkbookCompatibilityError(`${mapping.sheet} date/RIR grid changed at row ${row}.`);
      }
    }
  }
  const dates = {} as WorkbookSnapshot["dates"];
  const remaining = {} as WorkbookSnapshot["remaining"];
  for (const id of ["A", "B"] as const) {
    const cells = sheets[EXCEL_MAPPING[id].sheet as "TREINO A" | "TREINO B"].cells;
    dates[id] = DATE_SLOTS.map((ref) => {
      const cell = cells.get(ref)!;
      const value = displayValue(cell, strings);
      if (value === "") return null;
      if (attr(cell, "t") && attr(cell, "t") !== "n") throw new WorkbookCompatibilityError(`${EXCEL_MAPPING[id].sheet}!${ref} is not a numeric Excel date.`);
      return serialToDate(Number(value));
    });
    remaining[id] = dates[id].filter((date) => date === null).length;
  }
  return new LoadedWorkbook(zip, sheets, { dates, remaining });
}

function replaceEmptyCell(xml: string, ref: string, serial: number): string {
  if (!DATE_SLOTS.includes(ref)) throw new Error(`Refusing to write outside E5:E16: ${ref}`);
  const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*>`, "g");
  const matches = [...xml.matchAll(pattern)];
  if (matches.length !== 1) throw new WorkbookCompatibilityError(`Expected exactly one ${ref} cell.`);
  const openTag = matches[0][0];
  const start = matches[0].index!;
  let original = openTag;
  if (!openTag.endsWith("/>")) {
    const close = xml.indexOf("</c>", start + openTag.length);
    if (close < 0) throw new WorkbookCompatibilityError(`Unclosed cell ${ref}.`);
    original = xml.slice(start, close + 4);
    if (xml.slice(start + openTag.length, close).trim() !== "") throw new Error(`Refusing to overwrite occupied cell ${ref}.`);
  }
  if (/\bt="(?!n")[^"]+"/.test(openTag)) throw new Error(`Refusing nonnumeric cell ${ref}.`);
  const replacement = `${openTag.replace(/\s*\/>$/, ">")}<v>${serial}</v></c>`;
  return xml.slice(0, start) + replacement + xml.slice(start + original.length);
}

async function generateAndVerify(loaded: LoadedWorkbook, changed: Map<string, string>): Promise<Uint8Array> {
  for (const [path, xml] of changed) loaded.zip.file(path, xml, { createFolders: false });
  const generated = await loaded.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const originalZip = loaded.zip;
  const generatedZip = await JSZip.loadAsync(generated, { checkCRC32: true });
  const names = Object.keys(originalZip.files).filter((name) => !originalZip.files[name].dir).sort();
  if (names.join("|") !== Object.keys(generatedZip.files).filter((name) => !generatedZip.files[name].dir).sort().join("|")) {
    throw new Error("Workbook package entries changed unexpectedly.");
  }
  for (const path of names) {
    const actual = await generatedZip.file(path)!.async("uint8array");
    const expected = changed.has(path) ? new TextEncoder().encode(changed.get(path)!) : await originalZip.file(path)!.async("uint8array");
    if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
      throw new Error(`Workbook package entry ${path} changed unexpectedly.`);
    }
  }
  await loadWorkbook(generated);
  return generated;
}

export async function inspectWorkbook(bytes: Uint8Array): Promise<WorkbookSnapshot> {
  return (await loadWorkbook(bytes)).snapshot;
}

export async function writeCompletionDateToSlot(bytes: Uint8Array, id: WorkoutId, ref: string, date: string): Promise<Uint8Array> {
  const loaded = await loadWorkbook(bytes);
  if (!DATE_SLOTS.includes(ref)) throw new Error(`Refusing to write outside E5:E16: ${ref}`);
  const index = DATE_SLOTS.indexOf(ref);
  if (loaded.snapshot.dates[id][index] !== null) throw new Error(`Refusing to overwrite occupied cell ${ref}.`);
  const sheet = loaded.sheets[EXCEL_MAPPING[id].sheet as "TREINO A" | "TREINO B"];
  const changed = new Map([[sheet.path, replaceEmptyCell(sheet.xml, ref, dateToExcelSerial(date))]]);
  const output = await generateAndVerify(loaded, changed);
  if ((await inspectWorkbook(output)).dates[id][index] !== date) throw new Error("Written workbook date could not be verified.");
  return output;
}

export async function prepareWorkbookCopy(bytes: Uint8Array, sessions: WorkoutSession[]): Promise<{ bytes?: Uint8Array; outcomes: SyncOutcome[]; snapshot: WorkbookSnapshot }> {
  const loaded = await loadWorkbook(bytes);
  const dates: WorkbookSnapshot["dates"] = { A: [...loaded.snapshot.dates.A], B: [...loaded.snapshot.dates.B] };
  const changed = new Map<string, string>();
  const outcomes: SyncOutcome[] = [];
  for (const session of sessions) {
    if (session.status !== "completed" || !session.localDate || !isLocalDate(session.localDate)) continue;
    const id = session.workoutId;
    if (dates[id].includes(session.localDate)) {
      outcomes.push({ sessionId: session.id, kind: "alreadyPresent", message: "This workout/date already exists in Excel; no duplicate was written." });
      continue;
    }
    const index = dates[id].findIndex((value) => value === null);
    if (index < 0) {
      outcomes.push({ sessionId: session.id, kind: "full", message: `All 12 ${id} date slots are full. The local workout is safe.` });
      continue;
    }
    const sheet = loaded.sheets[EXCEL_MAPPING[id].sheet as "TREINO A" | "TREINO B"];
    const currentXml = changed.get(sheet.path) ?? sheet.xml;
    changed.set(sheet.path, replaceEmptyCell(currentXml, DATE_SLOTS[index], dateToExcelSerial(session.localDate)));
    dates[id][index] = session.localDate;
    outcomes.push({ sessionId: session.id, kind: "written" });
  }
  if (changed.size === 0) return { outcomes, snapshot: loaded.snapshot };
  const output = await generateAndVerify(loaded, changed);
  const snapshot = await inspectWorkbook(output);
  if (JSON.stringify(snapshot.dates) !== JSON.stringify(dates)) throw new Error("Updated workbook dates did not verify.");
  return { bytes: output, outcomes, snapshot };
}
