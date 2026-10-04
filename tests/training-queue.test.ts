import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, parseBackup } from "../lib/training/backup";
import { currentFocusId, remainingExerciseOrder, sessionExerciseOrder } from "../lib/training/queue";
import { cancelTrainingSession, finishTrainingSession, moveTrainingBlockLater, restoreTrainingQueue, setTrainingFocus, skipTrainingBlock, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { startRest } from "../lib/training/rest-timer";
import { parseTrainingData } from "../lib/training/storage";
import { historyEntries, loadProgression, statsOverview } from "../lib/training/statistics";
import { shareSummaryFromSession } from "../lib/training/share-summary";
import type { TrainingData, TrainingPlanRecord } from "../types/training";

const ids = ["A", "B", "C", "D"];
const plan: TrainingPlanRecord = { id: "p", name: "Plan", source: { kind: "builtin", label: "Local" }, version: 2,
  importedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", importWarnings: [], legacyCompletions: [],
  workouts: [{ id: "w", title: "Workout", description: "", restNote: "2 min rest", blocks: ids.map((id) =>
    ({ kind: "exercise" as const, id, section: "Strength", name: id, prescription: "3 × 10", defaultLoad: "5" })) }] };
const base = (): TrainingData => ({ schemaVersion: 5, plans: [structuredClone(plan)], activePlanId: "p", sessions: [], exerciseNotes: [] });
const start = () => startTrainingSession(base(), "p", "w", new Date("2026-10-03T08:00:00Z"), "s").data;
const active = (data: TrainingData) => data.sessions.find((session) => session.id === "s")!;

test("cancel discards only the active draft and timer, preserving plan, notes and completed history", () => {
  const before = finishTrainingSession(start(), "s", "2026-10-03", new Date("2026-10-03T08:40:00Z"));
  let data = startTrainingSession(before, "p", "w", new Date("2026-10-04T08:00:00Z"), "draft").data;
  data = updateTrainingBlock(data, "draft", "A", { actualLoad: "22", completed: true });
  data = skipTrainingBlock(data, "draft", "B", true);
  data = moveTrainingBlockLater(data, "draft", "C");
  data = startRest(data, "draft", 120);
  const cancelled = cancelTrainingSession(data, "draft");
  assert.equal(cancelled.sessions.length, 1);
  assert.equal(cancelled.sessions[0].status, "completed");
  assert.equal(cancelled.restTimer, undefined);
  assert.deepEqual(cancelled.plans, before.plans);
  assert.deepEqual(cancelled.exerciseNotes, before.exerciseNotes);
  assert.deepEqual(cancelled.sessions[0], before.sessions[0]);
  const restarted = startTrainingSession(cancelled, "p", "w", new Date("2026-10-04T09:00:00Z"), "fresh").session;
  assert.equal(restarted.blocks[0].actualLoad, "5");
  assert.equal(restarted.blocks.every((block) => !block.completed && !block.skipped), true);
  assert.deepEqual(restarted.queueOrder, ids);
  assert.throws(() => cancelTrainingSession(cancelled, "draft"));
});

test("session queue moves only today's pending exercise and preserves future plan order", () => {
  let data = start();
  assert.deepEqual(sessionExerciseOrder(active(data)), ids);
  data = updateTrainingBlock(data, "s", "A", { completed: true, actualLoad: "8" });
  data = moveTrainingBlockLater(data, "s", "B");
  assert.deepEqual(remainingExerciseOrder(active(data)), ["C", "D", "B"]);
  assert.equal(currentFocusId(active(data)), "C");
  data = moveTrainingBlockLater(data, "s", "B");
  assert.deepEqual(remainingExerciseOrder(active(data)), ["C", "D", "B"]);
  data = skipTrainingBlock(data, "s", "C", true);
  assert.deepEqual(remainingExerciseOrder(active(data)), ["D", "B"]);
  assert.equal(active(data).blocks.find((block) => block.blockId === "C")?.completed, false);
  assert.equal(active(data).blocks.find((block) => block.blockId === "C")?.skipped, true);
  data = skipTrainingBlock(data, "s", "C", false);
  assert.deepEqual(remainingExerciseOrder(active(data)), ["C", "D", "B"]);
  data = restoreTrainingQueue(data, "s", ids, "B");
  assert.deepEqual(remainingExerciseOrder(active(data)), ["B", "C", "D"]);
  assert.deepEqual(data.plans[0], plan);
  const fresh = startTrainingSession(finishTrainingSession(data, "s", "2026-10-03", new Date("2026-10-03T08:40:00Z")), "p", "w", new Date("2026-10-04T08:00:00Z"), "fresh").session;
  assert.deepEqual(sessionExerciseOrder(fresh), ids);
  assert.equal(fresh.blocks.some((block) => block.skipped), false);
});

test("skipping a middle Focus exercise advances to the next pending member", () => {
  let data = setTrainingFocus(start(), "s", true, "B");
  data = skipTrainingBlock(data, "s", "B", true);
  assert.equal(currentFocusId(active(data)), "C");
  assert.deepEqual(active(data).blocks.map((block) => Boolean(block.skipped)), [false, true, false, false]);
  data = skipTrainingBlock(data, "s", "B", false);
  assert.equal(currentFocusId(active(data)), "B");
});

test("focus, skip and queue survive storage and backup migration; legacy sessions gain original queue", () => {
  let data = start();
  data = setTrainingFocus(data, "s", true, "B");
  data = moveTrainingBlockLater(data, "s", "B");
  data = skipTrainingBlock(data, "s", "C", true);
  const loaded = parseTrainingData(JSON.stringify(data));
  assert.equal(active(loaded).focusMode, true);
  assert.deepEqual(remainingExerciseOrder(active(loaded)), ["A", "D", "B"]);
  const restored = parseBackup(createBackup(loaded)).data;
  assert.deepEqual(restored.sessions[0].queueOrder, loaded.sessions[0].queueOrder);
  assert.equal(restored.sessions[0].blocks.find((block) => block.blockId === "C")?.skipped, true);
  const legacy = structuredClone(data) as unknown as { schemaVersion: number; sessions: Array<Record<string, unknown>> };
  legacy.schemaVersion = 4;
  delete legacy.sessions[0].queueOrder;
  delete legacy.sessions[0].focusMode;
  delete legacy.sessions[0].focusBlockId;
  legacy.sessions[0].blocks = (legacy.sessions[0].blocks as Array<Record<string, unknown>>).map((block) => {
    const copy = { ...block }; delete copy.skipped; return copy;
  });
  const migrated = parseTrainingData(JSON.stringify(legacy));
  assert.deepEqual(sessionExerciseOrder(active(migrated)), ids);
  assert.equal(active(migrated).blocks.some((block) => block.skipped), false);
  assert.deepEqual(migrated.plans, data.plans);
});

test("paired source exercises move together while loads and completion remain individual", () => {
  const data = base();
  const blocks = data.plans[0].workouts[0].blocks;
  if (blocks[1].kind !== "exercise" || blocks[2].kind !== "exercise") throw new Error("Fixture invalid");
  blocks[1].groupId = "pair"; blocks[2].groupId = "pair";
  let workout = startTrainingSession(data, "p", "w", new Date(), "s").data;
  workout = moveTrainingBlockLater(workout, "s", "B");
  assert.deepEqual(remainingExerciseOrder(active(workout)), ["A", "D", "B", "C"]);
  workout = updateTrainingBlock(workout, "s", "B", { completed: true, actualLoad: "12" });
  assert.equal(active(workout).blocks.find((block) => block.blockId === "C")?.completed, false);
  assert.equal(active(workout).blocks.find((block) => block.blockId === "C")?.actualLoad, "5");
});

test("skip is not completion in history, stats, load trend or public sharing", () => {
  let data = start();
  data = updateTrainingBlock(data, "s", "A", { completed: true, actualLoad: "8" });
  data = skipTrainingBlock(data, "s", "B", true);
  data = updateTrainingBlock(data, "s", "C", { completed: true, actualLoad: "10" });
  data = finishTrainingSession(data, "s", "2026-10-03", new Date("2026-10-03T08:42:00Z"));
  const session = data.sessions[0];
  assert.deepEqual(session.blocks.map((block) => [block.completed, Boolean(block.skipped)]), [[true, false], [false, true], [true, false], [false, false]]);
  assert.equal(statsOverview(historyEntries(data), "all", "2026-10-03").exercisesCompleted, 2);
  assert.equal(statsOverview(historyEntries(data), "all", "2026-10-03").averageDuration, 42);
  assert.equal(loadProgression(historyEntries(data), "B").points.length, 0);
  assert.deepEqual([shareSummaryFromSession(session).completedExercises, shareSummaryFromSession(session).totalExercises], [2, 4]);
  assert.equal(JSON.stringify(shareSummaryFromSession(session)).includes("skipped"), false);
});

test("duplicate saved block IDs cannot complete two logical exercises", () => {
  const data = start();
  const saved = structuredClone(data);
  saved.sessions[0].workoutSnapshot.blocks[2].id = saved.sessions[0].workoutSnapshot.blocks[1].id;
  saved.sessions[0].blocks[2].blockId = saved.sessions[0].blocks[1].blockId;
  saved.sessions[0].queueOrder = ["A", "B", "B", "D"];
  const loaded = parseTrainingData(JSON.stringify(saved));
  const updated = updateTrainingBlock(loaded, "s", "B", { completed: true });
  assert.deepEqual(updated.sessions[0].blocks.map((block) => block.completed), [false, true, false, false]);
  assert.deepEqual(sessionExerciseOrder(updated.sessions[0]), ["A", "B", "B~3", "D"]);
  assert.equal(updated.sessions[0].workoutSnapshot.blocks[2].id, "B~3");
  assert.equal(updated.sessions[0].blocks[2].blockId, "B~3");
  assert.deepEqual(parseTrainingData(JSON.stringify(updated)).sessions[0].blocks.map((block) => block.completed), [false, true, false, false]);
});

test("new session repairs duplicate plan IDs before a grouped member can be completed", () => {
  const source = base();
  source.plans[0].workouts[0].blocks[2].id = "B";
  const loaded = parseTrainingData(JSON.stringify(source));
  const started = startTrainingSession(loaded, "p", "w", new Date("2026-10-03T08:00:00Z"), "s").data;
  const updated = updateTrainingBlock(started, "s", "B", { completed: true });
  assert.deepEqual(active(updated).blocks.map((block) => block.completed), [false, true, false, false]);
  assert.equal(active(updated).blocks[2].blockId, "B~3");
});

for (const group of [[], ["B", "C"], ["B", "C", "D"]]) {
  test(`${group.length || "ungrouped"} logical exercises retain independent completion, undo, history and stats`, () => {
    const source = base();
    for (const block of source.plans[0].workouts[0].blocks) {
      if (block.kind === "exercise" && group.includes(block.id)) block.groupId = "source-row-26";
    }
    let data = startTrainingSession(source, "p", "w", new Date("2026-10-03T08:00:00Z"), "s").data;
    const selected = group.length === 3 ? "C" : "B";
    data = updateTrainingBlock(data, "s", selected, { completed: true, actualLoad: "12,5" });
    assert.deepEqual(active(data).blocks.map((block) => block.completed), ids.map((id) => id === selected));
    data = parseTrainingData(JSON.stringify(data));
    assert.deepEqual(active(data).blocks.map((block) => block.completed), ids.map((id) => id === selected));
    assert.equal(currentFocusId(active(data)), "A");
    const finished = finishTrainingSession(data, "s", "2026-10-03", new Date("2026-10-03T08:42:00Z"));
    assert.equal(statsOverview(historyEntries(finished), "all", "2026-10-03").exercisesCompleted, 1);
    assert.deepEqual([shareSummaryFromSession(finished.sessions[0]).completedExercises,
      shareSummaryFromSession(finished.sessions[0]).totalExercises], [1, 4]);
    data = updateTrainingBlock(data, "s", selected, { completed: false });
    assert.deepEqual(active(data).blocks.map((block) => block.completed), [false, false, false, false]);
  });
}

test("Do later, skip, completion and undo keep exact state and queue through reload", () => {
  let data = start();
  data = moveTrainingBlockLater(data, "s", "B");
  data = skipTrainingBlock(data, "s", "C", true);
  data = updateTrainingBlock(data, "s", "A", { completed: true });
  data = parseTrainingData(JSON.stringify(data));
  assert.deepEqual(sessionExerciseOrder(active(data)), ["A", "C", "D", "B"]);
  assert.deepEqual(remainingExerciseOrder(active(data)), ["D", "B"]);
  assert.deepEqual(active(data).blocks.map((block) => [block.completed, Boolean(block.skipped)]),
    [[true, false], [false, false], [false, true], [false, false]]);
  data = updateTrainingBlock(data, "s", "A", { completed: false });
  data = skipTrainingBlock(data, "s", "C", false);
  assert.deepEqual(remainingExerciseOrder(active(data)), ["A", "C", "D", "B"]);
});

test("Focus continues after a completed middle exercise instead of jumping to the first pending one", () => {
  let data = setTrainingFocus(start(), "s", true, "B");
  data = updateTrainingBlock(data, "s", "B", { completed: true });
  assert.deepEqual(active(data).blocks.map((block) => block.completed), [false, true, false, false]);
  assert.equal(currentFocusId(active(data)), "C");
});
