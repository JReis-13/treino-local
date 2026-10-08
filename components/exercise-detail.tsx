"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { formatLocalDate } from "@/lib/dates";
import { exerciseNote } from "@/lib/training/exercise-notes";
import { comparableLoadSummary, exerciseLoadHistory } from "@/lib/training/exercise-history";
import { parseYouTubeVideo } from "@/lib/video-url";
import type { ExerciseBlock, TrainingSession } from "@/types/training";

type Tab = "overview" | "history" | "notes";

function LoadTrend({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const low = Math.min(...values); const high = Math.max(...values);
  const points = values.map((value, index) => `${8 + index * 184 / (values.length - 1)},${56 - (high === low ? 24 : (value - low) / (high - low) * 44)}`).join(" ");
  return <svg className="detail-trend" viewBox="0 0 200 64" role="img" aria-label="Recent comparable loads, oldest to newest"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{points.split(" ").map((point, index) => { const [cx, cy] = point.split(","); return <circle key={index} cx={cx} cy={cy} r="3" fill="currentColor" />; })}</svg>;
}

export function ExerciseDetail({ block, session, actualLoad, previousLoad, currentPlanLoad, planChanged, completed, launchVideo, launchNotes = false, onLoad, onComplete, onClose }: {
  block: ExerciseBlock; session: TrainingSession; actualLoad?: string; previousLoad?: string; currentPlanLoad?: string; planChanged?: boolean; completed: boolean;
  launchVideo: boolean; launchNotes?: boolean; onLoad: (value: string) => void; onComplete: () => void; onClose: () => void;
}) {
  const { data, saveExerciseNote } = useApp();
  const [tab, setTab] = useState<Tab>(launchNotes ? "notes" : "overview");
  const [videoRequested, setVideoRequested] = useState(launchVideo);
  const [videoFailed, setVideoFailed] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const currentNote = data ? exerciseNote(data, session.planId, block.name) : "";
  const [draft, setDraft] = useState(currentNote);
  const [noteMessage, setNoteMessage] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const video = parseYouTubeVideo(block.videoUrl);
  const history = data ? exerciseLoadHistory(data, session.planId, block.name, session.workoutId) : [];
  const recent = history.slice(0, 5);
  const { numeric, highest, unit, mixedUnits } = comparableLoadSummary(history);
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { document.body.style.overflow = before; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  function handleKeys(event: React.KeyboardEvent) {
    if (event.key === "Escape") { onClose(); return; }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") &&
      (event.target as HTMLElement).getAttribute("role") === "tab") {
      event.preventDefault();
      const tabs: Tab[] = ["overview", "history", "notes"];
      const current = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (current + (event.key === "ArrowRight" ? 1 : 2)) % 3;
      setTab(tabs[next]);
      document.getElementById(`tab-${tabs[next]}`)?.focus();
      return;
    }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const controls = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled)')];
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  function saveNote(value: string) {
    if (saveExerciseNote(session.planId, block.name, value)) { setDraft(value.trim()); setNoteMessage(value.trim() ? "Note saved on this device." : "Note removed."); }
  }
  return <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={sheetRef} className="exercise-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="exercise-detail-title" onKeyDown={handleKeys}>
      <div className="detail-sheet-top"><h2 id="exercise-detail-title">{block.name}</h2><button ref={closeRef} type="button" aria-label="Close exercise details" onClick={onClose}>×</button></div>
      <div className="detail-tabs" role="tablist" aria-label="Exercise details">{(["overview", "history", "notes"] as const).map((item) => <button key={item} type="button" role="tab" id={`tab-${item}`} aria-controls={`panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)}>{item === "overview" ? "Overview" : item === "history" ? "History" : "Notes"}</button>)}</div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="detail-panel">
        {tab === "overview" && <>
          {video && <div className="detail-video">{videoRequested ? <div className="detail-video-frame">{!online ? <p>Video requires an internet connection.</p> : videoFailed ? <p>Embedded playback is unavailable for this video.</p> : <iframe title={`Execution example: ${block.name}`} src={video.embedUrl} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={() => setVideoFailed(true)} />}</div> : <button type="button" className="detail-video-prompt" onClick={() => setVideoRequested(true)}>▶ Watch execution</button>}<a href={video.externalUrl} target="_blank" rel="noopener noreferrer">Open in YouTube ↗</a>{videoRequested && <small>If the player refuses playback, use the YouTube link.</small>}</div>}
          <p className="detail-prescription"><strong>Prescription</strong>{block.prescription || "See source plan"}</p>
          {block.equipment && <p className="detail-prescription"><strong>Equipment</strong>{block.equipment}</p>}
          {block.groupId && <p className="detail-prescription"><strong>Grouped in plan with</strong>{session.workoutSnapshot.blocks.filter((item) => item.kind === "exercise" && item.groupId === block.groupId && item.id !== block.id).map((item) => item.kind === "exercise" ? item.name : "").join(", ")}</p>}
          {(block.defaultLoad || currentPlanLoad || previousLoad) && <div className="detail-loads">{currentPlanLoad && <div><small>Current plan</small><strong>{currentPlanLoad}</strong></div>}{planChanged && block.defaultLoad !== currentPlanLoad && block.defaultLoad && <div><small>Plan when started</small><strong>{block.defaultLoad}</strong></div>}{previousLoad && <div><small>Last used</small><strong>{previousLoad}</strong></div>}</div>}
          {block.section !== "Warm-up" && <label className="date-field"><span>LOAD TODAY</span><input type="text" inputMode="decimal" value={actualLoad ?? ""} onChange={(event) => onLoad(event.target.value)} aria-label={`Actual load for ${block.name} in details`} /></label>}
          {block.section !== "Warm-up" && currentPlanLoad && actualLoad?.trim() !== currentPlanLoad.trim() &&
            <button type="button" className="inline-action" onClick={() => onLoad(currentPlanLoad)}>Use current plan load for today</button>}
          <button type="button" className={`primary-button detail-complete ${completed ? "detail-undo" : ""}`} onClick={onComplete}>{completed ? "Undo completion" : "Mark complete"}</button>
        </>}
        {tab === "history" && <><p className="quiet-note">Recent loads recorded for this exercise in this training.</p>{recent.length ? <><div className="detail-history-list">{recent.map((item, index) => <div key={`${item.completedAt}-${index}`}><span>{formatLocalDate(item.date)}</span><strong>{item.load}</strong></div>)}</div>{highest !== undefined && <div className="detail-highest"><span>Highest comparable load</span><strong>{highest}{unit ? ` ${unit}` : ""}</strong></div>}{mixedUnits && <p className="quiet-note">Recorded units differ, so no numeric high is shown.</p>}{!mixedUnits && <LoadTrend values={numeric.slice(0, 5).reverse().map((item) => item.amount)} />}</> : <p className="detail-empty">Your recorded load history will appear after a completed workout.</p>}</>}
        {tab === "notes" && <><p className="quiet-note">This note follows the exercise in this training and stays on this device.</p><label className="date-field"><span>EXERCISE NOTE</span><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setNoteMessage(""); }} maxLength={1000} rows={5} placeholder="Seat position, grip, or a reminder for next time" /></label><div className="detail-note-actions"><button type="button" className="primary-button" onClick={() => saveNote(draft)}>Save note</button>{currentNote && <button type="button" className="secondary-button" onClick={() => saveNote("")}>Remove note</button>}</div>{noteMessage && <p role="status" className="quiet-note">{noteMessage}</p>}</>}
      </div>
    </section>
  </div>;
}
