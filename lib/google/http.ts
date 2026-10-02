import { NextResponse } from "next/server";
import { googleConfig, sameOrigin } from "@/lib/google/config";
import { readSession } from "@/lib/google/session";
import { accessToken } from "@/lib/google/oauth";

export class GoogleError extends Error {
  constructor(message: string, public status = 400, public code = "failed") { super(message); }
}
export function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(cause: unknown) {
  const error = cause instanceof GoogleError ? cause : new GoogleError(cause instanceof Error ? cause.message : "Google request failed.", 500);
  return noStore({ error: error.message, code: error.code }, error.status);
}
export function requireOrigin(request: Request) {
  try { googleConfig(); } catch { throw new GoogleError("Google connection is not configured on this server.", 503, "unconfigured"); }
  if (!sameOrigin(request)) throw new GoogleError("This request must come from Treino Local.", 403, "csrf");
}
export async function requireGoogle(request: Request): Promise<string> {
  const session = readSession(request);
  if (!session) throw new GoogleError("Google connection expired. Reconnect to continue syncing.", 401, "authRequired");
  try { return await accessToken(session.refreshToken); }
  catch (cause) {
    if (cause instanceof Error && cause.message.includes("Reconnect")) throw new GoogleError(cause.message, 401, "authRequired");
    throw cause;
  }
}
export async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 4096) throw new GoogleError("Request is too large.", 413);
  const text = await request.text();
  if (text.length > 4096) throw new GoogleError("Request is too large.", 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new GoogleError("Invalid request."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoogleError("Invalid request.");
  return value as Record<string, unknown>;
}
