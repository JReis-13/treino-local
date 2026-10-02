"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";

export function RegisterServiceWorker() {
  const [update, setUpdate] = useState(false);
  const [oldDevCache, setOldDevCache] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const { data } = useApp();
  const workoutInProgress = data?.sessions.some((session) => session.status === "inProgress") ?? false;
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
    const hadController = Boolean(navigator.serviceWorker.controller);
    const changed = () => { if (hadController) setUpdate(true); };
    const check = () => { if (document.visibilityState === "visible") navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => {}); };
    const observe = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) { setWaiting(registration.waiting); setUpdate(true); }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) { setWaiting(worker); setUpdate(true); }
        });
      });
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    document.addEventListener("visibilitychange", check);
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(observe).catch(() => {});
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return update || oldDevCache ? <div className="update-banner" role="status"><span>{oldDevCache ? "Old development cache removed" : workoutInProgress ? "New version available — reload after your workout" : "New version available"}</span><button type="button" disabled={workoutInProgress} onClick={() => { if (workoutInProgress) return; if (waiting) { navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true }); waiting.postMessage("SKIP_WAITING"); } else window.location.reload(); }}>Reload</button></div> : null;
}
