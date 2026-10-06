import { readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const staticRoot = join(root, ".next", "static");
const version = process.env.NEXT_PUBLIC_TREINO_BUILD_ID;
if (!version || !/^[a-zA-Z0-9_-]{8,48}$/.test(version)) throw new Error("Missing safe build identifier for service worker.");

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

const assets = (await files(staticRoot)).map((path) => "/_next/static/" + relative(staticRoot, path).replaceAll("\\", "/"));
const routes = ["/", "/plans", "/history", "/history/session", "/workout", "/finish", "/share", "/source", "/settings", "/debug"];
const precache = [...routes, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
  "/google-connector-setup.html", "/WorkoutConnector.gs.txt", "/WorkoutConnectorV2.gs.txt", "/appsscript.v2.json.txt", ...assets].sort();
const sw = `const CACHE = "treino-${version}";
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
  if (event.data === "GET_BUILD_ID") event.ports[0]?.postMessage("${version}");
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("treino-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy))); }
      return response;
    }).catch(async () => (await caches.match(request, { ignoreSearch: true })) || (await caches.match(url.pathname)) || (await caches.match("/"))));
    return;
  }
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy))); }
    return response;
  })));
});
function pushDiagnostic(patch) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("treino-push-diagnostics-v1", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("state");
      open.onerror = () => resolve();
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("state", "readwrite");
        const store = transaction.objectStore("state");
        const read = store.get("safe");
        read.onsuccess = () => store.put({ ...(read.result || {}), ...patch }, "safe");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); resolve(); };
      };
    } catch { resolve(); }
  });
}
function pushLogEvent(type) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("treino-local-diagnostics-v1", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("log");
      open.onerror = () => resolve();
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("log", "readwrite");
        const store = transaction.objectStore("log");
        const read = store.get("events");
        read.onsuccess = () => {
          const prior = Array.isArray(read.result) ? read.result : [];
          store.put([...prior, { type, timestamp: new Date().toISOString() }].slice(-500), "events");
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); resolve(); };
      };
    } catch { resolve(); }
  });
}
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (!data || !["friend_workout", "reaction"].includes(data.type) ||
        typeof data.body !== "string" || data.body.length > 140 ||
        typeof data.activityId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.activityId) ||
        typeof data.tag !== "string" || !/^(friend-workout:[0-9a-f-]{36}|reaction:[0-9a-f-]{36}:[0-9a-f-]{36})$/i.test(data.tag) ||
        !data.tag.startsWith(data.type === "friend_workout" ? "friend-workout:" : "reaction:")) return;
    await pushDiagnostic({ lastReceivedType: data.type });
    await pushLogEvent("push_received");
    await self.registration.showNotification("Treino Local", {
      body: data.body, icon: "/icon-192.png", badge: "/icon-192.png",
      tag: data.tag,
      data: { type: data.type },
    });
    await pushLogEvent("notification_shown");
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    await pushLogEvent("notification_clicked");
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      await pushDiagnostic({ lastClickResult: "focused" });
    } else {
      await self.clients.openWindow("/?friends=1");
      await pushDiagnostic({ lastClickResult: "opened" });
    }
  })());
});
`;
await writeFile(join(root, "public", "sw.js"), sw);
console.log(`Generated service worker with ${precache.length} precached URLs (${version}).`);
