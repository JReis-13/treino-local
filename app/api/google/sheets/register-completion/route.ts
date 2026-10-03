import { failure, boundedJson, requireGoogle, requireOrigin, noStore, GoogleError } from "@/lib/google/http";
import { registerCompletion } from "@/lib/google/sheets";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const body = await boundedJson(request);
    if (typeof body.spreadsheetId !== "string" || typeof body.sourceFingerprint !== "string" ||
      typeof body.sourceProof !== "string" || typeof body.workoutId !== "string" || typeof body.localDate !== "string") {
      throw new GoogleError("Invalid completion request.");
    }
    const token = await requireGoogle(request);
    const result = await registerCompletion({ spreadsheetId: body.spreadsheetId,
      sourceFingerprint: body.sourceFingerprint, sourceProof: body.sourceProof,
      workoutId: body.workoutId, localDate: body.localDate, allowDuplicate: body.allowDuplicate === true }, token);
    return noStore(result);
  } catch (cause) { return failure(cause); }
}
