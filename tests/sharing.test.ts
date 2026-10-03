import assert from "node:assert/strict";
import test from "node:test";
import { createShareCardSvg, SHARE_CARD_SIZE } from "../lib/training/share-card";
import { shareWorkout } from "../lib/training/share-action";
import { defaultShareText, shareDate, shareSummaryFromLegacy, shareSummaryFromSession } from "../lib/training/share-summary";
import type { TrainingSession } from "../types/training";

const session = (): TrainingSession => ({
  id: "private-id", planId: "private-plan", planVersion: 1, workoutId: "A", status: "completed",
  startedAt: "2026-10-03T08:00:00+02:00", completedAt: "2026-10-03T08:42:00+02:00", localDate: "2026-10-03",
  workoutSnapshot: { id: "A", title: "Treino rápido 💪", description: "private-description", blocks: [
    { kind: "exercise", id: "squat", section: "A", name: "Squat", prescription: "3x10", defaultLoad: "PRIVATE-PLAN-LOAD", note: "PRIVATE-EXERCISE-NOTE" },
    { kind: "exercise", id: "press", section: "A", name: "Press", prescription: "3x10" },
    { kind: "instruction", id: "warmup", section: "A", heading: "Warmup", text: "Private instruction" },
  ] },
  blocks: [{ blockId: "squat", completed: true, actualLoad: "PRIVATE-ACTUAL-LOAD" }, { blockId: "press", completed: false }, { blockId: "warmup", completed: true }],
  syncStatus: "failed", syncMessage: "PRIVATE-SYNC-STATUS", sessionNote: "PRIVATE-SESSION-NOTE",
  completionReceipt: { sourceKind: "google", sourceId: "PRIVATE-SHEET-ID", workoutId: "A", slot: "E5", syncedAt: "2026-10-03" },
});

test("share summary uses actual local date, duration and exercise-only partial count", () => {
  const summary = shareSummaryFromSession(session());
  assert.deepEqual(summary, { workoutName: "Treino rápido 💪", localDate: "2026-10-03", durationMinutes: 42, completedExercises: 1, totalExercises: 2 });
  assert.equal(defaultShareText(summary), "Treino rápido 💪 completed 💪\n42 min · 1/2 exercises\n03 Oct 2026");
  assert.equal(shareDate("2026-10-03"), "03 Oct 2026");
  assert.match(defaultShareText({ ...summary, durationMinutes: 0 }), /under 1 min/);
  assert.match(createShareCardSvg({ ...summary, durationMinutes: 0 }), /&lt;1/);
});

test("normal, same-day, older, missing-duration and date-only summaries remain honest", () => {
  const complete = session(); complete.blocks[1].completed = true;
  assert.equal(shareSummaryFromSession(complete).completedExercises, 2);
  const sameDay = { ...complete, id: "second", completedAt: "2026-10-03T19:12:00+02:00" };
  assert.equal(shareSummaryFromSession(sameDay).localDate, shareSummaryFromSession(complete).localDate);
  assert.deepEqual([shareSummaryFromSession({ ...complete, blocks: complete.blocks.slice(0, 1) }).completedExercises,
    shareSummaryFromSession({ ...complete, blocks: complete.blocks.slice(0, 1) }).totalExercises], [1, 2]);
  assert.equal(shareSummaryFromSession({ ...complete, blocks: [] }).totalExercises, undefined);
  const older = { ...complete, localDate: "2025-09-29" };
  assert.match(defaultShareText(shareSummaryFromSession(older)), /29 Sep 2025/);
  const missing = { ...complete, completedAt: undefined };
  const missingSummary = shareSummaryFromSession(missing);
  assert.equal(missingSummary.durationMinutes, undefined);
  assert.doesNotMatch(defaultShareText(missingSummary), /0 min/);
  const legacy = shareSummaryFromLegacy({ id: "legacy", workoutId: "A", date: "2026-10-03", sourceSlot: "E5" }, "Workout A");
  assert.deepEqual(legacy, { workoutName: "Workout A", localDate: "2026-10-03" });
  assert.doesNotMatch(defaultShareText(legacy), /exercises|min/);
});

