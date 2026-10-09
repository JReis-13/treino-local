import { isLocalDate } from "@/lib/dates";
import { withSyncStatus } from "@/lib/training/sync-state";
import { legacyPlan, migrateLegacySession } from "@/lib/training/builtin";
import { parseStoredData } from "@/lib/storage";
import type { TrainingData, TrainingPlanRecord, TrainingSession, WorkoutBlock } from "@/types/training";

export const TRAINING_STORAGE_KEY = "treino-local:v2";
const OLD_KEY = "treino-local:v1";
export const emptyTrainingData = (): TrainingData => ({ schemaVersion: 5, plans: [], sessions: [], exerciseNotes: [] });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validBlock(value: unknown): value is WorkoutBlock {
  return record(value) && typeof value.id === "string" && typeof value.section === "string" &&
    (value.kind === "exercise" ? typeof value.name === "string" && typeof value.prescription === "string" &&
      (value.defaultLoad === undefined || typeof value.defaultLoad === "string") &&
      (value.loadSource === undefined || (record(value.loadSource) && typeof value.loadSource.cell === "string" &&
        /^[GHI](26|28|30|32|33|34)$/.test(value.loadSource.cell) &&
        (value.loadSource.part === undefined || (Number.isInteger(value.loadSource.part) &&
          Number(value.loadSource.part) >= 0 && Number(value.loadSource.part) < Number(value.loadSource.parts ?? 1))) &&
        (value.loadSource.parts === undefined || [2, 3].includes(Number(value.loadSource.parts))))) &&
      (value.videoUrl === undefined || typeof value.videoUrl === "string") :
      value.kind === "instruction" && typeof value.heading === "string" && typeof value.text === "string");
}

function validPlan(value: unknown): value is TrainingPlanRecord {
  return record(value) && typeof value.id === "string" && typeof value.name === "string" &&
    Number.isInteger(value.version) && Number(value.version) > 0 &&
    typeof value.importedAt === "string" && typeof value.updatedAt === "string" &&
    validSource(value.source) &&
    Array.isArray(value.workouts) && value.workouts.length > 0 && value.workouts.every((workout: unknown) =>
      record(workout) && typeof workout.id === "string" && typeof workout.title === "string" &&
      Array.isArray(workout.blocks) && workout.blocks.length > 0 && workout.blocks.every(validBlock)) &&
    Array.isArray(value.importWarnings) && Array.isArray(value.legacyCompletions) &&
    (value.removedSourceCompletions === undefined || (Array.isArray(value.removedSourceCompletions) &&
      value.removedSourceCompletions.every((item: unknown) => record(item) && typeof item.id === "string" &&
        typeof item.workoutId === "string" && typeof item.sourceSlot === "string" &&
        typeof item.date === "string" && isLocalDate(item.date)))) &&
    (value.lastReconciliation === undefined || (record(value.lastReconciliation) &&
      typeof value.lastReconciliation.at === "string" &&
      ["sourceCount", "removedCount", "archivedSessions", "conflicts"].every((key) =>
        Number.isInteger((value.lastReconciliation as Record<string, unknown>)[key]) &&
        Number((value.lastReconciliation as Record<string, unknown>)[key]) >= 0))) &&
    value.legacyCompletions.every((item: unknown) => record(item) && typeof item.id === "string" &&
      typeof item.workoutId === "string" && typeof item.date === "string" && isLocalDate(item.date));
}

function validSource(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "builtin") return typeof value.label === "string";
  if (value.kind === "excel") return typeof value.filename === "string" && typeof value.template === "string" &&
    record(value.mappings) && ["direct", "copy"].includes(String(value.mode));
  if (value.kind === "google") return typeof value.filename === "string" && typeof value.template === "string" &&
    record(value.mappings) && (value.connectorVersion === undefined || [1, 2].includes(Number(value.connectorVersion))) &&
    (value.sourceMode === undefined || ["bound", "standalone"].includes(String(value.sourceMode))) &&
    (value.spreadsheetId === undefined || (typeof value.spreadsheetId === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value.spreadsheetId))) &&
    (value.authMode === undefined || value.authMode === "oauth") &&
    (value.sourceProof === undefined || (typeof value.sourceProof === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.sourceProof))) &&
    (value.gid === undefined || (Number.isInteger(value.gid) && Number(value.gid) >= 0)) &&
    (value.connectorUrl === undefined || typeof value.connectorUrl === "string") &&
    (value.mappingId === undefined || typeof value.mappingId === "string");
  return false;
}

