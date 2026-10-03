"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { remainingSeconds } from "@/lib/training/rest-timer";

function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

export function RestTimerBar() {
  const { data, pauseRestTimer, resumeRestTimer, extendRestTimer, skipRestTimer } = useApp();
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const timer = data?.restTimer;
  const active = timer && data?.sessions.some((session) => session.id === timer.sessionId && session.status === "inProgress");
  useEffect(() => {
    if (!timer || !active) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const interval = timer.pausedRemainingSeconds === undefined ? window.setInterval(refresh, 1000) : undefined;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("pageshow", refresh); };
  }, [timer, active]);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  if (!timer || !active || !now) return null;
  const remaining = remainingSeconds(timer, now);
  const paused = timer.pausedRemainingSeconds !== undefined;
  const complete = remaining === 0;
  function close() { setOpen(false); openerRef.current?.focus(); }
  function handleKeys(event: React.KeyboardEvent) {
    if (event.key === "Escape") { close(); return; }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const controls = [...sheetRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  }
  return <><div className={`rest-timer-bar ${complete ? "is-finished" : ""}`} role="group" aria-label="Rest timer"><button ref={openerRef} type="button" className="rest-timer-open" onClick={() => setOpen(true)}><span>{complete ? "Rest complete" : paused ? "Rest paused" : "Rest"}</span><strong role="timer" aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}>{clock(remaining)}</strong><span aria-hidden="true">⌃</span></button><button type="button" className="rest-timer-skip" onClick={() => skipRestTimer()}>{complete ? "Done" : "Skip"}</button></div>
    {open && <div className="detail-backdrop rest-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={sheetRef} className="rest-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="rest-detail-title" onKeyDown={handleKeys}><div className="detail-sheet-top"><h2 id="rest-detail-title">Rest timer</h2><button ref={closeRef} type="button" aria-label="Close rest timer" onClick={close}>×</button></div><div className="rest-clock" role="timer" aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}>{clock(remaining)}</div><p className="quiet-note centered">of {clock(timer.durationSeconds)} planned</p><div className="rest-actions">{!complete && <button type="button" className="primary-button" onClick={() => paused ? resumeRestTimer() : pauseRestTimer()}>{paused ? "Resume" : "Pause"}</button>}<button type="button" className="secondary-button" onClick={() => extendRestTimer(30)}>+30 sec</button><button type="button" className="secondary-button" onClick={() => extendRestTimer(60)}>+1 min</button><button type="button" className="secondary-button" onClick={() => { skipRestTimer(); setOpen(false); }}>{complete ? "Done" : "Skip rest"}</button></div></section></div>}
  </>;
}
