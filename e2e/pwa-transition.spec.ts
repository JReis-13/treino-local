import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { test, expect } from "@playwright/test";

let server: Server;
let origin: string;
let managerScript: string;
let version = "one";

test.beforeAll(async () => {
  const output = await build({ entryPoints: [resolve(__dirname, "../lib/pwa/update-manager.ts")], bundle: true, write: false,
    platform: "browser", format: "iife", globalName: "PwaUpdate", target: "es2020" });
  managerScript = output.outputFiles[0].text;
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/sw.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`const VERSION = ${JSON.stringify(version)};
        self.addEventListener("install", event => event.waitUntil(caches.open("treino-test-" + VERSION).then(cache => cache.addAll(["/", "/manager.js"]))));
        self.addEventListener("message", event => {
          if (event.data === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
          if (event.data === "GET_BUILD_ID") event.ports[0]?.postMessage(VERSION);
        });
        self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("treino-test-") && key !== "treino-test-" + VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim())));
        self.addEventListener("fetch", event => {
          if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/")));
          else if (new URL(event.request.url).pathname === "/manager.js") event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
        });`);
    } else if (path === "/manager.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(managerScript);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><b id="build">${version}</b>
        <div id="phase">starting</div><button id="update" hidden>Update now</button>
        <script src="/manager.js"></script><script>
          sessionStorage.setItem("loads", String(Number(sessionStorage.getItem("loads") || 0) + 1));
          const manager = new PwaUpdate.PwaUpdateManager(navigator.serviceWorker, () => location.reload(), snapshot => {
            document.querySelector("#phase").textContent = snapshot.phase;
            const button = document.querySelector("#update");
            button.hidden = !["ready", "activated", "error"].includes(snapshot.phase);
            button.textContent = snapshot.phase === "error" ? "Retry" : "Update now";
          });
          manager.start();
          document.querySelector("#update").onclick = () => manager.apply();
          window.checkUpdate = () => manager.check();
        </script>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

test("real waiting worker activates, reloads once, changes build, and preserves local data", async ({ page }) => {
  version = "one";
  await page.goto(origin);
  await page.evaluate(() => localStorage.setItem("treino-test-plan-and-history", JSON.stringify({ plans: ["plan"], history: ["session"] })));
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expect(page.locator("#build")).toHaveText("one");
  await expect(page.locator("#phase")).toHaveText("idle");
  const beforeLoads = await page.evaluate(() => Number(sessionStorage.getItem("loads")));

  version = "two";
  await page.evaluate(() => (window as unknown as { checkUpdate(): Promise<void> }).checkUpdate());
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  await expect(page.locator("#phase")).toHaveText("ready");
  await page.locator("#update").click();
  await expect(page.locator("#build")).toHaveText("two");
  await expect(page.locator("#phase")).toHaveText("idle");
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("loads")))).toBe(beforeLoads + 1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Number(sessionStorage.getItem("loads")))).toBe(beforeLoads + 1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("treino-test-plan-and-history")!)))
    .toEqual({ plans: ["plan"], history: ["session"] });
  const controlledBuild = await page.evaluate(async () => {
    const channel = new MessageChannel();
    return new Promise<string>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
      navigator.serviceWorker.controller!.postMessage("GET_BUILD_ID", [channel.port2]);
    });
  });
  expect(controlledBuild).toBe("two");
  expect(await page.evaluate(() => caches.keys())).toEqual(["treino-test-two"]);
});

test("an already-waiting update can activate and reopen its precached shell offline", async ({ page, context }) => {
  version = "one";
  await page.goto(origin);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  version = "two";
  await page.evaluate(() => (window as unknown as { checkUpdate(): Promise<void> }).checkUpdate());
  await expect(page.locator("#phase")).toHaveText("ready");
  await context.setOffline(true);
  await page.locator("#update").click();
  await expect(page.locator("#build")).toHaveText("two");
  await expect(page.locator("#phase")).toHaveText("idle");
  await context.setOffline(false);
});
