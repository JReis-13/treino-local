import assert from "node:assert/strict";
import test from "node:test";
import { isReactionEmoji, parsePublishActivity, REACTIONS } from "../lib/social/model";
import { buildSocialWorkoutActivity, cacheSocialPreference, flushSocialOutbox, queueSocialActivity, refreshSocialPreference,
  readSocialDiagnostics, socialPreferenceRevision, shareSessionWithFriends, localSocialPublishState } from "../lib/social/client";
import type { TrainingSession } from "../types/training";

const session = (name = "Workout A", completedAt = "2026-10-04T08:40:00.000Z"): TrainingSession => ({
  id: "safe-session", planId: "p", planVersion: 1, workoutId: "A", status: "completed", startedAt: "2026-10-04T08:00:00.000Z",
  completedAt, localDate: "2026-10-04", workoutSnapshot: { id: "A", title: name, description: "Secret description",
    blocks: [{ kind: "exercise", id: "squat", section: "Strength", name: "Secret exercise", prescription: "3x10", defaultLoad: "90 kg", videoUrl: "https://example.com/private" }] },
  blocks: [{ blockId: "squat", completed: true, actualLoad: "100 kg" }], sessionNote: "Private workout note",
  syncStatus: "notApplicable",
});

test("an unhydrated automatic share persists an eligibility record instead of discarding the saved session", async () => {
  const values = new Map<string, string>();
  const oldStorage = globalThis.localStorage, oldNavigator = globalThis.navigator, oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => values.delete(key) } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  try {
    assert.equal(queueSocialActivity(session()), true);
    assert.equal(JSON.parse(values.get("treino-social-eligibility-v1") ?? "[]").length, 1);
    assert.equal(localSocialPublishState("safe-session"), "eligibility_pending");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(JSON.parse(values.get("treino-social-eligibility-v1") ?? "[]").length, 1);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: oldStorage });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: oldNavigator });
    globalThis.fetch = oldFetch;
  }
});

test("manual one-session share works with automatic sharing OFF without private payload fields", async () => {
  const values = new Map<string, string>();
  const oldStorage = globalThis.localStorage, oldNavigator = globalThis.navigator, oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => values.delete(key) } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  let posts = 0;
  globalThis.fetch = (async (url: string, options?: RequestInit) => {
    if (url.endsWith("/me")) return new Response(JSON.stringify({ email: "a@example.com", accountId: "account-a",
      displayName: "A", sharingEnabled: false }), { status: 200 });
    posts++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.manualShare, true);
    assert(!JSON.stringify(body).includes("100 kg"));
    assert(!JSON.stringify(body).includes("Private"));
    return new Response(JSON.stringify({ ok: true, activityId: "activity-a" }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await shareSessionWithFriends(session()), true);
    assert.equal(posts, 1);
    assert.equal(localSocialPublishState("safe-session"), "shared");
    assert.equal(readSocialDiagnostics().sharingCached, "false");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: oldStorage });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: oldNavigator });
    globalThis.fetch = oldFetch;
  }
});

test("activity input is allowlisted and validates bounds and emoji", () => {
  const raw = { clientSessionId: "safe-session", workoutName: "Workout A", completedAt: "2026-10-04T08:40:00.000Z",
    localDate: "2026-10-04", durationMinutes: 40, completedExercises: 1, totalExercises: 1,
    actualLoad: "100 kg", sessionNote: "secret", spreadsheetId: "secret", googleToken: "secret" };
  const parsed = parsePublishActivity(raw);
  assert.deepEqual(Object.keys(parsed ?? {}).sort(), ["clientSessionId", "workoutName", "completedAt", "localDate", "durationMinutes", "completedExercises", "totalExercises"].sort());
  assert(!JSON.stringify(parsed).includes("secret"));
  assert.equal(parsePublishActivity({ ...raw, clientSessionId: "bad id" }), null);
  assert.equal(parsePublishActivity({ ...raw, localDate: "2026-02-30" }), null);
  assert.equal(parsePublishActivity({ ...raw, completedExercises: 2 }), null);
  assert.equal(REACTIONS.length, 5);
  assert.equal(isReactionEmoji("🔥"), true);
  assert.equal(isReactionEmoji("unsafe"), false);
});

test("the social builder uses only a finalized session and omits private workout data", () => {
  const saved = session();
  const draft = { ...saved, status: "inProgress" as const, completedAt: undefined };
  assert.equal(buildSocialWorkoutActivity(draft), null);
  const payload = buildSocialWorkoutActivity(saved);
  assert.equal(payload?.clientSessionId, saved.id);
  assert.deepEqual(Object.keys(payload ?? {}).sort(), ["clientSessionId", "workoutName", "completedAt", "localDate",
    "durationMinutes", "completedExercises", "totalExercises"].sort());
  assert(!JSON.stringify(payload).includes("Private"));
  assert(!JSON.stringify(payload).includes("100 kg"));
  assert(!JSON.stringify(payload).includes("Secret"));
  const longSession = { ...saved, startedAt: "2026-10-02T08:00:00.000Z" };
  assert.equal(buildSocialWorkoutActivity(longSession)?.durationMinutes, null,
    "a long-running local workout still produces a valid social summary");
});

