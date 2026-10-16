"use client";

import { useState, useSyncExternalStore } from "react";
import { confirmedLoad } from "@/lib/training/load-editor";
import { acquireLoadAction, releaseLoadAction, clearLoadDraft, draftKey, loadDrafts, serverLoadDrafts, subscribeLoadDrafts } from "@/lib/training/load-drafts";

/** One explicit, atomic persistence operation for the selected logical exercise. */
export function CompletionControl({ sessionId, blockId, completed, onComplete, name, className, checkbox = false }: {
  sessionId: string; blockId: string; completed: boolean; onComplete: (load?: string) => boolean;
  name?: string; className?: string; checkbox?: boolean;
}) {
  const draft = useSyncExternalStore(subscribeLoadDrafts, loadDrafts, serverLoadDrafts)[draftKey(sessionId, blockId)];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = !completed && draft;
  const candidate = pending ? confirmedLoad(pending.text, pending.base, pending.mode) : undefined;
  async function complete() {
    if ((pending && candidate === undefined) || !acquireLoadAction(sessionId, blockId)) return;
    setBusy(true); setFailed(false);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (loadDrafts()[draftKey(sessionId, blockId)] !== draft) return;
      if (!onComplete(pending ? candidate : undefined)) { setFailed(true); return; }
      if (pending) clearLoadDraft(sessionId, blockId);
    } catch { setFailed(true); }
    finally { releaseLoadAction(sessionId, blockId); setBusy(false); }
  }
  const label = pending ? "Save load & complete" : completed ? (checkbox ? "Undo" : "Undo completion") : (checkbox ? "Done" : "Mark complete");
  return <><button type="button" className={`${className ?? ""}${pending ? " has-pending-load" : ""}`} role={checkbox ? "checkbox" : undefined}
    aria-checked={checkbox ? completed : undefined} aria-label={checkbox ? `${pending ? "Save load & complete" : completed ? "Reopen" : "Complete"} ${name}` : undefined}
    disabled={busy || Boolean(pending && candidate === undefined)} onClick={(event) => { if (event.detail <= 1) void complete(); }}>
    {checkbox && <span className={`complete-dot ${completed ? "on" : ""}`} aria-hidden="true">{completed ? "✓" : ""}</span>}
    {checkbox ? <span>{busy ? "Saving…" : label}</span> : busy ? "Saving…" : label}</button>
    {failed && <small role="alert">Could not save completion. Your edit and exercise remain here. Try again.</small>}</>;
}
