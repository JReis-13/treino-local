import { NextRequest, NextResponse } from "next/server";
import { googleConfig, safeReturnPath } from "@/lib/google/config";
import { authorizationUrl, randomUrlToken } from "@/lib/google/oauth";
import { setFlow } from "@/lib/google/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const config = googleConfig();
    if (request.nextUrl.origin !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Invalid Google connection request." }, { status: 403 });
    }
    const state = randomUrlToken(), verifier = randomUrlToken();
    const response = NextResponse.redirect(authorizationUrl(state, verifier));
    response.headers.set("Cache-Control", "no-store");
    setFlow(response, { state, verifier, returnTo: safeReturnPath(request.nextUrl.searchParams.get("returnTo")), createdAt: Date.now() });
    return response;
  } catch { return NextResponse.json({ error: "Google connection is not configured on this server." }, { status: 503 }); }
}
