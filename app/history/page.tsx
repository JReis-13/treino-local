"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { durationMinutes, formatLocalDate } from "@/lib/dates";
import { aggregateSync } from "@/lib/training/sync-state";
import { syncLabel } from "@/lib/sync-status";
import type { LegacyCompletion, TrainingSession } from "@/types/training";
import { legacyIsHidden } from "@/lib/training/history-delete";
import { readSocialDiagnostics } from "@/lib/social/client";

type Entry = { type: "session"; session: TrainingSession; date: string } | { type: "legacy"; legacy: LegacyCompletion; planId: string; planName: string; date: string };

export default function HistoryPage() {
  const { data, error, undoSessionDeletion, undoLegacyDeletion } = useApp();
  const [filter, setFilter] = useState("active");
  const [deletedMessage, setDeletedMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("deleted") === "1")
      setDeletedMessage(readSocialDiagnostics().deleteOutboxCount ?
        "Workout removed locally. Friends removal is queued and will retry when connected." :
        "Workout record removed from this device. Source spreadsheets remain unchanged.");
  }, []);
  if (!data) return <div className="loading">Loading history…</div>;
  const undoable = (data.pendingHistoryDeletions ?? []).filter((item) => Date.parse(item.expiresAt) > clock);
  const undoableLegacy = (data.pendingLegacyDeletions ?? []).filter((item) => Date.parse(item.expiresAt) > clock);
  const planId = filter === "active" ? data.activePlanId : filter === "all" ? undefined : filter;
  const sessions = data.sessions.filter((item) => item.status === "completed" &&
    item.sourceReconciliation !== "removed" && (!planId || item.planId === planId));
  const removedSessions = data.sessions.filter((item) => item.status === "completed" &&
    item.sourceReconciliation === "removed" && (!planId || item.planId === planId));
  const removedDateCount = data.plans.filter((item) => !planId || item.id === planId)
    .reduce((sum, item) => sum + (item.removedSourceCompletions?.length ?? 0), 0);
  const sourceDateCount = data.plans.filter((item) => (!planId || item.id === planId) &&
    item.source.kind === "google" && item.lastReconciliation)
    .reduce((sum, item) => sum + item.legacyCompletions.length, 0);
  const entries: Entry[] = sessions.map((session) => ({ type: "session", session, date: session.localDate! }));
  for (const plan of data.plans.filter((item) => !planId || item.id === planId)) {
    for (const legacy of plan.legacyCompletions) {
      if (legacyIsHidden(data, plan.id, legacy)) continue;
      if (sessions.some((session) => session.planId === plan.id && session.workoutId === legacy.workoutId && session.localDate === legacy.date &&
        (session.completionReceipt?.slot === legacy.sourceSlot || (!session.completionReceipt &&
          (plan.source.kind === "google" ? !session.duplicateDateAllowed &&
            plan.legacyCompletions.filter((item) => item.workoutId === legacy.workoutId && item.date === legacy.date).length === 1 :
            session.syncStatus === "synced"))))) continue;
      entries.push({ type: "legacy", legacy, planId: plan.id, planName: plan.name, date: legacy.date });
    }
  }
  if (filter === "all") for (const archived of data.archivedSources ?? []) for (const legacy of archived.legacyCompletions) {
    if (legacyIsHidden(data, archived.planId, legacy)) continue;
    entries.push({ type: "legacy", legacy, planId: archived.planId, planName: archived.planName, date: legacy.date });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) ||
    (b.type === "session" ? b.session.completedAt ?? "" : "").localeCompare(a.type === "session" ? a.session.completedAt ?? "" : ""));
  const days = entries.reduce<Array<{ date: string; items: Entry[] }>>((groups, entry) => {
    if (groups.at(-1)?.date === entry.date) groups.at(-1)!.items.push(entry);
    else groups.push({ date: entry.date, items: [entry] });
    return groups;
  }, []);
  return <div className="page-stack history-page"><div className="page-heading"><p className="eyebrow">YOUR PROGRESS</p><h1>History<span className="dot-accent">.</span></h1><p>Your sessions and imported dates, kept on this device.</p></div>
    {(undoable.length > 0 || undoableLegacy.length > 0) && <div className="history-undo-stack" role="status" aria-live="polite">{undoable.map((item) =>
      <div className="history-undo" key={item.session.id}><span>Workout deleted · {Math.max(1, Math.ceil((Date.parse(item.expiresAt) - clock) / 1000))}s</span>
        <button type="button" onClick={() => undoSessionDeletion(item.session.id)}>Undo</button></div>)}
      {undoableLegacy.map((item) => <div className="history-undo" key={`${item.planId}:${item.legacyId}`}>
        <span>Imported date deleted · {Math.max(1, Math.ceil((Date.parse(item.expiresAt) - clock) / 1000))}s</span>
        <button type="button" onClick={() => undoLegacyDeletion(item.planId, item.legacyId)}>Undo</button></div>)}</div>}
    {deletedMessage && <div className="context-note" role="status">{deletedMessage}</div>}
    {error && <div className="alert" role="alert">{error}</div>}
    {(removedSessions.length > 0 || removedDateCount > 0) && <div className="context-note"><strong>Google Sheets updated</strong>
      <span>{sourceDateCount} current source workout{sourceDateCount === 1 ? "" : "s"} found. {removedDateCount} previously imported date{removedDateCount === 1 ? "" : "s"} no longer in the Sheet.
        {removedSessions.length > 0 ? ` ${removedSessions.length} detailed local workout${removedSessions.length === 1 ? "" : "s"} preserved below.` : ""}
        {" "}These records are excluded from current History and Statistics. Friends sharing is unchanged.</span></div>}
    <label className="date-field"><span>TRAINING PLAN</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Current training</option><option value="all">All training</option>{data.plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label>
    <div className="history-total"><strong>{entries.length}</strong><span>workouts<br />recorded</span></div>
      {entries.length ? <div className="history-list">{days.map((day) => <section className="history-day" key={day.date}><div className="history-day-heading"><strong>{formatLocalDate(day.date)}</strong><span>{day.items.length} workout{day.items.length === 1 ? "" : "s"}</span></div>{day.items.map((entry) => entry.type === "session" ? <Link className="history-card" key={entry.session.id} href={`/history/session/?id=${encodeURIComponent(entry.session.id)}`}><div className="history-avatar">✓</div><div className="history-copy"><strong>{entry.session.workoutSnapshot.title}</strong><span>{new Date(entry.session.completedAt!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}{durationMinutes(entry.session.startedAt, entry.session.completedAt) === null ? "" : ` · ${durationMinutes(entry.session.startedAt, entry.session.completedAt)} min`} · {entry.session.blocks.filter((block) => block.completed).length}/{entry.session.blocks.length} done</span>{entry.session.sessionNote && <small className="history-note-preview">{entry.session.sessionNote}</small>}<small>{data.plans.find((plan) => plan.id === entry.session.planId)?.name ?? "Removed training"} · {entry.session.sourceReconciliation === "conflict" ? "Source match needs review" : entry.session.completionReceipt ? "Current source-linked" : "Saved locally"} · {syncLabel[aggregateSync(entry.session)]}</small></div><span className="history-arrow">›</span></Link>
      : <Link prefetch={false} className="history-card" key={`${entry.planId}:${entry.legacy.id}`} href={`/history/session/?plan=${encodeURIComponent(entry.planId)}&legacy=${encodeURIComponent(entry.legacy.id)}`}><div className="history-avatar imported">◷</div><div className="history-copy"><strong>Workout {entry.legacy.workoutId}</strong><span>Imported date · duration unavailable</span><small>{entry.planName}{entry.legacy.calories ? ` · ${entry.legacy.calories} kcal as recorded` : ""}</small></div><span className="history-arrow" aria-label="Open imported workout">›</span></Link>)}</section>)}</div>
      : <div className="empty-state"><h2>Your history starts here</h2><p>Finish a workout or import a plan with completion dates.</p><Link className="secondary-button" href="/">Choose a workout</Link></div>}
    {removedSessions.length > 0 && <section className="review-card"><h2>Preserved local workouts</h2>
      <p className="quiet-note">Their linked dates were removed from Google Sheets. Details remain on this device and can be inspected.</p>
      <div className="history-list">{removedSessions.map((session) => <Link className="history-card" key={session.id}
        href={`/history/session/?id=${encodeURIComponent(session.id)}`}><div className="history-avatar imported">◷</div>
        <div className="history-copy"><strong>{session.workoutSnapshot.title}</strong><span>{formatLocalDate(session.localDate!)}</span>
        <small>Removed from source · local details preserved</small></div><span className="history-arrow">›</span></Link>)}</div></section>}
  </div>;
}
