"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { activePlan } from "@/lib/training/session";
import type { WorkoutBlock } from "@/types/training";
import { lastUsedLoad, normalizeLoad } from "@/lib/training/loads";
import { ExerciseDetail } from "@/components/exercise-detail";
import { suggestedRest } from "@/lib/training/rest-timer";
import { currentFocusId, remainingExerciseOrder, sessionExerciseOrder } from "@/lib/training/queue";
import { exerciseNote } from "@/lib/training/exercise-notes";

function LoadEditor({ name, value, onLoad }: { name: string; value?: string; onLoad: (value: string) => void }) {
  return <label className="load-field"><span>LOAD TODAY</span><input inputMode="decimal" type="text" value={value ?? ""} onChange={(event) => onLoad(event.target.value)} onBlur={(event) => onLoad(normalizeLoad(event.target.value))} placeholder="Enter load used" aria-label={`Actual load for ${name}`} /></label>;
}

function BlockCard({ block, index, completed, skipped, actualLoad, previousLoad, restSuggestion, timerActive, onComplete, onLoad, onDetails, onStartRest, onLater, onSkip, onUndoSkip }: {
  block: WorkoutBlock; index: number; completed: boolean; skipped: boolean; actualLoad?: string; previousLoad?: string;
  restSuggestion?: { seconds: number; label: string }; timerActive: boolean;
  onComplete: () => void; onLoad: (value: string) => void; onDetails: (opener: HTMLElement) => void;
  onStartRest: () => void; onLater: () => void; onSkip: (opener: HTMLElement) => void; onUndoSkip: () => void;
}) {
  const [showOptionalLoad, setShowOptionalLoad] = useState(false);
  const hasLoad = block.kind === "exercise" && (Boolean(block.defaultLoad || previousLoad || actualLoad?.trim()) || showOptionalLoad);
  return <article className={`exercise-card ${completed ? "is-complete" : ""} ${skipped ? "is-skipped" : ""}`}>
    <div className="exercise-head">{!skipped && <button type="button" className="completion-toggle" role="checkbox" aria-checked={completed} aria-label={`${completed ? "Reopen" : "Complete"} ${block.kind === "exercise" ? block.name : block.heading}`} onClick={onComplete}><span className={`complete-dot ${completed ? "on" : ""}`} aria-hidden="true">{completed ? "✓" : ""}</span><span>{completed ? "Undo" : "Done"}</span></button>}<div className="exercise-heading"><span className="exercise-number">{String(index + 1).padStart(2, "0")}</span><h3>{block.kind === "exercise" ? block.name : block.heading}</h3>{block.kind === "exercise" && <p className="exercise-prescription">{block.prescription || "See source plan"}</p>}{completed && <span className="completed-feedback">✓ Completed · tap circle to undo</span>}{skipped && <span className="skipped-feedback">Skipped today</span>}</div></div>
    {block.kind === "exercise" ? <>
      {(block.defaultLoad || previousLoad) && <div className="load-reference">{block.defaultLoad && <div><span>Current plan</span><strong>{block.defaultLoad}</strong></div>}{previousLoad && <div><span>Last used</span><strong>{previousLoad}</strong></div>}</div>}
      {!skipped && block.section !== "Warm-up" && (hasLoad ? <LoadEditor name={block.name} value={actualLoad} onLoad={onLoad} /> : <button type="button" className="add-load-button" onClick={() => setShowOptionalLoad(true)}>+ Record a load</button>)}
      <div className="exercise-actions"><button type="button" className="exercise-detail-button" onClick={(event) => onDetails(event.currentTarget)}>Details</button>{skipped ? <button type="button" className="queue-action" onClick={onUndoSkip}>Undo skip</button> : !completed && <details className="queue-menu"><summary aria-label={`More options for ${block.name}`}>More</summary><div><button type="button" onClick={onLater}>Do later</button><button type="button" onClick={(event) => onSkip(event.currentTarget)}>Skip today</button></div></details>}</div>
      {completed && restSuggestion && !timerActive && <div className="rest-suggestion"><span>{restSuggestion.label}</span><button type="button" onClick={onStartRest}>Start {Math.floor(restSuggestion.seconds / 60)}:{String(restSuggestion.seconds % 60).padStart(2, "0")}</button></div>}
    </> : <p className="instruction-text">{block.text}</p>}
  </article>;
}

