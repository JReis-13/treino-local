"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { durationMinutes, formatLocalDate } from "@/lib/dates";
import { syncLabel } from "@/lib/sync-status";
import type { LegacyCompletion, TrainingSession } from "@/types/training";

type Entry = { type: "session"; session: TrainingSession; date: string } | { type: "legacy"; legacy: LegacyCompletion; planId: string; planName: string; date: string };

export default function HistoryPage() {
  const { data, error } = useApp();
  const [filter, setFilter] = useState("active");
  if (!data) return <div className="loading">Loading history…</div>;
  const planId = filter === "active" ? data.activePlanId : filter === "all" ? undefined : filter;
  const sessions = data.sessions.filter((item) => item.status === "completed" && (!planId || item.planId === planId));
  const entries: Entry[] = sessions.map((session) => ({ type: "session", session, date: session.localDate! }));
  for (const plan of data.plans.filter((item) => !planId || item.id === planId)) {
    for (const legacy of plan.legacyCompletions) {
      if (sessions.some((session) => session.planId === plan.id && session.workoutId === legacy.workoutId && session.localDate === legacy.date &&
        (session.completionReceipt?.slot === legacy.sourceSlot || (!session.completionReceipt && session.syncStatus === "synced")))) continue;
      entries.push({ type: "legacy", legacy, planId: plan.id, planName: plan.name, date: legacy.date });
    }
  }
  if (filter === "all") for (const archived of data.archivedSources ?? []) for (const legacy of archived.legacyCompletions) {
    entries.push({ type: "legacy", legacy, planId: archived.planId, planName: archived.planName, date: legacy.date });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) ||
    (b.type === "session" ? b.session.completedAt ?? "" : "").localeCompare(a.type === "session" ? a.session.completedAt ?? "" : ""));
  return <div className="page-stack"><div className="page-heading"><p className="eyebrow">YOUR PROGRESS</p><h1>History<span className="dot-accent">.</span></h1><p>Local sessions and source-imported completion dates stay with their training plan.</p></div>
    {error && <div className="alert" role="alert">{error}</div>}
    <label className="date-field"><span>TRAINING PLAN</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Current training</option><option value="all">All training</option>{data.plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label>
    <div className="history-total"><strong>{entries.length}</strong><span>workouts<br />recorded</span></div>
    {entries.length ? <div className="history-list">{entries.map((entry) => entry.type === "session" ? <Link className="history-card" key={entry.session.id} href={`/history/session/?id=${encodeURIComponent(entry.session.id)}`}><div className="history-avatar">{entry.session.workoutId.slice(0, 1)}</div><div className="history-copy"><strong>{entry.session.workoutSnapshot.title}</strong><span>{formatLocalDate(entry.date)} · {new Date(entry.session.completedAt!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {durationMinutes(entry.session.startedAt, entry.session.completedAt) ?? "—"} min · {entry.session.blocks.filter((block) => block.completed).length}/{entry.session.blocks.length} done</span><small>{data.plans.find((plan) => plan.id === entry.session.planId)?.name ?? "Removed training"} · {syncLabel[entry.session.syncStatus]}</small></div><span className="history-arrow">→</span></Link>
      : <div className="history-card" key={`${entry.planId}:${entry.legacy.id}`}><div className="history-avatar">{entry.legacy.workoutId.slice(0, 1)}</div><div className="history-copy"><strong>Workout {entry.legacy.workoutId}</strong><span>{formatLocalDate(entry.date)} · imported from source</span><small>{entry.planName}{entry.legacy.calories ? ` · ${entry.legacy.calories} kcal as recorded` : ""}</small></div></div>)}</div>
      : <div className="empty-state"><h2>Your history starts here</h2><p>Finish a workout or import a plan with completion dates.</p><Link className="secondary-button" href="/">Choose a workout</Link></div>}
  </div>;
}
