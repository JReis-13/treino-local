import { failure, boundedJson, requireGoogle, requireOrigin, noStore, GoogleError } from "@/lib/google/http";
import { parseSheetUrl } from "@/lib/google/sheet-url";
import { readGoogleTraining } from "@/lib/google/sheets";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const body = await boundedJson(request);
    if (typeof body.url !== "string") throw new GoogleError("Paste a Google Sheets URL.");
    const parsed = parseSheetUrl(body.url);
    const token = await requireGoogle(request);
    const { imported } = await readGoogleTraining(parsed.spreadsheetId, token);
    return noStore({ spreadsheetId: parsed.spreadsheetId, gid: parsed.gid, title: imported.name,
      workouts: imported.workouts.map((workout) => workout.title), warnings: imported.warnings });
  } catch (cause) { return failure(cause); }
}
