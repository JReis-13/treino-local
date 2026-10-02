"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { durationMinutes, isLocalDate, localDateString } from "@/lib/dates";

export default function FinishPage() {
  const router = useRouter();
  const { data, error, finish } = useApp();
  const [date, setDate] = useState("");
  useEffect(() => setDate(localDateString()), []);
  if (!data) return <div className="loading">Loading summary…</div>;
  const session = data.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  if (!session) return <div className="empty-state"><h1>No workout in progress</h1><p>Choose a workout to see a finish summary.</p><Link className="primary-button" href="/">Go home →</Link></div>;
  const plan = data.plans.find((item) => item.id === session.planId);
  const completed = session.blocks.filter((item) => item.completed).length;
  const loads = session.blocks.filter((item) => item.actualLoad?.trim()).map((item) => ({
    name: session.workoutSnapshot.blocks.find((block) => block.id === item.blockId && block.kind === "exercise")?.kind === "exercise"
      ? (session.workoutSnapshot.blocks.find((block) => block.id === item.blockId) as { name: string }).name : item.blockId,
    load: item.actualLoad!.trim(),
  }));
  const duration = durationMinutes(session.startedAt, new Date().toISOString());

  function save() { if (finish(session!.id, date)) router.push("/history/"); }

  return <div className="page-stack"><Link className="back-link" href={`/workout/?id=${encodeURIComponent(session.workoutId)}`}>← Back to workout</Link><div className="page-heading"><p className="eyebrow">SESSION SUMMARY · {plan?.name}</p><h1>Nice work.</h1><p>Review your session before saving it to this device.</p></div>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="summary-card"><div className="summary-top"><span>{session.workoutSnapshot.title}</span><span className="summary-badge">READY TO SAVE</span></div><div className="summary-stats"><div><small>STARTED</small><strong>{new Date(session.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</strong></div><div><small>DURATION</small><strong>{duration ?? "—"} min</strong></div><div><small>COMPLETED</small><strong>{completed} / {session.blocks.length}</strong></div></div></div>
    <label className="date-field"><span>WORKOUT DATE <small>your local date</small></span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <section className="loads-summary"><div className="section-heading"><div><p className="eyebrow">THIS SESSION</p><h2>Loads used</h2></div><span className="section-count">{loads.length} ENTERED</span></div>{loads.length ? <div className="load-list">{loads.map((item) => <div key={item.name}><span>{item.name}</span><strong>{item.load}</strong></div>)}</div> : <p className="quiet-note">No actual loads entered. You can still save this workout.</p>}</section>
    {completed < session.blocks.length && <p className="quiet-note">You completed {completed} of {session.blocks.length} blocks. Save when you’re done with your planned session.</p>}
    <button type="button" className="primary-button" disabled={!isLocalDate(date)} onClick={save}>Save workout <span>→</span></button><p className="quiet-note centered">Saved locally first. Source sync can happen later.</p>
  </div>;
}
