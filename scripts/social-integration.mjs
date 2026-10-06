import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import postgres from "postgres";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL || !process.env.GOOGLE_OAUTH_SESSION_SECRET) {
  console.error("Database or Google session test configuration is missing."); process.exit(1);
}
const marker = `codex-integration-${randomUUID()}`;
const emails = ["a", "b", "c"].map((letter) => `${marker}-${letter}@example.invalid`);
const subs = ["a", "b", "c"].map((letter) => `${marker}-${letter}`);
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: "require", connect_timeout: 8 });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start"], { cwd: process.cwd(),
  env: { ...process.env, APP_BASE_URL: "http://localhost:3000", GOOGLE_ALLOWED_EMAILS: emails.join(",") }, stdio: "ignore", windowsHide: true });
const base = "http://localhost:3000";
function cookie(index) {
  const name = "treino_google_session";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.GOOGLE_OAUTH_SESSION_SECRET).digest(), iv);
  cipher.setAAD(Buffer.from(name));
  const payload = Buffer.concat([cipher.update(JSON.stringify({ refreshToken: "integration-test-token-only", createdAt: Date.now(),
    email: emails[index], sub: subs[index], identityVerified: true })), cipher.final()]);
  return `${name}=${Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url")}`;
}
async function ready() {
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null) throw new Error("Local test server did not start. Is port 3000 already in use?");
    try { const response = await fetch(`${base}/api/google/auth/status`); if (response.ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local test server did not become ready.");
}
async function call(index, path, method = "GET", body, origin = base, extraHeaders = {}) {
  const response = await fetch(`${base}/api/social/${path}`, { method, headers: { cookie: cookie(index),
    ...(method === "GET" ? {} : { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const activity = { clientSessionId: marker, workoutName: "Workout A", completedAt: "2026-10-04T08:40:00.000Z",
  localDate: "2026-10-04", durationMinutes: 40, completedExercises: 3, totalExercises: 3,
  actualLoad: "PRIVATE", sessionNote: "PRIVATE", spreadsheetId: "PRIVATE", googleToken: "PRIVATE" };
let failure;
try {
  await ready();
  assert.equal((await call(0, "me")).status, 200);
  assert.equal((await call(1, "me")).status, 200);
  assert.equal((await call(2, "me")).status, 200);
  const accountA = (await call(0, "me")).data.accountId;
  const accountC = (await call(2, "me")).data.accountId;
  assert(accountA && accountC && accountA !== accountC);
  assert.equal((await call(0, "friends", "POST", { email: emails[1] }, "https://evil.invalid")).status, 403);
  assert.equal((await call(0, "friends", "POST", { email: emails[1] })).status, 201);
  assert.equal((await call(0, "friends", "POST", { email: emails[1] })).status, 409);
  const pending = await call(1, "friends");
  const friendshipId = pending.data.friends[0].id;
  assert.equal(pending.data.friends[0].direction, "incoming");
  assert.equal((await call(0, "me", "PATCH", { sharingEnabled: true })).status, 200);
  assert.equal((await call(0, "activities", "POST", activity, base, { "x-treino-social-account": accountC })).status, 409);
  assert.equal((await call(0, "activities", "POST", { ...activity, userId: accountC }, base,
    { "x-treino-social-account": accountA })).status, 200);
  assert.equal((await call(1, "home")).data.activities.length, 0);
  assert.equal((await call(1, "friends", "PATCH", { id: friendshipId, action: "accept" })).status, 200);
  assert.equal((await call(1, "friends", "POST", { email: emails[0] })).status, 409);
  const homeB = await call(1, "home");
  assert.equal(homeB.data.activities.length, 1);
  assert.equal(homeB.data.activities[0].workoutName, "Workout A");
  assert(!JSON.stringify(homeB.data).includes("PRIVATE"));
  assert.equal((await call(2, "home")).data.activities.length, 0);
  const id = homeB.data.activities[0].id;
  assert.equal((await call(2, `activities/${id}/reaction`, "PUT", { emoji: "🔥" })).status, 404);
  assert.equal((await call(0, `activities/${id}/reaction`, "PUT", { emoji: "🔥" })).status, 404);
  assert.equal((await call(1, `activities/${id}/reaction`, "PUT", { emoji: "🔥" })).status, 200);
  assert.equal((await call(1, `activities/${id}/reaction`, "PUT", { emoji: "💪" })).status, 200);
  assert.equal((await call(1, `activities/${id}/reaction`, "PUT", { emoji: "💪" })).status, 200);
  assert.equal((await call(1, "home")).data.activities[0].reactions["💪"], 1);
  assert.equal((await call(0, "home")).data.received[0].emoji, "💪");
  const workoutB = { ...activity, clientSessionId: `${marker}-other-workout`, workoutName: "Workout B",
    completedAt: "2026-10-04T09:40:00.000Z" };
  assert.equal((await call(0, "activities", "POST", workoutB)).status, 200);
  const afterB = await call(1, "home");
  assert.equal(afterB.data.activities[0].workoutName, "Workout B");
  const secondA = { ...activity, clientSessionId: `${marker}-second-A`, completedAt: "2026-10-04T18:40:00.000Z" };
  assert.equal((await call(0, "activities", "POST", secondA)).status, 200);
  const afterSecondA = await call(1, "home");
  assert.equal(afterSecondA.data.activities[0].workoutName, "Workout A");
  assert.equal(afterSecondA.data.activities[0].completedAt, secondA.completedAt);
  const secondId = afterSecondA.data.activities[0].id;
  assert.notEqual(secondId, id);
  assert.equal((await call(1, `activities/${secondId}/reaction`, "PUT", { emoji: "🔥" })).status, 200);
  assert.equal((await call(1, "home")).data.activities[0].reactions["🔥"], 1);
  assert.equal((await call(0, "home")).data.received.some((item) => item.emoji === "🔥"), true);
  assert.equal((await call(0, "activities", "POST", { ...activity, workoutName: "Workout A replaced",
    completedAt: "2026-10-04T10:40:00.000Z", durationMinutes: 46 })).status, 200);
  const replacedRows = await sql`select a.id, a.duration_minutes, a.user_id from treino_social.workout_activities a
    where a.client_session_id = ${activity.clientSessionId}`;
  assert.equal(replacedRows.length, 1);
  assert.equal(replacedRows[0].id, id);
  assert.equal(replacedRows[0].duration_minutes, 46);
  assert.equal(replacedRows[0].user_id, accountA);
  const allRows = await sql`select client_session_id from treino_social.workout_activities
    where client_session_id in (${activity.clientSessionId}, ${workoutB.clientSessionId}, ${secondA.clientSessionId})`;
  assert.equal(allRows.length, 3);
  const reactions = await sql`select activity_id, emoji from treino_social.activity_reactions where activity_id in (${id}, ${secondId})`;
  assert.equal(reactions.length, 2);
  assert.equal(reactions.find((row) => row.activity_id === id)?.emoji, "💪");
  assert.equal(reactions.find((row) => row.activity_id === secondId)?.emoji, "🔥");
  const replaced = await call(1, "home");
  assert.equal(replaced.data.activities[0].id, secondId, "the 18:40 session remains latest");
  assert.equal((await call(0, "activities", "POST", { ...activity, clientSessionId: `${marker}-backfill`,
    completedAt: "2026-10-01T08:40:00.000Z", localDate: "2026-10-01" })).status, 200);
  assert.equal((await call(1, "home")).data.activities[0].id, secondId, "offline backfill cannot replace latest");
  assert.equal((await call(0, "activities", "POST", activity)).status, 200);
  assert.equal((await call(1, "home")).data.activities[0].id, secondId);
  assert.equal((await sql`select duration_minutes from treino_social.workout_activities
    where client_session_id = ${activity.clientSessionId}`)[0].duration_minutes, 46, "late retry cannot undo Replace");
  assert.equal((await call(0, "me", "PATCH", { sharingEnabled: false })).status, 200);
  assert.equal((await call(1, "home")).data.activities.length, 0);
  const manualHistorical = { ...activity, clientSessionId: `${marker}-manual-history`, workoutName: "Historical workout",
    completedAt: "2026-10-04T20:40:00.000Z", manualShare: true };
  assert.equal((await call(0, "activities", "POST", { ...manualHistorical, manualShare: false })).status, 403);
  assert.equal((await call(0, "activities", "POST", manualHistorical)).status, 200);
  const manualStatus = await call(0, `activities?clientSessionId=${manualHistorical.clientSessionId}`);
  assert.equal(manualStatus.data.shared, true);
  const manualHome = await call(1, "home");
  assert.equal(manualHome.data.activities[0].workoutName, "Historical workout");
  assert.equal((await call(1, `activities/${manualHome.data.activities[0].id}/reaction`, "PUT", { emoji: "🔥" })).status, 200);
  assert.equal((await call(0, "home")).data.received.some((item) => item.workoutName === "Historical workout"), true);
  assert.equal((await call(0, "me", "PATCH", { sharingEnabled: true })).status, 200);
  // Owned deletion is idempotent and removes dependent reactions; another user cannot delete it.
  assert.equal((await call(1, "activities", "DELETE", { clientSessionId: secondA.clientSessionId })).status, 404);
  assert.equal((await call(0, "activities", "DELETE", { clientSessionId: secondA.clientSessionId })).status, 200);
  assert.equal((await call(0, "activities", "DELETE", { clientSessionId: secondA.clientSessionId })).status, 200);
  assert.equal((await sql`select count(*)::int as total from treino_social.activity_reactions where activity_id = ${secondId}`)[0].total, 0);
  assert.equal((await call(1, "home")).data.activities.some((item) => item.id === secondId), false);
  assert.equal((await call(0, "friends", "DELETE", { id: friendshipId })).status, 200);
  assert.equal((await call(1, "home")).data.activities.length, 0);
  assert.equal((await call(1, `activities/${secondId}/reaction`, "PUT", { emoji: "🔥" })).status, 404);
  console.log("Social API integration: OK (identity, CSRF, sharing, same-day Add/Replace, backfill, privacy, exact reactions, removal)");
} catch (cause) { failure = cause; console.error(`Social API integration: FAILED (${cause instanceof assert.AssertionError ? "assertion" : cause?.code ?? "runtime"})`); }
finally {
  try {
    await sql`delete from treino_social.users where google_sub in (${subs[0]}, ${subs[1]}, ${subs[2]})
      and email in (${emails[0]}, ${emails[1]}, ${emails[2]})`;
    console.log("Integration cleanup: OK");
  } catch { console.error("Integration cleanup failed; inspect only codex-integration temporary rows."); failure ??= new Error("Cleanup failed."); }
  server.kill();
  await sql.end({ timeout: 2 });
}
if (failure) process.exitCode = 1;
