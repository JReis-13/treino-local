import { GoogleError } from "@/lib/google/http";

export function parseSheetUrl(value: string): { spreadsheetId: string; gid?: number; canonicalUrl: string } {
  if (value.length > 2048) throw new GoogleError("This link is not a Google Sheet.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new GoogleError("This link is not a Google Sheet."); }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,128})(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || !match || url.username || url.password) {
    throw new GoogleError("This link is not a Google Sheet.");
  }
  const gidText = url.searchParams.get("gid") ?? new URLSearchParams(url.hash.slice(1)).get("gid");
  if (gidText !== null && !/^\d{1,10}$/.test(gidText)) throw new GoogleError("Invalid Google Sheet tab identifier.");
  const gid = gidText === null ? undefined : Number(gidText);
  if (gid !== undefined && !Number.isSafeInteger(gid)) throw new GoogleError("Invalid Google Sheet tab identifier.");
  return { spreadsheetId: match[1], gid, canonicalUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/edit` };
}
export function validSpreadsheetId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}
