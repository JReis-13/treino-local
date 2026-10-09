"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { REACTIONS, type ReactionEmoji } from "@/lib/social/model";
import { cacheSocialPreference, flushSocialOutbox, recordSocialHomeFetch, recordSocialReaction, socialFetch, socialPreferenceRevision, type SocialHome, type SocialMe } from "@/lib/social/client";

const LABELS: Record<ReactionEmoji, string> = { "💪": "strong", "🔥": "fire", "👏": "applause", "😂": "laughing", "❤️": "heart" };
function localDay(value: string) { try { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`)); } catch { return value; } }

export function SocialHomeCard({ compact = false }: { compact?: boolean }) {
  const [me, setMe] = useState<SocialMe | null>(null);
  const [home, setHome] = useState<SocialHome | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "unavailable">("loading");
  const [message, setMessage] = useState("");
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const revision = socialPreferenceRevision();
    try {
      const identity = await socialFetch<SocialMe>("me");
      cacheSocialPreference(identity, revision);
      await flushSocialOutbox();
      const result = await socialFetch<SocialHome>("home");
      recordSocialHomeFetch(true);
      if (sequence === refreshSequence.current) { setMe(identity); setHome(result); setState("ready"); }
    } catch (cause) {
      recordSocialHomeFetch(false, cause);
      if (sequence === refreshSequence.current) setState((cause as { status?: number }).status === 401 ? "auth" : "unavailable");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const foreground = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    return () => { document.removeEventListener("visibilitychange", foreground); window.removeEventListener("online", foreground); };
  }, [refresh]);
  async function react(id: string, emoji: ReactionEmoji) {
    const previous = home;
    if (!previous) return;
    const current = previous.activities.find((item) => item.id === id)?.myReaction;
    const next = current === emoji ? null : emoji;
    setHome({ ...previous, activities: previous.activities.map((item) => {
      if (item.id !== id) return item;
      const reactions = { ...item.reactions };
      if (current) reactions[current] = Math.max(0, (reactions[current] ?? 0) - 1);
      if (next) reactions[next] = (reactions[next] ?? 0) + 1;
      return { ...item, myReaction: next, reactions };
    }) });
    setMessage("");
    try { await socialFetch(`activities/${encodeURIComponent(id)}/reaction`, next ? "PUT" : "DELETE", next ? { emoji: next } : undefined); recordSocialReaction(true); await refresh(); }
    catch (cause) { recordSocialReaction(false, cause); setHome(previous); setMessage("Reaction could not be saved. Try again."); }
  }
  const latest = home?.activities[0];
  const received = home?.received[0];
  return <section className={`social-home-card ${compact ? "social-home-compact" : ""}`} aria-label="Friends"><div className="social-heading"><div><p className="eyebrow">FRIENDS</p><h2>{compact ? "Friends" : "Latest together"}</h2></div><Link href="/settings/friends/">Manage →</Link></div>
    {state === "loading" && <p className="quiet-note">Loading friends…</p>}
    {state === "auth" && <p className="quiet-note">Connect Google to use Friends. <Link href="/settings/#connections">Connect →</Link></p>}
    {state === "unavailable" && <p className="quiet-note">Friends are temporarily unavailable. Your workouts remain on this device. <button type="button" className="inline-action" onClick={() => void refresh()}>Retry</button></p>}
    {state === "ready" && home && (compact ? <>
      {home.friendCount === 0 ? <p className="quiet-note">No friends yet. Connect in Friends settings.</p> : received ?
        <p className="social-highlight"><strong>{received.displayName}</strong> reacted {received.emoji} to your {received.workoutName}</p> :
        latest ? <article className="social-activity"><strong>{latest.displayName}</strong><span>{latest.workoutName} · {localDay(latest.localDate)}</span><small>{[latest.durationMinutes === null ? "" : `${latest.durationMinutes} min`, latest.totalExercises === null ? "" : `${latest.completedExercises}/${latest.totalExercises} completed`].filter(Boolean).join(" · ")}</small><div className="reaction-row">{REACTIONS.map((emoji) => <button key={emoji} type="button" aria-label={`React with ${LABELS[emoji]}`} aria-pressed={latest.myReaction === emoji} onClick={() => void react(latest.id, emoji)}>{emoji}<span>{latest.reactions[emoji] || ""}</span></button>)}</div></article> :
        <p className="quiet-note">Connected · no recent workouts</p>}
    </> : <>
      {home.friendCount === 0 ? <p className="quiet-note">Add a friend to see each other’s latest workouts.</p> : home.activities.length === 0 ? <p className="quiet-note">No shared workouts yet.</p> : <div className="social-activity-list">{home.activities.map((activity) => <article key={activity.id} className="social-activity"><strong>{activity.displayName}</strong><span>{activity.workoutName} · {localDay(activity.localDate)}</span><small>{[activity.durationMinutes === null ? "" : `${activity.durationMinutes} min`, activity.totalExercises === null ? "" : `${activity.completedExercises}/${activity.totalExercises} completed`].filter(Boolean).join(" · ")}</small><div className="reaction-row">{REACTIONS.map((emoji) => <button key={emoji} type="button" aria-label={`React with ${LABELS[emoji]}`} aria-pressed={activity.myReaction === emoji} onClick={() => void react(activity.id, emoji)}>{emoji}<span>{activity.reactions[emoji] || ""}</span></button>)}</div></article>)}</div>}
      {home.received.length > 0 && <div className="social-received"><strong>Reactions to your workouts</strong>{home.received.map((item, index) => <p key={`${item.displayName}-${item.workoutName}-${index}`}>{item.displayName} reacted {item.emoji} to your {item.workoutName}</p>)}</div>}
      {!me?.sharingEnabled && <p className="quiet-note">Your completed workouts are private. Turn on sharing in Friends settings if you want friends to see them.</p>}
    </>)}
    {message && <p role="status" className="quiet-note">{message}</p>}
  </section>;
}
