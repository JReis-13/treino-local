"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { addTraining, refreshTraining, removeTraining, renameTraining } from "@/lib/training/library";
import { finishTrainingSession, startTrainingSession, updateTrainingBlock } from "@/lib/training/session";
import { trainingStorage } from "@/lib/training/storage";
import type { ImportedTraining, SourceSyncStatus, TrainingData, TrainingSession, TrainingSource } from "@/types/training";

interface AppContextValue {
  data: TrainingData | null;
  error: string | null;
  start(planId: string, workoutId: string): TrainingSession | null;
  updateBlock(sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }): void;
  finish(sessionId: string, localDate: string): boolean;
  addPlan(imported: ImportedTraining, name?: string): string | null;
  refreshPlan(planId: string, imported: ImportedTraining): boolean;
  setActivePlan(planId: string): boolean;
  renamePlan(planId: string, name: string): boolean;
  removePlan(planId: string): boolean;
  updateSource(planId: string, source: TrainingSource): boolean;
  setSyncStatus(sessionIds: string[], status: SourceSyncStatus, message?: string): void;
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
      return commit(() => result.data) ? result.session : null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start workout."); return null; }
  }, [commit]);

  const updateBlock = useCallback((sessionId: string, blockId: string, change: { completed?: boolean; actualLoad?: string }) => {
    commit((current) => updateTrainingBlock(current, sessionId, blockId, change));
  }, [commit]);

  const finish = useCallback((sessionId: string, localDate: string) => {
    const saved = commit((current) => finishTrainingSession(current, sessionId, localDate));
    if (!saved) return false;
    const session = dataRef.current?.sessions.find((item) => item.id === sessionId);
    const plan = dataRef.current?.plans.find((item) => item.id === session?.planId);
    const source = plan?.source;
    if (plan && session?.status === "completed" && source?.kind === "google" && source.syncEnabled &&
        source.mappingId && navigator.onLine &&
        !plan.importWarnings.some((warning) => warning.severity === "syncBlocker")) {
      // The completed session has already been committed locally. Remote sync is best-effort.
      void (async () => {
        try {
          const { loadPlanConnectorKey, loadDeviceConnector } = await import("@/lib/connector/credentials");
          const { registerConnectorCompletion } = await import("@/lib/connector/client");
          const device = source.connectorVersion === 2 ? await loadDeviceConnector() : undefined;
          const url = device?.url ?? source.connectorUrl;
          const key = await loadPlanConnectorKey(plan.id, source.connectorVersion);
          if (!url) throw new Error("Google connector unavailable on this device. Reconnect in Training plans.");
          if (!key) throw new Error("Connection key unavailable. Reconnect this Sheet in Training plans.");
          if (source.connectorVersion === 2 && !source.spreadsheetId) throw new Error("Spreadsheet identity is missing. Refresh this training before syncing.");
          const result = await registerConnectorCompletion(url, key, session.workoutId, localDate, source.mappingId!,
            source.connectorVersion === 2 ? source.spreadsheetId : undefined);
          commit((current) => ({ ...current, sessions: current.sessions.map((item) => item.id !== sessionId ? item : {
            ...item, syncStatus: result.status === "synced" ? "synced" as const : "conflict" as const,
            syncMessage: result.status === "synced" ? `Date verified in ${result.sourceSlot}.` :
              result.status === "duplicate" ? "This workout/date already exists in the Sheet." : "Source completion slots are full.",
          }) }));
        } catch (cause) {
          commit((current) => ({ ...current, sessions: current.sessions.map((item) => item.id !== sessionId ? item : {
            ...item, syncStatus: "failed" as const, syncMessage: cause instanceof Error ? cause.message : "Connector sync failed. Retry from Source.",
          }) }));
        }
      })();
    }
    return true;
  }, [commit]);
  const addPlan = useCallback((imported: ImportedTraining, name?: string) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return commit((current) => addTraining(current, imported, name, new Date().toISOString(), id)) ? id : null;
  }, [commit]);
  const refreshPlan = useCallback((planId: string, imported: ImportedTraining) =>
    commit((current) => refreshTraining(current, planId, imported)), [commit]);
  const setActivePlan = useCallback((planId: string) => commit((current) => {
    if (!current.plans.some((plan) => plan.id === planId)) throw new Error("Training plan not found.");
    return { ...current, activePlanId: planId };
  }), [commit]);
  const renamePlan = useCallback((planId: string, name: string) =>
    commit((current) => renameTraining(current, planId, name)), [commit]);
  const removePlan = useCallback((planId: string) => commit((current) => removeTraining(current, planId)), [commit]);
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

  return <AppContext.Provider value={{ data, error, start, updateBlock, finish, addPlan, refreshPlan,
    setActivePlan, renamePlan, removePlan, updateSource, setSyncStatus, restoreData, clearError: () => setError(null) }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("AppProvider is missing.");
  return context;
}