test("public representation excludes private session, load, notes, source and identity data", () => {
  const privateSession = { ...session(), googleEmail: "PRIVATE-EMAIL", spreadsheetUrl: "PRIVATE-SHEET-URL", excelFilename: "PRIVATE-XLSX", oauthToken: "PRIVATE-OAUTH", exerciseNotes: "PRIVATE-PERSISTENT-NOTE" };
  const summary = shareSummaryFromSession(privateSession);
  const publicOutput = JSON.stringify(summary) + defaultShareText(summary) + createShareCardSvg(summary);
  for (const secret of ["PRIVATE-ACTUAL-LOAD", "PRIVATE-PLAN-LOAD", "PRIVATE-EXERCISE-NOTE", "PRIVATE-SESSION-NOTE", "PRIVATE-PERSISTENT-NOTE", "PRIVATE-EMAIL", "PRIVATE-SHEET-ID", "PRIVATE-SHEET-URL", "PRIVATE-XLSX", "PRIVATE-SYNC-STATUS", "PRIVATE-OAUTH", "private-id", "private-plan"]) {
    assert.equal(publicOutput.includes(secret), false, secret);
  }
  assert.deepEqual(Object.keys(summary).sort(), ["completedExercises", "durationMinutes", "localDate", "totalExercises", "workoutName"]);
});

test("card has fixed square dimensions, escapes untrusted names, and omits unavailable metrics", () => {
  const summary = shareSummaryFromLegacy({ id: "one", workoutId: "A", date: "2026-10-03", sourceSlot: "E5" }, `<script>alert("bad")</script> & Café 💪\u0000`);
  const svg = createShareCardSvg(summary);
  assert.match(svg, new RegExp(`width="${SHARE_CARD_SIZE}" height="${SHARE_CARD_SIZE}"`));
  assert.doesNotMatch(svg, /<script>|0<\/text>|exercises<\/text>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /Café/);
  assert.doesNotMatch(svg, /\u0000/);
  const long = createShareCardSvg({ ...summary, workoutName: "Muito longo 🏋️ ".repeat(30), durationMinutes: 38, completedExercises: 6, totalExercises: 8 });
  assert.match(long, /6 \/ 8 exercises/);
  assert.match(long, /38/);
  assert.match(long, /…/);
  assert.equal((long.match(/<tspan x="96"/g) ?? []).length, 3);
});

test("native image and text, text-only, cancellation and unsupported-share behavior", async () => {
  const file = new File(["image"], "card.png", { type: "image/png" });
  const calls: unknown[] = [];
  assert.equal(await shareWorkout("edited", file, { canShare: () => true, share: async (data) => { calls.push(data); } }), "shared");
  assert.deepEqual(calls[0], { files: [file], text: "edited" });
  assert.equal(await shareWorkout("text", file, { canShare: () => false, share: async (data) => { calls.push(data); } }), "shared");
  assert.deepEqual(calls[1], { text: "text" });
  let attempts = 0;
  assert.equal(await shareWorkout("retry", file, { canShare: () => true, share: async (data) => {
    attempts++;
    if (data.files) throw new Error("Image attachment unsupported");
  } }), "shared");
  assert.equal(attempts, 2);
  assert.equal(await shareWorkout("cancel", file, { share: async () => { throw new DOMException("Cancel", "AbortError"); } }), "cancelled");
  assert.equal(await shareWorkout("error", file, { share: async () => { throw new Error("Unavailable"); } }), "failed");
  assert.equal(await shareWorkout("error", file, { canShare: () => { throw new Error("bad"); }, share: async () => {} }), "shared");
  assert.equal(await shareWorkout("none", undefined, {}), "unsupported");
});
