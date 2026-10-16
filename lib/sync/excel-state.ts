import { changedLoads, normalizeLoad, sameSourceLoadAssociation } from "@/lib/training/loads";
import { completionState, loadState, withSyncStatus } from "@/lib/training/sync-state";
import { sessionsWaitingForSource } from "@/lib/sync/logic";
import type { ImportedTraining, TrainingData, TrainingPlanRecord, TrainingSession } from "@/types/training";
import type { XlsxSyncOutcome, XlsxLoadOutcome } from "@/lib/sync/xlsx";

export type ExcelPatch = { sessionId: string; patch: Partial<TrainingSession> };

/** Excel holds one current load per exercise, not a table of historical loads. */
export function excelLoadTargets(session: TrainingSession, all: TrainingSession[]) {
  const changes = session.loadCorrectionPending ? session.blocks.flatMap(state => state.completed && state.actualLoad?.trim()
    ? [{ blockId: state.blockId, load: normalizeLoad(state.actualLoad) }] : []) : changedLoads(session);
  return changes.map(change => {
    const latest = all.filter(item => item.planId === session.planId && item.workoutId === session.workoutId &&
      item.status === "completed" && !item.sourceReconciliation &&
      (!item.planLineageKey || !session.planLineageKey || item.planLineageKey === session.planLineageKey) &&
      (!item.workoutLineageKey || !session.workoutLineageKey || item.workoutLineageKey === session.workoutLineageKey) &&
      sameSourceLoadAssociation(item, session.workoutSnapshot, change.blockId) &&
      item.blocks.some(state => state.blockId === change.blockId && state.completed && state.actualLoad?.trim()))
      .sort((a,b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt))[0] ?? session;
    const state = latest.blocks.find(item => item.blockId === change.blockId)!;
    return { blockId: change.blockId, load: normalizeLoad(state.actualLoad ?? change.load), sourceSessionId: latest.id };
  });
}

export function excelPreparedPatches(plan: TrainingPlanRecord, sessions: TrainingSession[],
  outcomes: XlsxSyncOutcome[], loads: XlsxLoadOutcome[], exportId: string, now = new Date().toISOString()): ExcelPatch[] {
  return sessionsWaitingForSource(sessions, plan.id).map(session => {
    const date = outcomes.find(item => item.sessionId === session.id)?.decision;
    const targets = excelLoadTargets(session, sessions);
    const successful = targets.filter(target => loads.some(item => item.sessionId === session.id && item.blockId === target.blockId && item.status === "synced"));
    const blocked = targets.length > successful.length;
    return { sessionId: session.id, patch: {
      ...(date?.kind === "write" ? { preparedCompletionSlot: date.slot, completionAttempted: true, completionSyncStatus: "pending" as const } :
        date && date.kind !== "verified" ? { completionSyncStatus: "conflict" as const } : {}),
      ...(targets.length ? { loadSyncStatus: blocked ? "conflict" as const : "pending" as const } : {}),
      excelSync: { exportId, planVersion: plan.version, preparedAt: now,
        loads: successful.map(target => ({ blockId: target.blockId, expected: target.load, sourceSessionId: target.sourceSessionId, verified: false })) },
      syncMessage: date && "message" in date ? date.message : blocked ? "Dates prepared; some load destinations need review. Local History is safe." : "Updated copy generated. Reconnect the downloaded workbook to verify dates and loads.",
    } };
  });
}

