"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useApp } from "@/components/app-provider";
import { hasActiveWorkout } from "@/lib/training/active-workout";
import { getPwaUpdateSnapshot, PwaUpdateManager, subscribePwaUpdate, updateBannerLabel } from "@/lib/pwa/update-manager";

const serverSnapshot = { phase: "idle", lastResult: "none", registration: "checking", controller: "none",
  installing: "none", waiting: "none", active: "none" } as const;

export function RegisterServiceWorker() {
  const [oldDevCache, setOldDevCache] = useState(false);
  const [online, setOnline] = useState(true);
  const manager = useRef<PwaUpdateManager | null>(null);
  const update = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot, () => serverSnapshot);
  const { data } = useApp();
  const workoutInProgress = hasActiveWorkout(data);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      const controlled = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        await Promise.all(registrations.filter((registration) => registration.scope.startsWith(window.location.origin)).map((registration) => registration.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("treino-")).map((key) => caches.delete(key)));
        if (controlled) setOldDevCache(true);
      }).catch(() => {});
      return;
    }
    const instance = new PwaUpdateManager(navigator.serviceWorker, () => window.location.reload());
    manager.current = instance;
    void instance.start();
    const check = () => { if (document.visibilityState === "visible") void instance.check(); };
    const connected = () => { setOnline(true); void instance.check(); };
    const disconnected = () => setOnline(false);
    setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      instance.dispose();
      manager.current = null;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  if (oldDevCache) return <div className="update-banner" role="status"><span>Old development cache removed</span>
    <button type="button" onClick={() => window.location.reload()}>Reload</button></div>;
  if (update.phase === "idle") return null;
  const busy = update.phase === "updating";
  const label = updateBannerLabel(update.phase, workoutInProgress, online);
  return <div className="update-banner" role="status" aria-live="polite"><span>{label}</span>
    {!workoutInProgress && <button type="button" disabled={busy || data === null}
      onClick={() => void manager.current?.apply()}>{busy ? "Updating…" : update.phase === "error" ? "Retry" : "Update now"}</button>}
  </div>;
}