function validSession(value: unknown): value is TrainingSession {
  return record(value) && typeof value.id === "string" && typeof value.planId === "string" &&
    (value.planVersion === undefined || Number.isInteger(value.planVersion)) &&
    (value.planLineageKey === undefined || typeof value.planLineageKey === "string") &&
    typeof value.workoutId === "string" &&
    (value.workoutLineageKey === undefined || typeof value.workoutLineageKey === "string") &&
    record(value.workoutSnapshot) && Array.isArray(value.workoutSnapshot.blocks) &&
    value.workoutSnapshot.blocks.every(validBlock) &&
    ["inProgress", "completed"].includes(String(value.status)) && typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) && Array.isArray(value.blocks) &&
    value.blocks.every((item: unknown) => record(item) && typeof item.blockId === "string" &&
      typeof item.completed === "boolean" && (item.skipped === undefined || (typeof item.skipped === "boolean" && !(item.skipped && item.completed))) &&
      (item.actualLoad === undefined || typeof item.actualLoad === "string") &&
      (item.loadOrigin === undefined || ["LAST", "PLAN", "USER"].includes(String(item.loadOrigin))) &&
      (item.initialLoadOrigin === undefined || ["LAST", "PLAN", "USER"].includes(String(item.initialLoadOrigin)))) &&
    (value.queueOrder === undefined || (Array.isArray(value.queueOrder) && value.queueOrder.every((id: unknown) => typeof id === "string"))) &&
    (value.focusBlockId === undefined || typeof value.focusBlockId === "string") &&
    (value.focusMode === undefined || typeof value.focusMode === "boolean") &&
    (value.completionSyncStatus === undefined || validSyncStatus(value.completionSyncStatus)) &&
    (value.loadSyncStatus === undefined || validSyncStatus(value.loadSyncStatus)) &&
    (value.duplicateDateAllowed === undefined || typeof value.duplicateDateAllowed === "boolean") &&
    (value.completionAttempted === undefined || typeof value.completionAttempted === "boolean") &&
    (value.sourceReconciliation === undefined || ["removed", "conflict"].includes(String(value.sourceReconciliation))) &&
    (value.loadCorrectionPending === undefined || typeof value.loadCorrectionPending === "boolean") &&
    (value.replacedAt === undefined || (typeof value.replacedAt === "string" && Number.isFinite(Date.parse(value.replacedAt)))) &&
    (value.sessionNote === undefined || (typeof value.sessionNote === "string" && value.sessionNote.length <= 500)) &&
    (value.completionReceipt === undefined || (record(value.completionReceipt) &&
      ["google", "excel"].includes(String(value.completionReceipt.sourceKind)) &&
      typeof value.completionReceipt.sourceId === "string" && typeof value.completionReceipt.workoutId === "string" &&
      typeof value.completionReceipt.slot === "string" && typeof value.completionReceipt.syncedAt === "string")) &&
    ["notApplicable", "pending", "syncing", "synced", "partial", "conflict", "authRequired", "sourceUnavailable", "failed"].includes(String(value.syncStatus)) &&
    (value.status !== "completed" || (typeof value.localDate === "string" && isLocalDate(value.localDate) &&
      typeof value.completedAt === "string" && Number.isFinite(Date.parse(value.completedAt))));
}

function validSyncStatus(value: unknown): boolean {
  return ["notApplicable", "pending", "syncing", "synced", "partial", "conflict", "authRequired", "sourceUnavailable", "failed"].includes(String(value));
}

/** Older or externally restored data may reuse a source-row ID for several logical exercises. */
function uniqueBlockIds(blocks: WorkoutBlock[]): { blocks: WorkoutBlock[]; ids: string[] } {
  const reserved = new Set(blocks.map((block) => block.id));
  const seen = new Set<string>();
  const ids = blocks.map((block, index) => {
    if (!seen.has(block.id)) { seen.add(block.id); return block.id; }
    let candidate = `${block.id}~${index + 1}`;
    while (reserved.has(candidate)) candidate += "~";
    reserved.add(candidate);
    seen.add(candidate);
    return candidate;
  });
  return { blocks: blocks.map((block, index) => ids[index] === block.id ? block : { ...block, id: ids[index] }), ids };
}

