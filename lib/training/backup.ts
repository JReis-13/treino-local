import { parseTrainingData } from "@/lib/training/storage";
import type { TrainingData, TrainingSource } from "@/types/training";

export const MAX_BACKUP_BYTES = 20_000_000;
export const SAFETY_SNAPSHOT_KEY = "treino-local:restore-safety";

function safeTree(value: unknown, depth = 0, count = { value: 0 }): void {
  if (++count.value > 100_000 || depth > 60) throw new Error("Backup structure is too large or deeply nested.");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Backup contains an unsafe field.");
    safeTree(child, depth + 1, count);
  }
}

function withoutConnector(source: TrainingSource): TrainingSource {
  if (source.kind === "builtin") return { kind: "builtin", label: source.label };
  if (source.kind === "excel") return { kind: "excel", filename: source.filename, template: source.template,
    mappings: source.mappings, mode: source.mode };
  return { kind: "google", filename: source.filename, template: source.template, mappings: source.mappings,
    mappingId: source.mappingId, sheetUrl: source.sheetUrl, lastRefreshedAt: source.lastRefreshedAt,
    connectorVersion: source.connectorVersion, sourceMode: source.sourceMode, spreadsheetId: source.spreadsheetId,
    fileId: source.fileId, url: source.url, authMode: source.authMode, gid: source.gid, syncEnabled: false };
}

const credentialField = /^(?:access_?token|refresh_?token|client_?secret|session_?cookie|connector_?key|oauth_?cookie)$/i;
function withoutCredentials(key: string, value: unknown) { return credentialField.test(key) ? undefined : value; }

export function createBackup(data: TrainingData, createdAt = new Date().toISOString()): string {
  const sanitized: TrainingData = { ...data, plans: data.plans.map((plan) => ({ ...plan, source: withoutConnector(plan.source) })) };
  return JSON.stringify({ format: "treino-local-backup", version: 2, createdAt, data: sanitized }, withoutCredentials, 2);
}

export function parseBackup(raw: string): { data: TrainingData; createdAt: string } {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup file is too large.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Backup is not valid JSON."); }
  safeTree(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Backup format is invalid.");
  const envelope = value as Record<string, unknown>;
  if (envelope.format !== "treino-local-backup" || ![1, 2].includes(Number(envelope.version)) ||
      typeof envelope.createdAt !== "string" || !Number.isFinite(Date.parse(envelope.createdAt)))
    throw new Error("Backup format or version is unsupported.");
  const data = parseTrainingData(JSON.stringify(envelope.data, withoutCredentials));
  return { data: { ...data, plans: data.plans.map((plan) => ({ ...plan, source: withoutConnector(plan.source) })) }, createdAt: envelope.createdAt };
}
