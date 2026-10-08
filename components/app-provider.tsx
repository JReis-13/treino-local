"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { addTraining, migrateGoogleTraining, refreshTraining, removeTraining, renameTraining } from "@/lib/training/library";
import { cancelTrainingSession, finalizeTrainingSession, moveTrainingBlockLater, restoreTrainingQueue, setTrainingFocus, skipTrainingBlock, startTrainingSession, updateTrainingBlock } from "@/lib/training/session";
import { changedLoads, resolveLoadHistory, sameSourceLoadAssociation } from "@/lib/training/loads";
import { normalizeLoad } from "@/lib/training/loads";
import { completionState, loadState, withSyncStatus } from "@/lib/training/sync-state";
import { updateExerciseNote } from "@/lib/training/exercise-notes";
import { extendRest, pauseRest, resumeRest, skipRest, startRest } from "@/lib/training/rest-timer";
import { trainingStorage } from "@/lib/training/storage";
import { activateQueuedSocialDeletion, flushSocialOutbox, queueSocialActivity, queueSocialDeletion,
  reconcileQueuedSocialDeletions, refreshSocialPreference, undoQueuedSocialDeletion } from "@/lib/social/client";
import { completedSessionForDeletion, deleteCompletedHistory, deleteLegacyHistory } from "@/lib/training/history-delete";
import { plannedCompletionSlot } from "@/lib/sync/logic";
import { recordDiagnosticEvent } from "@/lib/diagnostic-log";
import type { ImportedTraining, SourceSyncStatus, TrainingData, TrainingSession, TrainingSource } from "@/types/training";

