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
const routes = ["/", "/plans", "/history", "/history/session", "/workout", "/finish", "/source", "/debug"];
const precache = [...routes, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
  "/google-connector-setup.html", "/WorkoutConnector.gs.txt", ...assets].sort();
const sw = `const CACHE = "treino-${version}";
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
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
`;
await writeFile(join(root, "public", "sw.js"), sw);
console.log(`Generated service worker with ${precache.length} precached URLs (${version}).`);
