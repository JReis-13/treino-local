"use client";

import { useEffect, useState } from "react";

export function RegisterServiceWorker() {
  const [update, setUpdate] = useState(false);
  const [oldDevCache, setOldDevCache] = useState(false);
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
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    document.addEventListener("visibilitychange", check);
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return update || oldDevCache ? <div className="update-banner" role="status"><span>{oldDevCache ? "Old development cache removed" : "New version available"}</span><button type="button" onClick={() => window.location.reload()}>Reload</button></div> : null;
}
