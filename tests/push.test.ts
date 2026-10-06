import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import postgres from "postgres";
import webpush from "web-push";
import { publishActivity, setReaction } from "../lib/social/server";
import { detachPushDevice, sendFriendWorkoutPush, sendReactionPush, validateSubscription, vapidConfigured,
  type PushTransport } from "../lib/push/server";

test("subscription validation rejects private endpoints and malformed keys", () => {
  const keys = { p256dh: "a".repeat(87), auth: "b".repeat(22) };
  assert.deepEqual(validateSubscription({ endpoint: "https://push.example.com/device-one", keys }),
    { endpoint: "https://push.example.com/device-one", ...keys });
  for (const endpoint of ["http://push.example.com/one", "https://127.0.0.1/one", "https://localhost/one",
    "https://user:pass@push.example.com/one", "file:///etc/passwd"]) {
    assert.throws(() => validateSubscription({ endpoint, keys }));
  }
  assert.throws(() => validateSubscription({ endpoint: "https://push.example.com/device-one",
    keys: { ...keys, auth: "short" } }));
});

test("isolated Postgres push lifecycle: new, retry, Replace, Add, reaction, preferences, two devices and 410", async (t) => {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL unavailable");
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:push-test@example.invalid";
  assert.equal(vapidConfigured(), true);
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: "require", connect_timeout: 8 });
  const a = randomUUID(), b = randomUUID(), marker = `codex-push-${randomUUID()}`;
  const b1 = randomUUID(), b2 = randomUUID(), a1 = randomUUID();
  const calls: Array<{ endpoint: string; type: string }> = [];
  const send: PushTransport = async (target, payload) => {
    const parsed = JSON.parse(payload) as { type: string; body: string; tag: string };
    assert.equal(parsed.body.includes("@"), false);
    assert(parsed.tag.startsWith(parsed.type === "reaction" ? "reaction:" : "friend-workout:"));
    calls.push({ endpoint: target.endpoint, type: parsed.type });
    if (target.id === b2) throw { statusCode: 410 };
  };
  const item = (session: string, completedAt: string) => ({ clientSessionId: session, workoutName: "Workout A",
    completedAt, localDate: "2026-10-06", durationMinutes: 40, completedExercises: 3, totalExercises: 3 });
  try {
    await sql`insert into treino_social.users (id, google_sub, email, display_name, sharing_enabled)
      values (${a}, ${`${marker}-a`}, ${`${marker}-a@example.invalid`}, 'Alice', true),
             (${b}, ${`${marker}-b`}, ${`${marker}-b@example.invalid`}, 'Bob', true)`;
    await sql`insert into treino_social.friendships (id, requester_user_id, addressee_user_id, status)
      values (${randomUUID()}, ${a}, ${b}, 'accepted')`;
    await sql`insert into treino_social.push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${b1}, ${b}, ${`https://push.example.com/${b1}`}, ${"a".repeat(87)}, ${"b".repeat(22)}),
             (${b2}, ${b}, ${`https://push.example.com/${b2}`}, ${"a".repeat(87)}, ${"b".repeat(22)}),
             (${a1}, ${a}, ${`https://push.example.com/${a1}`}, ${"a".repeat(87)}, ${"b".repeat(22)})`;
    const first = await publishActivity(a, item(`${marker}-one`, "2026-10-06T08:40:00Z"));
    assert.equal(first.created, true);
    await sendFriendWorkoutPush(first.activityId, send);
    assert.equal(calls.filter((call) => call.type === "friend_workout").length, 2);
    assert.equal((await sql`select count(*)::int as n from treino_social.push_subscriptions where user_id = ${b}`)[0].n, 1);
    await sendFriendWorkoutPush(first.activityId, send);
    assert.equal(calls.length, 2, "same event key is claimed only once per device");
    assert.equal((await publishActivity(a, item(`${marker}-one`, "2026-10-06T08:40:00Z"))).created, false);
    const replace = await publishActivity(a, item(`${marker}-one`, "2026-10-06T09:40:00Z"));
    assert.equal(replace.created, false);
    assert.equal(replace.activityId, first.activityId);
    const second = await publishActivity(a, item(`${marker}-two`, "2026-10-06T10:40:00Z"));
    assert.equal(second.created, true);
    await sendFriendWorkoutPush(second.activityId, send);
    assert.equal(calls.filter((call) => call.type === "friend_workout").length, 3);
    await sql`insert into treino_social.push_preferences (user_id, friend_workouts, reactions)
      values (${b}, false, true)`;
    const third = await publishActivity(a, item(`${marker}-three`, "2026-10-06T11:40:00Z"));
    await sendFriendWorkoutPush(third.activityId, send);
    assert.equal(calls.length, 3, "workout preference disables delivery but leaves subscriptions");
    assert.equal(await setReaction(b, first.activityId, "🔥"), true);
    await sendReactionPush(first.activityId, b, "🔥", randomUUID(), send);
    assert.equal(calls.filter((call) => call.type === "reaction").length, 1);
    assert.equal(await setReaction(b, first.activityId, "🔥"), false);
    assert.equal(await setReaction(b, first.activityId, "❤️"), true);
    await sendReactionPush(first.activityId, b, "❤️", randomUUID(), send);
    assert.equal(calls.filter((call) => call.type === "reaction").length, 2);
    assert.equal(await setReaction(b, first.activityId, null), false);
    await sql`insert into treino_social.push_preferences (user_id, friend_workouts, reactions)
      values (${a}, true, false)`;
    assert.equal(await setReaction(b, first.activityId, "💪"), true);
    await sendReactionPush(first.activityId, b, "💪", randomUUID(), send);
    assert.equal(calls.filter((call) => call.type === "reaction").length, 2);
    // Rebinding an existing endpoint transfers ownership; unique endpoint prevents cross-account fan-out.
    await sql`insert into treino_social.push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${randomUUID()}, ${a}, ${`https://push.example.com/${b1}`}, ${"a".repeat(87)}, ${"b".repeat(22)})
      on conflict (endpoint) do update set user_id = excluded.user_id, updated_at = now()`;
    assert.equal((await sql`select user_id from treino_social.push_subscriptions where id = ${b1}`)[0].user_id, a);
    assert.equal((await sql`select count(*)::int as n from treino_social.push_subscriptions where user_id = ${b}`)[0].n, 0);
    await detachPushDevice(new Request("https://treino.example/", { headers: { cookie: `treino_push_device=${b1}` } }), `${marker}-b`);
    assert.equal((await sql`select count(*)::int as n from treino_social.push_subscriptions where id = ${b1}`)[0].n, 1,
      "former account cannot delete the rebound endpoint");
    await detachPushDevice(new Request("https://treino.example/", { headers: { cookie: `treino_push_device=${b1}` } }), `${marker}-a`);
    assert.equal((await sql`select count(*)::int as n from treino_social.push_subscriptions where id = ${b1}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int as n from treino_social.push_subscriptions where id = ${a1}`)[0].n, 1,
      "other devices stay registered");
  } finally {
    await sql`delete from treino_social.users where id in (${a}, ${b}) and google_sub like ${`${marker}%`}`;
    await sql.end({ timeout: 2 });
  }
});
