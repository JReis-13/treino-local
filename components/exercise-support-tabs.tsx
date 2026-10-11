"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useApp } from "@/components/app-provider";
import { formatLocalDate } from "@/lib/dates";
import { exerciseNote } from "@/lib/training/exercise-notes";
import { comparableLoadSummary, exerciseLoadHistory } from "@/lib/training/exercise-history";
import { parseYouTubeVideo } from "@/lib/video-url";
import type { ExerciseBlock, TrainingSession } from "@/types/training";

type Tab = "overview" | "history" | "notes";

function LoadTrend({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const low = Math.min(...values), high = Math.max(...values);
  const points = values.map((value, index) => `${8 + index * 184 / (values.length - 1)},${56 - (high === low ? 24 : (value - low) / (high - low) * 44)}`).join(" ");
  return <svg className="detail-trend" viewBox="0 0 200 64" role="img" aria-label="Recent comparable loads, oldest to newest"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{points.split(" ").map((point, index) => { const [cx, cy] = point.split(","); return <circle key={index} cx={cx} cy={cy} r="3" fill="currentColor" />; })}</svg>;
}

export function ExerciseSupportTabs({ block, session, initialTab = "overview", launchVideo = false }: {
  block: ExerciseBlock; session: TrainingSession; initialTab?: Tab; launchVideo?: boolean;
}) {
  const { data, saveExerciseNote } = useApp();
  const prefix = useId();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [videoRequested, setVideoRequested] = useState(launchVideo);
  const [videoFailed, setVideoFailed] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const currentNote = data ? exerciseNote(data, session.planId, block.name) : "";
  const [draft, setDraft] = useState(currentNote);
  const [noteMessage, setNoteMessage] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const video = parseYouTubeVideo(block.videoUrl);
  const history = data ? exerciseLoadHistory(data, session.planId, block.name, session.workoutId) : [];
  const visibleHistory = showAllHistory ? history : history.slice(0, 5);
  const { numeric, highest, unit, mixedUnits } = comparableLoadSummary(history);
  useEffect(() => { const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  function saveNote(value: string) {
    if (saveExerciseNote(session.planId, block.name, value)) { setDraft(value.trim()); setNoteMessage(value.trim() ? "Note saved on this device." : "Note removed."); }
    else setNoteMessage("Could not save the note. Try again.");
  }
  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs: Tab[] = ["overview", "history", "notes"];
    const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? 2 :
      (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
    setTab(tabs[next]);
    document.getElementById(`${prefix}-tab-${tabs[next]}`)?.focus();
  }
  return <div className="exercise-support">
    <div className="detail-tabs" role="tablist" aria-label="Exercise details">{(["overview", "history", "notes"] as const).map((item) =>
      <button key={item} type="button" role="tab" id={`${prefix}-tab-${item}`}
        aria-controls={`${prefix}-panel`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1}
        onClick={() => setTab(item)} onKeyDown={handleTabKey}>{item === "overview" ? "Overview" : item === "history" ? "History" : "Notes"}</button>)}</div>
    <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-tab-${tab}`} className="detail-panel">
      {tab === "overview" && <>
        {video && <div className="detail-video">{videoRequested ? <div className="detail-video-frame">{!online ? <p>Video requires an internet connection.</p> : videoFailed ? <p>Embedded playback is unavailable for this video.</p> : <iframe title={`Execution example: ${block.name}`} src={video.embedUrl} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={() => setVideoFailed(true)} />}</div> : <button type="button" className="detail-video-prompt" onClick={() => setVideoRequested(true)}>▶ Watch execution</button>}<a href={video.externalUrl} target="_blank" rel="noopener noreferrer">Open in YouTube ↗</a>{videoRequested && <small>If the player refuses playback, use the YouTube link.</small>}</div>}
        <p className="detail-prescription"><strong>Prescription</strong>{block.prescription || "See source plan"}</p>
        {block.equipment && <p className="detail-prescription"><strong>Equipment</strong>{block.equipment}</p>}
        {block.groupId && <p className="detail-prescription"><strong>Grouped in plan with</strong>{session.workoutSnapshot.blocks.filter((item) => item.kind === "exercise" && item.groupId === block.groupId && item.id !== block.id).map((item) => item.kind === "exercise" ? item.name : "").join(", ")}</p>}
      </>}
      {tab === "history" && <><p className="quiet-note">Verified loads from completed sessions in this training. Changing Today never rewrites them.</p>{visibleHistory.length ? <><div className="detail-history-list">{visibleHistory.map((item) => <Link href={`/history/session/?id=${encodeURIComponent(item.sessionId)}`} key={item.sessionId}><span>{formatLocalDate(item.date)}</span><strong>{item.load}</strong></Link>)}</div>{history.length > 5 && <button type="button" className="inline-action" onClick={() => setShowAllHistory(!showAllHistory)}>{showAllHistory ? "Show recent only" : `Show all ${history.length} sessions`}</button>}{highest !== undefined && <div className="detail-highest"><span>Highest comparable load</span><strong>{highest}{unit ? ` ${unit}` : ""}</strong></div>}{mixedUnits && <p className="quiet-note">Recorded units differ, so no numeric high is shown.</p>}{!mixedUnits && <LoadTrend values={numeric.slice(0, 5).reverse().map((item) => item.amount)} />}</> : <><p className="detail-empty">No verified load history matches this exercise yet. Older records may still be in local History but cannot be safely assigned here.</p><Link className="inline-action" href="/history/">Review local History →</Link></>}</>}
      {tab === "notes" && <><p className="quiet-note">This note follows the exercise in this training and stays on this device.</p><label className="date-field"><span>EXERCISE NOTE</span><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setNoteMessage(""); }} maxLength={1000} rows={5} placeholder="Seat position, grip, or a reminder for next time" /></label><div className="detail-note-actions"><button type="button" className="primary-button" onClick={() => saveNote(draft)}>Save note</button>{currentNote && <button type="button" className="secondary-button" onClick={() => saveNote("")}>Remove note</button>}</div>{noteMessage && <p role="status" className="quiet-note">{noteMessage}</p>}</>}
    </div>
  </div>;
}
