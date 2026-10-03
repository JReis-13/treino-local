import { failure, boundedJson, requireGoogle, requireOrigin, noStore, GoogleError } from "@/lib/google/http";
import { writeGoogleLoads } from "@/lib/google/sheets";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const body = await boundedJson(request);
    if (typeof body.spreadsheetId !== "string" || typeof body.sourceFingerprint !== "string" ||
        typeof body.sourceProof !== "string" || typeof body.workoutId !== "string" || !Array.isArray(body.changes))
      throw new GoogleError("Invalid load update request.");
    const token = await requireGoogle(request);
    return noStore(await writeGoogleLoads({ spreadsheetId: body.spreadsheetId, sourceFingerprint: body.sourceFingerprint,
      sourceProof: body.sourceProof, workoutId: body.workoutId, changes: body.changes }, token));
  } catch (cause) { return failure(cause); }
}
