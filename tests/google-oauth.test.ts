import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { GOOGLE_SCOPE, sameOrigin } from "../lib/google/config";
import { accessToken, authorizationUrl, challenge, equalState, randomUrlToken, tokenRequest } from "../lib/google/oauth";
import { FLOW_COOKIE, SESSION_COOKIE } from "../lib/google/config";
import { readFlow, readSession, seal, unseal, type GoogleSession } from "../lib/google/session";
import { parseSheetUrl } from "../lib/google/sheet-url";
import { allowedGoogleEmails, isAllowedGoogleEmail, verifyGoogleIdentity } from "../lib/google/identity";
import { readAllowedSession } from "../lib/google/session";

process.env.APP_BASE_URL = "http://localhost:3000";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_SESSION_SECRET = "a".repeat(64);
process.env.GOOGLE_ALLOWED_EMAILS = " owner@example.com, friend@example.com,owner@example.com,,";

test("OAuth start uses unique state, PKCE, exact callback and Sheets scope", () => {
  const a = randomUrlToken(), b = randomUrlToken();
  assert.notEqual(a, b);
  const url = new URL(authorizationUrl(a, b));
  assert.equal(url.searchParams.get("state"), a);
  assert.equal(url.searchParams.get("code_challenge"), challenge(b));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), GOOGLE_SCOPE);
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/google/auth/callback");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "select_account consent");
  assert(equalState(a, a)); assert(!equalState(a, b));
});

test("authenticated flow cookie rejects tampering, expiry and wrong purpose", () => {
  const value = seal({ state: "a", verifier: "b", returnTo: "/plans", createdAt: Date.now() }, FLOW_COOKIE);
  const request = new Request("http://localhost:3000", { headers: { cookie: `${FLOW_COOKIE}=${value}` } });
  assert.equal(readFlow(request)?.state, "a");
  assert.equal(unseal(value, SESSION_COOKIE), null);
  assert.equal(unseal(value.slice(0, 20) + (value[20] === "a" ? "b" : "a") + value.slice(21), FLOW_COOKIE), null);
  const expired = seal({ state: "a", verifier: "b", returnTo: "/plans", createdAt: Date.now() - 700_000 }, FLOW_COOKIE);
  assert.equal(readFlow(new Request("http://localhost:3000", { headers: { cookie: `${FLOW_COOKIE}=${expired}` } })), null);
});

test("refresh token is only in encrypted session cookie and same-origin POST is required", () => {
  const token = "refresh-token-secret-123";
  const value = seal({ refreshToken: token, createdAt: Date.now(), email: "owner@example.com", sub: "subject-1", identityVerified: true }, SESSION_COOKIE);
  assert(!value.includes(token));
  const request = new Request("http://localhost:3000", { headers: { cookie: `${SESSION_COOKIE}=${value}`, origin: "http://localhost:3000" } });
  assert.equal(readSession(request)?.refreshToken, token);
  assert.equal(readAllowedSession(request)?.email, "owner@example.com");
  assert(sameOrigin(request));
  assert(!sameOrigin(new Request("http://localhost:3000", { headers: { origin: "https://attacker.example" } })));
});

test("allowlist normalizes, deduplicates, fails closed, and rechecks existing sessions", () => {
  const original = process.env.GOOGLE_ALLOWED_EMAILS;
  try {
    assert.deepEqual([...allowedGoogleEmails()], ["owner@example.com", "friend@example.com"]);
    assert(isAllowedGoogleEmail(" OWNER@EXAMPLE.COM "));
    assert(!isAllowedGoogleEmail("other@gmail.com"));
    const value = seal({ refreshToken: "refresh-token-123456", createdAt: Date.now(), email: "owner@example.com", sub: "subject-1", identityVerified: true }, SESSION_COOKIE);
    const request = new Request("http://localhost:3000", { headers: { cookie: `${SESSION_COOKIE}=${value}` } });
    process.env.GOOGLE_ALLOWED_EMAILS = "friend@example.com";
    assert.equal(readAllowedSession(request), null);
    process.env.GOOGLE_ALLOWED_EMAILS = "";
    assert.throws(allowedGoogleEmails);
    process.env.GOOGLE_ALLOWED_EMAILS = "owner@example.com,not-an-email";
    assert.throws(allowedGoogleEmails);
    const old = seal({ refreshToken: "refresh-token-123456", createdAt: Date.now() } as GoogleSession, SESSION_COOKIE);
    assert.equal(readSession(new Request("http://localhost:3000", { headers: { cookie: `${SESSION_COOKIE}=${old}` } })), null);
  } finally { process.env.GOOGLE_ALLOWED_EMAILS = original; }
});

test("Google ID token signature, issuer, audience, expiry and verified email are checked", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const client = new OAuth2Client();
  Object.defineProperty(client, "getFederatedSignonCertsAsync", { value: async () => ({ certs: { test: publicKey.export({ type: "spki", format: "pem" }) } }) });
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: "https://accounts.google.com", aud: "test-client", sub: "subject-1", email: " OWNER@EXAMPLE.COM ",
    email_verified: true, iat: now, exp: now + 600 };
  const token = (claims: Record<string, unknown>, key = privateKey) => {
    const signed = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url")}.${Buffer.from(JSON.stringify({ ...base, ...claims })).toString("base64url")}`;
    return `${signed}.${sign("RSA-SHA256", Buffer.from(signed), key).toString("base64url")}`;
  };
  assert.deepEqual(await verifyGoogleIdentity(token({}), client), { email: "owner@example.com", sub: "subject-1" });
  for (const claims of [{ aud: "another-client" }, { iss: "https://evil.example" }, { exp: now - 1000 },
    { email: undefined }, { email_verified: false }]) {
    await assert.rejects(() => verifyGoogleIdentity(token(claims), client));
  }
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(() => verifyGoogleIdentity(token({}, wrongKey), client));
});

test("only standard Google Sheets URLs produce validated IDs and gid", () => {
  const id = "a".repeat(44);
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing#gid=12`),
    { spreadsheetId: id, gid: 12, canonicalUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  for (const input of [`https://docs.google.com/document/d/${id}/edit`, `https://docs.google.com/presentation/d/${id}/edit`,
    `https://drive.google.com/drive/folders/${id}`, `https://evil.example/spreadsheets/d/${id}/edit`,
    `http://docs.google.com/spreadsheets/d/${id}/edit`, `https://docs.google.com/spreadsheets/d/short/edit`]) {
    assert.throws(() => parseSheetUrl(input));
  }
});

test("code exchange and expired-access refresh keep tokens on server", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = String(init?.body);
    requests.push(body);
    return Response.json(body.includes("authorization_code") ? { access_token: "short-lived", refresh_token: "long-lived" } : { access_token: "new-access" });
  };
  try {
    const exchanged = await tokenRequest({ grant_type: "authorization_code", code: "one-use-code", redirect_uri: "http://localhost:3000/api/google/auth/callback", code_verifier: "verifier" });
    assert.equal(exchanged.refresh_token, "long-lived");
    assert.equal(await accessToken("long-lived"), "new-access");
    assert(requests[0].includes("code_verifier=verifier"));
    assert(requests[1].includes("refresh_token=long-lived"));
  } finally { globalThis.fetch = original; }
});

test("revoked refresh token and failed code exchange produce safe reconnect errors", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "invalid_grant", error_description: "private upstream detail" }, { status: 400 });
  try {
    await assert.rejects(() => accessToken("revoked-token"), /Reconnect/);
    await assert.rejects(() => tokenRequest({ grant_type: "authorization_code", code: "bad" }), /Reconnect/);
  } finally { globalThis.fetch = original; }
});
