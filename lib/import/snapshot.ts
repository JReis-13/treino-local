import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type Node = Record<string, unknown>;
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: false });
const object = (value: unknown): Node => value && typeof value === "object" ? value as Node : {};
const list = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const attribute = (node: Node, key: string): string => String(node[`@_${key}`] ?? "");
const parse = (xml: string): Node => object(xmlParser.parse(xml));

export interface SourceCell {
  ref: string;
  raw: string;
  displayed: string;
  rawType: string;
  numberFormat?: string;
  formula?: string;
  hyperlink?: string;
}
export interface SourceSheet {
  name: string;
  sheetId?: number;
  path?: string;
  cells: Record<string, SourceCell>;
}
export interface SourceSnapshot { sheets: SourceSheet[]; }
export const cell = (sheet: SourceSheet, ref: string): SourceCell | undefined => sheet.cells[ref];
export const display = (sheet: SourceSheet, ref: string): string => cell(sheet, ref)?.displayed ?? "";
export const serialToDate = (value: number): string => new Date((value - 25569) * 86400000).toISOString().slice(0, 10);
export const dateToSerial = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000 + 25569);
};

function text(node: unknown): string {
  const value = object(node);
  if (typeof value.t === "string") return value.t;
  if (typeof object(value.t)["#text"] === "string") return String(object(value.t)["#text"]);
  return list(value.r).map(text).join("");
}

function formatted(raw: string, format?: string): string {
  if (!raw || !format) return raw;
  const normalized = format.toLowerCase().replace(/"([^\"]*)"/g, "$1");
  if (/^d\.m$/.test(normalized)) {
    const date = serialToDate(Number(raw));
    return `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
  }
  if (/^dd\/mm$/.test(normalized)) {
    const date = serialToDate(Number(raw));
    return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  }
  return raw;
}

function styleFormats(doc: Node): string[] {
  const styles = object(doc.styleSheet);
  const custom = new Map(list(object(styles.numFmts).numFmt).map((item) => {
    const node = object(item);
    return [Number(attribute(node, "numFmtId")), attribute(node, "formatCode")];
  }));
  const builtin = new Map<number, string>([[14, "mm/dd/yy"], [15, "d-mmm-yy"], [16, "d-mmm"], [17, "mmm-yy"]]);
  return list(object(styles.cellXfs).xf).map((item) => {
    const id = Number(attribute(object(item), "numFmtId"));
    return custom.get(id) ?? builtin.get(id) ?? "General";
  });
}

function sheetLinks(sheetDoc: Node, relDoc: Node): Map<string, string> {
  const relations = new Map(list(object(relDoc.Relationships).Relationship).map((item) => {
    const relation = object(item);
    return [attribute(relation, "Id"), attribute(relation, "Target")];
  }));
  const result = new Map<string, string>();
  for (const item of list(object(object(sheetDoc.worksheet).hyperlinks).hyperlink)) {
    const link = object(item);
    const target = relations.get(attribute(link, "r:id")) ?? attribute(link, "location");
    if (target) result.set(attribute(link, "ref"), target);
  }
  return result;
}

async function entry(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Workbook package is missing ${path}.`);
  return file.async("string");
}

