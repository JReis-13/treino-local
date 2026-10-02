"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { activePlan } from "@/lib/training/session";
import type { WorkoutBlock } from "@/types/training";

function BlockCard({ block, index, completed, actualLoad, onComplete, onLoad }: {
  block: WorkoutBlock; index: number; completed: boolean; actualLoad?: string;
  onComplete: () => void; onLoad: (value: string) => void;
}) {
  return <article className={`exercise-card ${completed ? "is-complete" : ""}`}>
    <div className="exercise-head"><span className="exercise-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{block.kind === "exercise" ? block.name : block.heading}</h3>{block.kind === "exercise" && block.groupId && <small>Grouped exercise</small>}</div><span className={`complete-dot ${completed ? "on" : ""}`}>{completed ? "✓" : ""}</span></div>
    {block.kind === "exercise" ? <>
      <div className="exercise-details"><div><span>TARGET</span><strong>{block.prescription || "See source plan"}</strong></div>{block.equipment && <div><span>EQUIPMENT</span><strong>{block.equipment}</strong></div>}</div>
      {block.section !== "Warm-up" && <label className="load-field"><span>ACTUAL LOAD <small>(unit as used in your plan)</small></span><input inputMode="decimal" type="text" value={actualLoad ?? ""} onChange={(event) => onLoad(event.target.value)} placeholder={block.defaultLoad ? `Plan: ${block.defaultLoad}` : "Enter if used"} aria-label={`Actual load for ${block.name}`} /></label>}
      <div className="exercise-actions">{block.videoUrl && <a href={block.videoUrl} target="_blank" rel="noopener noreferrer" className="video-button">▶ Watch example</a>}<button type="button" className={completed ? "done-button done" : "done-button"} onClick={onComplete}>{completed ? "Completed ✓" : "Mark complete"}</button></div>
    </> : <><p className="instruction-text">{block.text}</p><button type="button" className={completed ? "done-button done" : "done-button"} onClick={onComplete}>{completed ? "Completed ✓" : "Mark block complete"}</button></>}
  </article>;
}

export function WorkoutView({ workoutId }: { workoutId?: string }) {
  const router = useRouter();
  const { data, error, start, updateBlock } = useApp();
  const [queryId, setQueryId] = useState<string | null>(null);
  useEffect(() => { if (!workoutId) setQueryId(new URLSearchParams(window.location.search).get("id")); }, [workoutId]);
  if (!data) return <div className="loading">Loading your workout…</div>;
  const plan = activePlan(data);
  const inProgress = data.sessions.find((session) => session.status === "inProgress" && session.planId === plan?.id);
  // Static export navigation can normalize a query URL to /workout. The locally saved
  // session is the authoritative route target after Start or Resume.
  const id = workoutId ?? queryId ?? inProgress?.workoutId;
  const workout = plan?.workouts.find((item) => item.id === id);
  if (!plan || !workout) return <div className="empty-state"><h1>Workout unavailable</h1><p>Choose a training plan and workout first.</p><Link className="primary-button" href="/">Go home →</Link></div>;
  const ownSession = inProgress?.workoutId === workout.id ? inProgress : undefined;
  const blocks = ownSession?.workoutSnapshot.blocks ?? workout.blocks;
  const count = ownSession?.blocks.filter((state) => state.completed).length ?? 0;
  const sections = [...new Set(blocks.map((block) => block.section))];

  function begin() {
    const session = start(plan!.id, workout!.id);
    if (session && session.workoutId !== workout!.id) router.push(`/workout/?id=${encodeURIComponent(session.workoutId)}`);
  }

  if (!ownSession) return <div className="page-stack"><Link className="back-link" href="/">← Home</Link><div className="plan-preview"><p className="eyebrow">{plan.name}</p><h1>{workout.title}</h1><p>{workout.description}</p><div className="preview-stats"><span><strong>{workout.blocks.length}</strong> blocks</span><span><strong>{workout.duration || "Flexible"}</strong> duration</span></div><button type="button" className="primary-button" onClick={begin}>{inProgress ? `Resume ${inProgress.workoutSnapshot.title}` : `Start ${workout.title}`} <span>→</span></button></div>{error && <div className="alert" role="alert">{error}</div>}<p className="quiet-note">Your progress saves automatically on this device.</p></div>;

  return <div className="page-stack workout-page"><Link className="back-link" href="/">← Home</Link><div className="workout-title"><div><p className="eyebrow">IN PROGRESS · {plan.name}</p><h1>{ownSession.workoutSnapshot.title}</h1><p>{ownSession.workoutSnapshot.description}</p></div><div className="progress-ring"><strong>{count}</strong><small>/ {blocks.length}</small></div></div>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="progress-track"><span style={{ width: `${count / blocks.length * 100}%` }} /></div><p className="progress-caption">{count} of {blocks.length} blocks completed</p>
    {(ownSession.workoutSnapshot.restNote || ownSession.workoutSnapshot.rirByOccurrence?.length) && <div className="context-note"><strong>Plan context</strong><span>{ownSession.workoutSnapshot.restNote}{ownSession.workoutSnapshot.rirByOccurrence?.length ? " RIR follows workout occurrence in the source, not each exercise." : ""}</span></div>}
    {sections.map((section) => <section key={section} className="exercise-section"><div className="section-heading"><div><p className="eyebrow">YOUR PLAN</p><h2>{section}</h2></div><span className="section-count">{blocks.filter((block) => block.section === section).length} BLOCKS</span></div><div className="exercise-list">{blocks.map((block, index) => block.section !== section ? null : (() => {
      const state = ownSession.blocks.find((item) => item.blockId === block.id);
      return <BlockCard key={block.id} block={block} index={index} completed={state?.completed ?? false} actualLoad={state?.actualLoad}
        onComplete={() => updateBlock(ownSession.id, block.id, { completed: !state?.completed })}
        onLoad={(actualLoad) => updateBlock(ownSession.id, block.id, { actualLoad })} />;
    })())}</div></section>)}
    <div className="sticky-action"><Link className="primary-button" href="/finish/">Finish workout <span>→</span></Link></div>
  </div>;
}
