"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { addTraining, migrateGoogleTraining, refreshTraining, removeTraining, renameTraining } from "@/lib/training/library";
import { finishTrainingSession, moveTrainingBlockLater, restoreTrainingQueue, sameDaySessions, setTrainingFocus, skipTrainingBlock, startTrainingSession, updateTrainingBlock } from "@/lib/training/session";
import { changedLoads } from "@/lib/training/loads";
import { normalizeLoad } from "@/lib/training/loads";
import { withSyncStatus } from "@/lib/training/sync-state";
import { updateExerciseNote } from "@/lib/training/exercise-notes";
import { extendRest, pauseRest, resumeRest, skipRest, startRest } from "@/lib/training/rest-timer";
import { trainingStorage } from "@/lib/training/storage";
import type { ImportedTraining, SourceSyncStatus, TrainingData, TrainingSession, TrainingSource } from "@/types/training";

interface AppContextValue {
  data: TrainingData | null;
  error: string | null;
  start(planId: string, workoutId: string): TrainingSession | null;
  updateBlock(sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }): void;
  moveBlockLater(sessionId: string, blockId: string): void;
  restoreQueue(sessionId: string, queueOrder: string[], focusBlockId?: string): void;
  skipBlock(sessionId: string, blockId: string, skipped: boolean): void;
  setFocus(sessionId: string, enabled: boolean, blockId?: string): void;
  correctSessionLoad(sessionId: string, blockId: string, load: string): boolean;
  finish(sessionId: string, localDate: string, choice?: "normal" | "add" | "replace", replaceId?: string, note?: string): boolean;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loaded = trainingStorage.load();
    dataRef.current = loaded.data;
    storageBlocked.current = Boolean(loaded.error);
    setData(loaded.data);
    if (loaded.error) setError(loaded.error);
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
      return commit(() => ({ ...result.data, restTimer: result.data.restTimer?.sessionId === result.session.id ? result.data.restTimer : undefined })) ? result.session : null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start workout."); return null; }
  }, [commit]);

  const updateBlock = useCallback((sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }) => {
    commit((current) => updateTrainingBlock(current, sessionId, blockId, change));
  }, [commit]);
  const moveBlockLater = useCallback((sessionId: string, blockId: string) => {
    commit((current) => moveTrainingBlockLater(current, sessionId, blockId));
  }, [commit]);
  const restoreQueue = useCallback((sessionId: string, queueOrder: string[], focusBlockId?: string) => {
    commit((current) => restoreTrainingQueue(current, sessionId, queueOrder, focusBlockId));
  }, [commit]);
  const skipBlock = useCallback((sessionId: string, blockId: string, skipped: boolean) => {
    commit((current) => skipTrainingBlock(current, sessionId, blockId, skipped));
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
    commit((current) => ({ ...current, sessions: current.sessions.map((session) => session.id === sessionId ? withSyncStatus(session, patch) : session) }));
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
    const previous = dataRef.current ? sameDaySessions(dataRef.current, sessionId, localDate).find((item) => item.id === (replaceId ?? sameDaySessions(dataRef.current!, sessionId, localDate)[0]?.id)) : undefined;
    const saved = commit((current) => finishTrainingSession(current, sessionId, localDate, new Date(), choice, replaceId, note));
    if (!saved) return false;
    const completedId = choice === "replace" ? previous?.id ?? sessionId : sessionId;
    const session = dataRef.current?.sessions.find((item) => item.id === completedId);
    const plan = dataRef.current?.plans.find((item) => item.id === session?.planId);
    const source = plan?.source;
    if (plan && session?.status === "completed" && source?.kind === "google" && source.syncEnabled &&
        (source.authMode === "oauth" ? Boolean(source.sourceProof && source.spreadsheetId) : Boolean(source.mappingId)) && navigator.onLine &&
        !plan.importWarnings.some((warning) => warning.severity === "syncBlocker")) {
      // The completed session has already been committed locally. Remote sync is best-effort.
      void (async () => {
        let currentPlan = plan;
        if (source.authMode === "oauth") {
          try {
            const { refreshGoogleSheet } = await import("@/lib/google/client");
            const { imported } = await refreshGoogleSheet(source.spreadsheetId!, plan.sourceFingerprint!, source.sourceProof!);
            if (![imported.sourceFingerprint, imported.legacyFingerprint].includes(plan.sourceFingerprint) ||
                imported.warnings.some((warning) => warning.severity === "activationBlocker")) throw new Error("The Sheet changed; review it before syncing.");
            applySourceLoads(plan.id, imported);
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
              if (session.duplicateDateAllowed) setSessionSync(completedId, { completionAttempted: true });
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
        const mapped = changes.filter((change) => currentPlan.workouts.find((item) => item.id === session.workoutId)?.blocks
          .some((block) => block.kind === "exercise" && block.id === change.blockId && block.loadSource));
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
    return true;
  }, [commit, applySourceLoads, setSessionSync]);
  const addPlan = useCallback((imported: ImportedTraining, name?: string) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return commit((current) => addTraining(current, imported, name, new Date().toISOString(), id)) ? id : null;
  }, [commit]);
  const refreshPlan = useCallback((planId: string, imported: ImportedTraining) =>
    commit((current) => refreshTraining(current, planId, imported)), [commit]);
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
      ? { ...session, syncStatus: status, syncMessage: message } : session) }));
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

  return <AppContext.Provider value={{ data, error, start, updateBlock, moveBlockLater, restoreQueue, skipBlock, setFocus, correctSessionLoad, finish,
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
