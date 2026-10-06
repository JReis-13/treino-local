import { NextRequest, NextResponse } from "next/server";
import { googleConfig, safeReturnPath } from "@/lib/google/config";
import { equalState, tokenRequest } from "@/lib/google/oauth";
import { clearFlow, clearSession, readFlow, readSession, setSession } from "@/lib/google/session";
import { isAllowedGoogleEmail, verifyGoogleIdentity } from "@/lib/google/identity";
import { detachPushDevice, PUSH_DEVICE_COOKIE } from "@/lib/push/server";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = googleConfig().origin; } catch { return NextResponse.json({ error: "Google connection is not configured." }, { status: 503 }); }
  if (request.nextUrl.origin !== origin) return NextResponse.json({ error: "Invalid Google callback host." }, { status: 403 });
  const flow = readFlow(request);
  if (!flow || !equalState(request.nextUrl.searchParams.get("state") ?? "", flow.state)) {
    return NextResponse.json({ error: "Google connection expired or failed validation. Try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const destination = new URL(safeReturnPath(flow.returnTo), origin);
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 2048 || request.nextUrl.searchParams.has("error")) {
    destination.searchParams.set("google", "denied");
    const response = NextResponse.redirect(destination); clearFlow(response); return response;
  }
  try {
    const token = await tokenRequest({ grant_type: "authorization_code", code,
      redirect_uri: googleConfig().redirectUri, code_verifier: flow.verifier });
    if (typeof token.access_token !== "string") throw new Error("Missing access token.");
    const identity = await verifyGoogleIdentity(token.id_token);
    if (!isAllowedGoogleEmail(identity.email)) {
      const previous = readSession(request);
      if (previous) await detachPushDevice(request, previous.sub);
      destination.searchParams.set("google", "unauthorized");
      const response = NextResponse.redirect(destination);
      clearFlow(response); clearSession(response);
      response.cookies.delete(PUSH_DEVICE_COOKIE);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const previous = readSession(request);
    if (previous && previous.sub !== identity.sub) await detachPushDevice(request, previous.sub);
    const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token :
      previous?.sub === identity.sub ? previous.refreshToken : undefined;
    if (!refreshToken) throw new Error("Missing refresh token.");
    destination.searchParams.set("google", "connected");
    const response = NextResponse.redirect(destination);
    setSession(response, { refreshToken, createdAt: Date.now(), ...identity, identityVerified: true });
    clearFlow(response);
    if (previous && previous.sub !== identity.sub) response.cookies.delete(PUSH_DEVICE_COOKIE);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    destination.searchParams.set("google", "failed");
    const response = NextResponse.redirect(destination); clearFlow(response); return response;
  }
}
