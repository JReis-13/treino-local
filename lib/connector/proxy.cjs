"use strict";

const OPERATIONS = new Set(["ping", "getWorkbookSnapshot", "getSyncSnapshot", "registerWorkoutCompletion"]);
const MAX_REQUEST_BYTES = 32768;
const MAX_RESPONSE_BYTES = 1000000;
const ERROR_MESSAGES = {
  BAD_REQUEST: "The connector rejected the request.",
  UNAUTHORIZED: "Connection key was rejected.",
  NO_BOUND_SHEET: "The connector is not bound to a Sheet.",
  UNSUPPORTED_SOURCE: "No supported workout sheets were found.",
  UNKNOWN_OPERATION: "Connector operation is not supported.",
  BAD_WORKOUT: "Workout identifier is invalid.",
  SOURCE_CHANGED: "Training structure changed. Refresh before syncing.",
  BUSY: "The Sheet is busy. Retry shortly.",
  OCCUPIED: "Completion slot became occupied. No date was written.",
  VERIFY_FAILED: "Date write could not be verified. Check the Sheet before retrying.",
  CONNECTOR_ERROR: "The connector could not complete the request.",
};

function validateConnectorUrl(value) {
  if (typeof value !== "string" || value.length > 512) throw new Error("Enter a valid Apps Script /exec deployment URL.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid Apps Script /exec deployment URL."); }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.port || url.username || url.password || url.search || url.hash ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error("Only HTTPS Apps Script /exec deployment URLs are accepted.");
  return url.href;
}

function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || !OPERATIONS.has(message.operation)) throw new Error("Unsupported connector operation.");
  const url = validateConnectorUrl(message.connectorUrl);
  if (typeof message.key !== "string" || !/^[A-Za-z0-9_-]{48,128}$/.test(message.key)) throw new Error("Connection key format is invalid.");
  if (message.operation === "registerWorkoutCompletion") {
    const p = message.payload;
    if (!p || typeof p !== "object" || Array.isArray(p) || !/^[A-Za-z0-9_-]{1,32}$/.test(p.workoutId) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.localDate) || !/^[0-9a-f]{8}$/.test(p.mappingId) ||
        Object.keys(p).some((key) => !["workoutId", "localDate", "mappingId"].includes(key))) throw new Error("Invalid workout completion request.");
  } else if (message.payload !== undefined) throw new Error("This operation does not accept a payload.");
  if (Object.keys(message).some((key) => !["operation", "connectorUrl", "key", "payload"].includes(key))) throw new Error("Unexpected connector request field.");
  return { url, operation: message.operation, key: message.key, payload: message.payload };
}

async function limitedText(response) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Connector response is too large.");
  let text = "";
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Connector response is too large."); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function forwardConnector(message, fetchImpl = fetch, timeoutMs = 15000) {
  const checked = validateMessage(message);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl(checked.url, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "manual",
      body: JSON.stringify({ operation: checked.operation, key: checked.key, ...(checked.payload ? { payload: checked.payload } : {}) }),
      signal: controller.signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      let redirected;
      try { redirected = location ? new URL(location, checked.url) : null; }
      catch { throw new Error("Unexpected Apps Script redirect."); }
      if (!redirected || redirected.protocol !== "https:" || redirected.hostname !== "script.googleusercontent.com" || redirected.port || redirected.username || redirected.password)
        throw new Error("Unexpected Apps Script redirect.");
      response = await fetchImpl(redirected.href, { method: "GET", redirect: "manual", signal: controller.signal });
    }
    if (!response.ok || response.status >= 300) throw new Error("Apps Script did not return a usable response.");
    const text = await limitedText(response);
    let result;
    try { result = JSON.parse(text); } catch { throw new Error("Apps Script returned an invalid response."); }
    if (!result || typeof result !== "object" || typeof result.ok !== "boolean" || result.version !== 1)
      throw new Error("Connector version or response is invalid.");
    if (result.ok) {
      if (!result.result || typeof result.result !== "object" || Array.isArray(result.result))
        throw new Error("Connector version or response is invalid.");
    } else {
      const code = result.error && typeof result.error.code === "string" ? result.error.code : "CONNECTOR_ERROR";
      result = { ok: false, version: 1, error: { code: Object.hasOwn(ERROR_MESSAGES, code) ? code : "CONNECTOR_ERROR",
        message: ERROR_MESSAGES[code] || ERROR_MESSAGES.CONNECTOR_ERROR } };
    }
    return result;
  } finally { clearTimeout(timer); }
}

async function readBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_REQUEST_BYTES) throw new Error("Connector request is too large.");
  if (!request.body) throw new SyntaxError("Empty request body.");
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new Error("Connector request is too large."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8"));
}

function jsonResponse(data, status) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}

async function handleConnectorRequest(request, fetchImpl = fetch) {
  if (request.method !== "POST") return jsonResponse({ error: "POST required." }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: "Cross-origin request rejected." }, 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || ""))
    return jsonResponse({ error: "JSON request required." }, 415);
  try {
    const message = await readBody(request);
    const result = await forwardConnector(message, fetchImpl);
    return jsonResponse(result, 200);
  } catch (error) {
    // Deliberately never log URLs, credentials, request bodies, or upstream responses.
    const message = error instanceof Error && error.name === "AbortError" ? "Connector timed out." :
      error instanceof SyntaxError ? "Malformed JSON request." : error instanceof Error ? error.message : "Connector request failed.";
    const status = /too large/i.test(message) ? 413 : /timed out/i.test(message) ? 504 :
      /Apps Script did not return|Apps Script returned|Connector version|Unexpected Apps Script redirect/i.test(message) ? 502 : 400;
    return jsonResponse({ error: message }, status);
  }
}

module.exports = { validateConnectorUrl, validateMessage, forwardConnector, handleConnectorRequest };
