import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("generated worker handles push and click while preserving the PWA update handlers", async () => {
  const source = readFileSync("scripts/generate-sw.mjs", "utf8");
  const template = /const sw = `([\s\S]*?)`;\s*await writeFile/.exec(source)?.[1];
  assert(template, "service worker template exists");
  const script = vm.runInNewContext(`\`${template}\``, { version: "test-build", precache: ["/"] }) as string;
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  let skipWaiting = 0, focused = 0, opened = 0;
  const client = { url: "https://treino.example/workout", focus: async () => { focused++; } };
  const self = {
    location: { origin: "https://treino.example" },
    addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
    skipWaiting: async () => { skipWaiting++; },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    clients: { claim: async () => {}, matchAll: async () => [client], openWindow: async () => { opened++; } },
  };
  vm.runInNewContext(script, { self, caches: {}, indexedDB: undefined, URL, Promise, Date });
  for (const name of ["install", "message", "activate", "fetch", "push", "notificationclick"])
    assert(handlers.has(name), `${name} handler remains registered`);
  let work: Promise<unknown> = Promise.resolve();
  handlers.get("message")!({ data: "SKIP_WAITING", waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  assert.equal(skipWaiting, 1);
  let build = "";
  handlers.get("message")!({ data: "GET_BUILD_ID", ports: [{ postMessage: (value: string) => { build = value; } }] });
  assert.equal(build, "test-build");
  handlers.get("push")!({ data: { json: () => ({ type: "friend_workout",
    activityId: "11111111-1111-4111-8111-111111111111", body: "Milena finished a workout 💪",
    traceId: "11111111-1111-4111-8111-111111111111",
    tag: "friend-workout:11111111-1111-4111-8111-111111111111" }) },
    waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, "Treino Local");
  assert.equal(shown[0].options.tag, "friend-workout:11111111-1111-4111-8111-111111111111");
  handlers.get("push")!({ data: { json: () => ({ type: "unknown", body: "bad" }) },
    waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  assert.equal(shown.length, 1, "malformed payload does not notify");
  handlers.get("notificationclick")!({ notification: { close: () => {} },
    waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  assert.equal(focused, 1);
  assert.equal(opened, 0);
  assert.equal(skipWaiting, 1, "push and click do not change update state");
});
