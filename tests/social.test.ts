import assert from "node:assert/strict";
import test from "node:test";
import { isReactionEmoji, parsePublishActivity, REACTIONS } from "../lib/social/model";
import { cacheSocialPreference, flushSocialOutbox, queueSocialActivity } from "../lib/social/client";
import type { TrainingSession } from "../types/training";

const session = (name = "Workout A", completedAt = "2026-10-04T08:40:00.000Z"): TrainingSession => ({
  id: "safe-session", planId: "p", planVersion: 1, workoutId: "A", status: "completed", startedAt: "2026-10-04T08:00:00.000Z",
  completedAt, localDate: "2026-10-04", workoutSnapshot: { id: "A", title: name, description: "Secret description",
    blocks: [{ kind: "exercise", id: "squat", section: "Strength", name: "Secret exercise", prescription: "3x10", defaultLoad: "90 kg", videoUrl: "https://example.com/private" }] },
  blocks: [{ blockId: "squat", completed: true, actualLoad: "100 kg" }], sessionNote: "Private workout note",
  syncStatus: "notApplicable",
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