function ElapsedTime({ startedAt }: { startedAt: string }) {
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    const refresh = () => setMinutes(Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60000)));
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <span className="elapsed-time">◷ {minutes} min elapsed</span>;
}

export function WorkoutView({ workoutId }: { workoutId?: string }) {
  const router = useRouter();
  const { data, error, start, updateBlock, moveBlockLater, restoreQueue, skipBlock, setFocus, startRestTimer } = useApp();
  const [queryId, setQueryId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ blockId: string; launchVideo: boolean } | null>(null);
  const [detailOpener, setDetailOpener] = useState<HTMLElement | null>(null);
  const [skipTarget, setSkipTarget] = useState<string | null>(null);
  const [laterUndo, setLaterUndo] = useState<{ sessionId: string; queueOrder: string[]; focusBlockId?: string } | null>(null);
  const [recentComplete, setRecentComplete] = useState<string | null>(null);
  const skipOpener = useRef<HTMLElement | null>(null);
  const skipConfirm = useRef<HTMLButtonElement | null>(null);
  const skipCancel = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { if (!workoutId) setQueryId(new URLSearchParams(window.location.search).get("id")); }, [workoutId]);
  const activeSession = data?.sessions.find((session) => session.status === "inProgress" && session.planId === data.activePlanId);
  useEffect(() => {
    if (!activeSession?.focusMode) return;
    if (!window.history.state?.treinoFocus) window.history.pushState({ treinoFocus: true }, "", window.location.href);
    const onBack = () => setFocus(activeSession.id, false);
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [activeSession?.id, activeSession?.focusMode, setFocus]);
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
  const skippedCount = ownSession?.blocks.filter((state) => state.skipped).length ?? 0;
  const exerciseOrder = ownSession ? sessionExerciseOrder(ownSession) : [];
  const remaining = ownSession ? remainingExerciseOrder(ownSession) : [];
  const focusId = ownSession ? currentFocusId(ownSession) : undefined;
  const focusBlock = blocks.find((block) => block.id === focusId && block.kind === "exercise");
  const focusIndex = remaining.indexOf(focusId ?? "");
  const otherBlocks = blocks.filter((block) => block.kind !== "exercise" || !remaining.includes(block.id));
  const pendingBlocks = exerciseOrder.flatMap((blockId) => remaining.includes(blockId) ? blocks.filter((block) => block.id === blockId) : []);
  const restSuggestion = suggestedRest(ownSession?.workoutSnapshot.restNote);
  const focusRestSuggestion = focusBlock?.kind === "exercise" && focusBlock.section !== "Warm-up" ? restSuggestion : undefined;
  const recentBlock = blocks.find((block) => block.id === recentComplete);
  const recentRestSuggestion = recentBlock?.kind === "exercise" && recentBlock.section !== "Warm-up" ? restSuggestion : undefined;
  function openDetail(blockId: string, launchVideo: boolean, opener: HTMLElement) { setDetailOpener(opener); setDetail({ blockId, launchVideo }); }
  function closeDetail() { setDetail(null); window.requestAnimationFrame(() => detailOpener?.focus()); }

  function doLater(blockId: string) {
    if (!ownSession) return;
    setLaterUndo({ sessionId: ownSession.id, queueOrder: sessionExerciseOrder(ownSession), focusBlockId: ownSession.focusBlockId });
    moveBlockLater(ownSession.id, blockId);
    setRecentComplete(null);
  }

  function complete(blockId: string, wasComplete: boolean) {
    if (!ownSession) return;
    updateBlock(ownSession.id, blockId, { completed: !wasComplete });
    setRecentComplete(wasComplete ? null : blockId);
  }

  function askSkip(blockId: string, opener: HTMLElement) { skipOpener.current = opener; setSkipTarget(blockId); }
  function closeSkip() { setSkipTarget(null); window.requestAnimationFrame(() => skipOpener.current?.focus()); }

  function begin() {
    const session = start(plan!.id, workout!.id);
    if (session && session.workoutId !== workout!.id) router.push(`/workout/?id=${encodeURIComponent(session.workoutId)}`);
  }

  if (!ownSession) return <div className="page-stack"><Link className="back-link" href="/">← Home</Link><div className="plan-preview"><p className="eyebrow">{plan.name}</p><h1>{workout.title}</h1><p>{workout.description}</p><div className="preview-stats"><span><strong>{workout.blocks.length}</strong> blocks</span><span><strong>{workout.duration || "Flexible"}</strong> duration</span></div><button type="button" className="primary-button" onClick={begin}>{inProgress ? `Resume ${inProgress.workoutSnapshot.title}` : `Start ${workout.title}`} <span>→</span></button></div>{error && <div className="alert" role="alert">{error}</div>}<p className="quiet-note">Your progress saves automatically on this device.</p></div>;

  return <div className={`page-stack workout-page ${ownSession.focusMode ? "focus-page" : ""}`}><Link className="back-link" href="/">← Home</Link><div className="workout-title"><div><p className="eyebrow">IN PROGRESS · {plan.name}</p><h1>{ownSession.workoutSnapshot.title}</h1><p>{ownSession.workoutSnapshot.description}</p></div><div className="progress-ring"><strong>{count}</strong><small>/ {blocks.length}</small></div></div><div className="workout-meta"><ElapsedTime startedAt={ownSession.startedAt} /><span>{count} / {blocks.length} blocks completed{skippedCount ? ` · ${skippedCount} skipped` : ""}</span></div>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="progress-track" role="progressbar" aria-label="Workout progress" aria-valuenow={count} aria-valuemin={0} aria-valuemax={blocks.length}><span style={{ width: `${count / blocks.length * 100}%` }} /></div>
    <div className="workout-mode" role="group" aria-label="Workout view"><button type="button" aria-pressed={!ownSession.focusMode} onClick={() => { if (window.history.state?.treinoFocus) window.history.back(); else setFocus(ownSession.id, false); }}>List</button><button type="button" aria-pressed={Boolean(ownSession.focusMode)} onClick={() => setFocus(ownSession.id, true)} disabled={!exerciseOrder.length}>Focus</button></div>
    {laterUndo?.sessionId === ownSession.id && <div className="queue-feedback" role="status">Moved to later <button type="button" onClick={() => { restoreQueue(ownSession.id, laterUndo.queueOrder, laterUndo.focusBlockId); setLaterUndo(null); }}>Undo</button></div>}
    {ownSession.focusMode ? <section className="focus-stage" aria-label="Focus mode">
      {focusBlock?.kind === "exercise" ? <>
        <div className="focus-top"><span className="eyebrow">NOW · {focusIndex + 1} OF {remaining.length} REMAINING</span><span>{focusBlock.section}</span></div>
        <h2 className="focus-name" tabIndex={-1} aria-live="polite">{focusBlock.name}</h2>
        <p className="focus-prescription">{focusBlock.prescription || "See source plan"}</p>
        {(focusBlock.defaultLoad || lastUsedLoad(data, plan.id, focusBlock.id)) && <div className="focus-reference">{focusBlock.defaultLoad && <div><span>Current plan</span><strong>{focusBlock.defaultLoad}</strong></div>}{lastUsedLoad(data, plan.id, focusBlock.id) && <div><span>Last used</span><strong>{lastUsedLoad(data, plan.id, focusBlock.id)}</strong></div>}</div>}
        <LoadEditor name={focusBlock.name} value={ownSession.blocks.find((state) => state.blockId === focusBlock.id)?.actualLoad} onLoad={(actualLoad) => updateBlock(ownSession.id, focusBlock.id, { actualLoad })} />
        <button type="button" className="primary-button focus-complete" onClick={() => complete(focusBlock.id, false)}>✓ Complete {focusBlock.name}</button>
        <div className="focus-context"><button type="button" onClick={(event) => openDetail(focusBlock.id, false, event.currentTarget)}>Exercise details{exerciseNote(data, plan.id, focusBlock.name) ? " · Note" : ""}</button></div>
        {focusRestSuggestion && <p className="focus-rest">Rest guidance: {focusRestSuggestion.label}</p>}
        <details key={focusBlock.id} className="focus-more"><summary>More actions</summary><div className="focus-secondary"><button type="button" onClick={() => doLater(focusBlock.id)}>Do later</button><button type="button" onClick={(event) => askSkip(focusBlock.id, event.currentTarget)}>Skip today</button></div></details>
        <div className="focus-navigation"><button type="button" disabled={focusIndex <= 0} onClick={() => setFocus(ownSession.id, true, remaining[focusIndex - 1])}>← Previous</button><span>{focusIndex + 1} / {remaining.length}</span><button type="button" disabled={focusIndex >= remaining.length - 1} onClick={() => setFocus(ownSession.id, true, remaining[focusIndex + 1])}>Next →</button></div>
        <p className="focus-next">{remaining[focusIndex + 1] ? `Next: ${blocks.find((block) => block.id === remaining[focusIndex + 1] && block.kind === "exercise")?.kind === "exercise" ? (blocks.find((block) => block.id === remaining[focusIndex + 1]) as { name: string }).name : "Exercise"}` : "Last exercise in today’s queue"}</p>
      </> : <div className="focus-finished"><h2>All active exercises are done</h2><p>{ownSession.blocks.filter((state) => state.completed && exerciseOrder.includes(state.blockId)).length} completed · {skippedCount} skipped today</p><Link className="primary-button" href="/finish/">Finish workout →</Link></div>}
      {recentComplete && ownSession.blocks.find((state) => state.blockId === recentComplete)?.completed && <div className="focus-recent" role="status"><span>Exercise completed.</span><button type="button" onClick={() => { updateBlock(ownSession.id, recentComplete, { completed: false }); setFocus(ownSession.id, true, recentComplete); setRecentComplete(null); }}>Undo completion</button>{recentRestSuggestion && !data.restTimer && <button type="button" onClick={() => startRestTimer(ownSession.id, recentRestSuggestion.seconds)}>Start {Math.floor(recentRestSuggestion.seconds / 60)}:{String(recentRestSuggestion.seconds % 60).padStart(2, "0")} rest</button>}</div>}
    </section> : <>
    <section className="exercise-section"><div className="section-heading"><div><p className="eyebrow">TODAY’S QUEUE</p><h2>Remaining</h2></div><span className="section-count">{remaining.length} EXERCISES</span></div><div className="exercise-list">{pendingBlocks.map((block) => {
      const state = ownSession.blocks.find((item) => item.blockId === block.id);
      return <BlockCard key={block.id} block={block} index={blocks.findIndex((item) => item.id === block.id)} completed={false} skipped={false} actualLoad={state?.actualLoad}
        previousLoad={block.kind === "exercise" ? lastUsedLoad(data, plan.id, block.id) : undefined}
        restSuggestion={block.kind === "exercise" && block.section !== "Warm-up" ? restSuggestion : undefined}
        timerActive={data.restTimer?.sessionId === ownSession.id}
        onComplete={() => complete(block.id, false)}
        onLoad={(actualLoad) => updateBlock(ownSession.id, block.id, { actualLoad })}
        onDetails={(opener) => openDetail(block.id, false, opener)}
        onStartRest={() => startRestTimer(ownSession.id, restSuggestion!.seconds)} onLater={() => doLater(block.id)} onSkip={(opener) => askSkip(block.id, opener)} onUndoSkip={() => skipBlock(ownSession.id, block.id, false)} />;
    })}</div></section>
    {otherBlocks.length > 0 && <section className="exercise-section"><div className="section-heading"><div><p className="eyebrow">YOUR PLAN</p><h2>Done, skipped & guidance</h2></div></div><div className="exercise-list">{otherBlocks.map((block) => {
      const state = ownSession.blocks.find((item) => item.blockId === block.id);
      return <BlockCard key={block.id} block={block} index={blocks.findIndex((item) => item.id === block.id)} completed={state?.completed ?? false} skipped={state?.skipped ?? false} actualLoad={state?.actualLoad}
        previousLoad={block.kind === "exercise" ? lastUsedLoad(data, plan.id, block.id) : undefined} restSuggestion={block.kind === "exercise" && block.section !== "Warm-up" ? restSuggestion : undefined}
        timerActive={data.restTimer?.sessionId === ownSession.id} onComplete={() => complete(block.id, state?.completed ?? false)}
        onLoad={(actualLoad) => updateBlock(ownSession.id, block.id, { actualLoad })} onDetails={(opener) => openDetail(block.id, false, opener)}
        onStartRest={() => startRestTimer(ownSession.id, restSuggestion!.seconds)} onLater={() => doLater(block.id)} onSkip={(opener) => askSkip(block.id, opener)} onUndoSkip={() => skipBlock(ownSession.id, block.id, false)} />;
    })}</div></section>}
    </>}
    {(ownSession.workoutSnapshot.restNote || ownSession.workoutSnapshot.rirByOccurrence?.length) && <details className="plan-context"><summary>Plan notes</summary><p>{ownSession.workoutSnapshot.restNote}{ownSession.workoutSnapshot.rirByOccurrence?.length ? " RIR follows workout occurrence in the source, not each exercise." : ""}</p></details>}
    <div className="sticky-action"><Link className="primary-button" href="/finish/">Finish workout <span>→</span></Link></div>
    {skipTarget && <div className="dialog-backdrop"><section className="decision-sheet" role="dialog" aria-modal="true" aria-labelledby="skip-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSkip(); } else if (event.key === "Tab" && event.shiftKey && document.activeElement === skipConfirm.current) { event.preventDefault(); skipCancel.current?.focus(); } else if (event.key === "Tab" && !event.shiftKey && document.activeElement === skipCancel.current) { event.preventDefault(); skipConfirm.current?.focus(); } }}><p className="eyebrow">THIS SESSION ONLY</p><h2 id="skip-title">Skip {blocks.find((block) => block.id === skipTarget && block.kind === "exercise")?.kind === "exercise" ? (blocks.find((block) => block.id === skipTarget) as { name: string }).name : "this exercise"} today?</h2><p>It stays in your plan and returns next workout.</p><button ref={skipConfirm} type="button" className="primary-button" onClick={() => { skipBlock(ownSession.id, skipTarget, true); closeSkip(); setRecentComplete(null); }}>Skip today</button><button ref={skipCancel} type="button" className="secondary-button" autoFocus onClick={closeSkip}>Cancel</button></section></div>}
    {detail && (() => { const block = blocks.find((item) => item.id === detail.blockId); const state = ownSession.blocks.find((item) => item.blockId === detail.blockId); return block?.kind === "exercise" ? <ExerciseDetail key={block.id} block={block} session={ownSession} actualLoad={state?.actualLoad} previousLoad={lastUsedLoad(data, plan.id, block.id)} completed={state?.completed ?? false} launchVideo={detail.launchVideo} onLoad={(actualLoad) => updateBlock(ownSession.id, block.id, { actualLoad })} onComplete={() => updateBlock(ownSession.id, block.id, { completed: !state?.completed })} onClose={closeDetail} /> : null; })()}
  </div>;
}
