import assert from "node:assert/strict";
import test from "node:test";
import { MAX_DIAGNOSTIC_UPLOAD_BYTES, sanitizeDebugReport } from "../lib/diagnostics-upload";
import { reportCode } from "../lib/support/server";
import { boundedJson, POST } from "../app/api/support/diagnostics/route";

test("support report sanitizer strips arbitrary fields, notes, loads, URLs and push secrets", () => {
  const secrets = ["ACCESS_TOKEN_PRIVATE", "REFRESH_TOKEN_PRIVATE", "DATABASE_URL_PRIVATE", "VAPID_PRIVATE_KEY",
    "https://push.example.invalid/endpoint", "P256DH_PRIVATE", "AUTH_PRIVATE", "PRIVATE_NOTE", "95kg", "person@example.invalid",
    "https://docs.google.com/spreadsheets/d/PRIVATE_ID", "FULL_GOOGLE_SUB"];
  const input = { debugReportVersion: 1, timestamp: "2026-10-08T08:00:00Z", token: secrets[0],
    app: { buildId: "1234abcd-20261008T080000", route: "/settings/", online: true, secret: secrets[1] },
    source: { latestSessionSync: "synced", historicalPendingSessions: 3, spreadsheetUrl: secrets[10] },
    social: { authenticated: "yes", email: secrets[9], googleSub: secrets[11] },
    push: { supported: true, permission: "granted", subscriptionPresent: true, endpoint: secrets[4],
      auth: secrets[6], p256dh: secrets[5], lastSubscriptionResult: secrets[3] },
    storage: { plans: 1, rawLocalStorage: secrets[2] },
    importer: { template: "jonatha-v1", parserVersion: 2, workoutCount: 2, exerciseCount: 16,
      loadBearingExercises: 5, numericLoads: 4, blankLoads: 11, ambiguousLoads: 0,
      warningCodes: ["uncertain-load", secrets[7]] },
    events: [{ type: "plan_import_finished", timestamp: "2026-10-08T08:00:00Z", reason: secrets[8],
      note: secrets[7], load: secrets[8] }], notes: secrets[7], loads: secrets[8] };
  const sanitized = sanitizeDebugReport(input);
  const json = JSON.stringify(sanitized);
  for (const secret of secrets) assert(!json.includes(secret), `support report leaked a private fixture`);
  assert.equal((sanitized.source as Record<string, unknown>).latestSessionSync, "synced");
  assert.equal((sanitized.source as Record<string, unknown>).historicalPendingSessions, 3);
  assert.equal((sanitized.importer as Record<string, unknown>).exerciseCount, 16);
});

test("support report rejects wrong version and bounds event count", () => {
  assert.throws(() => sanitizeDebugReport({ debugReportVersion: 2 }), /version/);
  const report = sanitizeDebugReport({ debugReportVersion: 1, events: Array.from({ length: 800 }, () =>
    ({ type: "app_boot", timestamp: "2026-10-08T08:00:00Z" })) });
  assert.equal((report.events as unknown[]).length, 500);
  assert.equal(MAX_DIAGNOSTIC_UPLOAD_BYTES, 131072);
});

test("support codes are random, short and contain no database identity", () => {
  const codes = Array.from({ length: 100 }, reportCode);
  assert.equal(new Set(codes).size, codes.length);
  assert(codes.every((code) => /^TL-[A-HJ-NP-Z2-9]{8}$/.test(code)));
});

test("diagnostic endpoint rejects unauthenticated requests and bounded body rejects oversize", async () => {
  const prior = { base: process.env.APP_BASE_URL, id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, session: process.env.GOOGLE_OAUTH_SESSION_SECRET };
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_OAUTH_SESSION_SECRET = "s".repeat(50);
  try {
    const response = await POST(new Request("http://localhost:3000/api/support/diagnostics", { method: "POST",
      headers: { origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ debugReportVersion: 1 }) }));
    assert.equal(response.status, 401);
    assert.equal(await response.text().then((text) => text.includes("report")), false);
    await assert.rejects(() => boundedJson(new Request("http://localhost:3000/api/support/diagnostics", {
      method: "POST", body: "x".repeat(MAX_DIAGNOSTIC_UPLOAD_BYTES + 1) })), /too large/);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      const name = { base: "APP_BASE_URL", id: "GOOGLE_OAUTH_CLIENT_ID", secret: "GOOGLE_OAUTH_CLIENT_SECRET",
        session: "GOOGLE_OAUTH_SESSION_SECRET" }[key as keyof typeof prior];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
