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
async function call(index, path, method = "GET", body, origin = base) {
  const response = await fetch(`${base}/api/social/${path}`, { method, headers: { cookie: cookie(index),
    ...(method === "GET" ? {} : { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }) },
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
  assert.equal((await call(0, "friends", "POST", { email: emails[1] }, "https://evil.invalid")).status, 403);
  assert.equal((await call(0, "friends", "POST", { email: emails[1] })).status, 201);
  assert.equal((await call(0, "friends", "POST", { email: emails[1] })).status, 409);
  const pending = await call(1, "friends");
  const friendshipId = pending.data.friends[0].id;
  assert.equal(pending.data.friends[0].direction, "incoming");
  assert.equal((await call(0, "me", "PATCH", { sharingEnabled: true })).status, 200);
  assert.equal((await call(0, "activities", "POST", activity)).status, 200);
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
  assert.equal((await call(1, `activities/${id}/reaction`, "DELETE")).status, 200);
  assert.equal((await call(0, "home")).data.received.length, 0);
  assert.equal((await call(0, "activities", "POST", { ...activity, workoutName: "Workout A replaced", completedAt: "2026-10-04T09:40:00.000Z" })).status, 200);
  const replaced = await call(1, "home");
  assert.equal(replaced.data.activities[0].id, id);
  assert.equal(replaced.data.activities[0].workoutName, "Workout A replaced");
  assert.equal((await call(0, "activities", "POST", activity)).status, 200);
  assert.equal((await call(1, "home")).data.activities[0].workoutName, "Workout A replaced");
  assert.equal((await call(0, "me", "PATCH", { sharingEnabled: false })).status, 200);
  assert.equal((await call(1, "home")).data.activities.length, 0);
  assert.equal((await call(0, "me", "PATCH", { sharingEnabled: true })).status, 200);
  assert.equal((await call(0, "friends", "DELETE", { id: friendshipId })).status, 200);
  assert.equal((await call(1, "home")).data.activities.length, 0);
  assert.equal((await call(1, `activities/${id}/reaction`, "PUT", { emoji: "🔥" })).status, 404);
  console.log("Social API integration: OK (identity, CSRF, friendship, privacy, idempotency, reactions, removal)");
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
