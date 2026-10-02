import assert from "node:assert/strict";
import test from "node:test";
import { callConnector, registerConnectorCompletion } from "../lib/connector/client";

const url = "https://script.google.com/macros/s/id/exec";
const key = "a".repeat(64);

test("browser client uses same-origin POST and rejects malformed or wrong-version replies", async () => {
  let target = "";
  const fetchMock: typeof fetch = async (input, init) => {
    target = String(input);
    assert.equal(init?.method, "POST");
    assert.equal(JSON.parse(String(init?.body)).key, key);
    return new Response(JSON.stringify({ ok: true, version: 2, result: {} }), { status: 200 });
  };
  await assert.rejects(callConnector(url, key, "ping", undefined, fetchMock), /version/);
  assert.equal(target, "/api/google-connector");
  await assert.rejects(callConnector(url, key, "ping", undefined, async () => { throw new Error("private network detail"); }), /network request failed/);
});

test("browser completion client refuses unverified slot or mismatched response", async () => {
  const prior = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, version: 1,
      result: { status: "synced", workoutId: "A", localDate: "2026-09-30", sourceSlot: "E17" } }), { status: 200 });
    await assert.rejects(registerConnectorCompletion(url, key, "A", "2026-09-30", "abcdef12"), /could not be verified/);
  } finally { globalThis.fetch = prior; }
});
