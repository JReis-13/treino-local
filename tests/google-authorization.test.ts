import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { GET as callback } from "../app/api/google/auth/callback/route";
import { GET as status } from "../app/api/google/auth/status/route";
import { POST as disconnect } from "../app/api/google/auth/disconnect/route";
import { requireGoogle } from "../lib/google/http";
import { FLOW_COOKIE, SESSION_COOKIE } from "../lib/google/config";
import { readSession, seal } from "../lib/google/session";

process.env.APP_BASE_URL = "http://localhost:3000";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_SESSION_SECRET = "a".repeat(64);
process.env.GOOGLE_ALLOWED_EMAILS = "owner@example.com";

function sessionCookie(response: Response): string {
  return response.headers.getSetCookie().map((header) => header.split(";")[0])
    .find((header) => header.startsWith(`${SESSION_COOKIE}=`)) ?? "";
}

test("callback allows verified account, rejects another account without tokens, and preserves state validation", async () => {
  const originalFetch = globalThis.fetch;
  const originalVerify = OAuth2Client.prototype.verifyIdToken;
  let email = "owner@example.com";
  let exchanges = 0;
  globalThis.fetch = async () => { exchanges++; return Response.json({ access_token: "access-secret", refresh_token: "refresh-secret-123456", id_token: "id-secret" }); };
  OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => ({
    iss: "https://accounts.google.com", aud: "test-client", exp: Math.floor(Date.now() / 1000) + 600,
    email_verified: true, email, sub: email,
  }) }) as never;
  const makeRequest = (state = "expected") => {
    const flow = seal({ state: "expected", verifier: "verifier", returnTo: "/plans", createdAt: Date.now() }, FLOW_COOKIE);
    return new NextRequest(`http://localhost:3000/api/google/auth/callback?state=${state}&code=code`, { headers: { cookie: `${FLOW_COOKIE}=${flow}` } });
  };
  try {
    const invalid = await callback(makeRequest("wrong"));
    assert.equal(invalid.status, 400);
    assert.equal(exchanges, 0);
    const accepted = await callback(makeRequest());
    assert.equal(new URL(accepted.headers.get("location")!).searchParams.get("google"), "connected");
    const cookie = sessionCookie(accepted);
    assert(cookie && !cookie.includes("refresh-secret") && !cookie.includes("owner@example.com"));
    assert.equal(readSession(new Request("http://localhost:3000", { headers: { cookie } }))?.email, "owner@example.com");
    email = "other@gmail.com";
    const rejected = await callback(makeRequest());
    assert.equal(new URL(rejected.headers.get("location")!).searchParams.get("google"), "unauthorized");
    assert.equal(readSession(new Request("http://localhost:3000", { headers: { cookie: sessionCookie(rejected) } })), null);
    assert(!rejected.headers.get("location")?.includes("owner@example.com"));
    assert(!JSON.stringify(await rejected.text()).includes("refresh-secret"));
  } finally { globalThis.fetch = originalFetch; OAuth2Client.prototype.verifyIdToken = originalVerify; }
});

test("status and every Google API request use the current allowlist; disconnect clears credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalAllowlist = process.env.GOOGLE_ALLOWED_EMAILS;
  const value = seal({ refreshToken: "refresh-secret-123456", createdAt: Date.now(), email: "owner@example.com", sub: "owner-sub", identityVerified: true }, SESSION_COOKIE);
  const cookie = `${SESSION_COOKIE}=${value}`;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ access_token: "access-secret" }); };
  try {
    const allowed = new Request("http://localhost:3000/api/google/sheets/import", { headers: { cookie } });
    assert.equal(await requireGoogle(allowed), "access-secret");
    assert.deepEqual(await (await status(allowed)).json(), { connected: true, email: "owner@example.com" });
    process.env.GOOGLE_ALLOWED_EMAILS = "friend@example.com";
    await assert.rejects(() => requireGoogle(allowed), { status: 403, code: "unauthorized" });
    assert.equal(requests, 1);
    assert.deepEqual(await (await status(allowed)).json(), { connected: false });
    const disconnected = await disconnect(new Request("http://localhost:3000/api/google/auth/disconnect", { method: "POST", headers: { cookie, origin: "http://localhost:3000" } }));
    assert.equal(disconnected.status, 200);
    assert(sessionCookie(disconnected).startsWith(`${SESSION_COOKIE}=`));
  } finally { globalThis.fetch = originalFetch; process.env.GOOGLE_ALLOWED_EMAILS = originalAllowlist; }
});
