import { currentSocialUser, socialFailure, SocialError } from "@/lib/social/server";
import { MAX_DIAGNOSTIC_UPLOAD_BYTES } from "@/lib/diagnostics-upload";
import { storeDiagnosticReport } from "@/lib/support/server";

export const runtime = "nodejs";

export async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_DIAGNOSTIC_UPLOAD_BYTES)
    throw new SocialError("Diagnostic report is too large.", 413, "tooLarge");
  const reader = request.body?.getReader();
  if (!reader) throw new SocialError("Diagnostic report is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DIAGNOSTIC_UPLOAD_BYTES) {
      await reader.cancel();
      throw new SocialError("Diagnostic report is too large.", 413, "tooLarge");
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new SocialError("Invalid diagnostic report."); }
}

export async function POST(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await boundedJson(request);
    let code: string;
    try { code = await storeDiagnosticReport(user.id, body); }
    catch (cause) {
      if (cause instanceof Error && cause.message === "Unsupported diagnostic report version.")
        throw new SocialError("Unsupported diagnostic report version.");
      throw cause;
    }
    return Response.json({ code }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return socialFailure(cause); }
}