interface AppContextValue {
  data: TrainingData | null;
  error: string | null;
  start(planId: string, workoutId: string): TrainingSession | null;
  cancel(sessionId: string): boolean;
  deleteSession(sessionId: string): boolean;
  deleteLegacy(planId: string, legacyId: string): boolean;
  updateBlock(sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }): void;
  moveBlockLater(sessionId: string, blockId: string): void;
  restoreQueue(sessionId: string, queueOrder: string[], focusBlockId?: string): void;
  skipBlock(sessionId: string, blockId: string, skipped: boolean): void;
  setFocus(sessionId: string, enabled: boolean, blockId?: string): void;
  correctSessionLoad(sessionId: string, blockId: string, load: string): boolean;
  finish(sessionId: string, localDate: string, choice?: "normal" | "add" | "replace", replaceId?: string, note?: string): TrainingSession | null;
  saveExerciseNote(planId: string, exerciseName: string, note: string): boolean;
  startRestTimer(sessionId: string, seconds: number): boolean;
  pauseRestTimer(): boolean;
  resumeRestTimer(): boolean;
  extendRestTimer(seconds: number): boolean;
  skipRestTimer(): boolean;
  addPlan(imported: ImportedTraining, name?: string): string | null;
  refreshPlan(planId: string, imported: ImportedTraining): boolean;
  migrateGooglePlan(planId: string, imported: ImportedTraining): boolean;
  setActivePlan(planId: string): boolean;
  renamePlan(planId: string, name: string): boolean;
  removePlan(planId: string): boolean;
  updateSource(planId: string, source: TrainingSource): boolean;
  setSyncStatus(sessionIds: string[], status: SourceSyncStatus, message?: string): void;
  setSessionSync(sessionId: string, patch: Partial<TrainingSession>): void;
  applySourceLoads(planId: string, imported: ImportedTraining): void;
  restoreData(restored: TrainingData): boolean;
  clearError(): void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<TrainingData | null>(null);
  const dataRef = useRef<TrainingData | null>(null);
  const storageBlocked = useRef(false);
  const reconciling = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loaded = trainingStorage.load();
    if (!loaded.error) reconcileQueuedSocialDeletions(new Set(loaded.data.sessions.map((session) => session.id)));
    dataRef.current = loaded.data;
    storageBlocked.current = Boolean(loaded.error);
    setData(loaded.data);
    if (loaded.error) setError(loaded.error);
    recordDiagnosticEvent("app_boot", { reason: loaded.error ? "STORAGE_ERROR" : "OK" });
    recordDiagnosticEvent("storage_migration", { reason: loaded.error ? "FAILED" : "OK" });
  }, []);

  useEffect(() => {
    void refreshSocialPreference().then(() => flushSocialOutbox());
    const retry = () => { if (document.visibilityState === "visible") void flushSocialOutbox(); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => { window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); };
  }, []);

  const commit = useCallback((change: (current: TrainingData) => TrainingData): boolean => {
    if (!dataRef.current) return false;
    if (storageBlocked.current) {
      setError("Saved data is invalid or storage is unavailable. Nothing was overwritten. See /debug for details.");
      return false;
    }
    try {
      const next = change(dataRef.current);
      trainingStorage.save(next);
      dataRef.current = next;
      setData(next);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save local data.");
      return false;
    }
  }, []);

  const start = useCallback((planId: string, workoutId: string) => {
    if (!dataRef.current) return null;
    try {
      const result = startTrainingSession(dataRef.current, planId, workoutId);
      if (!commit(() => ({ ...result.data, restTimer: result.data.restTimer?.sessionId === result.session.id ? result.data.restTimer : undefined }))) return null;
      recordDiagnosticEvent("workout_started", { sessionId: result.session.id });
      recordDiagnosticEvent("active_session_initialized", { sessionId: result.session.id, reason: "OK" });
      const plan = dataRef.current?.plans.find((item) => item.id === planId);
      const workout = plan?.workouts.find((item) => item.id === workoutId);
      if (workout && dataRef.current) for (const block of workout.blocks) if (block.kind === "exercise")
        recordDiagnosticEvent("last_load_resolved", { sessionId: result.session.id,
          reason: resolveLoadHistory(dataRef.current, planId, workout, block).reason });
      return result.session;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start workout."); return null; }
  }, [commit]);

  const cancel = useCallback((sessionId: string) => { const saved = commit((current) => cancelTrainingSession(current, sessionId));
    if (saved) recordDiagnosticEvent("workout_cancelled", { sessionId }); return saved; }, [commit]);
  const deleteSession = useCallback((sessionId: string): boolean => {
    if (!dataRef.current || !completedSessionForDeletion(dataRef.current, sessionId)) {
      setError("Completed workout record not found."); return false;
    }
    if (!queueSocialDeletion(sessionId)) {
      setError("Could not prepare Friends deletion on this device. The workout was left intact."); return false;
    }
    const saved = commit((current) => deleteCompletedHistory(current, sessionId));
    if (saved) { recordDiagnosticEvent("history_deleted", { sessionId }); activateQueuedSocialDeletion(sessionId); }
    else undoQueuedSocialDeletion(sessionId);
    return saved;
  }, [commit]);
  const deleteLegacy = useCallback((planId: string, legacyId: string): boolean => {
    const saved = commit((current) => deleteLegacyHistory(current, planId, legacyId));
    if (saved) recordDiagnosticEvent("history_deleted", { reason: "LEGACY" });
    return saved;
  }, [commit]);

  const updateBlock = useCallback((sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }) => {
    if (commit((current) => updateTrainingBlock(current, sessionId, blockId, change))) {
      if (change.completed !== undefined) recordDiagnosticEvent(change.completed ? "exercise_completed" : "exercise_reopened", { sessionId });
      if (change.actualLoad !== undefined) recordDiagnosticEvent("today_load_manually_changed", { sessionId, operation: "load" });
    }
  }, [commit]);
  const moveBlockLater = useCallback((sessionId: string, blockId: string) => {
    commit((current) => moveTrainingBlockLater(current, sessionId, blockId));
  }, [commit]);
  const restoreQueue = useCallback((sessionId: string, queueOrder: string[], focusBlockId?: string) => {
    commit((current) => restoreTrainingQueue(current, sessionId, queueOrder, focusBlockId));
  }, [commit]);
  const skipBlock = useCallback((sessionId: string, blockId: string, skipped: boolean) => {
    if (commit((current) => skipTrainingBlock(current, sessionId, blockId, skipped)))
      recordDiagnosticEvent(skipped ? "exercise_skipped" : "exercise_skip_undone", { sessionId });
  }, [commit]);
  const setFocus = useCallback((sessionId: string, enabled: boolean, blockId?: string) => {
    commit((current) => setTrainingFocus(current, sessionId, enabled, blockId));
  }, [commit]);
  const correctSessionLoad = useCallback((sessionId: string, blockId: string, load: string): boolean =>
    commit((current) => {
      const target = current.sessions.find((item) => item.id === sessionId && item.status === "completed");
      if (!target || !target.blocks.some((block) => block.blockId === blockId)) throw new Error("Session load is unavailable.");
      const plan = current.plans.find((item) => item.id === target.planId);
      const latest = current.sessions.filter((item) => item.status === "completed" && item.planId === target.planId &&
        item.blocks.some((block) => block.blockId === blockId && block.completed)).sort((a, b) =>
        (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
      const shouldSync = Boolean(plan && plan.source.kind !== "builtin" && latest?.id === sessionId);
      return { ...current, sessions: current.sessions.map((item) => item.id === sessionId ? withSyncStatus({ ...item,
        blocks: item.blocks.map((block) => block.blockId === blockId ? { ...block, actualLoad: normalizeLoad(load) } : block) },
        { loadSyncStatus: shouldSync ? "pending" : "notApplicable", loadCorrectionPending: shouldSync,
          syncMessage: shouldSync ? "Load correction saved locally; source update pending." : "Historical load corrected locally." }) : item) };
    }), [commit]);

  const setSessionSync = useCallback((sessionId: string, patch: Partial<TrainingSession>) => {
    const previous = dataRef.current?.sessions.find((item) => item.id === sessionId);
    const source = dataRef.current?.plans.find((item) => item.id === previous?.planId)?.source.kind;
    if (commit((current) => ({ ...current, sessions: current.sessions.map((session) => session.id === sessionId ? withSyncStatus(session, patch) : session) }))) {
      for (const operation of ["completion", "load"] as const) {
        const key = operation === "completion" ? "completionSyncStatus" : "loadSyncStatus";
        const status = patch[key];
        if (!status || status === previous?.[key]) continue;
        if (status === "synced") recordDiagnosticEvent("source_sync_success", { sessionId, source, operation, reason: "OK" });
        else if (["failed", "conflict", "authRequired", "sourceUnavailable"].includes(status))
          recordDiagnosticEvent("source_sync_failed", { sessionId, source, operation,
            reason: status === "authRequired" ? "AUTH_REQUIRED" : status === "conflict" ? "CONFLICT" : "FAILED" });
      }
    }
  }, [commit]);
  const applySourceLoads = useCallback((planId: string, imported: ImportedTraining) => {
    commit((current) => ({ ...current, plans: current.plans.map((plan) => {
      if (plan.id !== planId || plan.source.kind !== imported.source.kind) return plan;
      return { ...plan, sourceFingerprint: imported.sourceFingerprint,
        source: { ...plan.source, ...(imported.source.kind === "google" ? { sourceProof: imported.source.sourceProof } : {}) },
        workouts: plan.workouts.map((workout) => {
          const next = imported.workouts.find((item) => item.id === workout.id);
          return { ...workout, blocks: workout.blocks.map((block) => {
            const match = next?.blocks.find((item) => item.id === block.id);
            return block.kind === "exercise" && match?.kind === "exercise" ?
              { ...block, defaultLoad: match.defaultLoad, loadSource: match.loadSource } : block;
          }) };
        }) };
    }) }));
  }, [commit]);
  const saveExerciseNote = useCallback((planId: string, exerciseName: string, note: string) =>
    commit((current) => updateExerciseNote(current, planId, exerciseName, note)), [commit]);
  const startRestTimer = useCallback((sessionId: string, seconds: number) =>
    commit((current) => startRest(current, sessionId, seconds)), [commit]);
  const pauseRestTimer = useCallback(() => commit((current) => pauseRest(current)), [commit]);
  const resumeRestTimer = useCallback(() => commit((current) => resumeRest(current)), [commit]);
  const extendRestTimer = useCallback((seconds: number) => commit((current) => extendRest(current, seconds)), [commit]);
  const skipRestTimer = useCallback(() => commit((current) => skipRest(current)), [commit]);
  const finish = useCallback((sessionId: string, localDate: string, choice: "normal" | "add" | "replace" = "normal", replaceId?: string, note = "") => {
    recordDiagnosticEvent("workout_finish_started", { sessionId });
    if (choice === "add") recordDiagnosticEvent("same_day_add", { sessionId });
    if (choice === "replace") recordDiagnosticEvent("same_day_replace", { sessionId });
    let finalized: TrainingSession | undefined;
    const saved = commit((current) => {
      const result = finalizeTrainingSession(current, sessionId, localDate, new Date(), choice, replaceId, note);
      finalized = result.session;
      return result.data;
    });
    if (!saved) return null;
    const session = finalized as TrainingSession | undefined;
    if (!session) return null;
    const completedId = session.id;
    recordDiagnosticEvent("workout_persisted", { sessionId: completedId });
    queueSocialActivity(session);
    const plan = dataRef.current?.plans.find((item) => item.id === session?.planId);
    const source = plan?.source;
    if (plan && session?.status === "completed" && source?.kind === "google" && source.syncEnabled &&
        (source.authMode === "oauth" ? Boolean(source.sourceProof && source.spreadsheetId) : Boolean(source.mappingId)) && navigator.onLine &&
        !plan.importWarnings.some((warning) => warning.severity === "syncBlocker")) {
      // The completed session has already been committed locally. Remote sync is best-effort.
      void (async () => {
        let currentPlan = plan;
        let intendedSlot: string | undefined;
        if (source.authMode === "oauth") {
          try {
            const { refreshGoogleSheet } = await import("@/lib/google/client");
            const { imported } = await refreshGoogleSheet(source.spreadsheetId!, plan.sourceFingerprint!, source.sourceProof!);
            if (![imported.sourceFingerprint, imported.legacyFingerprint].includes(plan.sourceFingerprint) ||
                imported.warnings.some((warning) => warning.severity === "activationBlocker")) throw new Error("The Sheet changed; review it before syncing.");
            applySourceLoads(plan.id, imported);
            intendedSlot = plannedCompletionSlot(imported, session.workoutId);
            currentPlan = dataRef.current?.plans.find((item) => item.id === plan.id) ?? plan;
          } catch (cause) {
            setSessionSync(completedId, { completionSyncStatus: "failed", loadSyncStatus: "failed",
              syncMessage: cause instanceof Error ? cause.message : "Google source could not be validated." });
            return;
          }
        }
        const currentSource = currentPlan.source;
        try {
          if (session.completionSyncStatus !== "synced") {
            let result: { status: "synced" | "duplicate" | "full"; sourceSlot?: string };
            if (currentSource.kind === "google" && currentSource.authMode === "oauth") {
              const { syncGoogleDate } = await import("@/lib/google/client");
              if (session.duplicateDateAllowed && session.completionAttempted) throw new Error("Duplicate date sync needs review before retrying.");
              setSessionSync(completedId, { completionAttempted: true, preparedCompletionSlot: intendedSlot });
              result = await syncGoogleDate(currentSource.spreadsheetId!, currentPlan.sourceFingerprint!, currentSource.sourceProof!,
                session.workoutId, localDate, session.duplicateDateAllowed);
            } else {
            const { loadPlanConnectorKey, loadDeviceConnector } = await import("@/lib/connector/credentials");
            const { registerConnectorCompletion } = await import("@/lib/connector/client");
            const device = source.connectorVersion === 2 ? await loadDeviceConnector() : undefined;
            const url = device?.url ?? source.connectorUrl;
            const key = await loadPlanConnectorKey(plan.id, source.connectorVersion);
            if (!url || !key) throw new Error("Legacy Google connector unavailable. Reconnect with Google in Training plans.");
            result = await registerConnectorCompletion(url, key, session.workoutId, localDate, source.mappingId!,
              source.connectorVersion === 2 ? source.spreadsheetId : undefined);
            }
            setSessionSync(completedId, { completionSyncStatus: result.status === "synced" ? "synced" : "conflict",
              preparedCompletionSlot: result.status === "synced" ? undefined : intendedSlot,
              completionReceipt: result.status === "synced" && result.sourceSlot ? { sourceKind: "google",
                sourceId: currentSource.kind === "google" ? currentSource.spreadsheetId ?? "legacy" : "legacy", workoutId: session.workoutId,
                slot: result.sourceSlot, syncedAt: new Date().toISOString() } : undefined,
              syncMessage: result.status === "synced" ? "Completion date verified." : result.status === "duplicate" ?
                "This date already exists in the source; local workout is safe." : "Source completion slots are full." });
          }
        } catch (cause) {
          setSessionSync(completedId, { completionSyncStatus: cause instanceof Error && /reconnect|expired/i.test(cause.message) ? "authRequired" : "failed",
            syncMessage: cause instanceof Error ? cause.message : "Date sync failed. Retry from Source." });
        }
        const changes = changedLoads(session);
        if (!changes.length) return;
        if (currentSource.kind !== "google" || currentSource.authMode !== "oauth") {
          setSessionSync(completedId, { loadSyncStatus: "conflict", syncMessage: "Load saved locally; legacy connector cannot update loads." }); return;
        }
        const mapped = changes.filter((change) => sameSourceLoadAssociation(session,
          currentPlan.workouts.find((item) => item.id === session.workoutId), change.blockId));
        if (mapped.length !== changes.length) setSessionSync(completedId, { loadSyncStatus: "conflict", syncMessage: "Some load destinations are ambiguous; loads remain local." });
        if (!mapped.length) return;
        try {
          const { syncGoogleLoads } = await import("@/lib/google/client");
          const requestChanges = mapped.map((change) => ({ ...change, expected: session.workoutSnapshot.blocks.find((block) =>
            block.kind === "exercise" && block.id === change.blockId)?.kind === "exercise" ?
            (session.workoutSnapshot.blocks.find((block) => block.id === change.blockId) as { defaultLoad?: string }).defaultLoad ?? "" : "" }));
          const { imported } = await syncGoogleLoads(currentSource.spreadsheetId!, currentPlan.sourceFingerprint!, currentSource.sourceProof!,
            session.workoutId, requestChanges);
          applySourceLoads(plan.id, imported);
          if (mapped.length === changes.length) setSessionSync(completedId, { loadSyncStatus: "synced", syncMessage: "Date and load updates checked against the Sheet." });
        } catch (cause) {
          setSessionSync(completedId, { loadSyncStatus: "failed", syncMessage: cause instanceof Error ? cause.message : "Load sync failed; local workout is safe." });
        }
      })();
    }
    return session;
  }, [commit, applySourceLoads, setSessionSync]);

  const reconcilePendingGoogle = useCallback(async () => {
    if (!navigator.onLine || !dataRef.current || storageBlocked.current) return;
    const { refreshGoogleSheet, syncGoogleDate, syncGoogleLoads } = await import("@/lib/google/client");
    const snapshot = dataRef.current;
    for (const plan of snapshot.plans) {
      const source = plan.source;
      if (source.kind !== "google" || source.authMode !== "oauth" || !source.syncEnabled ||
          !source.spreadsheetId || !source.sourceProof || !plan.sourceFingerprint ||
          plan.importWarnings.some((warning) => warning.severity === "syncBlocker")) continue;
      const waiting = snapshot.sessions.filter((session) => session.planId === plan.id && session.status === "completed" &&
        !["synced", "notApplicable"].includes(withSyncStatus(session, {}).syncStatus) && !reconciling.current.has(session.id));
      if (!waiting.length) continue;
      for (const session of waiting) reconciling.current.add(session.id);
      try {
        const { imported } = await refreshGoogleSheet(source.spreadsheetId, plan.sourceFingerprint, source.sourceProof);
        if (![imported.sourceFingerprint, imported.legacyFingerprint].includes(plan.sourceFingerprint) || imported.source.kind !== "google" ||
            !imported.source.sourceProof) throw new Error("Sheet structure changed; review the plan before syncing.");
        applySourceLoads(plan.id, imported);
        for (const snapshotSession of waiting) {
          const session = dataRef.current?.sessions.find((item) => item.id === snapshotSession.id) ?? snapshotSession;
          if (!session.localDate) continue;
          try {
            if (completionState(session) !== "synced") {
              const matching = session.completionAttempted && session.preparedCompletionSlot ? imported.legacyCompletions.filter((entry) =>
                entry.workoutId === session.workoutId && entry.date === session.localDate &&
                entry.sourceSlot === session.preparedCompletionSlot &&
                !dataRef.current?.sessions.some((other) => other.id !== session.id && other.completionReceipt?.sourceKind === "google" &&
                  other.completionReceipt.sourceId === source.spreadsheetId && other.completionReceipt.slot === entry.sourceSlot)) : [];
              if (matching.length === 1) {
                setSessionSync(session.id, { completionSyncStatus: "synced", preparedCompletionSlot: undefined, completionReceipt: { sourceKind: "google",
                  sourceId: source.spreadsheetId, workoutId: session.workoutId, slot: matching[0].sourceSlot,
                  syncedAt: new Date().toISOString() }, syncMessage: "Completion date verified in Sheet." });
              } else if (session.duplicateDateAllowed && session.completionAttempted) {
                setSessionSync(session.id, { completionSyncStatus: "conflict", syncMessage: "Same-day date needs review before retrying." });
              } else {
                setSessionSync(session.id, { completionSyncStatus: "syncing", completionAttempted: true,
                  preparedCompletionSlot: plannedCompletionSlot(imported, session.workoutId) });
                const result = await syncGoogleDate(source.spreadsheetId, imported.sourceFingerprint, imported.source.sourceProof,
                  session.workoutId, session.localDate, session.duplicateDateAllowed);
                setSessionSync(session.id, result.status === "synced" && result.sourceSlot ? { completionSyncStatus: "synced", preparedCompletionSlot: undefined,
                  completionReceipt: { sourceKind: "google", sourceId: source.spreadsheetId, workoutId: session.workoutId,
                    slot: result.sourceSlot, syncedAt: new Date().toISOString() }, syncMessage: "Completion date verified in Sheet." } :
                  { completionSyncStatus: "conflict", syncMessage: "Completion date needs source review." });
              }
            }
            if (loadState(session) === "synced" || loadState(session) === "notApplicable") continue;
            const workout = imported.workouts.find((item) => item.id === session.workoutId);
            const changes = session.loadCorrectionPending ? session.blocks.flatMap((state) => {
              const block = workout?.blocks.find((item) => item.kind === "exercise" && item.id === state.blockId);
              return state.completed && block?.kind === "exercise" && state.actualLoad?.trim() &&
                normalizeLoad(state.actualLoad) !== normalizeLoad(block.defaultLoad ?? "") ?
                [{ blockId: state.blockId, load: normalizeLoad(state.actualLoad) }] : [];
            }) : changedLoads(session);
            if (session.loadCorrectionPending && !changes.length) {
              setSessionSync(session.id, { loadSyncStatus: "synced", loadCorrectionPending: false });
              continue;
            }
            const mapped = changes.filter((change) => sameSourceLoadAssociation(session, workout, change.blockId));
            if (mapped.length !== changes.length) setSessionSync(session.id, { loadSyncStatus: "conflict", syncMessage: "Some load destinations need review." });
            if (!mapped.length) continue;
            if (mapped.length === changes.length) setSessionSync(session.id, { loadSyncStatus: "syncing" });
            const requests = mapped.map((change) => ({ ...change, expected: session.loadCorrectionPending ?
              (workout?.blocks.find((block) => block.kind === "exercise" && block.id === change.blockId) as { defaultLoad?: string } | undefined)?.defaultLoad ?? "" :
              (session.workoutSnapshot.blocks.find((block) => block.kind === "exercise" && block.id === change.blockId) as { defaultLoad?: string } | undefined)?.defaultLoad ?? "" }));
            const result = await syncGoogleLoads(source.spreadsheetId, imported.sourceFingerprint, imported.source.sourceProof,
              session.workoutId, requests);
            applySourceLoads(plan.id, result.imported);
            if (mapped.length === changes.length) setSessionSync(session.id, { loadSyncStatus: "synced", loadCorrectionPending: false,
              syncMessage: "Completion and loads verified in Sheet." });
            else setSessionSync(session.id, { loadSyncStatus: "conflict", syncMessage: "Some load destinations need review." });
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Source sync failed; local workout is safe.";
            setSessionSync(session.id, { completionSyncStatus: completionState(session) === "synced" ? "synced" : "failed",
              loadSyncStatus: loadState(session) === "synced" || loadState(session) === "notApplicable" ? loadState(session) : "failed",
              syncMessage: message });
          }
        }
      } catch { /* A disconnected source stays locally saved and can be retried from Source. */ }
      finally { for (const session of waiting) reconciling.current.delete(session.id); }
    }
  }, [applySourceLoads, setSessionSync]);

  useEffect(() => {
    const retry = () => { if (document.visibilityState === "visible") void reconcilePendingGoogle(); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    retry();
    return () => { window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); };
  }, [reconcilePendingGoogle]);
  const addPlan = useCallback((imported: ImportedTraining, name?: string) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!commit((current) => addTraining(current, imported, name, new Date().toISOString(), id))) return null;
    recordDiagnosticEvent("exercise_load_mapping_completed", { source: imported.source.kind, reason: "OK" });
    return id;
  }, [commit]);
  const refreshPlan = useCallback((planId: string, imported: ImportedTraining) => {
    const saved = commit((current) => refreshTraining(current, planId, imported));
    if (saved) { recordDiagnosticEvent("plan_refreshed", { source: imported.source.kind, reason: "OK" });
      recordDiagnosticEvent("exercise_load_mapping_completed", { source: imported.source.kind, reason: "OK" }); }
    return saved;
  }, [commit]);
  const migrateGooglePlan = useCallback((planId: string, imported: ImportedTraining) =>
    commit((current) => migrateGoogleTraining(current, planId, imported)), [commit]);
  const setActivePlan = useCallback((planId: string) => commit((current) => {
    if (!current.plans.some((plan) => plan.id === planId)) throw new Error("Training plan not found.");
    return { ...current, activePlanId: planId };
  }), [commit]);
  const renamePlan = useCallback((planId: string, name: string) =>
    commit((current) => renameTraining(current, planId, name)), [commit]);
  const removePlan = useCallback((planId: string) => commit((current) => {
    const next = removeTraining(current, planId);
    return current.restTimer && current.sessions.some((session) => session.id === current.restTimer!.sessionId && session.planId === planId)
      ? { ...next, restTimer: undefined } : next;
  }), [commit]);
  const updateSource = useCallback((planId: string, source: TrainingSource) => commit((current) => ({ ...current,
    plans: current.plans.map((plan) => plan.id === planId ? { ...plan, source } : plan),
  })), [commit]);
  const setSyncStatus = useCallback((sessionIds: string[], status: SourceSyncStatus, message?: string) => {
    const ids = new Set(sessionIds);
    commit((current) => ({ ...current, sessions: current.sessions.map((session) => ids.has(session.id)
      ? withSyncStatus(session, { completionSyncStatus: completionState(session) === "synced" ? "synced" : status,
        loadSyncStatus: loadState(session) === "synced" || loadState(session) === "notApplicable" ? loadState(session) : status,
        syncMessage: message }) : session) }));
  }, [commit]);

  const restoreData = useCallback((restored: TrainingData): boolean => {
    try {
      trainingStorage.save(restored);
      dataRef.current = restored;
      storageBlocked.current = false;
      setData(restored);
      setError(null);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not restore local data."); return false; }
  }, []);

  return <AppContext.Provider value={{ data, error, start, cancel, deleteSession, deleteLegacy, updateBlock, moveBlockLater, restoreQueue, skipBlock, setFocus, correctSessionLoad, finish,
    saveExerciseNote, startRestTimer, pauseRestTimer, resumeRestTimer, extendRestTimer, skipRestTimer,
    addPlan, refreshPlan, migrateGooglePlan,
    setActivePlan, renamePlan, removePlan, updateSource, setSyncStatus, setSessionSync, applySourceLoads,
    restoreData, clearError: () => setError(null) }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("AppProvider is missing.");
  return context;
}
