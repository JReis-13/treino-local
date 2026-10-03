import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, parseBackup } from "../lib/training/backup";
import { currentFocusId, remainingExerciseOrder, sessionExerciseOrder } from "../lib/training/queue";
import { finishTrainingSession, moveTrainingBlockLater, restoreTrainingQueue, setTrainingFocus, skipTrainingBlock, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
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
