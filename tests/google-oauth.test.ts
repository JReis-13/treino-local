import assert from "node:assert/strict";
import test from "node:test";
import { GOOGLE_SCOPE, sameOrigin } from "../lib/google/config";
import { accessToken, authorizationUrl, challenge, equalState, randomUrlToken, tokenRequest } from "../lib/google/oauth";
import { FLOW_COOKIE, SESSION_COOKIE } from "../lib/google/config";
import { readFlow, readSession, seal, unseal } from "../lib/google/session";
import { parseSheetUrl } from "../lib/google/sheet-url";

process.env.APP_BASE_URL = "http://localhost:3000";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_SESSION_SECRET = "a".repeat(64);

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
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert(equalState(a, a)); assert(!equalState(a, b));
});

test("authenticated flow cookie rejects tampering, expiry and wrong purpose", () => {
  const value = seal({ state: "a", verifier: "b", returnTo: "/plans", createdAt: Date.now() }, FLOW_COOKIE);
  const request = new Request("http://localhost:3000", { headers: { cookie: `${FLOW_COOKIE}=${value}` } });
  assert.equal(readFlow(request)?.state, "a");
  assert.equal(unseal(value, SESSION_COOKIE), null);
  assert.equal(unseal(value.slice(0, -1) + "z", FLOW_COOKIE), null);
  const expired = seal({ state: "a", verifier: "b", returnTo: "/plans", createdAt: Date.now() - 700_000 }, FLOW_COOKIE);
  assert.equal(readFlow(new Request("http://localhost:3000", { headers: { cookie: `${FLOW_COOKIE}=${expired}` } })), null);
});

test("refresh token is only in encrypted session cookie and same-origin POST is required", () => {
  const token = "refresh-token-secret-123";
  const value = seal({ refreshToken: token, createdAt: Date.now() }, SESSION_COOKIE);
  assert(!value.includes(token));
  const request = new Request("http://localhost:3000", { headers: { cookie: `${SESSION_COOKIE}=${value}`, origin: "http://localhost:3000" } });
  assert.equal(readSession(request)?.refreshToken, token);
  assert(sameOrigin(request));
  assert(!sameOrigin(new Request("http://localhost:3000", { headers: { origin: "https://attacker.example" } })));
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
