import { NextResponse } from "next/server";
import { clearSession, readSession } from "@/lib/google/session";
import { failure, requireOrigin } from "@/lib/google/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const session = readSession(request);
    if (session) {
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: session.refreshToken }), signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
    const response = NextResponse.json({ disconnected: true }, { headers: { "Cache-Control": "no-store" } });
    clearSession(response);
    return response;
  } catch (cause) { return failure(cause); }
}
