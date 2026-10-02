export function spreadsheetIdFromUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Paste a normal Google Sheets URL."); }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,128})(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password || !match)
    throw new Error("Paste a normal https://docs.google.com/spreadsheets/d/… URL.");
  return match[1];
}

export function canonicalSpreadsheetUrl(id: string): string {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(id)) throw new Error("Spreadsheet identifier is invalid.");
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