/** Reject a stale copy before it can roll back current plan values or receipts. */
export function assertExcelContinuity(plan: TrainingPlanRecord, sessions: TrainingSession[], imported: ImportedTraining) {
  if (plan.source.kind !== "excel" || imported.source.kind !== "excel" || imported.source.template !== plan.source.template ||
      (plan.sourceFingerprint && ![imported.sourceFingerprint, imported.legacyFingerprint].includes(plan.sourceFingerprint)))
    throw new Error("This is a different workbook structure. Refresh and review the source before syncing.");
  const own = sessions.filter(item => item.planId === plan.id && !item.sourceReconciliation);
  for (const session of own) {
    const receipt = session.completionReceipt;
    if (receipt?.sourceKind === "excel" && !imported.legacyCompletions.some(item => item.workoutId === receipt.workoutId &&
      item.sourceSlot === receipt.slot && item.date === session.localDate))
      throw new Error("This workbook is missing a previously verified date. Connect the latest updated copy. If a date was deliberately removed, review the source in Training plans; no date will be recreated here.");
  }
  const verified = new Map<string, { expected: string; order: string }>();
  for (const session of own) if (session.excelSync && session.excelSync.planVersion >= plan.version) for (const load of session.excelSync.loads) {
    if (!load.verified) continue;
    const origin = own.find(item => item.id === load.sourceSessionId);
    const order = `${origin?.completedAt ?? session.completedAt ?? ""}|${session.excelSync.verifiedAt ?? session.excelSync.preparedAt}`;
    const key = `${session.workoutId}:${load.blockId}`;
    if (!verified.has(key) || order > verified.get(key)!.order) verified.set(key, { expected: load.expected, order });
  }
  for (const [key, proof] of verified) {
    const [workoutId, blockId] = key.split(":");
    const block = imported.workouts.find(item => item.id === workoutId)?.blocks.find(item => item.id === blockId);
    const actual = block?.kind === "exercise" ? normalizeLoad(block.defaultLoad ?? "") : undefined;
    if (actual === proof.expected) continue;
    const prepared = own.some(session => session.workoutId === workoutId && session.excelSync && !session.excelSync.verifiedAt &&
      session.excelSync.loads.some(load => load.blockId === blockId && load.expected === actual &&
        excelLoadTargets(session, own).some(target => target.blockId === blockId && target.load === load.expected && target.sourceSessionId === load.sourceSessionId)));
    if (!prepared) throw new Error("This workbook is missing a previously verified load update. Connect the latest updated copy, or refresh and review intentional source changes in Training plans.");
  }
}

