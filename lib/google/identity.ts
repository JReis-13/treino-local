import { OAuth2Client } from "google-auth-library";
import { googleConfig } from "@/lib/google/config";

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;

export interface VerifiedGoogleIdentity { email: string; sub: string; }

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function allowedGoogleEmails(): ReadonlySet<string> {
  const entries = (process.env.GOOGLE_ALLOWED_EMAILS ?? "").split(",")
    .map(normalizeEmail).filter(Boolean);
  if (!entries.length || entries.some((entry) => !EMAIL_PATTERN.test(entry))) {
    throw new Error("Google account authorization is not configured on this server.");
  }
  return new Set(entries);
}

export function isAllowedGoogleEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(email)) && allowedGoogleEmails().has(normalizeEmail(email));
}

export async function verifyGoogleIdentity(idToken: unknown, client: OAuth2Client = new OAuth2Client()): Promise<VerifiedGoogleIdentity> {
  if (typeof idToken !== "string" || !idToken) throw new Error("Missing Google identity token.");
  const ticket = await client.verifyIdToken({ idToken, audience: googleConfig().clientId });
  const payload = ticket.getPayload();
  if (!payload || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) ||
      payload.aud !== googleConfig().clientId || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now() ||
      payload.email_verified !== true || typeof payload.email !== "string" ||
      !EMAIL_PATTERN.test(normalizeEmail(payload.email)) || typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Google identity could not be verified.");
  }
  return { email: normalizeEmail(payload.email), sub: payload.sub };
}
