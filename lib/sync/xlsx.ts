import JSZip from "jszip";
import { inspectWorkbook } from "@/lib/excel/adapter";
import { dateToSerial, snapshotFromXlsx, type SourceSnapshot } from "@/lib/import/snapshot";
import { parseTrainingSnapshot } from "@/lib/import/template-parser";
import { chooseCompletionSlot, type SyncDecision } from "@/lib/sync/logic";
import type { TrainingPlanRecord, TrainingSession } from "@/types/training";

export type XlsxSyncOutcome = { sessionId: string; decision: SyncDecision };

function dateValues(snapshot: SourceSnapshot, sheetName: string, slots: string[]): Array<string | null> {
  const sheet = snapshot.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`Source workout sheet ${sheetName} was removed.`);
  return slots.map((ref) => {
    const raw = sheet.cells[ref]?.raw;
    return raw ? new Date((Number(raw) - 25569) * 86400000).toISOString().slice(0, 10) : null;
  });
}

function replaceEmptyCell(xml: string, ref: string, serial: number): string {
  const match = /^E(\d+)$/.exec(ref);
  if (!match || Number(match[1]) < 5 || Number(match[1]) > 16) throw new Error(`Refusing source write outside E5:E16: ${ref}`);
  const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*>`, "g");
  const matches = [...xml.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one source cell ${ref}.`);
  const openTag = matches[0][0];
  const start = matches[0].index!;
  let original = openTag;
  if (!openTag.endsWith("/>")) {
    const close = xml.indexOf("</c>", start + openTag.length);
    if (close < 0) throw new Error(`Unclosed source cell ${ref}.`);
    original = xml.slice(start, close + 4);
    if (xml.slice(start + openTag.length, close).trim()) throw new Error(`Refusing occupied source cell ${ref}.`);
  }
  if (/\bt="(?!n")[^"]+"/.test(openTag)) throw new Error(`Refusing nonnumeric source cell ${ref}.`);
  const replacement = `${openTag.replace(/\s*\/>$/, ">")}<v>${serial}</v></c>`;
  return xml.slice(0, start) + replacement + xml.slice(start + original.length);
}

async function verifyPackage(before: JSZip, bytes: Uint8Array, changed: Map<string, string>): Promise<void> {
  const after = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const names = Object.keys(before.files).sort();
  if (names.join("|") !== Object.keys(after.files).sort().join("|")) throw new Error("Workbook package entries changed.");
  for (const path of names) {
    if (before.files[path].dir) continue;
    const expected = changed.has(path) ? new TextEncoder().encode(changed.get(path)!) : await before.file(path)!.async("uint8array");
    const actual = await after.file(path)!.async("uint8array");
    if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
      throw new Error(`Unrelated workbook content changed: ${path}`);
    }
  }
}

export async function prepareXlsxSync(bytes: Uint8Array, plan: TrainingPlanRecord, sessions: TrainingSession[]): Promise<{
  bytes?: Uint8Array; outcomes: XlsxSyncOutcome[]; snapshot: SourceSnapshot;
}> {
  if (plan.source.kind !== "excel") throw new Error("This plan is not connected to an Excel source.");
  if (!plan.sourceFingerprint && plan.source.template === "jonatha-v1") await inspectWorkbook(bytes);
  const snapshot = await snapshotFromXlsx(bytes);
  const parsed = parseTrainingSnapshot(snapshot, plan.source, plan.name);
  if (parsed.source.kind !== "excel" || parsed.source.template !== plan.source.template ||
      (plan.sourceFingerprint && parsed.sourceFingerprint !== plan.sourceFingerprint)) {
    throw new Error("The workbook plan changed. Refresh and review the training before syncing. No changes were made.");
  }
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const changed = new Map<string, string>();
  const outcomes: XlsxSyncOutcome[] = [];
  const dates = new Map<string, Array<string | null>>();
  for (const session of sessions) {
    if (session.status !== "completed" || !session.localDate) continue;
    const mapping = plan.source.mappings[session.workoutId];
    if (!mapping || JSON.stringify(mapping.slots) !== JSON.stringify(parsed.source.mappings[session.workoutId]?.slots)) {
      throw new Error("Source completion mapping changed. No changes were made.");
    }
    const current = dates.get(session.workoutId) ?? dateValues(snapshot, mapping.sheetName, mapping.slots);
    dates.set(session.workoutId, current);
    const decision = chooseCompletionSlot(mapping, current, session.localDate);
    outcomes.push({ sessionId: session.id, decision });
    if (decision.kind !== "write") continue;
    const sheet = snapshot.sheets.find((item) => item.name === mapping.sheetName)!;
    const path = sheet.path!;
    const xml = changed.get(path) ?? await zip.file(path)!.async("string");
    changed.set(path, replaceEmptyCell(xml, decision.slot, dateToSerial(session.localDate)));
    current[mapping.slots.indexOf(decision.slot)] = session.localDate;
  }
  if (!changed.size) return { outcomes, snapshot };
  for (const [path, xml] of changed) zip.file(path, xml, { createFolders: false });
  const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await verifyPackage(zip, output, changed);
  const reopened = await snapshotFromXlsx(output);
  const reparsed = parseTrainingSnapshot(reopened, plan.source, plan.name);
  if (reparsed.sourceFingerprint !== parsed.sourceFingerprint) throw new Error("Workbook plan changed while writing.");
  for (const [id, expected] of dates) {
    const mapping = plan.source.mappings[id];
    if (JSON.stringify(dateValues(reopened, mapping.sheetName, mapping.slots)) !== JSON.stringify(expected)) {
      throw new Error("Saved workbook dates could not be verified.");
    }
  }
  return { bytes: output, outcomes, snapshot: reopened };
}