export function verifyExcelCopy(plan: TrainingPlanRecord, sessions: TrainingSession[], imported: ImportedTraining,
  workbookId: string, now = new Date().toISOString()) {
  assertExcelContinuity(plan, sessions, imported);
  let dates = 0, loads = 0, historicalLoads = 0;
  const claimedSlots = new Set(sessions.filter(item => item.planId === plan.id && item.completionReceipt?.sourceKind === "excel")
    .map(item => `${item.workoutId}:${item.completionReceipt!.slot}`));
  const patches = sessionsWaitingForSource(sessions, plan.id).map(session => {
    let next = session;
    const attempted = Boolean(session.excelSync || session.preparedCompletionSlot || session.completionReceipt);
    const date = session.preparedCompletionSlot && imported.legacyCompletions.find(item => item.workoutId === session.workoutId &&
      item.sourceSlot === session.preparedCompletionSlot && item.date === session.localDate);
    const claimed = date && claimedSlots.has(`${session.workoutId}:${date.sourceSlot}`);
    if (date && !claimed) {
      dates++; claimedSlots.add(`${session.workoutId}:${date.sourceSlot}`);
      next = withSyncStatus(next, { completionSyncStatus: "synced", preparedCompletionSlot: undefined,
        completionReceipt: { sourceKind: "excel", sourceId: plan.id, workoutId: session.workoutId, slot: date.sourceSlot, syncedAt: now } });
    }
    if (claimed) next = withSyncStatus(next, { completionSyncStatus: "conflict", syncMessage: "This date is already linked to another local session. Review History; no duplicate receipt was created." });
    const targets = excelLoadTargets(session, sessions);
    const evidence = targets.map(target => {
      const prepared = session.excelSync?.loads.find(item => item.blockId === target.blockId);
      const block = imported.workouts.find(item => item.id === session.workoutId)?.blocks.find(item => item.id === target.blockId);
      const verified = Boolean(sameSourceLoadAssociation(session, imported.workouts.find(item => item.id === session.workoutId), target.blockId) &&
        block?.kind === "exercise" && normalizeLoad(block.defaultLoad ?? "") === target.load &&
        (!prepared || (prepared.expected === target.load && prepared.sourceSessionId === target.sourceSessionId)));
      if (verified) { loads++; if (target.sourceSessionId !== session.id) historicalLoads++; }
      return { blockId: target.blockId, expected: target.load, sourceSessionId: target.sourceSessionId, verified };
    });
    if (loadState(session) !== "synced" && targets.length && (attempted || evidence.every(item => item.verified))) next = withSyncStatus(next, {
      loadSyncStatus: evidence.every(item => item.verified) ? evidence.every(item => item.sourceSessionId !== session.id) ? "notApplicable" : "synced" : "conflict",
      loadCorrectionPending: evidence.every(item => item.verified) ? false : session.loadCorrectionPending,
    });
    const allVerified = completionState(next) === "synced" && ["synced", "notApplicable"].includes(loadState(next));
    next = withSyncStatus(next, { excelSync: attempted || evidence.some(item => item.verified) ? { exportId: session.excelSync?.exportId ?? workbookId,
      preparedAt: session.excelSync?.preparedAt ?? now, planVersion: session.excelSync?.planVersion ?? plan.version,
      ...(allVerified ? { verifiedAt: now } : {}), loads: evidence } : undefined,
      syncMessage: allVerified ? evidence.some(item => item.sourceSessionId !== session.id)
        ? "Date verified. Workbook uses later recorded loads; earlier loads stay in local History." : "Date and required loads verified in workbook."
        : completionState(next) === "conflict" ? next.syncMessage : !attempted ? "Saved locally. Export an updated workbook copy to include pending dates and current loads." : completionState(next) === "synced" ? "Date verified; load updates still need attention. Reconnect the latest copy or review load mapping." :
          "Workbook date not verified. Reconnect the latest downloaded copy; no date was recreated.",
    });
    return { sessionId: session.id, patch: {
      completionSyncStatus: next.completionSyncStatus, completionReceipt: next.completionReceipt,
      preparedCompletionSlot: next.preparedCompletionSlot, loadSyncStatus: next.loadSyncStatus,
      loadCorrectionPending: next.loadCorrectionPending, excelSync: next.excelSync, syncMessage: next.syncMessage,
    } };
  });
  return { patches, dates, loads, historicalLoads };
}

/** Commit receipts and plan load readback together; session details are never rewritten. */
export function applyExcelSync(data: TrainingData, planId: string, patches: ExcelPatch[], imported?: ImportedTraining,
  connection?: { filename: string; mode: "copy" | "direct" }): TrainingData {
  if (data.plans.find(plan => plan.id === planId)?.source.kind !== "excel") throw new Error("Excel verification requires an Excel source.");
  return { ...data, sessions: data.sessions.map(session => {
    const patch = patches.find(item => item.sessionId === session.id && session.planId === planId)?.patch;
    return patch ? withSyncStatus(session, patch) : session;
  }), plans: data.plans.map(plan => plan.id !== planId || plan.source.kind !== "excel" ? plan : {
    ...plan, source: { ...plan.source, ...connection },
    ...(imported ? { sourceFingerprint: imported.sourceFingerprint, workouts: plan.workouts.map(workout => ({ ...workout,
      blocks: workout.blocks.map(block => {
        const match = imported.workouts.find(item => item.id === workout.id)?.blocks.find(item => item.id === block.id);
        return block.kind === "exercise" && match?.kind === "exercise" ? { ...block, defaultLoad: match.defaultLoad, loadSource: match.loadSource } : block;
      }) })) } : {}),
  }) };
}
