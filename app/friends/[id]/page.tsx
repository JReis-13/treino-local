"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocalDate } from "@/lib/dates";
import { type ReactionEmoji, type SocialActivity } from "@/lib/social/model";
import { recordSocialReaction, socialFetch } from "@/lib/social/client";
import { applyReaction, SocialReactions } from "@/components/social-reactions";

type Page = { displayName: string; activities: SocialActivity[]; nextCursor: string | null };
function amsterdamTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" })
    .format(new Date(value));
}

export default function FriendHistoryPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [page, setPage] = useState<Page | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [moreBusy, setMoreBusy] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setState("loading"); setPage(null);
    try {
      const result = await socialFetch<Page>(`friends/${encodeURIComponent(id)}/history`);
      if (request === sequence.current) { setPage(result); setState("ready"); }
    } catch (cause) {
      if (request === sequence.current) { setState("error"); setMessage(cause instanceof Error ? cause.message : "Could not load shared workouts."); }
    }
  }, [id]);
  useEffect(() => { const tracker = sequence; void refresh(); return () => { ++tracker.current; }; }, [refresh]);
  async function more() {
    if (!page?.nextCursor || moreBusy) return;
    const request = sequence.current;
    setMoreBusy(true);
    try {
      const result = await socialFetch<Page>(`friends/${encodeURIComponent(id)}/history?cursor=${encodeURIComponent(page.nextCursor)}`);
      if (request === sequence.current) setPage((current) => current ? { ...current,
        activities: [...current.activities, ...result.activities.filter((activity) =>
          !current.activities.some((existing) => existing.id === activity.id))], nextCursor: result.nextCursor } : current);
    } catch (cause) { if (request === sequence.current) setMessage(cause instanceof Error ? cause.message : "Could not load more workouts."); }
    finally { setMoreBusy(false); }
  }
  async function react(activityId: string, emoji: ReactionEmoji) {
    const original = page?.activities.find((item) => item.id === activityId);
    if (!original) return;
    const next = original.myReaction === emoji ? null : emoji;
    setPage((current) => current ? { ...current, activities: current.activities.map((item) =>
      item.id === activityId ? applyReaction(item, next) : item) } : current);
    setMessage("");
    try {
      await socialFetch(`activities/${encodeURIComponent(activityId)}/reaction`, next ? "PUT" : "DELETE",
        next ? { emoji: next } : undefined);
      recordSocialReaction(true, undefined, activityId);
    } catch (cause) {
      recordSocialReaction(false, cause, activityId);
      setPage((current) => current ? { ...current, activities: current.activities.map((item) =>
        item.id === activityId && item.myReaction === next ? original : item) } : current);
      setMessage(cause instanceof Error ? cause.message : "Reaction could not be saved.");
    }
  }
  return <div className="page-stack friend-history-page"><div className="page-heading">
    <Link className="back-link" href="/settings/friends/">← Friends</Link>
    <p className="eyebrow">SHARED WORKOUTS</p><h1>{page?.displayName ?? "Friend"}<span className="dot-accent">.</span></h1>
    <p>Workout history shared with you</p></div>
    {state === "loading" && <p className="quiet-note" role="status">Loading shared workouts…</p>}
    {state === "error" && <div className="alert" role="alert">{message} <button type="button" className="inline-action" onClick={() => void refresh()}>Retry</button></div>}
    {state === "ready" && page && <>
      {page.activities.length === 0 ? <div className="empty-state"><h2>No shared workouts yet</h2>
        <p>Only workouts your friend chose to share appear here.</p></div> :
        <div className="friend-history-list">{page.activities.map((activity) => <article className="social-activity" key={activity.id}>
          <small>{formatLocalDate(activity.localDate)} · {amsterdamTime(activity.completedAt)}</small>
          <strong>{activity.workoutName}</strong>
          <span>{[activity.durationMinutes === null ? "" : `${activity.durationMinutes} min`,
            activity.totalExercises === null ? "" : `${activity.completedExercises}/${activity.totalExercises} completed`].filter(Boolean).join(" · ")}</span>
          <SocialReactions activity={activity} onReact={(emoji) => void react(activity.id, emoji)} />
        </article>)}</div>}
      {page.nextCursor && <button type="button" className="secondary-button" disabled={moreBusy}
        onClick={() => void more()}>{moreBusy ? "Loading…" : "Load more"}</button>}
      <p className="quiet-note">Only shared workout summaries are shown. Earlier private workouts are not included.</p>
      {message && <p className="context-note" role="status">{message}</p>}
    </>}
  </div>;
}