function repairSessionIds(session: TrainingSession): TrainingSession {
  const original = session.workoutSnapshot.blocks;
  const { blocks: snapshotBlocks, ids } = uniqueBlockIds(original);
  const replacements = new Map<string, string[]>();
  original.forEach((block, index) => {
    if (block.kind !== "exercise") return;
    replacements.set(block.id, [...(replacements.get(block.id) ?? []), ids[index]]);
  });
  const progressOccurrences = new Map<string, number>();
  const progress = session.blocks.map((block, index) => {
    const matchingIndex = original[index]?.id === block.blockId ? index : -1;
    const occurrence = progressOccurrences.get(block.blockId) ?? 0;
    progressOccurrences.set(block.blockId, occurrence + 1);
    const replacement = matchingIndex >= 0 ? ids[matchingIndex] :
      original.flatMap((item, position) => item.id === block.blockId ? [ids[position]] : [])[occurrence];
    return replacement && replacement !== block.blockId ? { ...block, blockId: replacement } : block;
  });
  const exerciseIds = snapshotBlocks.filter((block) => block.kind === "exercise").map((block) => block.id);
  const queueOrder = [...new Set((session.queueOrder ?? original.filter((block) => block.kind === "exercise").map((block) => block.id))
    .flatMap((id) => replacements.get(id) ?? [id]).filter((id) => exerciseIds.includes(id)))];
  queueOrder.push(...exerciseIds.filter((id) => !queueOrder.includes(id)));
  return { ...session, workoutSnapshot: { ...session.workoutSnapshot, blocks: snapshotBlocks }, blocks: progress,
    queueOrder, ...(session.focusBlockId === undefined ? {} :
      { focusBlockId: replacements.get(session.focusBlockId)?.[0] ?? session.focusBlockId }) };
}

