import assert from "node:assert/strict";
import test from "node:test";
import { WORKOUTS } from "../data/workouts";
import { isLocalDate, localDateString } from "../lib/dates";
import { finishSession, startSession, updateExercise } from "../lib/session";
import { parseStoredData } from "../lib/storage";
import type { AppData } from "../types/workout";

const empty = (): AppData => ({ schemaVersion: 1, sessions: [] });

test("reviewed plan has 11 ordered exercises and exact video links per workout", () => {
  for (const id of ["A", "B"] as const) {
    const plan = WORKOUTS[id];
    assert.equal(plan.exercises.length, 11);
    assert.deepEqual(plan.exercises.map((item) => item.order), Array.from({ length: 11 }, (_, index) => index + 1));
    assert.equal(plan.exercises.filter((item) => item.section === "warmup").length, 3);
    assert.equal(new Set(plan.exercises.map((item) => item.id)).size, 11);
    assert(plan.exercises.every((item) => item.videoUrl.startsWith("https://www.youtube.com/")));
  }
  assert.equal(WORKOUTS.A.exercises[8].defaultLoad, undefined);
  assert(WORKOUTS.B.exercises.every((item) => item.defaultLoad === undefined));
  assert.equal(WORKOUTS.B.exercises[9].prescription.unit, "seconds");
});

test("session completion persists only session loads and a full local date", () => {
  const began = startSession(empty(), "A", new Date("2026-09-30T06:00:00Z"), "session-1");
  const exerciseId = WORKOUTS.A.exercises[3].id;
  const updated = updateExercise(began.data, began.session.id, exerciseId, { completed: true, actualLoad: "9" });
  const completed = finishSession(updated, began.session.id, "2026-09-30", new Date("2026-09-30T06:42:00Z"));
  assert.equal(completed.sessions[0].status, "completed");
  assert.equal(completed.sessions[0].syncStatus, "notConfigured");
  assert.equal(completed.sessions[0].localDate, "2026-09-30");
  assert.equal(completed.sessions[0].exercises[3].actualLoad, "9");
  assert.equal(WORKOUTS.A.exercises[3].defaultLoad, "8");
  assert.deepEqual(parseStoredData(JSON.stringify(completed)), completed);
});

test("in-progress work resumes and invalid saved records fail safely", () => {
  const first = startSession(empty(), "B", new Date(), "session-2");
  const next = startSession(first.data, "A", new Date(), "session-3");
  assert.equal(next.session.id, "session-2");
  assert.equal(next.data.sessions.length, 1);
  assert.throws(() => parseStoredData("{broken"));
  assert.throws(() => parseStoredData(JSON.stringify({ schemaVersion: 1, sessions: [{ id: "bad" }] })));
  assert.throws(() => finishSession(first.data, "session-2", "2026-02-30"));
});

test("date helpers validate full dates and derive local calendar dates", () => {
  assert.equal(isLocalDate("2026-09-30"), true);
  assert.equal(isLocalDate("2026-02-30"), false);
  const local = localDateString(new Date(2026, 8, 30, 23, 50));
  assert.equal(local, "2026-09-30");
});
