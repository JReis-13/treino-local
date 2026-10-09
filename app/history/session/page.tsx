"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { DeleteHistoryConfirmation } from "@/components/delete-history-confirmation";
import { FriendsShareStatus } from "@/components/friends-share-status";
import { durationMinutes, formatLocalDate } from "@/lib/dates";
import { syncLabel } from "@/lib/sync-status";
import { aggregateSync } from "@/lib/training/sync-state";
import { legacyIsHidden } from "@/lib/training/history-delete";

export default function HistorySessionPage() {
  const router = useRouter();
  const { data, correctSessionLoad, deleteSession, deleteLegacy, error } = useApp();
  const [query, setQuery] = useState<URLSearchParams | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteOpener = useRef<HTMLButtonElement>(null);
  useEffect(() => setQuery(new URLSearchParams(window.location.search)), []);
  if (!data || query === null) return <div className="loading">Loading session…</div>;
  const id = query.get("id");
  const foundSession = data.sessions.find((item) => item.id === id && item.status === "completed");
  const legacyPlanId = query.get("plan"), legacyId = query.get("legacy");
  const source = legacyPlanId ? data.plans.find((item) => item.id === legacyPlanId) ??
    data.archivedSources?.find((item) => item.planId === legacyPlanId) : undefined;
  const legacy = legacyId ? source?.legacyCompletions.find((item) => item.id === legacyId) : undefined;
  const visibleLegacy = legacy && legacyPlanId && !legacyIsHidden(data, legacyPlanId, legacy) ? legacy : undefined;
  function closeDelete() { setConfirmDelete(false); requestAnimationFrame(() => deleteOpener.current?.focus()); }
  function remove() {
    const saved = foundSession ? deleteSession(foundSession.id) : visibleLegacy && legacyPlanId ? deleteLegacy(legacyPlanId, visibleLegacy.id) : false;
    if (saved) router.push("/history/");
    else closeDelete();
  }
  if (!foundSession && !visibleLegacy) return <div className="empty-state"><h1>Session unavailable</h1><Link href="/history/" className="secondary-button">Back to history</Link></div>;
  if (!foundSession && visibleLegacy && legacyPlanId) return <div className="page-stack"><Link className="back-link" href="/history/">← History</Link>
    <div className="page-heading"><p className="eyebrow">IMPORTED DATE · {source && "planName" in source ? source.planName : source?.name ?? "Training"}</p>
      <h1>Workout {visibleLegacy.workoutId}</h1><p>{formatLocalDate(visibleLegacy.date)} · duration unavailable</p></div>
    {error && <div className="alert" role="alert">{error}</div>}
    <p className="quiet-note">This date came from a source workbook. Its source remains unchanged if you remove the local History entry.</p>
    <Link className="secondary-button history-share-link" href={`/share/?plan=${encodeURIComponent(legacyPlanId)}&legacy=${encodeURIComponent(visibleLegacy.id)}&from=history`}>Share workout</Link>
    <button ref={deleteOpener} type="button" className="inline-action history-delete-action" onClick={() => setConfirmDelete(true)}>Delete workout record</button>
    {confirmDelete && <DeleteHistoryConfirmation imported onKeep={closeDelete} onDelete={remove} />}
  </div>;
  if (!foundSession) return null;
  const session = foundSession;
  const planName = data.plans.find((plan) => plan.id === session.planId)?.name ?? "Removed training";
  const duration = durationMinutes(session.startedAt, session.completedAt);
  return <div className="page-stack"><Link className="back-link" href="/history/">← History</Link><div className="page-heading"><p className="eyebrow">COMPLETED SESSION · {planName} · VERSION {session.planVersion}</p><h1>{session.workoutSnapshot.title}</h1><p>{formatLocalDate(session.localDate!)}{duration === null ? "" : ` · ${duration} min`}</p></div>{error && <div className="alert" role="alert">{error}</div>}<FriendsShareStatus session={session} /><Link prefetch={false} className="secondary-button history-share-link" href={`/share/?id=${encodeURIComponent(session.id)}&from=history`}>Share workout</Link>{session.sessionNote && <section className="session-note-card"><p className="eyebrow">WORKOUT NOTE</p><p>{session.sessionNote}</p></section>}<div className="context-note"><strong>{session.sourceReconciliation === "removed" ? "Removed from Google Sheets · preserved locally" : session.sourceReconciliation === "conflict" ? "Source match needs review" : syncLabel[aggregateSync(session)]}</strong><span>{session.syncMessage ?? "Your local workout stays saved regardless of source status."}</span></div>
    <div className="section-heading"><div><p className="eyebrow">SESSION RECORD</p><h2>Blocks</h2></div><span className="section-count">{session.blocks.filter((item) => item.completed).length} / {session.blocks.length} DONE{session.blocks.some((item) => item.skipped) ? ` · ${session.blocks.filter((item) => item.skipped).length} SKIPPED` : ""}</span></div><div className="detail-list">{session.blocks.map((item) => {
      const block = session.workoutSnapshot.blocks.find((value) => value.id === item.blockId);
      return <div className="detail-row" key={item.blockId}><span className={`detail-check ${item.completed ? "checked" : ""}`}>{item.completed ? "✓" : "–"}</span><div><strong>{block?.kind === "exercise" ? block.name : block?.kind === "instruction" ? block.heading : item.blockId}</strong><small>{item.skipped ? "Skipped today · " : ""}{block?.kind === "exercise" ? block.prescription : "Instruction block"}</small>{block?.kind === "exercise" && !item.skipped && (block.defaultLoad || item.actualLoad?.trim()) && <small>Plan then: {block.defaultLoad || "—"} · Used: {item.actualLoad?.trim() || "—"}</small>}{block?.kind === "exercise" && item.completed && <details className="session-edit"><summary>Correct load</summary><label className="date-field"><span>ACTUAL LOAD</span><input defaultValue={item.actualLoad ?? ""} inputMode="decimal" aria-label={`Correct load for ${block.name}`} onBlur={(event) => { if (event.target.value !== (item.actualLoad ?? "")) correctSessionLoad(session.id, item.blockId, event.target.value); }} /></label><p className="quiet-note">Saved locally. A current source load change waits for safe source sync.</p></details>}</div></div>;
    })}</div><button ref={deleteOpener} type="button" className="inline-action history-delete-action" onClick={() => setConfirmDelete(true)}>Delete workout record</button>
    {confirmDelete && <DeleteHistoryConfirmation imported={false} onKeep={closeDelete} onDelete={remove} />}
  </div>;
}