export async function snapshotFromXlsx(bytes: Uint8Array): Promise<SourceSnapshot> {
  if (bytes.byteLength > 20_000_000) throw new Error("This workbook is too large for the local importer.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error("The selected file is not a valid .xlsx workbook."); }
  const workbook = parse(await entry(zip, "xl/workbook.xml"));
  if (["1", "true"].includes(attribute(object(object(workbook.workbook).workbookPr), "date1904"))) {
    throw new Error("The 1904 Excel date system is not supported.");
  }
  const rels = parse(await entry(zip, "xl/_rels/workbook.xml.rels"));
  const relationships = new Map(list(object(rels.Relationships).Relationship).map((item) => {
    const relation = object(item);
    return [attribute(relation, "Id"), attribute(relation, "Target")];
  }));
  const shared = zip.file("xl/sharedStrings.xml") ? parse(await entry(zip, "xl/sharedStrings.xml")) : {};
  const strings = list(object(shared.sst).si).map(text);
  const formats = styleFormats(parse(await entry(zip, "xl/styles.xml")));
  const sheets: SourceSheet[] = [];
  for (const item of list(object(object(workbook.workbook).sheets).sheet)) {
    const sheetNode = object(item);
    const name = attribute(sheetNode, "name");
    const target = relationships.get(attribute(sheetNode, "r:id"));
    if (!target) throw new Error(`Missing worksheet relationship for ${name}.`);
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (!path.startsWith("xl/worksheets/") || path.includes("..")) throw new Error("Invalid worksheet relationship.");
    const sheetDoc = parse(await entry(zip, path));
    const relPath = path.replace("/worksheets/", "/worksheets/_rels/") + ".rels";
    const sheetRels = zip.file(relPath) ? parse(await entry(zip, relPath)) : {};
    const hyperlinks = sheetLinks(sheetDoc, sheetRels);
    const cells: Record<string, SourceCell> = {};
    for (const row of list(object(object(sheetDoc.worksheet).sheetData).row)) {
      for (const item of list(object(row).c)) {
        const node = object(item);
        const ref = attribute(node, "r");
        if (!ref) continue;
        const rawType = attribute(node, "t");
        const raw = rawType === "s" ? strings[Number(node.v)] ?? "" : rawType === "inlineStr" ? text(node.is) : node.v === undefined ? "" : String(node.v);
        const format = formats[Number(attribute(node, "s") || 0)];
        const value = rawType === "s" || rawType === "inlineStr" || rawType === "str" ? raw : formatted(raw, format);
        cells[ref] = { ref, raw, displayed: value, rawType, numberFormat: format, formula: node.f === undefined ? undefined : String(node.f), hyperlink: hyperlinks.get(ref) };
      }
    }
    sheets.push({ name, sheetId: Number(attribute(sheetNode, "sheetId")), path, cells });
  }
  return { sheets };
}

export interface GoogleCellData {
  formattedValue?: string;
  userEnteredValue?: { numberValue?: number; stringValue?: string; formulaValue?: string };
  effectiveValue?: { numberValue?: number; stringValue?: string };
  effectiveFormat?: { numberFormat?: { pattern?: string; type?: string } };
  userEnteredFormat?: { numberFormat?: { pattern?: string; type?: string } };
  hyperlink?: string;
  textFormatRuns?: Array<{ format?: { link?: { uri?: string } } }>;
}
export interface GoogleGridSheet {
  properties: { title: string; sheetId: number };
  data?: Array<{ startRow?: number; startColumn?: number; rowData?: Array<{ values?: GoogleCellData[] }> }>;
}
export interface GoogleGrid { sheets: GoogleGridSheet[]; }

function columnName(index: number): string {
  let value = index + 1; let result = "";
  while (value > 0) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

export function snapshotFromGoogle(grid: GoogleGrid): SourceSnapshot {
  return { sheets: grid.sheets.map((sheet) => {
    const cells: Record<string, SourceCell> = {};
    for (const chunk of sheet.data ?? []) {
      (chunk.rowData ?? []).forEach((row, rowIndex) => (row.values ?? []).forEach((value, columnIndex) => {
        const ref = `${columnName((chunk.startColumn ?? 0) + columnIndex)}${(chunk.startRow ?? 0) + rowIndex + 1}`;
        const effective = value.effectiveValue ?? value.userEnteredValue ?? {};
        const raw = effective.numberValue === undefined ? (effective.stringValue ?? "") : String(effective.numberValue);
        const displayed = value.formattedValue ?? raw;
        const hyperlink = value.hyperlink ?? value.textFormatRuns?.find((run) => run.format?.link?.uri)?.format?.link?.uri;
        const format = value.effectiveFormat?.numberFormat ?? value.userEnteredFormat?.numberFormat;
        const numberFormat = format?.pattern ?? (format?.type === "DATE" || format?.type === "DATE_TIME" ? "dd/mm" : undefined);
        if (raw || displayed || hyperlink || value.userEnteredValue?.formulaValue || numberFormat) cells[ref] = {
          ref, raw, displayed, rawType: effective.numberValue === undefined ? "s" : "n",
          numberFormat,
          formula: value.userEnteredValue?.formulaValue, hyperlink,
        };
      }));
    }
    return { name: sheet.properties.title, sheetId: sheet.properties.sheetId, cells };
  }) };
}
