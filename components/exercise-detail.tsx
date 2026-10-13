"use client";

import { useEffect, useRef } from "react";
import { LoadInput } from "@/components/load-input";
import { ExerciseSupportTabs } from "@/components/exercise-support-tabs";
import type { ExerciseBlock, TrainingSession } from "@/types/training";

export function ExerciseDetail({ block, session, actualLoad, previousLoad, currentPlanLoad, planChanged, completed,
  launchVideo, launchNotes = false, onLoad, onComplete, onClose }: {
  block: ExerciseBlock; session: TrainingSession; actualLoad?: string; previousLoad?: string; currentPlanLoad?: string;
  planChanged?: boolean; completed: boolean; launchVideo: boolean; launchNotes?: boolean;
  onLoad: (value: string) => boolean; onComplete: () => void; onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = before; };
  }, []);
  function handleKeys(event: React.KeyboardEvent) {
    if (event.key === "Escape") { onClose(); return; }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const controls = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={sheetRef} className="exercise-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="exercise-detail-title" onKeyDown={handleKeys}>
      <div className="detail-sheet-top"><h2 id="exercise-detail-title">{block.name}</h2><button ref={closeRef} type="button" aria-label="Close exercise details" onClick={onClose}>×</button></div>
      <div className="detail-active-controls">
        {(block.defaultLoad || currentPlanLoad || previousLoad) && <div className="detail-loads">{currentPlanLoad && <div><small>Current plan</small><strong>{currentPlanLoad}</strong></div>}{planChanged && block.defaultLoad !== currentPlanLoad && block.defaultLoad && <div><small>Plan when started</small><strong>{block.defaultLoad}</strong></div>}{previousLoad && <div><small>Last used</small><strong>{previousLoad}</strong></div>}</div>}
        {block.section !== "Warm-up" && <LoadInput sessionId={session.id} blockId={block.id} variant="detail" name={block.name} value={actualLoad} onLoad={onLoad} ariaLabel={`Actual load for ${block.name} in details`} />}
        {block.section !== "Warm-up" && currentPlanLoad && actualLoad?.trim() !== currentPlanLoad.trim() && <button type="button" className="inline-action" onClick={() => onLoad(currentPlanLoad)}>Use current plan load for today</button>}
        <button type="button" className={`primary-button detail-complete ${completed ? "detail-undo" : ""}`} onClick={onComplete}>{completed ? "Undo completion" : "Mark complete"}</button>
      </div>
      <ExerciseSupportTabs key={block.id} block={block} session={session} initialTab={launchNotes ? "notes" : "overview"} launchVideo={launchVideo} />
    </section>
  </div>;
}
