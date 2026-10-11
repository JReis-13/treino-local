"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ReactionEmoji } from "@/lib/social/model";
import { applyReaction, SocialReactions } from "@/components/social-reactions";
import { cachedSocialHome, fetchSocialHome, invalidateSocialHome, recordSocialDisplayedActivity,
  recordSocialHomeFetch, recordSocialReaction, socialFetch, subscribeSocialChange, updateCachedSocialHome } from "@/lib/social/client";
import { sharedDurationLabel } from "@/lib/social/display";

function localDay(value: string) { try { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`)); } catch { return value; } }

export function SocialHomeCard({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState(() => cachedSocialHome());
  const [state, setState] = useState<"loading" | "ready" | "auth" | "unavailable">(snapshot ? "ready" : "loading");
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const refreshSequence = useRef(0);
  const hasSnapshot = useRef(Boolean(snapshot));
  useEffect(() => subscribeSocialChange(() => {
    if (hasSnapshot.current && !cachedSocialHome()) {
      hasSnapshot.current = false;
      setSnapshot(null); setState("auth"); setUpdating(false);
    }
  }), []);
  const refresh = useCallback(async (force = true) => {
    const sequence = ++refreshSequence.current;
    setUpdating(Boolean(cachedSocialHome()));
    try {
      const result = await fetchSocialHome(force);
      recordSocialHomeFetch(true, undefined, result.home.activities[0]?.id);
      if (sequence === refreshSequence.current) { hasSnapshot.current = true; setSnapshot(result); setState("ready"); setUpdating(false); setMessage("");
        recordSocialDisplayedActivity(result.home.activities[0]?.id); }
    } catch (cause) {
      recordSocialHomeFetch(false, cause);
      if (sequence === refreshSequence.current) { setUpdating(false);
        if ((cause as { status?: number }).status === 401) { setSnapshot(null); setState("auth"); }
        else if (cachedSocialHome()) { setState("ready"); setMessage("Could not update Friends. Showing the last confirmed activity."); }
        else setState("unavailable"); }
    }
  }, []);
  useEffect(() => {
    void refresh(true);
    const foreground = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    return () => { document.removeEventListener("visibilitychange", foreground); window.removeEventListener("online", foreground); };
  }, [refresh]);
  async function react(id: string, emoji: ReactionEmoji) {
    const previous = snapshot?.home;
    if (!previous) return;
    const original = previous.activities.find((item) => item.id === id);
    if (!original) return;
    const current = original.myReaction;
    const next = current === emoji ? null : emoji;
    ++refreshSequence.current;
    const optimistic = (value: typeof previous) => ({ ...value, activities: value.activities.map((item) =>
      item.id === id ? applyReaction(item, next) : item) });
    setSnapshot((value) => value ? { ...value, home: optimistic(value.home) } : value);
    updateCachedSocialHome(optimistic);
    setMessage("");
    try { await socialFetch(`activities/${encodeURIComponent(id)}/reaction`, next ? "PUT" : "DELETE", next ? { emoji: next } : undefined); recordSocialReaction(true, undefined, id); invalidateSocialHome(); await refresh(true); }
    catch (cause) { recordSocialReaction(false, cause, id); setSnapshot((value) => value ? { ...value, home: { ...value.home,
      activities: value.home.activities.map((item) => item.id === id && item.myReaction === next ? original : item) } } : value);
      updateCachedSocialHome((value) => ({ ...value, activities: value.activities.map((item) =>
        item.id === id && item.myReaction === next ? original : item) }));
      setMessage("Reaction could not be saved. Try again."); }
  }
  const me = snapshot?.me;
  const home = snapshot?.home;
  const latest = home?.activities[0];
  const received = home?.received[0];
  return <section className={`social-home-card ${compact ? "social-home-compact" : ""}`} aria-label="Friends"><div className="social-heading"><div><p className="eyebrow">FRIENDS</p><h2>{compact ? "Friends" : "Recent activity"}</h2></div>{compact ? <Link href="/friends/">Open Friends →</Link> : <button type="button" className="inline-action" onClick={() => void refresh(true)}>Refresh</button>}</div>
    {state === "loading" && <p className="quiet-note">Loading friends…</p>}
    {state === "auth" && <p className="quiet-note">Connect Google to use Friends. <Link href="/settings/#connections">Connect →</Link></p>}
    {state === "unavailable" && <p className="quiet-note">Friends are temporarily unavailable. Your workouts remain on this device. <button type="button" className="inline-action" onClick={() => void refresh(true)}>Retry</button></p>}
    {updating && state === "ready" && <small className="social-updating" role="status">Updating friends…</small>}
    {state === "ready" && home && (compact ? <>
      {home.friendCount === 0 ? <p className="quiet-note">No friends yet. Connect in Friends settings.</p> :
        latest ? <article className="social-activity"><Link href={`/friends/${latest.friendshipId}/`}><strong>{latest.displayName}</strong><span>{latest.workoutName} · {localDay(latest.localDate)}</span></Link><small>{[sharedDurationLabel(latest.durationMinutes), latest.totalExercises === null ? "" : `${latest.completedExercises}/${latest.totalExercises} completed`].filter(Boolean).join(" · ")}</small><SocialReactions activity={latest} onReact={(emoji) => void react(latest.id, emoji)} /><Link className="inline-action" href={`/friends/${latest.friendshipId}/`}>View workouts →</Link></article> :
        <p className="quiet-note">Connected · no recent workouts</p>}
      {received && <p className="social-highlight"><strong>{received.displayName}</strong> reacted {received.emoji} to your {received.workoutName}</p>}
    </> : <>
      {home.friendCount === 0 ? <p className="quiet-note">Add a friend to see each other’s latest workouts.</p> : home.activities.length === 0 ? <p className="quiet-note">No shared workouts yet.</p> : <div className="social-activity-list">{home.activities.map((activity) => <article key={activity.id} className="social-activity"><Link href={`/friends/${activity.friendshipId}/`}><strong>{activity.displayName}</strong><span>{activity.workoutName} · {localDay(activity.localDate)}</span></Link><small>{[sharedDurationLabel(activity.durationMinutes), activity.totalExercises === null ? "" : `${activity.completedExercises}/${activity.totalExercises} completed`].filter(Boolean).join(" · ")}</small><SocialReactions activity={activity} onReact={(emoji) => void react(activity.id, emoji)} /><Link className="inline-action" href={`/friends/${activity.friendshipId}/`}>View workouts →</Link></article>)}</div>}
      {home.received.length > 0 && <div className="social-received"><strong>Reactions to your workouts</strong>{home.received.map((item, index) => <p key={`${item.displayName}-${item.workoutName}-${index}`}>{item.displayName} reacted {item.emoji} to your {item.workoutName}</p>)}</div>}
      {!me?.sharingEnabled && <p className="quiet-note">Your completed workouts are private. Turn on sharing in Friends settings if you want friends to see them.</p>}
    </>)}
    {message && <p role="status" className="quiet-note">{message}</p>}
  </section>;
}
