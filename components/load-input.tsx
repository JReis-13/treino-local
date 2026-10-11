"use client";

import { useEffect, useState } from "react";
import { normalizeLoad } from "@/lib/training/loads";

export function LoadInput({ name, value, onLoad, variant = "list", ariaLabel }: {
  name: string; value?: string; onLoad: (value: string) => boolean;
  variant?: "list" | "focus" | "detail"; ariaLabel?: string;
}) {
  const [save, setSave] = useState<"idle" | "saved" | "failed">("idle");
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const persist = (next: string) => { setDraft(next); setSave(onLoad(next) ? "saved" : "failed"); };
  return <div className={`load-editor load-editor-${variant}`}>
    <label className={variant === "focus" ? "focus-load" : variant === "detail" ? "date-field" : "load-field"}>
      <span>LOAD TODAY</span><input inputMode="decimal" type="text" value={draft}
        onChange={(event) => persist(event.target.value)} onBlur={(event) => {
          const normalized = normalizeLoad(event.target.value);
          if (normalized !== draft) persist(normalized);
        }} placeholder="Enter load used" aria-label={ariaLabel ?? `Actual load for ${name}`} />
    </label>
    {save === "saved" && <small role="status" className="load-save-status">Saved on this device · This session only</small>}
    {save === "failed" && <small role="alert" className="load-save-status load-save-failed">Could not save. <button type="button" onClick={() => persist(draft)}>Retry</button></small>}
  </div>;
}
