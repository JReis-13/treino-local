import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GOOGLE_SCOPE, googleConfig } from "@/lib/google/config";

export const randomUrlToken = () => randomBytes(32).toString("base64url");
export const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export function equalState(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function authorizationUrl(state: string, verifier: string): string {
  const config = googleConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [name, value] of Object.entries({ client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: "code", scope: GOOGLE_SCOPE, access_type: "offline", prompt: "select_account consent",
    include_granted_scopes: "false", state, code_challenge: challenge(verifier), code_challenge_method: "S256" })) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}
export async function tokenRequest(fields: Record<string, string>): Promise<Record<string, unknown>> {
  const config = googleConfig();
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }),
      signal: AbortSignal.timeout(15_000) });
  } catch { throw new Error("Google authorization is temporarily unavailable."); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body || typeof body !== "object") {
    if ((body as { error?: string }).error === "invalid_grant") throw new Error("Google connection expired. Reconnect to continue syncing.");
    throw new Error("Google authorization failed. Please try connecting again.");
  }
  return body as Record<string, unknown>;
}
export async function accessToken(refreshToken: string): Promise<string> {
  const body = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error("Google connection expired. Reconnect to continue syncing.");
  return body.access_token;
}
