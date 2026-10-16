"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { confirmedLoad, loadEditorModel } from "@/lib/training/load-editor";
import { acquireLoadAction, releaseLoadAction, clearLoadDraft, draftKey, loadDrafts, serverLoadDrafts, setLoadDraft, subscribeLoadDrafts } from "@/lib/training/load-drafts";

export function LoadInput({ name, value, onLoad, sessionId, blockId, variant = "list", ariaLabel }: {
  name: string; value?: string; onLoad: (value: string) => boolean; sessionId: string; blockId: string;
  variant?: "list" | "focus" | "detail"; ariaLabel?: string;
}) {
  const drafts = useSyncExternalStore(subscribeLoadDrafts, loadDrafts, serverLoadDrafts);
  const unitId = useId();
  const draft = drafts[draftKey(sessionId, blockId)];
  const model = loadEditorModel(draft?.base ?? value);
  const mode = draft?.mode ?? model.mode;
  const text = draft?.text ?? model.text;
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const candidate = confirmedLoad(text, draft?.base ?? value ?? "", mode);
  function edit(next: string, nextMode = mode) {
    setSave("idle");
    const base = draft?.base ?? value ?? "";
    if (next === loadEditorModel(base).text && nextMode === loadEditorModel(base).mode && base === (value ?? "")) clearLoadDraft(sessionId, blockId);
    else setLoadDraft({ sessionId, blockId, base, text: next, mode: nextMode });
  }
  async function confirm() {
    if (candidate === undefined || save === "saving" || !acquireLoadAction(sessionId, blockId)) return;
    setSave("saving");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (loadDrafts()[draftKey(sessionId, blockId)] !== draft) { releaseLoadAction(sessionId, blockId); setSave("idle"); return; }
    try {
      if (!onLoad(candidate)) { setSave("failed"); return; }
      clearLoadDraft(sessionId, blockId); setSave("saved");
    } catch { setSave("failed"); } finally { releaseLoadAction(sessionId, blockId); }
  }
  return <div className={`load-editor load-editor-${variant}`}>
    <label className={variant === "focus" ? "focus-load" : variant === "detail" ? "date-field" : "load-field"}>
      <span>LOAD TODAY</span><span className="load-entry"><input inputMode={mode === "number" ? "decimal" : "text"} type="text" value={text}
        disabled={save === "saving"} onChange={(event) => edit(event.target.value)}
        placeholder="Enter load used" aria-describedby={mode === "number" && model.unit ? unitId : undefined}
        aria-invalid={Boolean(draft && candidate === undefined)} aria-label={ariaLabel ?? `Actual load for ${name}`} />
        {mode === "number" && model.unit && <span id={unitId} className="load-unit">{model.unit.trim()}</span>}</span>
    </label>
    {(draft || !value) && mode === "number" && <button type="button" className="load-text-mode" disabled={save === "saving"} onClick={() => edit(candidate ?? text, "text")}>Edit full expression</button>}
    {draft && <>
      <small className="load-draft-status">Unsaved edit · Confirmed: {value || "No load"}</small>
      {candidate === undefined && <small role="status">Enter a complete number, using a comma or period for decimals.</small>}
      {draft.memoryOnly && <small role="alert">Draft is held in this tab only. Save before closing it.</small>}
      <div className="load-confirm-actions"><button type="button" disabled={candidate === undefined || save === "saving"} onClick={() => void confirm()}>{save === "saving" ? "Saving load…" : save === "failed" ? "Retry save load" : "Save load"}</button>
        <button type="button" disabled={save === "saving"} onClick={() => { clearLoadDraft(sessionId, blockId); setSave("idle"); }}>Discard edit</button></div>
    </>}
    {save === "saved" && !draft && <small role="status" className="load-save-status">Saved on this device · This session only</small>}
    {save === "failed" && <small role="alert" className="load-save-status load-save-failed">Could not save load. Your draft is retained.</small>}
  </div>;
}
