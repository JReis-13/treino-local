import type { SourceSnapshot } from "@/lib/import/snapshot";
import { spreadsheetIdFromUrl } from "@/lib/connector/sheet-url";

export interface ConnectorPing { spreadsheetName: string; sheetUrl: string; workoutSheets: string[]; }
export interface ConnectorWorkbook { spreadsheetName: string; sheetUrl: string; mappingId: string; snapshot: SourceSnapshot; }
export interface ConnectorRegistration { status: "synced" | "duplicate" | "full"; workoutId: string; localDate: string; sourceSlot?: string; }
export type ConnectorOperation = "ping" | "registerSpreadsheet" | "getWorkbookSnapshot" | "getSyncSnapshot" | "registerWorkoutCompletion" | "registerSpreadsheetCompletion";
export interface DeviceConnectorPing { connectorVersion: 2; registeredSheets: number; }

export async function callConnector<T>(connectorUrl: string, key: string, operation: ConnectorOperation,
  payload?: { workoutId: string; localDate: string; mappingId: string }, fetchImpl: typeof fetch = fetch,
  options: { spreadsheetId?: string; expectedVersion?: 1 | 2 } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl("/api/google-connector", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ connectorUrl, key, operation, ...(options.spreadsheetId ? { spreadsheetId: options.spreadsheetId } : {}), ...(payload ? { payload } : {}) }),
    });
  } catch { throw new Error("Connector network request failed. Your local workout remains saved."); }
  let envelope: { ok?: boolean; version?: number; result?: T; error?: { code?: string; message?: string } | string };
  try { envelope = await response.json(); } catch { throw new Error("Connector returned a malformed response."); }
  if (!response.ok) throw new Error(typeof envelope.error === "string" ? envelope.error : "Connector proxy request failed.");
  if (envelope.version !== (options.expectedVersion ?? 1) || typeof envelope.ok !== "boolean") throw new Error("Connector version or response is invalid.");
  if (!envelope.ok) throw new Error(typeof envelope.error === "object" ? envelope.error?.message ?? "Connector rejected the request." : "Connector rejected the request.");
  if (!envelope.result || typeof envelope.result !== "object") throw new Error("Connector response is missing data.");
  return envelope.result;
}

export async function connectorPingV2(url: string, key: string): Promise<DeviceConnectorPing> {
  const result = await callConnector<DeviceConnectorPing>(url, key, "ping", undefined, fetch, { expectedVersion: 2 });
  if (result.connectorVersion !== 2 || !Number.isInteger(result.registeredSheets)) throw new Error("Standalone connector response is invalid.");
  return result;
}

export async function connectorPing(url: string, key: string): Promise<ConnectorPing> {
  const result = await callConnector<ConnectorPing>(url, key, "ping");
  if (!result.spreadsheetName || !Array.isArray(result.workoutSheets)) throw new Error("Connector ping response is invalid.");
  return result;
}

export async function connectorWorkbook(url: string, key: string, spreadsheetId?: string): Promise<ConnectorWorkbook> {
  const result = await callConnector<ConnectorWorkbook>(url, key, "getWorkbookSnapshot", undefined, fetch,
    spreadsheetId ? { spreadsheetId, expectedVersion: 2 } : {});
  if (!result.spreadsheetName || !/^[0-9a-f]{8}$/.test(result.mappingId) ||
      !result.snapshot || !Array.isArray(result.snapshot.sheets)) throw new Error("Connector workbook response is invalid.");
  if (spreadsheetId && spreadsheetIdFromUrl(result.sheetUrl) !== spreadsheetId) throw new Error("Connector returned a different spreadsheet.");
  return result;
}

export async function registerSpreadsheet(url: string, key: string, spreadsheetId: string): Promise<ConnectorWorkbook> {
  const result = await callConnector<ConnectorWorkbook>(url, key, "registerSpreadsheet", undefined, fetch,
    { spreadsheetId, expectedVersion: 2 });
  if (!result.spreadsheetName || !/^[0-9a-f]{8}$/.test(result.mappingId) ||
      !result.snapshot || !Array.isArray(result.snapshot.sheets) || spreadsheetIdFromUrl(result.sheetUrl) !== spreadsheetId)
    throw new Error("Connector registration response is invalid.");
  return result;
}

export async function registerConnectorCompletion(url: string, key: string, workoutId: string, localDate: string, mappingId: string,
  spreadsheetId?: string): Promise<ConnectorRegistration> {
  const result = await callConnector<ConnectorRegistration>(url, key,
    spreadsheetId ? "registerSpreadsheetCompletion" : "registerWorkoutCompletion", { workoutId, localDate, mappingId }, fetch,
    spreadsheetId ? { spreadsheetId, expectedVersion: 2 } : {});
  if (!["synced", "duplicate", "full"].includes(result.status) || result.workoutId !== workoutId || result.localDate !== localDate ||
      (result.status === "synced" && !/^E(?:[5-9]|1[0-6])$/.test(result.sourceSlot ?? ""))) {
    throw new Error("Connector completion response could not be verified. Check the Sheet before retrying.");
  }
  return result;
}
