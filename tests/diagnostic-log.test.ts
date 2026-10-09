import assert from "node:assert/strict";
import test from "node:test";
import { appendBoundedEvents, DIAGNOSTIC_RETENTION, safeDiagnosticEvent } from "../lib/diagnostic-log";

test("diagnostic events whitelist metadata and discard private values", () => {
  const event = safeDiagnosticEvent("source_sync_failed", { sessionId: "full-google-sub-SECRET",
    source: "google", operation: "load", reason: "SECRET_CLIENT_SECRET", retry: 2,
    token: "ACCESS_TOKEN_FIXTURE", note: "PRIVATE_NOTE_99", load: "PRIVATE_LOAD_99" } as never);
  assert(event);
  assert.equal(event.reason, "UNCLASSIFIED");
  const encoded = JSON.stringify(event);
  for (const secret of ["full-google-sub-SECRET", "ACCESS_TOKEN_FIXTURE", "PRIVATE_NOTE_99", "PRIVATE_LOAD_99"])
    assert(!encoded.includes(secret));
  assert.equal(safeDiagnosticEvent("unknown_event"), null);
  assert.equal(safeDiagnosticEvent("app_error", { reason: "https://docs.google.com/private" })?.reason, "UNCLASSIFIED");
  assert.equal(safeDiagnosticEvent("notification_shown", { reason: "FRIEND_WORKOUT" })?.reason, "FRIEND_WORKOUT");
});
test("diagnostic retention evicts oldest events by count and age", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  let events = [safeDiagnosticEvent("app_boot", {}, new Date("2026-09-01T00:00:00Z"))!];
  for (let index = 0; index < DIAGNOSTIC_RETENTION.maxEvents + 12; index++)
    events = appendBoundedEvents(events, safeDiagnosticEvent("exercise_completed", {}, now)!, now);
  assert.equal(events.length, DIAGNOSTIC_RETENTION.maxEvents);
  assert(events.every((event) => event.type !== "app_boot"));
  assert(new TextEncoder().encode(JSON.stringify(events)).byteLength <= DIAGNOSTIC_RETENTION.maxBytes);
});
