"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { createShareCardFile, createShareCardSvg } from "@/lib/training/share-card";
import { shareWorkout, type ShareResult } from "@/lib/training/share-action";
import { processSharePhoto } from "@/lib/training/share-photo";
import { defaultShareText, shareDate, shareMetrics, shareSummaryFromLegacy, shareSummaryFromSession, type WorkoutShareSummary } from "@/lib/training/share-summary";

async function validPng(file: File): Promise<boolean> {
  if (file.type !== "image/png" || file.size < 8 || !file.name.toLowerCase().endsWith(".png")) return false;
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte);
}

function ShareComposer({ summary, afterSave, backHref }: { summary: WorkoutShareSummary; afterSave: boolean; backHref: string }) {
  const [message, setMessage] = useState(() => defaultShareText(summary));
  const [photo, setPhoto] = useState<Blob>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [card, setCard] = useState<{ file: File; photo?: Blob; summaryKey: string; previewUrl?: string }>();
  const [cardError, setCardError] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sharing, setSharing] = useState(false);
  const [textOnlyRetry, setTextOnlyRetry] = useState(false);
  const selectionVersion = useRef(0);
  const summaryKey = JSON.stringify(summary);
  const svg = useMemo(() => createShareCardSvg(summary), [summary]);
  const readyCard = card?.photo === photo && card?.summaryKey === summaryKey ? card : undefined;
  const preview = readyCard?.previewUrl ?? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  useEffect(() => {
    let active = true;
    createShareCardFile(summary, photo).then(async (created) => {
      if (!await validPng(created)) throw new Error("Invalid card export");
      if (active) setCard({ file: created, photo, summaryKey, previewUrl: photo ? URL.createObjectURL(created) : undefined });
    }).catch(() => {
      if (active) {
        if (photo) { setPhoto(undefined); setPhotoError("The photo card could not be prepared. Your normal card is ready to share."); }
        else setCardError(true);
      }
    });
    return () => { active = false; };
  }, [summary, summaryKey, photo]);
  useEffect(() => () => { if (card?.previewUrl) URL.revokeObjectURL(card.previewUrl); }, [card?.previewUrl]);
  useEffect(() => () => { selectionVersion.current++; }, []);

  async function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!selected) return;
    const version = ++selectionVersion.current;
    setPhotoBusy(true);
    setPhotoError("");
    setTextOnlyRetry(false);
    try {
      const processed = await processSharePhoto(selected);
      if (version === selectionVersion.current) setPhoto(processed);
    } catch (cause) {
      if (version === selectionVersion.current) {
        setPhoto(undefined);
        setPhotoError(cause instanceof Error ? cause.message : "This photo could not be read. Choose another image.");
      }
    } finally {
      if (version === selectionVersion.current) setPhotoBusy(false);
    }
  }

  function removePhoto() {
    selectionVersion.current++;
    setPhotoBusy(false);
    setPhoto(undefined);
    setPhotoError("");
    setTextOnlyRetry(false);
  }

  async function share() {
    if (sharing || photoBusy || (photo && !readyCard)) return;
    setSharing(true);
    setFeedback("");
    const navigatorShare = typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined;
    const navigatorCanShare = typeof navigator.canShare === "function" ? navigator.canShare.bind(navigator) : undefined;
    const result: ShareResult = await shareWorkout(message, textOnlyRetry ? undefined : readyCard?.file, {
      share: navigatorShare,
      canShare: navigatorCanShare,
    });
    setSharing(false);
    if (result === "imageFailed") setTextOnlyRetry(true);
    setFeedback({ sharedImage: "Share sheet closed. Your workout remains saved.",
      sharedImageOnly: "Image sharing opened. This device could not include the workout text.",
      sharedText: readyCard && !textOnlyRetry ? "This device could not share the image. Workout text was shared instead." : "Share sheet closed. Your workout remains saved.",
      imageFailed: "This device could not share the image. Tap Share text instead to try again.",
      cancelled: "Share cancelled. Your workout remains saved.",
      unsupported: "Native sharing is unavailable in this browser. Your workout remains saved.",
      failed: "The share sheet could not open. Your workout remains saved; please try again." }[result]);
  }

  const metrics = shareMetrics(summary);
  return <div className="page-stack share-page">
    <Link className="back-link" href={backHref}>← {afterSave ? "History" : "Session"}</Link>
    <div className="page-heading"><p className="eyebrow">{afterSave ? "SAVED ON THIS DEVICE" : "FROM YOUR HISTORY"}</p><h1>{afterSave ? "Workout completed" : "Share workout"}<span className="dot-accent">.</span></h1><p className="share-summary-text">{summary.workoutName}<br />{metrics ? `${metrics} · ` : ""}{shareDate(summary.localDate)}</p></div>
    <div className="share-card-preview">{/* The preview is a local data URL; server image optimization would disclose nothing useful and add a request. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={`Treino Local card for ${summary.workoutName}, ${metrics ? `${metrics}, ` : ""}${shareDate(summary.localDate)}${photo && readyCard ? ", with selected photo" : ""}`} width="1080" height="1080" />
    </div>
    <div className="share-photo-controls"><label className="share-photo-picker" htmlFor="share-photo-input">{photo ? "Change photo" : "Add photo"}</label><input id="share-photo-input" className="share-photo-input" type="file" accept="image/*" aria-label="Choose workout photo" onChange={selectPhoto} disabled={photoBusy} />{photo && <button type="button" className="share-photo-remove" onClick={removePhoto}>Remove photo</button>}</div>
    {photoBusy && <p className="share-photo-status" role="status">Preparing photo…</p>}
    {photo && !photoBusy && <p className="share-photo-status" role="status">Photo selected for this share only.</p>}
    {photoError && <p className="share-photo-error" role="status">{photoError}</p>}
    <label className="date-field share-message"><span>MESSAGE <small>edit before sharing</small></span><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={2000} /></label>
    <button type="button" className="primary-button share-main-action" onClick={share} disabled={sharing || photoBusy || Boolean(photo && !readyCard)}>{sharing ? "Opening share…" : photoBusy || (photo && !readyCard) ? "Preparing card…" : textOnlyRetry ? "Share text instead" : "Share workout"}</button>
    <p className="share-hint">Your phone chooses the app and recipient. {!readyCard && !cardError && !photo ? "Preparing the image. " : ""}If image sharing is unavailable, workout text is shared instead.</p>
    {cardError && <p className="quiet-note" role="status">Card export is unavailable on this device. Text sharing still works.</p>}
    {feedback && <p className="share-feedback" role="status" aria-live="polite">{feedback}</p>}
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
