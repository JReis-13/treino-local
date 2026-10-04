import assert from "node:assert/strict";
import test from "node:test";
import { hasActiveWorkout } from "../lib/training/active-workout";
import { PwaUpdateManager, updateBannerLabel, type UpdateSnapshot } from "../lib/pwa/update-manager";
import { cancelTrainingSession, finishTrainingSession, startTrainingSession } from "../lib/training/session";
import { emptyTrainingData } from "../lib/training/storage";
import type { TrainingData, TrainingPlanRecord } from "../types/training";

class Worker extends EventTarget {
  state: ServiceWorkerState = "installed";
  scriptURL: string;
  messages: unknown[] = [];
  failMessage = false;
  constructor(id: string) { super(); this.scriptURL = `https://example.test/${id}.js`; }
  postMessage(message: unknown): void {
    if (this.failMessage) throw Error("worker unavailable");
    this.messages.push(message);
  }
}
class Registration extends EventTarget {
  waiting: Worker | null = null;
  installing: Worker | null = null;
  active: Worker | null = null;
  checks = 0;
  updateAction?: () => void;
  async update(): Promise<void> { this.checks++; this.updateAction?.(); }
}
class Container extends EventTarget {
  controller: Worker | null = null;
  failRegistration = false;
  constructor(readonly registration: Registration) { super(); }
  async register(): Promise<ServiceWorkerRegistration> {
    if (this.failRegistration) throw Error("offline");
    return this.registration as unknown as ServiceWorkerRegistration;
  }
  change(worker: Worker): void { this.controller = worker; this.dispatchEvent(new Event("controllerchange")); }
}
function setup(withController = true) {
  const registration = new Registration();
  const container = new Container(registration);
  if (withController) container.controller = registration.active = new Worker("old");
  const snapshots: UpdateSnapshot[] = [];
  let reloads = 0;
  const manager = new PwaUpdateManager(container as unknown as ServiceWorkerContainer, () => reloads++,
    (snapshot) => snapshots.push(snapshot));
  return { registration, container, manager, snapshots, reloads: () => reloads,
    phase: () => snapshots.at(-1)?.phase };
}

test("first install is not an update; an installed waiting worker is", async () => {
  const x = setup(false);
  await x.manager.start();
  const first = new Worker("first");
  x.registration.installing = first;
  x.registration.dispatchEvent(new Event("updatefound"));
  x.container.change(first);
  assert.equal(x.phase(), "idle");
  const next = new Worker("next");
  x.registration.installing = next;
  x.registration.dispatchEvent(new Event("updatefound"));
  x.registration.waiting = next;
  next.dispatchEvent(new Event("statechange"));
  assert.equal(x.phase(), "ready");
  x.manager.dispose();
});

test("explicit activation waits for new controller and reloads once", async () => {
  const x = setup();
  await x.manager.start();
  const next = x.registration.waiting = new Worker("next");
  x.manager.reconcile();
  assert.equal(x.phase(), "ready");
  await x.manager.apply();
  assert.equal(x.phase(), "updating");
  assert.deepEqual(next.messages, ["SKIP_WAITING"]);
  assert.equal(x.reloads(), 0);
  x.registration.waiting = null;
  x.container.change(next);
  x.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(x.reloads(), 1);
  x.manager.dispose();
});

test("stale update state clears when waiting disappears and update finds nothing", async () => {
  const x = setup();
  await x.manager.start();
  x.registration.waiting = new Worker("next");
  x.manager.reconcile();
  assert.equal(x.phase(), "ready");
  x.registration.waiting = null;
  x.manager.reconcile();
  assert.equal(x.phase(), "idle");
  await x.manager.apply();
  assert.equal(x.phase(), "idle");
  assert.equal(x.registration.checks, 1);
  assert.equal(x.snapshots.at(-1)?.lastResult, "already current");
  x.manager.dispose();
});

test("failed activation has a retry that sends a new request", async () => {
  const x = setup();
  await x.manager.start();
  const next = x.registration.waiting = new Worker("next");
  x.manager.reconcile();
  next.failMessage = true;
  await x.manager.apply();
  assert.equal(x.phase(), "error");
  next.failMessage = false;
  await x.manager.apply();
  assert.equal(x.phase(), "updating");
  assert.deepEqual(next.messages, ["SKIP_WAITING"]);
  x.manager.dispose();
});

test("failed registration exposes a retry that recovers when connection returns", async () => {
  const x = setup();
  x.container.failRegistration = true;
  await x.manager.start();
  assert.equal(x.phase(), "error");
  assert.equal(x.snapshots.at(-1)?.registration, "failed");
  x.container.failRegistration = false;
  await x.manager.apply();
  assert.equal(x.phase(), "idle");
  x.manager.dispose();
});

test("another tab activation is actionable without a waiting worker", async () => {
  const x = setup();
  await x.manager.start();
  x.container.change(new Worker("next"));
  assert.equal(x.phase(), "activated");
  assert.equal(x.reloads(), 0);
  await x.manager.apply();
  assert.equal(x.reloads(), 1);
  x.manager.dispose();
});

const plan: TrainingPlanRecord = { id: "plan", name: "Plan", source: { kind: "builtin", label: "Local" },
  version: 1, importedAt: "2026-10-04", updatedAt: "2026-10-04", importWarnings: [], legacyCompletions: [],
  workouts: [{ id: "workout", title: "Workout", description: "", blocks: [] }] };
function data(): TrainingData { return { ...emptyTrainingData(), plans: [plan], activePlanId: plan.id }; }

test("only a resumable in-progress session defers updates; cancel and finish release it", () => {
  const started = startTrainingSession(data(), "plan", "workout", new Date("2026-10-04T08:00:00Z"), "session").data;
  assert.equal(hasActiveWorkout(started), true);
  assert.equal(hasActiveWorkout({ ...started, activePlanId: undefined }), true);
  assert.equal(hasActiveWorkout({ ...started, plans: [] }), false);
  assert.equal(hasActiveWorkout(cancelTrainingSession(started, "session")), false);
  const finished = finishTrainingSession(started, "session", "2026-10-04");
  assert.equal(hasActiveWorkout(finished), false);
  assert.equal(finished.sessions[0].status, "completed");
  assert.deepEqual(finished.plans, started.plans);
});

test("Home update copy depends on the live session, not selected plan or stale UI", () => {
  assert.equal(updateBannerLabel("ready", false, true), "New version available");
  assert.equal(updateBannerLabel("ready", true, true), "New version available — update after this workout");
  assert.equal(updateBannerLabel("ready", false, false), "Update available · offline");
  assert.equal(updateBannerLabel("updating", false, true), "Updating…");
  assert.equal(updateBannerLabel("error", false, true), "Update couldn’t be applied.");
});
