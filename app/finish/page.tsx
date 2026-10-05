"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { durationMinutes, formatLocalDate, isLocalDate, localDateString } from "@/lib/dates";
import { sameDaySessions } from "@/lib/training/session";

export default function FinishPage() {
  const router = useRouter();
  const { data, error, finish } = useApp();
  const [date, setDate] = useState("");
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [replaceId, setReplaceId] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const dateEdited = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const refresh = () => { if (!dateEdited.current) setDate(localDateString()); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => { if (showDuplicate) addButton.current?.focus(); }, [showDuplicate]);
  if (!data) return <div className="loading">Loading summary…</div>;
  const session = data.sessions.find((item) => item.status === "inProgress" && item.planId === data.activePlanId);
  if (!session) return <div className="empty-state"><h1>No workout in progress</h1><p>Choose a workout to see a finish summary.</p><Link className="primary-button" href="/">Go home →</Link></div>;
  const plan = data.plans.find((item) => item.id === session.planId);
  const completed = session.blocks.filter((item) => item.completed).length;
  const skipped = session.blocks.filter((item) => item.skipped).length;
  const loads = session.blocks.filter((item) => item.completed && item.actualLoad?.trim()).map((item) => ({
    name: session.workoutSnapshot.blocks.find((block) => block.id === item.blockId && block.kind === "exercise")?.kind === "exercise"
      ? (session.workoutSnapshot.blocks.find((block) => block.id === item.blockId) as { name: string }).name : item.blockId,
    load: item.actualLoad!.trim(),
  }));
  const duration = durationMinutes(session.startedAt, new Date().toISOString());

  const duplicates = isLocalDate(date) ? sameDaySessions(data, session.id, date) : [];
  const previous = duplicates.find((item) => item.id === replaceId) ?? duplicates[0];
  function save(choice: "normal" | "add" | "replace" = "normal") {
    if (submittingRef.current) return;
    const saveDate = dateEdited.current ? date : localDateString();
    const matches = sameDaySessions(data!, session!.id, saveDate);
    if (choice === "normal" && matches.length) { setDate(saveDate); setReplaceId(matches[0].id); setShowDuplicate(true); return; }
    submittingRef.current = true;
    setSubmitting(true);
    const finalSession = finish(session!.id, saveDate, choice, replaceId || undefined, sessionNote);
    if (finalSession) router.push(`/share/?id=${encodeURIComponent(finalSession.id)}`);
    else { submittingRef.current = false; setSubmitting(false); }
  }

  return <div className="page-stack"><Link className="back-link" href={`/workout/?id=${encodeURIComponent(session.workoutId)}`}>← Back to workout</Link><div className="page-heading"><p className="eyebrow">SESSION SUMMARY · {plan?.name}</p><h1>Nice work.</h1><p>Review your session before saving it to this device.</p></div>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="summary-card"><div className="summary-top"><span>{session.workoutSnapshot.title}</span><span className="summary-badge">READY TO SAVE</span></div><div className="summary-stats"><div><small>STARTED</small><strong>{new Date(session.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</strong></div><div><small>DURATION</small><strong>{duration ?? "—"} min</strong></div><div><small>COMPLETED</small><strong>{completed} / {session.blocks.length}</strong></div></div>{skipped > 0 && <p className="quiet-note">{skipped} skipped today</p>}</div>
    <label className="date-field"><span>WORKOUT DATE <small>your local date</small></span><input type="date" value={date} onChange={(event) => { dateEdited.current = true; setDate(event.target.value); setShowDuplicate(false); }} /></label>
    <section className="loads-summary"><div className="section-heading"><div><p className="eyebrow">THIS SESSION</p><h2>Loads used</h2></div><span className="section-count">{loads.length} ENTERED</span></div>{loads.length ? <div className="load-list">{loads.map((item) => <div key={item.name}><span>{item.name}</span><strong>{item.load}</strong></div>)}</div> : <p className="quiet-note">No actual loads entered. You can still save this workout.</p>}</section>
    {completed < session.blocks.length && <p className="quiet-note">You completed {completed} of {session.blocks.length} blocks. Save when you’re done with your planned session.</p>}
    <label className="date-field session-note-field"><span>WORKOUT NOTE <small>optional · local only</small></span><textarea value={sessionNote} maxLength={500} rows={3} onChange={(event) => setSessionNote(event.target.value)} placeholder="How did this workout feel?" /></label>
    <button type="button" className="primary-button" disabled={!isLocalDate(date) || submitting} onClick={() => save()}>Save workout <span>→</span></button><p className="quiet-note centered">Saved locally first. Source sync can happen later.</p>
    {showDuplicate && <div className="dialog-backdrop"><section className="decision-sheet" role="dialog" aria-modal="true" aria-labelledby="duplicate-title" onKeyDown={(event) => { if (event.key === "Escape") setShowDuplicate(false); }}><p className="eyebrow">SAME-DAY WORKOUT</p><h2 id="duplicate-title">You already saved {session.workoutSnapshot.title} today.</h2><p>Choose what happens to this new session.</p>
      {previous && <div className="previous-session"><span>PREVIOUS WORKOUT · {formatLocalDate(previous.localDate!)}</span><strong>{new Date(previous.completedAt!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {durationMinutes(previous.startedAt, previous.completedAt) ?? "—"} min</strong><small>{previous.blocks.filter((block) => block.completed).length} of {previous.blocks.length} blocks completed</small></div>}
      {duplicates.length > 1 && <label className="date-field"><span>SESSION TO REPLACE</span><select value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>{duplicates.map((item) => <option key={item.id} value={item.id}>{new Date(item.completedAt!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {item.blocks.filter((block) => block.completed).length} done</option>)}</select></label>}
      <button ref={addButton} type="button" disabled={submitting} className="primary-button decision-add" onClick={() => save("add")}><span>+ Add another workout<small>Keep both sessions in History</small></span><b aria-hidden="true">→</b></button><button type="button" disabled={submitting} className="secondary-button decision-replace" onClick={() => save("replace")}><span>Replace previous workout<small>Update the selected session</small></span><b aria-hidden="true">→</b></button><button type="button" disabled={submitting} className="decision-cancel" onClick={() => setShowDuplicate(false)}>Cancel</button>
    </section></div>}
  </div>;
}