export function parseTrainingData(raw: string): TrainingData {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || ![2, 3, 4, 5].includes(Number(value.schemaVersion)) || !Array.isArray(value.plans) || !value.plans.every(validPlan) ||
    !Array.isArray(value.sessions) || !value.sessions.every(validSession) ||
    (value.exerciseNotes !== undefined && (!Array.isArray(value.exerciseNotes) || !value.exerciseNotes.every((note: unknown) =>
      record(note) && typeof note.planId === "string" && typeof note.exerciseKey === "string" &&
      typeof note.text === "string" && note.text.length <= 1000 && typeof note.updatedAt === "string" &&
      Number.isFinite(Date.parse(note.updatedAt))))) ||
    (value.restTimer !== undefined && (!record(value.restTimer) || typeof value.restTimer.sessionId !== "string" ||
      !Number.isInteger(value.restTimer.durationSeconds) || Number(value.restTimer.durationSeconds) < 1 || Number(value.restTimer.durationSeconds) > 3600 ||
      (value.restTimer.targetEndAt === undefined) === (value.restTimer.pausedRemainingSeconds === undefined) ||
      (value.restTimer.targetEndAt !== undefined && (typeof value.restTimer.targetEndAt !== "string" || !Number.isFinite(Date.parse(value.restTimer.targetEndAt)))) ||
      (value.restTimer.pausedRemainingSeconds !== undefined && (!Number.isInteger(value.restTimer.pausedRemainingSeconds) ||
        Number(value.restTimer.pausedRemainingSeconds) < 0 || Number(value.restTimer.pausedRemainingSeconds) > 3600)))) ||
    (value.activePlanId !== undefined && typeof value.activePlanId !== "string") ||
    (value.activePlanId !== undefined && !value.plans.some((plan: TrainingPlanRecord) => plan.id === value.activePlanId)) ||
    (value.archivedSources !== undefined && (!Array.isArray(value.archivedSources) || !value.archivedSources.every((source: unknown) =>
      record(source) && typeof source.planId === "string" && typeof source.planName === "string" && Array.isArray(source.legacyCompletions)))) ||
    (value.hiddenLegacyCompletions !== undefined && (!Array.isArray(value.hiddenLegacyCompletions) ||
      !value.hiddenLegacyCompletions.every((item: unknown) => record(item) && typeof item.planId === "string" &&
        typeof item.id === "string" && typeof item.workoutId === "string" && typeof item.sourceSlot === "string" &&
        typeof item.date === "string" && isLocalDate(item.date)))) ||
    (value.pendingHistoryDeletions !== undefined && (!Array.isArray(value.pendingHistoryDeletions) ||
      !value.pendingHistoryDeletions.every((item: unknown) => record(item) && validSession(item.session) &&
        (item.session as TrainingSession).status === "completed" && typeof item.expiresAt === "string" &&
        Number.isFinite(Date.parse(item.expiresAt))))) ||
    (value.pendingLegacyDeletions !== undefined && (!Array.isArray(value.pendingLegacyDeletions) ||
      !value.pendingLegacyDeletions.every((item: unknown) => record(item) && typeof item.planId === "string" &&
        typeof item.legacyId === "string" && typeof item.expiresAt === "string" &&
        Number.isFinite(Date.parse(item.expiresAt))))) ||
    new Set(value.plans.map((plan: TrainingPlanRecord) => plan.id)).size !== value.plans.length ||
    new Set(value.sessions.map((session: TrainingSession) => session.id)).size !== value.sessions.length ||
    new Set([...(value.sessions as TrainingSession[]).map((session) => session.id),
      ...((value.pendingHistoryDeletions ?? []) as Array<{session: TrainingSession}>).map((item) => item.session.id)]).size !==
      value.sessions.length + (value.pendingHistoryDeletions?.length ?? 0)) {
    throw new Error("Saved training data is invalid. It was left untouched.");
  }
  return { ...value, schemaVersion: 5, exerciseNotes: value.exerciseNotes ?? [],
    plans: (value.plans as TrainingPlanRecord[]).map((plan) => ({ ...plan, workouts: plan.workouts.map((workout) => ({
      ...workout, blocks: uniqueBlockIds(workout.blocks).blocks })) })),
    pendingHistoryDeletions: (value.pendingHistoryDeletions as TrainingData["pendingHistoryDeletions"] | undefined)?.map((item) =>
      ({ ...item, session: withSyncStatus(repairSessionIds(item.session), {}) })),
    sessions: (value.sessions as TrainingSession[]).map(repairSessionIds).map((session) => {
      const plan = (value.plans as TrainingPlanRecord[]).find((item) => item.id === session.planId);
      const compatible = { ...session, planVersion: session.planVersion ?? plan?.version ?? 1 };
      return compatible.status === "completed" ? withSyncStatus(compatible, {}) : compatible;
    }) } as TrainingData;
}

export function migrateV1(raw: string, now = new Date().toISOString()): TrainingData {
  const old = parseStoredData(raw);
  if (old.sessions.length === 0 && !old.excel) return emptyTrainingData();
  const plan = legacyPlan(old, now);
  return { schemaVersion: 5, plans: [plan], activePlanId: plan.id, exerciseNotes: [],
    sessions: old.sessions.map((session) => migrateLegacySession(session, plan)) };
}

export interface TrainingStorage {
  load(): { data: TrainingData; error?: string; migrated?: boolean };
  save(data: TrainingData): void;
}

export const trainingStorage: TrainingStorage = {
  load() {
    try {
      const latest = localStorage.getItem(TRAINING_STORAGE_KEY);
      if (latest !== null) {
        const data = parseTrainingData(latest);
        if (JSON.parse(latest).schemaVersion !== 5) localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(data));
        return { data, migrated: JSON.parse(latest).schemaVersion !== 5 };
      }
      const old = localStorage.getItem(OLD_KEY);
      if (old === null) return { data: emptyTrainingData() };
      const migrated = migrateV1(old);
      localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(migrated));
      return { data: migrated, migrated: true };
    } catch (error) {
      return { data: emptyTrainingData(), error: error instanceof Error ? error.message : "Could not access local training data." };
    }
  },
  save(data) { localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(data)); },
};
