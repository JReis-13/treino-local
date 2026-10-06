"use client";

import { useRef } from "react";

export function DeleteHistoryConfirmation({ imported, onKeep, onDelete }: {
  imported: boolean; onKeep: () => void; onDelete: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  return <div className="dialog-backdrop"><section className="decision-sheet" role="dialog" aria-modal="true"
    aria-labelledby="delete-history-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onKeep(); }
      else if (event.key === "Tab" && event.shiftKey && document.activeElement === keep.current) {
        event.preventDefault(); remove.current?.focus();
      } else if (event.key === "Tab" && !event.shiftKey && document.activeElement === remove.current) {
        event.preventDefault(); keep.current?.focus();
      }
    }}>
    <p className="eyebrow">DELETE LOCAL RECORD</p><h2 id="delete-history-title">Delete this workout from Treino Local?</h2>
    <p>{imported ? "This imported date will disappear from History and Statistics." :
      "This workout will disappear from History, Statistics and load progression. If shared, its Friends activity will be removed when online."}</p>
    <p>Changes already written to Google Sheets or Excel will not be reversed.</p>
    <button ref={keep} type="button" className="secondary-button" autoFocus onClick={onKeep}>Keep workout</button>
    <button ref={remove} type="button" className="text-button destructive-action" onClick={onDelete}>Delete record</button>
  </section></div>;
}
