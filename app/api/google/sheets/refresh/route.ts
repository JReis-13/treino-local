import { failure, boundedJson, requireGoogle, requireOrigin, noStore, GoogleError } from "@/lib/google/http";
import { validSpreadsheetId } from "@/lib/google/sheet-url";
import { readGoogleTraining, sourceProof, validProof } from "@/lib/google/sheets";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const body = await boundedJson(request);
    if (!validSpreadsheetId(body.spreadsheetId)) throw new GoogleError("Invalid spreadsheet ID.");
    if (typeof body.sourceFingerprint !== "string" || typeof body.sourceProof !== "string" ||
      !validProof(body.spreadsheetId, body.sourceFingerprint, body.sourceProof)) throw new GoogleError("This Sheet must be imported by URL first.", 403);
    const token = await requireGoogle(request);
    const { imported } = await readGoogleTraining(body.spreadsheetId, token);
    if (imported.source.kind === "google") imported.source.sourceProof = sourceProof(body.spreadsheetId, imported.sourceFingerprint);
    return noStore({ imported });
  } catch (cause) { return failure(cause); }
}
