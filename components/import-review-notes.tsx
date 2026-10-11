"use client";

import { useRef, useState } from "react";
import { warningExercises } from "@/lib/import/review-notes";
import type { ImportedTraining } from "@/types/training";

export function ImportReviewNotes({ imported }: { imported: ImportedTraining }) {
  const notes = imported.warnings.filter((warning) => warning.severity !== "info");
  const [selected, setSelected] = useState<number | null>(null);
  const review = useRef<HTMLDivElement>(null);
  if (!notes.length) return null;
  return <details className="review-warnings"><summary>{notes.length} import note{notes.length === 1 ? "" : "s"} · View details</summary>
    {notes.map((warning, index) => {
      const affected = warningExercises(imported, warning);
      return <article className="import-note" key={`${warning.code}-${index}`}><p>{warning.message}</p>
        {affected.length ? <><p><strong>{affected[0].workout.title}</strong> · {affected.map(({ block }) => block.name).join(" · ")}</p>
          <button type="button" className="inline-action" onClick={() => { setSelected(index); window.requestAnimationFrame(() => review.current?.focus()); }}>Review affected exercises</button></> :
          <p>Review this part of the original source, then import again if you correct it.</p>}
        <details><summary>Source details</summary><p>{warning.location}</p></details>
        {selected === index && <div ref={review} tabIndex={-1} className="import-exercise-review" aria-label="Affected exercises">
          {affected.map(({ block }) => <div key={block.id}><strong>{block.name}</strong><p>Prescription: {block.prescription || "Not identified"}</p><p>Plan load: {block.defaultLoad ?? "Not assigned safely"}</p>{block.equipment && <p>Equipment: {block.equipment}</p>}</div>)}
          <p>These are recognized source values, not today’s loads. Check the original source before using uncertain values; correcting it requires a new import.</p>
        </div>}
      </article>;
    })}
  </details>;
}
