"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { durationMinutes, formatLocalDate } from "@/lib/dates";
import { syncLabel } from "@/lib/sync-status";
import { aggregateSync } from "@/lib/training/sync-state";

export default function HistorySessionPage() {
  const { data, correctSessionLoad } = useApp();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id") ?? ""), []);
  if (!data || id === null) return <div className="loading">Loading session…</div>;
  const session = data.sessions.find((item) => item.id === id && item.status === "completed");
  if (!session) return <div className="empty-state"><h1>Session unavailable</h1><Link href="/history/" className="secondary-button">Back to history</Link></div>;
  const planName = data.plans.find((plan) => plan.id === session.planId)?.name ?? "Removed training";
  const duration = durationMinutes(session.startedAt, session.completedAt);
  return <div className="page-stack"><Link className="back-link" href="/history/">← History</Link><div className="page-heading"><p className="eyebrow">COMPLETED SESSION · {planName} · VERSION {session.planVersion}</p><h1>{session.workoutSnapshot.title}</h1><p>{formatLocalDate(session.localDate!)}{duration === null ? "" : ` · ${duration} min`}</p></div><Link prefetch={false} className="secondary-button history-share-link" href={`/share/?id=${encodeURIComponent(session.id)}&from=history`}>Share workout</Link>{session.sessionNote && <section className="session-note-card"><p className="eyebrow">WORKOUT NOTE</p><p>{session.sessionNote}</p></section>}<div className="context-note"><strong>{syncLabel[aggregateSync(session)]}</strong><span>{session.syncMessage ?? "Your local workout stays saved regardless of source status."}</span></div>
    <div className="section-heading"><div><p className="eyebrow">SESSION RECORD</p><h2>Blocks</h2></div><span className="section-count">{session.blocks.filter((item) => item.completed).length} / {session.blocks.length} DONE{session.blocks.some((item) => item.skipped) ? ` · ${session.blocks.filter((item) => item.skipped).length} SKIPPED` : ""}</span></div><div className="detail-list">{session.blocks.map((item) => {
      const block = session.workoutSnapshot.blocks.find((value) => value.id === item.blockId);
      return <div className="detail-row" key={item.blockId}><span className={`detail-check ${item.completed ? "checked" : ""}`}>{item.completed ? "✓" : "–"}</span><div><strong>{block?.kind === "exercise" ? block.name : block?.kind === "instruction" ? block.heading : item.blockId}</strong><small>{item.skipped ? "Skipped today · " : ""}{block?.kind === "exercise" ? block.prescription : "Instruction block"}{!item.skipped && item.actualLoad?.trim() ? ` · Load ${item.actualLoad.trim()}` : ""}</small>{block?.kind === "exercise" && !item.skipped && (block.defaultLoad || item.actualLoad?.trim()) && <small>Plan then: {block.defaultLoad || "—"} · Used: {item.actualLoad?.trim() || "—"}</small>}{block?.kind === "exercise" && item.completed && <details className="session-edit"><summary>Correct load</summary><label className="date-field"><span>ACTUAL LOAD</span><input defaultValue={item.actualLoad ?? ""} inputMode="decimal" aria-label={`Correct load for ${block.name}`} onBlur={(event) => { if (event.target.value !== (item.actualLoad ?? "")) correctSessionLoad(session.id, item.blockId, event.target.value); }} /></label><p className="quiet-note">Saved locally. A current source load change waits for safe source sync.</p></details>}</div></div>;
    })}</div>
  </div>;
}
