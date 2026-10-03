"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app-provider";
import { createShareCardFile, createShareCardSvg } from "@/lib/training/share-card";
import { downloadShareCard, shareWorkout, type ShareResult } from "@/lib/training/share-action";
import { defaultShareText, shareDate, shareMetrics, shareSummaryFromLegacy, shareSummaryFromSession, type WorkoutShareSummary } from "@/lib/training/share-summary";

function ShareComposer({ summary, afterSave, backHref }: { summary: WorkoutShareSummary; afterSave: boolean; backHref: string }) {
  const [message, setMessage] = useState(() => defaultShareText(summary));
  const [file, setFile] = useState<File>();
  const [cardError, setCardError] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sharing, setSharing] = useState(false);
  const svg = useMemo(() => createShareCardSvg(summary), [summary]);
  const preview = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  useEffect(() => {
    let active = true;
    createShareCardFile(summary).then((created) => { if (active) setFile(created); })
      .catch(() => { if (active) setCardError(true); });
    return () => { active = false; };
  }, [summary]);

  async function share() {
    if (sharing) return;
    setSharing(true);
    setFeedback("");
    const navigatorShare = typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined;
    const navigatorCanShare = typeof navigator.canShare === "function" ? navigator.canShare.bind(navigator) : undefined;
    const result: ShareResult = await shareWorkout(message, file, {
      share: navigatorShare,
      canShare: navigatorCanShare,
      copy: navigator.clipboard?.writeText?.bind(navigator.clipboard),
      download: downloadShareCard,
    });
    setSharing(false);
    setFeedback({ shared: "Share sheet closed. Your workout remains saved.", copied: "Copied to clipboard", downloaded: "Card downloaded. You can copy the message above.", cancelled: "Share cancelled. Your workout remains saved.", failed: "Sharing is unavailable here. Select and copy the message above." }[result]);
  }

  const metrics = shareMetrics(summary);
  return <div className="page-stack share-page">
    <Link className="back-link" href={backHref}>← {afterSave ? "History" : "Session"}</Link>
    <div className="page-heading"><p className="eyebrow">{afterSave ? "SAVED ON THIS DEVICE" : "FROM YOUR HISTORY"}</p><h1>{afterSave ? "Workout completed" : "Share workout"}<span className="dot-accent">.</span></h1><p className="share-summary-text">{summary.workoutName}<br />{metrics ? `${metrics} · ` : ""}{shareDate(summary.localDate)}</p></div>
    <div className="share-card-preview">{/* The preview is a local data URL; server image optimization would disclose nothing useful and add a request. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={`Treino Local card for ${summary.workoutName}, ${metrics ? `${metrics}, ` : ""}${shareDate(summary.localDate)}`} width="1080" height="1080" />
    </div>
    <label className="date-field share-message"><span>MESSAGE <small>edit before sharing</small></span><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={2000} /></label>
    <button type="button" className="primary-button share-main-action" onClick={share} disabled={sharing}>{sharing ? "Opening share…" : "Share workout"}</button>
    <p className="share-hint">Your phone chooses the app and recipient. {!file && !cardError ? "Preparing the image; sharing now uses text only. " : ""}If image sharing is unavailable, we’ll share the text or offer a copy.</p>
    {cardError && <p className="quiet-note" role="status">Card export is unavailable on this device. Text sharing still works.</p>}
    {feedback && <p className="share-feedback" role="status" aria-live="polite">{feedback}</p>}
    {file && <button type="button" className="share-download" onClick={() => downloadShareCard(file)}>Download card instead</button>}
    <Link className="share-dismiss" href={backHref}>{afterSave ? "Not now" : "Cancel"}</Link>
  </div>;
}

export default function SharePage() {
  const { data } = useApp();
  const [query, setQuery] = useState<URLSearchParams>();
  useEffect(() => setQuery(new URLSearchParams(window.location.search)), []);
  if (!data || !query) return <div className="loading">Loading share preview…</div>;
  const id = query.get("id");
  const session = id ? data.sessions.find((item) => item.id === id && item.status === "completed") : undefined;
  const legacyPlanId = query.get("plan");
  const legacyId = query.get("legacy");
  const plan = legacyPlanId ? data.plans.find((item) => item.id === legacyPlanId) : undefined;
  const archived = legacyPlanId ? data.archivedSources?.find((item) => item.planId === legacyPlanId) : undefined;
  const legacy = legacyId ? (plan?.legacyCompletions.find((item) => item.id === legacyId) ?? archived?.legacyCompletions.find((item) => item.id === legacyId)) : undefined;
  if (!session && !legacy) return <div className="empty-state"><h1>Workout unavailable</h1><Link className="secondary-button" href="/history/">Back to history</Link></div>;
  const summary = session ? shareSummaryFromSession(session) : shareSummaryFromLegacy(legacy!, plan?.workouts.find((item) => item.id === legacy!.workoutId)?.title ?? `Workout ${legacy!.workoutId}`);
  const afterSave = query.get("from") !== "history";
  const backHref = afterSave || !session ? "/history/" : `/history/session/?id=${encodeURIComponent(session.id)}`;
  return <ShareComposer key={session?.id ?? `${legacyPlanId}:${legacyId}`} summary={summary} afterSave={afterSave} backHref={backHref} />;
}
