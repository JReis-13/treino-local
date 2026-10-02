import type { SourceSnapshot } from "@/lib/import/snapshot";

export interface ConnectorPing { spreadsheetName: string; sheetUrl: string; workoutSheets: string[]; }
export interface ConnectorWorkbook { spreadsheetName: string; sheetUrl: string; mappingId: string; snapshot: SourceSnapshot; }
export interface ConnectorRegistration { status: "synced" | "duplicate" | "full"; workoutId: string; localDate: string; sourceSlot?: string; }
export type ConnectorOperation = "ping" | "getWorkbookSnapshot" | "getSyncSnapshot" | "registerWorkoutCompletion";

export async function callConnector<T>(connectorUrl: string, key: string, operation: ConnectorOperation,
  payload?: { workoutId: string; localDate: string; mappingId: string }, fetchImpl: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl("/api/google-connector", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ connectorUrl, key, operation, ...(payload ? { payload } : {}) }),
    });
  } catch { throw new Error("Connector network request failed. Your local workout remains saved."); }
  let envelope: { ok?: boolean; version?: number; result?: T; error?: { code?: string; message?: string } | string };
  try { envelope = await response.json(); } catch { throw new Error("Connector returned a malformed response."); }
  if (!response.ok) throw new Error(typeof envelope.error === "string" ? envelope.error : "Connector proxy request failed.");
  if (envelope.version !== 1 || typeof envelope.ok !== "boolean") throw new Error("Connector version or response is invalid.");
  if (!envelope.ok) throw new Error(typeof envelope.error === "object" ? envelope.error?.message ?? "Connector rejected the request." : "Connector rejected the request.");
  if (!envelope.result || typeof envelope.result !== "object") throw new Error("Connector response is missing data.");
  return envelope.result;
}

export async function connectorPing(url: string, key: string): Promise<ConnectorPing> {
  const result = await callConnector<ConnectorPing>(url, key, "ping");
  if (!result.spreadsheetName || !Array.isArray(result.workoutSheets)) throw new Error("Connector ping response is invalid.");
  return result;
}

export async function connectorWorkbook(url: string, key: string): Promise<ConnectorWorkbook> {
  const result = await callConnector<ConnectorWorkbook>(url, key, "getWorkbookSnapshot");
  if (!result.spreadsheetName || !/^[0-9a-f]{8}$/.test(result.mappingId) ||
      !result.snapshot || !Array.isArray(result.snapshot.sheets)) throw new Error("Connector workbook response is invalid.");
  return result;
}

export async function registerConnectorCompletion(url: string, key: string, workoutId: string, localDate: string, mappingId: string): Promise<ConnectorRegistration> {
  const result = await callConnector<ConnectorRegistration>(url, key, "registerWorkoutCompletion", { workoutId, localDate, mappingId });
  if (!["synced", "duplicate", "full"].includes(result.status) || result.workoutId !== workoutId || result.localDate !== localDate ||
      (result.status === "synced" && !/^E(?:[5-9]|1[0-6])$/.test(result.sourceSlot ?? ""))) {
    throw new Error("Connector completion response could not be verified. Check the Sheet before retrying.");
  }
  return result;
}
