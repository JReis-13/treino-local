import { createHmac, timingSafeEqual } from "node:crypto";
import { dateToSerial, snapshotFromGoogle, type GoogleGrid, type SourceSnapshot } from "@/lib/import/snapshot";
import { parseTrainingSnapshot } from "@/lib/import/template-parser";
import { isLocalDate } from "@/lib/dates";
import { googleConfig } from "@/lib/google/config";
import { GoogleError } from "@/lib/google/http";
import { validSpreadsheetId } from "@/lib/google/sheet-url";
import type { ImportedTraining } from "@/types/training";

type Meta = { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> };
const API = "https://sheets.googleapis.com/v4/spreadsheets/";
const MAX_RESPONSE = 3_000_000;
async function googleFetch(url: string, token: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new GoogleError("Google Sheets timed out. Your local workout is safe; retry sync.", 504, "retry"); }
  if (response.status === 401) throw new GoogleError("Google connection expired. Reconnect to continue syncing.", 401, "authRequired");
  if (response.status === 403) throw new GoogleError("This Google account does not have access to that spreadsheet or cannot edit it.", 403, "sourceUnavailable");
  if (response.status === 404) throw new GoogleError("This spreadsheet was not found or is unavailable to this Google account.", 404, "sourceUnavailable");
  if (!response.ok) throw new GoogleError("Google Sheets is temporarily unavailable. Your local workout is safe.", 502, "retry");
  const text = await response.text();
  if (text.length > MAX_RESPONSE) throw new GoogleError("This spreadsheet is too large for the supported workout template.", 413);
  try { return JSON.parse(text) as unknown; } catch { throw new GoogleError("Google Sheets returned an invalid response.", 502); }
}
export async function readGoogleTraining(spreadsheetId: string, token: string): Promise<{ imported: ImportedTraining; snapshot: SourceSnapshot; title: string }> {
  if (!validSpreadsheetId(spreadsheetId)) throw new GoogleError("Invalid spreadsheet ID.");
  const meta = await googleFetch(`${API}${spreadsheetId}?fields=properties(title),sheets(properties(title,sheetId))`, token) as Meta;
  const names = (meta.sheets ?? []).map((sheet) => sheet.properties?.title).filter((title): title is string => Boolean(title && /^TREINO\s/i.test(title)));
  if (!names.length || names.length > 8) throw new GoogleError("This spreadsheet format is not a supported workout template.");
  const params = new URLSearchParams({ includeGridData: "true" });
  for (const name of names) params.append("ranges", `'${name.replaceAll("'", "''")}'!A1:M45`);
  const grid = await googleFetch(`${API}${spreadsheetId}?${params}`, token) as GoogleGrid;
  if (!grid || !Array.isArray(grid.sheets)) throw new GoogleError("Google Sheets returned an invalid workbook.", 502);
  const snapshot = snapshotFromGoogle(grid);
  const title = meta.properties?.title?.slice(0, 200) || "Google Sheet";
  let imported: ImportedTraining;
  try { imported = parseTrainingSnapshot(snapshot, { kind: "google", filename: title, template: "", mappings: {},
    spreadsheetId, sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, authMode: "oauth", syncEnabled: true }, title); }
  catch { throw new GoogleError("This spreadsheet format is not a supported workout template.", 422, "unsupported"); }
  return { imported, snapshot, title };
}
function signature(spreadsheetId: string, fingerprint: string) {
  return createHmac("sha256", googleConfig().sessionSecret).update(`google-sheet-v1:${spreadsheetId}:${fingerprint}`).digest("base64url");
}
export function sourceProof(spreadsheetId: string, fingerprint: string) { return signature(spreadsheetId, fingerprint); }
export function validProof(spreadsheetId: string, fingerprint: string, proof: string) {
  const expected = Buffer.from(signature(spreadsheetId, fingerprint));
  const actual = Buffer.from(proof);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function registerCompletion(input: { spreadsheetId: string; sourceFingerprint: string; sourceProof: string;
  workoutId: string; localDate: string }, token: string): Promise<{ status: "synced" | "duplicate" | "full"; sourceSlot?: string }> {
  if (!validSpreadsheetId(input.spreadsheetId) || !/^[a-f0-9]{8}$/.test(input.sourceFingerprint) ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.sourceProof) || !validProof(input.spreadsheetId, input.sourceFingerprint, input.sourceProof) ||
    !/^[A-Za-z0-9 _-]{1,40}$/.test(input.workoutId) || !isLocalDate(input.localDate)) {
    throw new GoogleError("Invalid or unregistered training source.", 400, "conflict");
  }
  const current = await readGoogleTraining(input.spreadsheetId, token);
  if (current.imported.sourceFingerprint !== input.sourceFingerprint ||
    current.imported.warnings.some((item) => item.severity === "syncBlocker" || item.severity === "activationBlocker")) {
    throw new GoogleError("The spreadsheet structure changed. Your local workout is safe, but sync is paused.", 409, "conflict");
  }
  if (current.imported.source.kind !== "google") throw new GoogleError("Invalid source.", 409, "conflict");
  const mapping = current.imported.source.mappings[input.workoutId];
  if (!mapping || !Number.isInteger(mapping.sheetId)) throw new GoogleError("Workout tab changed. Your local workout is safe.", 409, "conflict");
  const existing = current.imported.legacyCompletions.filter((item) => item.workoutId === input.workoutId);
  if (existing.some((item) => item.date === input.localDate)) return { status: "duplicate" };
  const occupied = new Set(existing.map((item) => item.sourceSlot));
  const slot = mapping.slots.find((candidate) => !occupied.has(candidate));
  if (!slot) return { status: "full" };
  const match = /^([A-Z]+)(\d+)$/.exec(slot);
  if (!match || match[1] !== "E" || Number(match[2]) < 5 || Number(match[2]) > 16) throw new GoogleError("Invalid completion mapping.", 409, "conflict");
  // Sheets has no conditional cell update. Re-read just before writing and reconcile after uncertain failures.
  const latest = await readGoogleTraining(input.spreadsheetId, token);
  if (latest.imported.sourceFingerprint !== input.sourceFingerprint || latest.imported.source.kind !== "google") throw new GoogleError("Spreadsheet changed before sync.", 409, "conflict");
  const latestMapping = latest.imported.source.mappings[input.workoutId];
  if (!latestMapping || latestMapping.sheetId !== mapping.sheetId || latest.imported.legacyCompletions.some((item) => item.sourceSlot === slot && item.workoutId === input.workoutId)) {
    throw new GoogleError("Completion slot changed before sync.", 409, "conflict");
  }
  try {
    await googleFetch(`${API}${input.spreadsheetId}:batchUpdate`, token, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ updateCells: { start: { sheetId: mapping.sheetId, rowIndex: Number(match[2]) - 1, columnIndex: 4 },
        rows: [{ values: [{ userEnteredValue: { numberValue: dateToSerial(input.localDate) } }] }], fields: "userEnteredValue" } }] }) });
  } catch (cause) {
    try {
      const check = await readGoogleTraining(input.spreadsheetId, token);
      if (check.imported.legacyCompletions.some((item) => item.workoutId === input.workoutId && item.sourceSlot === slot && item.date === input.localDate)) {
        return { status: "synced", sourceSlot: slot };
      }
    } catch { /* Preserve original error. */ }
    throw cause;
  }
  const verified = await readGoogleTraining(input.spreadsheetId, token);
  if (!verified.imported.legacyCompletions.some((item) => item.workoutId === input.workoutId && item.sourceSlot === slot && item.date === input.localDate)) {
    throw new GoogleError("Google did not confirm the date. Your local workout remains complete; retry sync.", 502, "retry");
  }
  return { status: "synced", sourceSlot: slot };
}
