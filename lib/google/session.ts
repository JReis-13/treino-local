import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { FLOW_COOKIE, googleConfig, SESSION_COOKIE } from "@/lib/google/config";

export interface GoogleSession { refreshToken: string; createdAt: number; }
export interface GoogleFlow { state: string; verifier: string; returnTo: string; createdAt: number; }
type CookieName = typeof SESSION_COOKIE | typeof FLOW_COOKIE;

function key() { return createHash("sha256").update(googleConfig().sessionSecret).digest(); }
export function seal(value: GoogleSession | GoogleFlow, purpose: CookieName): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}
export function unseal<T>(encoded: string | undefined, purpose: CookieName): T | null {
  if (!encoded || encoded.length > 4000) return null;
  try {
    const buffer = Buffer.from(encoded, "base64url");
    if (buffer.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), buffer.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString()) as T;
  } catch { return null; }
}
export function cookieValue(request: Request, name: CookieName): string | undefined {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function readSession(request: Request): GoogleSession | null {
  const session = unseal<GoogleSession>(cookieValue(request, SESSION_COOKIE), SESSION_COOKIE);
  return session && typeof session.refreshToken === "string" && session.refreshToken.length > 10 &&
    Number.isFinite(session.createdAt) ? session : null;
}
export function readFlow(request: Request): GoogleFlow | null {
  const flow = unseal<GoogleFlow>(cookieValue(request, FLOW_COOKIE), FLOW_COOKIE);
  return flow && typeof flow.state === "string" && typeof flow.verifier === "string" &&
    typeof flow.returnTo === "string" && Date.now() - flow.createdAt < 600_000 && flow.createdAt <= Date.now() ? flow : null;
}
export function setSession(response: NextResponse, session: GoogleSession) {
  const secure = googleConfig().secure;
  const value = seal(session, SESSION_COOKIE);
  if (value.length > 3800) throw new Error("Google session exceeds the safe cookie size.");
  response.cookies.set(SESSION_COOKIE, value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
}
export function setFlow(response: NextResponse, flow: GoogleFlow) {
  response.cookies.set(FLOW_COOKIE, seal(flow, FLOW_COOKIE), { httpOnly: true, secure: googleConfig().secure,
    sameSite: "lax", path: "/api/google/auth", maxAge: 600 });
}
export function clearFlow(response: NextResponse) {
  response.cookies.set(FLOW_COOKIE, "", { httpOnly: true, secure: googleConfig().secure, sameSite: "lax", path: "/api/google/auth", maxAge: 0 });
}
export function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: googleConfig().secure, sameSite: "lax", path: "/", maxAge: 0 });
}