test("offline outbox contains only a safe summary, Replace overwrites it, and retry publishes once", async () => {
  const values = new Map<string, string>();
  const oldStorage = globalThis.localStorage, oldNavigator = globalThis.navigator, oldFetch = globalThis.fetch;
  const sent: unknown[] = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  try {
    cacheSocialPreference({ email: "a@example.com", displayName: "A", sharingEnabled: true });
    queueSocialActivity(session());
    queueSocialActivity(session("Workout B", "2026-10-04T09:40:00.000Z"));
    await flushSocialOutbox();
    const queued = JSON.parse(values.get("treino-social-outbox-v1") ?? "[]");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].activity.workoutName, "Workout B");
    assert(!JSON.stringify(queued).includes("100 kg"));
    assert(!JSON.stringify(queued).includes("Private"));
    assert(!JSON.stringify(queued).includes("example.com/private"));
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    let identity = "b@example.com";
    globalThis.fetch = (async (url: string, options?: RequestInit) => {
      if (url.endsWith("/me")) return new Response(JSON.stringify({ email: identity, displayName: "A", sharingEnabled: true }), { status: 200 });
      sent.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await flushSocialOutbox();
    assert.equal(sent.length, 0, "a queued workout must never publish under a different Google account");
    identity = "a@example.com";
    await flushSocialOutbox();
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as { workoutName: string }).workoutName, "Workout B");
    assert.equal(JSON.parse(values.get("treino-social-outbox-v1") ?? "[]").length, 0);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: oldStorage });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: oldNavigator });
    globalThis.fetch = oldFetch;
  }
});

test("stale sharing cache cannot suppress a verified ON account; reload, Add and Replace retain correct queued IDs", async () => {
  const values = new Map<string, string>();
  const oldStorage = globalThis.localStorage, oldNavigator = globalThis.navigator, oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  try {
    cacheSocialPreference({ email: "a@example.com", displayName: "A", accountId: "account-a", sharingEnabled: false });
    const first = session();
    const second = { ...session("Workout A", "2026-10-04T18:40:00.000Z"), id: "safe-session-two" };
    assert.equal(queueSocialActivity(first), true);
    assert.equal(queueSocialActivity(second), true);
    const replacingFirst = { ...session("Workout A revised", "2026-10-04T10:40:00.000Z"), id: first.id };
    assert.equal(queueSocialActivity(replacingFirst), true);
    let queued = JSON.parse(values.get("treino-social-eligibility-v1") ?? "[]");
    assert.equal(queued.length, 2);
    assert.deepEqual(new Set(queued.map((item: { activity: { clientSessionId: string } }) => item.activity.clientSessionId)),
      new Set([first.id, second.id]));
    assert.equal(queued.find((item: { activity: { clientSessionId: string } }) => item.activity.clientSessionId === first.id)
      .activity.workoutName, "Workout A revised");
    const revision = socialPreferenceRevision();
    cacheSocialPreference({ email: "a@example.com", displayName: "A", accountId: "account-a", sharingEnabled: true }, undefined, true);
    cacheSocialPreference({ email: "a@example.com", displayName: "A", accountId: "account-a", sharingEnabled: false }, revision);
    assert.equal(readSocialDiagnostics().sharingCached, "true", "an older GET cannot roll back a saved toggle");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    const posted: Array<{ clientSessionId: string; workoutName: string }> = [];
    globalThis.fetch = (async (url: string, options?: RequestInit) => {
      if (url.endsWith("/me")) return new Response(JSON.stringify({ email: "a@example.com", accountId: "account-a",
        displayName: "A", sharingEnabled: true }), { status: 200 });
      posted.push(JSON.parse(String(options?.body)));
      assert.equal((options?.headers as Record<string, string>)["X-Treino-Social-Account"], "account-a");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await refreshSocialPreference();
    await flushSocialOutbox();
    queued = JSON.parse(values.get("treino-social-outbox-v1") ?? "[]");
    assert.equal(queued.length, 0);
    assert.equal(posted.length, 2);
    assert.equal(posted.find((item) => item.clientSessionId === first.id)?.workoutName, "Workout A revised");
    assert.equal(posted.find((item) => item.clientSessionId === second.id)?.workoutName, "Workout A");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: oldStorage });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: oldNavigator });
    globalThis.fetch = oldFetch;
  }
});
