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
import { safeVideoUrl } from "@/lib/video-url";

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

function WorkoutHeader({ title, count, total, skipped, startedAt, focusMode, onList, onFocus, canFocus, onCancel }: {
  title: string; count: number; total: number; skipped: number; startedAt: string; focusMode: boolean;
  onList: () => void; onFocus: () => void; canFocus: boolean; onCancel: () => void;
}) {
  return <header className="active-workout-header"><div className="focus-workout-header"><Link className="back-link" href="/" aria-label="Back home">←</Link><div><h1>{title}</h1><p><span>{count}/{total} completed{skipped ? ` · ${skipped} skipped` : ""}</span><ElapsedTime startedAt={startedAt} /></p></div><details className="workout-overflow"><summary aria-label="Workout options">⋯</summary><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onCancel(); }}>Cancel workout</button></details></div>
    <div className="progress-track" role="progressbar" aria-label="Workout progress" aria-valuenow={count} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${total ? count / total * 100 : 0}%` }} /></div>
    <div className="workout-mode" role="group" aria-label="Workout view"><button type="button" aria-pressed={!focusMode} onClick={onList}>List</button><button type="button" aria-pressed={focusMode} onClick={onFocus} disabled={!canFocus}>Focus</button></div>
  </header>;
}

export function WorkoutView({ workoutId }: { workoutId?: string }) {
  const router = useRouter();
  const { data, error, start, cancel, updateBlock, moveBlockLater, restoreQueue, skipBlock, setFocus, startRestTimer } = useApp();
  const [queryId, setQueryId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ blockId: string; launchVideo: boolean; launchNotes: boolean } | null>(null);
  const [detailOpener, setDetailOpener] = useState<HTMLElement | null>(null);
  const [skipTarget, setSkipTarget] = useState<string | null>(null);
  const [laterUndo, setLaterUndo] = useState<{ sessionId: string; queueOrder: string[]; focusBlockId?: string } | null>(null);
  const [recentComplete, setRecentComplete] = useState<string | null>(null);
  const [reviewBlockId, setReviewBlockId] = useState<string | null>(null);
  const [optionalLoadId, setOptionalLoadId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
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
  useEffect(() => {
    if (activeSession?.focusMode) window.scrollTo(0, 0);
  }, [activeSession?.focusMode, activeSession?.focusBlockId, reviewBlockId]);
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
  const displayedFocusId = reviewBlockId && exerciseOrder.includes(reviewBlockId) ? reviewBlockId : focusId;
  const focusBlock = blocks.find((block) => block.id === displayedFocusId && block.kind === "exercise");
  const focusIndex = exerciseOrder.indexOf(displayedFocusId ?? "");
  const focusState = ownSession?.blocks.find((state) => state.blockId === displayedFocusId);
  const focusPreviousLoad = focusBlock?.kind === "exercise" ? lastUsedLoad(data, plan.id, focusBlock.id) : undefined;
  const focusNote = focusBlock?.kind === "exercise" ? exerciseNote(data, plan.id, focusBlock.name) : "";
  const focusHasLoad = Boolean(focusBlock?.kind === "exercise" && (focusState?.actualLoad || focusBlock.defaultLoad || focusPreviousLoad));
  const focusPartnerNames = focusBlock?.kind === "exercise" && focusBlock.groupId ? blocks.filter((block) => block.kind === "exercise" && block.groupId === focusBlock.groupId && block.id !== focusBlock.id).map((block) => block.kind === "exercise" ? block.name : "") : [];
  const otherBlocks = blocks.filter((block) => block.kind !== "exercise" || !remaining.includes(block.id));
  const pendingBlocks = exerciseOrder.flatMap((blockId) => remaining.includes(blockId) ? blocks.filter((block) => block.id === blockId) : []);
  const restSuggestion = suggestedRest(ownSession?.workoutSnapshot.restNote);
  const focusRestSuggestion = focusBlock?.kind === "exercise" && focusBlock.section !== "Warm-up" ? restSuggestion : undefined;
  const recentBlock = blocks.find((block) => block.id === recentComplete);
  const recentRestSuggestion = recentBlock?.kind === "exercise" && recentBlock.section !== "Warm-up" ? restSuggestion : undefined;
  function openDetail(blockId: string, launchVideo: boolean, opener: HTMLElement, launchNotes = false) { setDetailOpener(opener); setDetail({ blockId, launchVideo, launchNotes }); }
  function closeDetail() { setDetail(null); window.requestAnimationFrame(() => detailOpener?.focus()); }

  function doLater(blockId: string) {
    if (!ownSession) return;
    setLaterUndo({ sessionId: ownSession.id, queueOrder: sessionExerciseOrder(ownSession), focusBlockId: ownSession.focusBlockId });
    moveBlockLater(ownSession.id, blockId);
    setRecentComplete(null);
    setReviewBlockId(null);
  }

  function complete(blockId: string, wasComplete: boolean) {
    if (!ownSession) return;
    updateBlock(ownSession.id, blockId, { completed: !wasComplete });
    setRecentComplete(wasComplete ? null : blockId);
    setReviewBlockId(null);
  }

  function navigateFocus(blockId: string) {
    if (!ownSession) return;
    setRecentComplete(null);
    if (remaining.includes(blockId)) {
      setReviewBlockId(null);
      setFocus(ownSession.id, true, blockId);
    } else setReviewBlockId(blockId);
  }

  function askSkip(blockId: string, opener: HTMLElement) { skipOpener.current = opener; setSkipTarget(blockId); }
  function closeSkip() { setSkipTarget(null); window.requestAnimationFrame(() => skipOpener.current?.focus()); }

  function begin() {
    const session = start(plan!.id, workout!.id);
    if (session && session.workoutId !== workout!.id) router.push(`/workout/?id=${encodeURIComponent(session.workoutId)}`);
  }

  if (!ownSession) return <div className="page-stack"><Link className="back-link" href="/">← Home</Link><div className="plan-preview"><p className="eyebrow">{plan.name}</p><h1>{workout.title}</h1><p>{workout.description}</p><div className="preview-stats"><span><strong>{workout.blocks.length}</strong> blocks</span><span><strong>{workout.duration || "Flexible"}</strong> duration</span></div><button type="button" className="primary-button" onClick={begin}>{inProgress ? `Resume ${inProgress.workoutSnapshot.title}` : `Start ${workout.title}`} <span>→</span></button></div>{error && <div className="alert" role="alert">{error}</div>}<p className="quiet-note">Your progress saves automatically on this device.</p></div>;

  return <div className={`page-stack workout-page ${ownSession.focusMode ? "focus-page" : ""}`}>
    <WorkoutHeader title={ownSession.workoutSnapshot.title} count={count} total={blocks.length} skipped={skippedCount} startedAt={ownSession.startedAt} focusMode={Boolean(ownSession.focusMode)} canFocus={exerciseOrder.length > 0} onList={() => { setReviewBlockId(null); if (window.history.state?.treinoFocus) window.history.back(); else setFocus(ownSession.id, false); }} onFocus={() => setFocus(ownSession.id, true)} onCancel={() => setCancelOpen(true)} />
    {error && <div className="alert" role="alert">{error}</div>}
    {laterUndo?.sessionId === ownSession.id && <div className="queue-feedback" role="status">Moved to later <button type="button" onClick={() => { restoreQueue(ownSession.id, laterUndo.queueOrder, laterUndo.focusBlockId); setLaterUndo(null); }}>Undo</button></div>}
    {ownSession.focusMode ? <section className="focus-stage" aria-label="Focus mode">
      {focusBlock?.kind === "exercise" ? <>
        <div className="focus-top"><span>{focusBlock.section}{focusPartnerNames.length ? ` · Group of ${focusPartnerNames.length + 1}` : ""}</span><span>{focusIndex + 1} of {exerciseOrder.length}</span></div>
        <h2 className="focus-name" tabIndex={-1} aria-live="polite">{focusBlock.name}</h2>
        <p className="focus-prescription">{focusBlock.prescription || "See source plan"}{focusBlock.equipment ? ` · ${focusBlock.equipment}` : ""}</p>
        {focusPartnerNames.length > 0 && <p className="focus-group">Paired with {focusPartnerNames.join(", ")}</p>}
        {!focusState?.skipped && focusBlock.section !== "Warm-up" && (focusHasLoad || optionalLoadId === focusBlock.id ? <label className="focus-load"><span>LOAD TODAY</span><input inputMode="decimal" type="text" value={focusState?.actualLoad ?? ""} onChange={(event) => updateBlock(ownSession.id, focusBlock.id, { actualLoad: event.target.value })} onBlur={(event) => updateBlock(ownSession.id, focusBlock.id, { actualLoad: normalizeLoad(event.target.value) })} placeholder="Enter load used" aria-label={`Actual load for ${focusBlock.name}`} /></label> : <button type="button" className="focus-optional-load" onClick={() => setOptionalLoadId(focusBlock.id)}>+ Add load (optional)</button>)}
        {(focusBlock.defaultLoad || focusPreviousLoad) && <p className="focus-reference">{focusBlock.defaultLoad && <span>Plan <strong>{focusBlock.defaultLoad}</strong></span>}{focusPreviousLoad && <span>Last <strong>{focusPreviousLoad}</strong></span>}</p>}
        {focusRestSuggestion && <p className="focus-rest">Rest: {focusRestSuggestion.label}</p>}
        {(safeVideoUrl(focusBlock.videoUrl) || focusNote) && <div className="focus-context">{safeVideoUrl(focusBlock.videoUrl) && <button type="button" onClick={(event) => openDetail(focusBlock.id, true, event.currentTarget)}>▶ Watch execution</button>}{focusNote && <button type="button" className="focus-note" onClick={(event) => openDetail(focusBlock.id, false, event.currentTarget, true)}>Note: {focusNote}</button>}</div>}
        {focusState?.completed ? <div className="focus-state is-completed" role="status"><strong>✓ Completed</strong><div><button type="button" onClick={() => { complete(focusBlock.id, true); setFocus(ownSession.id, true, focusBlock.id); }}>Undo</button>{focusRestSuggestion && !data.restTimer && <button type="button" onClick={() => startRestTimer(ownSession.id, focusRestSuggestion.seconds)}>Start {Math.floor(focusRestSuggestion.seconds / 60)}:{String(focusRestSuggestion.seconds % 60).padStart(2, "0")} rest</button>}</div></div>
          : focusState?.skipped ? <div className="focus-state is-skipped" role="status"><strong>Skipped today</strong><button type="button" onClick={() => { skipBlock(ownSession.id, focusBlock.id, false); setReviewBlockId(null); }}>Undo skip</button></div>
          : <button type="button" className="primary-button focus-complete" onClick={() => complete(focusBlock.id, false)}>Mark complete</button>}
        <div className="focus-detail-links"><button type="button" onClick={(event) => openDetail(focusBlock.id, false, event.currentTarget, true)}>{focusNote ? "Edit note & history" : "Add note & history"}</button></div>
        {!focusState?.completed && !focusState?.skipped && <details key={focusBlock.id} className="focus-more"><summary>More actions</summary><div className="focus-secondary"><button type="button" onClick={() => doLater(focusBlock.id)}>Do later</button><button type="button" onClick={(event) => askSkip(focusBlock.id, event.currentTarget)}>Skip today</button></div></details>}
        <div className="focus-navigation"><button type="button" disabled={focusIndex <= 0} onClick={() => navigateFocus(exerciseOrder[focusIndex - 1])}>← Previous</button><span>{focusIndex + 1} / {exerciseOrder.length}</span><button type="button" disabled={focusIndex >= exerciseOrder.length - 1} onClick={() => navigateFocus(exerciseOrder[focusIndex + 1])}>Next →</button></div>
        {focusIndex < exerciseOrder.length - 1 && <p className="focus-next">Next: {blocks.find((block) => block.id === exerciseOrder[focusIndex + 1] && block.kind === "exercise")?.kind === "exercise" ? (blocks.find((block) => block.id === exerciseOrder[focusIndex + 1]) as { name: string }).name : "Exercise"}</p>}
      </> : <div className="focus-finished"><h2>All active exercises are done</h2><p>{ownSession.blocks.filter((state) => state.completed && exerciseOrder.includes(state.blockId)).length} completed · {skippedCount} skipped today</p><Link className="primary-button" href="/finish/">Finish workout →</Link></div>}
      {recentComplete && displayedFocusId !== recentComplete && ownSession.blocks.find((state) => state.blockId === recentComplete)?.completed && <div className="focus-recent" role="status"><span>Previous exercise completed.</span><button type="button" onClick={() => { updateBlock(ownSession.id, recentComplete, { completed: false }); setFocus(ownSession.id, true, recentComplete); setRecentComplete(null); }}>Undo</button>{recentRestSuggestion && !data.restTimer && <button type="button" onClick={() => startRestTimer(ownSession.id, recentRestSuggestion.seconds)}>Start {Math.floor(recentRestSuggestion.seconds / 60)}:{String(recentRestSuggestion.seconds % 60).padStart(2, "0")} rest</button>}</div>}
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
    {cancelOpen && <div className="dialog-backdrop"><section className="decision-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-workout-title" onKeyDown={(event) => { if (event.key === "Escape") setCancelOpen(false); }}><p className="eyebrow">DISCARD DRAFT</p><h2 id="cancel-workout-title">Cancel this workout?</h2><p>Your progress in this workout will be discarded. Your training plan and previous workout history will not change.</p><button type="button" className="secondary-button" autoFocus onClick={() => setCancelOpen(false)}>Keep workout</button><button type="button" className="text-button" onClick={() => { if (cancel(ownSession.id)) { setCancelOpen(false); router.push("/"); } }}>Cancel workout</button></section></div>}
    {detail && (() => { const block = blocks.find((item) => item.id === detail.blockId); const state = ownSession.blocks.find((item) => item.blockId === detail.blockId); return block?.kind === "exercise" ? <ExerciseDetail key={block.id} block={block} session={ownSession} actualLoad={state?.actualLoad} previousLoad={lastUsedLoad(data, plan.id, block.id)} completed={state?.completed ?? false} launchVideo={detail.launchVideo} launchNotes={detail.launchNotes} onLoad={(actualLoad) => updateBlock(ownSession.id, block.id, { actualLoad })} onComplete={() => updateBlock(ownSession.id, block.id, { completed: !state?.completed })} onClose={closeDetail} /> : null; })()}
  </div>;
}
