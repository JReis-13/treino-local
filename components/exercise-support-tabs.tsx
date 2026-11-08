"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useApp } from "@/components/app-provider";
import { ExerciseLoadRecords } from "@/components/exercise-load-records";
import { exerciseNote } from "@/lib/training/exercise-notes";
import { noteIdentity, scopedNotes } from "@/lib/training/annotation-notes";
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

export function ExerciseSupportTabs({ block, session, initialTab = "overview", launchVideo = false, contextVisible = false }: {
  block: ExerciseBlock; session: TrainingSession; initialTab?: Tab; launchVideo?: boolean; contextVisible?: boolean;
}) {
  const { data, error, saveExerciseNote, resolveExerciseNote } = useApp();
  const prefix = useId();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [videoRequested, setVideoRequested] = useState(launchVideo);
  const [videoFailed, setVideoFailed] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const currentWorkout=data?.plans.find(p=>p.id===session.planId)?.workouts.find(w=>w.id===session.workoutId)??session.workoutSnapshot;
  const matches=currentWorkout.blocks.filter((b):b is ExerciseBlock=>b.kind==="exercise"&&noteIdentity(b)===noteIdentity(block));
  const instructor=matches.length===1?matches[0].sourceNotes??[]:block.sourceNotes??[];
  const notes=data?scopedNotes(data,session.planId,matches.length===1?currentWorkout:session.workoutSnapshot,block):[];
  const excelPlan=data?.plans.find(p=>p.id===session.planId)?.source.kind==="excel";
  const legacy=data?.exerciseNotes.find(n=>!n.id&&n.planId===session.planId&&n.exerciseKey===block.name.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("pt-BR"));
  const currentNote=notes.at(-1)?.text??(data?exerciseNote(data,session.planId,block.name):"");
  const [editingId,setEditingId]=useState<string>();
  const [adding,setAdding]=useState(false);
  const [draft, setDraft] = useState(currentNote);
  const [noteMessage, setNoteMessage] = useState("");
  const [noteSaveFailed, setNoteSaveFailed] = useState(false);
  const editedNote = notes.find(note => note.id === editingId) ?? notes.at(-1);
  const savedText = adding ? "" : editedNote?.text ?? currentNote;
  const canAssignNote = matches.length === 1;
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
    if (!canAssignNote || (!value.trim() && (adding || (!editedNote && !legacy)))) return;
    const saved = saveExerciseNote(session.planId, block.name, value, {
      workoutId: session.workoutId, blockId: matches[0].id, id: adding ? undefined : editedNote?.id,
    });
    setNoteSaveFailed(!saved);
    if (saved) {
      if (adding) setEditingId(undefined);
      setDraft(value.trim());
      setAdding(false);
      setNoteMessage(value.trim() ? "Note saved on this device." : "Note removed. Previous versions remain saved.");
    }
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
        {!contextVisible && <><p className="detail-prescription"><strong>Prescription</strong>{block.prescription || "See source plan"}</p>
        {block.equipment && <p className="detail-prescription"><strong>Equipment</strong>{block.equipment}</p>}
        {block.groupId && <p className="detail-prescription"><strong>Grouped in plan with</strong>{session.workoutSnapshot.blocks.filter((item) => item.kind === "exercise" && item.groupId === block.groupId && item.id !== block.id).map((item) => item.kind === "exercise" ? item.name : "").join(", ")}</p>}</>}
        {contextVisible && !video && <p className="quiet-note">No video reference in this plan. Exercise guidance is shown above.</p>}
      </>}
      {tab === "history" && <><p className="quiet-note">Verified loads from completed sessions in this training. Changing Today never rewrites them.</p>{visibleHistory.length ? <><ExerciseLoadRecords history={visibleHistory} />{history.length > 5 && <button type="button" className="inline-action" onClick={() => setShowAllHistory(!showAllHistory)}>{showAllHistory ? "Show recent only" : `Show all ${history.length} sessions`}</button>}{highest !== undefined && <div className="detail-highest"><span>Highest comparable load</span><strong>{highest}{unit ? ` ${unit}` : ""}</strong></div>}{mixedUnits && <p className="quiet-note">Recorded units differ, so no numeric high is shown.</p>}{!mixedUnits && <LoadTrend values={numeric.slice(0, 5).reverse().map((item) => item.amount)} />}</> : <><p className="detail-empty">No verified load history matches this exercise yet. Older records may still be in local History but cannot be safely assigned here.</p><Link className="inline-action" href="/history/">Review local History →</Link></>}</>}
      {tab === "notes" && <>
        <h3>Instructor notes</h3>{instructor.length?instructor.map(n=><article className="excel-note" key={n.id}><strong>{n.author??"Instructor"}</strong><small>From Excel · {n.sheet}!{n.cell}{n.shared?" · shared group cell":""}{n.timestamp?` · ${n.timestamp}`:""}</small><p>{n.text}</p>{!!n.previousTexts?.length&&<details><summary>Previous source versions</summary>{n.previousTexts.map((text,i)=><p key={i}>{text}</p>)}</details>}</article>):<p className="quiet-note">No instructor comments for this exercise.</p>}
        <h3>My notes</h3><p className="quiet-note">{excelPlan ? "Save note stores your changes on this device. To put them in Excel, open Source sync and export a new workbook copy." : "Save note stores your changes on this device. Excel comment export is available for locally imported Excel plans."}</p>
        {legacy&&<details><summary>Existing local note</summary><p className="excel-note">{legacy.text}</p><p className="quiet-note">This older note is preserved. Save it below to associate it with this exercise.</p></details>}
        {notes.filter(n=>n.text||n.history?.length).map(n=><article className="excel-note" key={n.id}><p>{n.text||"Removed locally"}</p><small>{n.updatedAt} · {n.exported?.text===n.text?"Included in a generated or imported Excel copy":"Local changes — not yet exported"}</small><button type="button" className="inline-action" onClick={()=>{setEditingId(n.id);setAdding(false);setDraft(n.text);}}>Edit this note</button>{!!n.history?.length&&<details><summary>Previous versions</summary>{n.history.map((h,i)=><p key={i}>{h.updatedAt} · {h.text||"Empty note"}</p>)}</details>}{n.conflicts?.map(text=><div className="context-note" key={text}><strong>Workbook version differs</strong><p>{text}</p><button type="button" className="secondary-button" onClick={()=>{if(resolveExerciseNote(session.planId,n.id!,text,true)){setEditingId(n.id);setDraft(text);}}}>Use workbook version</button><button type="button" className="secondary-button" onClick={()=>resolveExerciseNote(session.planId,n.id!,text,false)}>Keep my version</button></div>)}</article>)}
        {!!notes.length&&<button type="button" className="inline-action" onClick={()=>{setAdding(true);setEditingId(undefined);setDraft("");}}>Add another note</button>}
        <label className="date-field"><span>EXERCISE NOTE</span><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setNoteMessage(""); setNoteSaveFailed(false); }} maxLength={1000} rows={5} placeholder="Seat position, grip, or a reminder for next time" /></label>
        {!canAssignNote && <p className="quiet-note">This exercise has no unique match in the current plan. Review the plan before saving a note here.</p>}
        {draft.trim() !== savedText && <p className="quiet-note">Unsaved changes</p>}
        <div className="detail-note-actions">
          <button type="button" className="primary-button" disabled={!canAssignNote || (!draft.trim() && !savedText)} onClick={() => saveNote(draft)}>Save note</button>
          {!adding && savedText && <button type="button" className="secondary-button" disabled={!canAssignNote} onClick={() => saveNote("")}>Remove note</button>}
        </div>
        <Link href="/source/" className="inline-action">{excelPlan ? "Source sync & Excel export →" : "Source connection →"}</Link>
        {noteMessage && <p role="status" className="quiet-note">{noteSaveFailed ? error ?? noteMessage : noteMessage}</p>}
      </>}
    </div>
  </div>;
}
