import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, parseBackup } from "../lib/training/backup";
import { exerciseKey, exerciseNote, updateExerciseNote } from "../lib/training/exercise-notes";
import { comparableLoadSummary, exerciseLoadHistory } from "../lib/training/exercise-history";
import { extendRest, pauseRest, remainingSeconds, resumeRest, skipRest, startRest, suggestedRest } from "../lib/training/rest-timer";
import { finishTrainingSession, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { parseYouTubeVideo } from "../lib/video-url";
import type { TrainingData, TrainingPlanRecord } from "../types/training";

const plan = (id: string): TrainingPlanRecord => ({ id, name: id, source: { kind: "builtin", label: "Local" }, version: 1,
  importedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", importWarnings: [], legacyCompletions: [],
  workouts: [{ id: "A", title: "Workout A", description: "", restNote: "intervalo 2'",
    blocks: [{ kind: "exercise", id: "A-squat", section: "Strength", name: "Agachamento Goblet", prescription: "3x10", defaultLoad: "15 kg" }] }] });
const base = (): TrainingData => ({ ...emptyTrainingData(), plans: [plan("one"), plan("two")], activePlanId: "one" });

test("only whitelisted YouTube links create privacy-enhanced embeds", () => {
  for (const url of ["https://www.youtube.com/watch?v=spjnmreGb7U&t=12", "https://youtube.com/shorts/spjnmreGb7U?feature=share",
    "https://youtu.be/spjnmreGb7U?si=extra"]) {
    const result = parseYouTubeVideo(url)!;
    assert.equal(result.id, "spjnmreGb7U");
    assert.equal(result.embedUrl, "https://www.youtube-nocookie.com/embed/spjnmreGb7U?autoplay=1&rel=0");
    assert.equal(result.externalUrl, "https://www.youtube.com/watch?v=spjnmreGb7U");
  }
  for (const url of ["https://youtube.com/watch?v=short", "https://youtube.com.evil.test/watch?v=spjnmreGb7U",
    "https://youtube.com@evil.test/watch?v=spjnmreGb7U", "http://youtube.com/watch?v=spjnmreGb7U",
    "javascript:alert(1)", "https://vimeo.com/123", "https://youtube.com/watch?v=spjnmreGb7U%3Cscript%3E"])
    assert.equal(parseYouTubeVideo(url), undefined);
});

test("persistent exercise notes isolate plan and normalized exercise, survive migration and backup", () => {
  let data = base();
  assert.equal(exerciseKey("  AGACHAMENTO   Goblet  "), exerciseKey("agachamento goblet"));
  data = updateExerciseNote(data, "one", "Agachamento Goblet", "seat position 4", "2026-10-03T00:00:00Z");
  data = updateExerciseNote(data, "two", "Agachamento Goblet", "other machine", "2026-10-03T00:00:00Z");
  data = updateExerciseNote(data, "one", "Remada", "narrow grip", "2026-10-03T00:00:00Z");
  assert.equal(exerciseNote(data, "one", "agachamento goblet"), "seat position 4");
  assert.equal(exerciseNote(data, "two", "agachamento goblet"), "other machine");
  assert.equal(exerciseNote(data, "one", "Remada"), "narrow grip");
  data = updateExerciseNote(data, "one", "Agachamento Goblet", "  seat position 3  ");
  assert.equal(exerciseNote(data, "one", "Agachamento Goblet"), "seat position 3");
  const restored = parseBackup(createBackup(data)).data;
  assert.equal(exerciseNote(restored, "one", "Agachamento Goblet"), "seat position 3");
  assert.equal(restored.restTimer, undefined);
  data = updateExerciseNote(data, "one", "Agachamento Goblet", "");
  assert.equal(exerciseNote(data, "one", "Agachamento Goblet"), "");
  assert.equal(exerciseNote(data, "two", "Agachamento Goblet"), "other machine");
  const v3 = { ...base(), schemaVersion: 3, exerciseNotes: undefined };
  const migrated = parseTrainingData(JSON.stringify(v3));
  assert.equal(migrated.schemaVersion, 5);
  assert.deepEqual(migrated.exerciseNotes, []);
  assert.deepEqual(migrated.plans, base().plans);
});

test("session note is local history, backed up, and timer clears on Add or Replace completion", () => {
  let data = startTrainingSession(base(), "one", "A", new Date("2026-10-03T08:00:00Z"), "session-one").data;
  data = startRest(data, "session-one", 120, Date.parse("2026-10-03T08:01:00Z"));
  data = updateTrainingBlock(data, "session-one", "A-squat", { completed: true, actualLoad: "16 kg" });
  data = finishTrainingSession(data, "session-one", "2026-10-03", new Date("2026-10-03T08:40:00Z"), "normal", undefined, "Workout felt good");
  assert.equal(data.restTimer, undefined);
  assert.equal(data.sessions[0].sessionNote, "Workout felt good");
  assert.equal(parseBackup(createBackup(data)).data.sessions[0].sessionNote, "Workout felt good");
  data = startTrainingSession(data, "one", "A", new Date("2026-10-03T18:00:00Z"), "session-two").data;
  data = startRest(data, "session-two", 120);
  data = finishTrainingSession(data, "session-two", "2026-10-03", new Date("2026-10-03T18:30:00Z"), "add", undefined, "Second session");
  assert.equal(data.restTimer, undefined);
  assert.equal(data.sessions.length, 2);
  data = startTrainingSession(data, "one", "A", new Date("2026-10-03T20:00:00Z"), "session-three").data;
  data = startRest(data, "session-three", 120);
  data = finishTrainingSession(data, "session-three", "2026-10-03", new Date("2026-10-03T20:30:00Z"), "replace", "session-one", "Replacement");
  assert.equal(data.restTimer, undefined);
  assert.equal(data.sessions.find((item) => item.id === "session-one")?.sessionNote, "Replacement");
  data = startTrainingSession(data, "one", "A", new Date("2026-10-03T21:00:00Z"), "session-four").data;
  data = finishTrainingSession(data, "session-four", "2026-10-03", new Date("2026-10-03T21:30:00Z"), "replace", "session-one");
  assert.equal(data.sessions.find((item) => item.id === "session-one")?.sessionNote, "Replacement");
});

test("exercise history uses completed actual loads for the same plan and normalized name", () => {
  let data = base();
  data = startTrainingSession(data, "one", "A", new Date("2026-10-01T08:00:00Z"), "first").data;
  data = updateTrainingBlock(data, "first", "A-squat", { completed: true, actualLoad: "12.5 kg" });
  data = finishTrainingSession(data, "first", "2026-10-01", new Date("2026-10-01T08:30:00Z"));
  data = startTrainingSession(data, "one", "A", new Date("2026-10-02T08:00:00Z"), "second").data;
  data = updateTrainingBlock(data, "second", "A-squat", { completed: true, actualLoad: "15 kg" });
  data = finishTrainingSession(data, "second", "2026-10-02", new Date("2026-10-02T08:30:00Z"));
  data = startTrainingSession(data, "two", "A", new Date("2026-10-03T08:00:00Z"), "other-plan").data;
  data = updateTrainingBlock(data, "other-plan", "A-squat", { completed: true, actualLoad: "30 kg" });
  data = finishTrainingSession(data, "other-plan", "2026-10-03", new Date("2026-10-03T08:30:00Z"));
  data = startTrainingSession(data, "one", "A", new Date("2026-10-04T08:00:00Z"), "ongoing").data;
  data = updateTrainingBlock(data, "ongoing", "A-squat", { completed: true, actualLoad: "40 kg" });
  const history = exerciseLoadHistory(data, "one", "  agachamento GOBLET ");
  assert.deepEqual(history.map((item) => item.load), ["15 kg", "12.5 kg"]);
  assert.equal(comparableLoadSummary(history).highest, 15);
  assert.equal(comparableLoadSummary(history).unit, "kg");
  assert.deepEqual(exerciseLoadHistory(data, "one", "Other exercise"), []);
  assert.equal(comparableLoadSummary([{ ...history[0], load: "15 kg" }, { ...history[1], load: "20" }]).highest, undefined);
});

test("timestamp timer survives reload and background time, then pauses, extends and skips", () => {
  const start = Date.parse("2026-10-03T08:00:00Z");
  let data = startTrainingSession(base(), "one", "A", new Date(start), "session").data;
  data = startRest(data, "session", 120, start);
  assert.equal(remainingSeconds(data.restTimer!, start + 61_000), 59);
  data = parseTrainingData(JSON.stringify(data));
  assert.equal(remainingSeconds(data.restTimer!, start + 121_000), 0);
  data = extendRest(data, 30, start + 121_000);
  assert.equal(remainingSeconds(data.restTimer!, start + 121_000), 30);
  data = pauseRest(data, start + 131_000);
  assert.equal(remainingSeconds(data.restTimer!, start + 500_000), 20);
  data = extendRest(data, 60, start + 500_000);
  assert.equal(remainingSeconds(data.restTimer!, start + 500_000), 80);
  data = resumeRest(data, start + 500_000);
  assert.equal(remainingSeconds(data.restTimer!, start + 535_000), 45);
  data = skipRest(data);
  assert.equal(data.restTimer, undefined);
  assert.throws(() => startRest(data, "missing", 120), /cannot start/);
});

test("rest advice uses only explicit time guidance and documents range default", () => {
  assert.deepEqual(suggestedRest("intervalo 2'"), { seconds: 120, label: "2 min recommended" });
  assert.deepEqual(suggestedRest("1 a 2' entre séries"), { seconds: 120, label: "1–2 min suggested; starts at 2 min" });
  assert.equal(suggestedRest("3 x 10 repetitions"), undefined);
  assert.equal(suggestedRest("Rest as needed"), undefined);
});
