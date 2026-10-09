"use client";

import { useCallback, useEffect, useState } from "react";
import { clearStalePushRegistration, deviceSubscription, disablePush, enablePush, getPushStatus,
  notificationPermission, pushSupported, savePushPreferences, type PushStatus } from "@/lib/push/client";

export function PushSettings() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const canUsePush = pushSupported();
    setSupported(canUsePush);
    setPermission(notificationPermission());
    const next = await getPushStatus();
    const device = canUsePush ? await deviceSubscription() : null;
    if (next.deviceRegistered && !device) {
      await clearStalePushRegistration();
      next.deviceRegistered = false;
    }
    setSubscribed(Boolean(device));
    setStatus(next);
  }, []);
  useEffect(() => { void refresh().catch(() => setMessage("Notification status is temporarily unavailable.")); }, [refresh]);
  const enabled = Boolean(status?.deviceRegistered && subscribed && permission === "granted");
  async function enable() {
    if (!status?.publicKey) return;
    setBusy(true); setMessage("");
    try { await enablePush(status.publicKey); await refresh(); setMessage("Notifications enabled on this device."); }
    catch (cause) { setPermission(notificationPermission()); setMessage(cause instanceof Error ? cause.message : "Could not enable notifications."); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMessage("");
    try { await disablePush(); setSubscribed(false); setStatus((current) => current && { ...current, deviceRegistered: false });
      setMessage("Notifications disabled on this device."); }
    catch (cause) { await refresh().catch(() => {});
      setMessage(cause instanceof Error ? cause.message : "Could not disable notifications."); }
    finally { setBusy(false); }
  }
  async function preference(key: "friendWorkouts" | "reactions", value: boolean) {
    if (!status) return;
    const previous = status;
    const next = { ...status, [key]: value };
    setStatus(next); setBusy(true); setMessage("");
    try { await savePushPreferences(next.friendWorkouts, next.reactions); setMessage("Notification preferences saved."); }
    catch (cause) { setStatus(previous); setMessage(cause instanceof Error ? cause.message : "Could not save preferences."); }
    finally { setBusy(false); }
  }
  return <section className="review-card push-settings"><p className="eyebrow">NOTIFICATIONS</p><h2>Friends notifications</h2>
    <p className="quiet-note">Get a small alert when a friend finishes a workout or reacts to yours.</p>
    <p className="push-device-status"><strong>Notifications on this device</strong><span>{supported === null || !status ? "Checking…" :
      !status.configured ? "Not configured yet" : !supported ? "Unavailable" : permission === "denied" ? "Permission denied" :
      enabled ? "Enabled" : "Not enabled"}</span></p>
    {status && !status.configured && <p className="quiet-note">Notifications are not configured yet.</p>}
    {status?.configured && supported === false && <p className="quiet-note">Notifications aren&apos;t available on this device/browser. On some iPhones, install Treino Local to the Home Screen first.</p>}
    {status?.configured && supported && permission === "denied" && <p className="quiet-note">Notifications are blocked for this site. Change the permission in your browser or device settings to enable them.</p>}
    {status?.configured && supported && permission !== "denied" && (enabled ?
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void disable()}>Disable notifications on this device</button> :
      <button type="button" className="primary-button" disabled={busy} onClick={() => void enable()}>Enable notifications</button>)}
    {status && <fieldset className="push-preferences" disabled={busy}><legend>Notify me about</legend>
      <label><input type="checkbox" checked={status.friendWorkouts} onChange={(event) => void preference("friendWorkouts", event.target.checked)} /> Friend workouts</label>
      <label><input type="checkbox" checked={status.reactions} onChange={(event) => void preference("reactions", event.target.checked)} /> Reactions</label>
    </fieldset>}
    {status?.configured && supported && <button type="button" className="inline-action" disabled={busy} onClick={() =>
      void refresh().then(() => setMessage("Device and preferences checked. No notification was sent.")).catch(() =>
        setMessage("Could not check notification status right now."))}>Check notification status</button>}
    {message && <p role="status" className="quiet-note">{message}</p>}
  </section>;
}
