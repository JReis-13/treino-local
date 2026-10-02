import assert from "node:assert/strict";
import test from "node:test";
import proxy from "../lib/connector/proxy.cjs";

const connectorUrl = "https://script.google.com/macros/s/AKfycbx123_-9/exec";
const key = "a".repeat(64);
const request = { connectorUrl, key, operation: "ping" };
const response = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

test("proxy accepts only an exact Apps Script deployment endpoint and narrow messages", () => {
  assert.equal(proxy.validateConnectorUrl(connectorUrl), connectorUrl);
  for (const url of ["http://script.google.com/macros/s/id/exec", "https://script.google.com.evil.test/macros/s/id/exec",
    "https://script.google.com@evil.test/macros/s/id/exec", "https://script.google.com/macros/s/id/exec?x=1",
    "https://script.google.com/macros/s/id/dev", "https://127.0.0.1/macros/s/id/exec"])
    assert.throws(() => proxy.validateConnectorUrl(url));
  assert.throws(() => proxy.validateMessage({ ...request, operation: "writeRange" }));
  assert.throws(() => proxy.validateMessage({ ...request, key: "bad" }));
  assert.throws(() => proxy.validateMessage({ ...request, operation: "registerWorkoutCompletion", payload: {
    workoutId: "A", localDate: "2026-09-30", mappingId: "abcdef12", cell: "A1" } }));
});

test("proxy posts only to Apps Script and follows its one approved response redirect", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=abc" } }) :
      response({ ok: true, version: 1, result: { spreadsheetName: "Copy" } });
  };
  const result = await proxy.forwardConnector(request, fetchMock);
  assert.equal(result.result.spreadsheetName, "Copy");
  assert.equal(calls[0].url, connectorUrl);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].url.startsWith("https://script.googleusercontent.com/"), true);
  assert.equal(JSON.parse(String(calls[0].init.body)).key, key);
});

test("proxy rejects redirect abuse, malformed replies, oversized replies and timeout", async () => {
  await assert.rejects(proxy.forwardConnector(request, async () => new Response(null, { status: 302,
    headers: { location: "http://127.0.0.1/internal" } })), /redirect/);
  await assert.rejects(proxy.forwardConnector(request, async () => response({ ok: true, version: 2 })), /version/);
  await assert.rejects(proxy.forwardConnector(request, async () => new Response("x".repeat(1_000_001))), /too large/);
  await assert.rejects(proxy.forwardConnector(request, (_url: URL | RequestInfo, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }), 5), /Aborted/);
});

test("Next Route Handler rejects cross-origin and invalid targets before network access", async () => {
  let calls = 0;
  const fetchMock = async () => { calls++; return response({ ok: true, version: 1, result: {} }); };
  async function invoke(body: unknown, origin = "http://localhost:3000") {
    return proxy.handleConnectorRequest(new Request("http://localhost:3000/api/google-connector", { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), fetchMock);
  }
  assert.equal((await invoke(request, "https://evil.test")).status, 403);
  assert.equal((await invoke({ ...request, connectorUrl: "http://127.0.0.1/" })).status, 400);
  assert.equal((await invoke({ ...request, operation: "writeRange" })).status, 400);
  assert.equal((await invoke({ ...request, extra: "x".repeat(33_000) })).status, 413);
  assert.equal(calls, 0);
});

test("proxy replaces upstream error text with fixed messages", async () => {
  const result = await proxy.forwardConnector(request, async () => response({ ok: false, version: 1,
    error: { code: "UNAUTHORIZED", message: `leaked ${key}` } }));
  assert.equal(result.error.message, "Connection key was rejected.");
  assert(!JSON.stringify(result).includes(key));
});

test("proxy never logs the bearer key or its upstream error body", async () => {
  const logs: string[] = [];
  const previous = console.log;
  console.log = (...values: unknown[]) => { logs.push(values.join(" ")); };
  try {
    await assert.rejects(proxy.forwardConnector(request, async () => new Response("secret upstream response", { status: 500 })));
    assert.equal(logs.length, 0);
  } finally { console.log = previous; }
});
