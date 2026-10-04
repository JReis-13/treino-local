"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { REACTIONS, type ReactionEmoji } from "@/lib/social/model";
import { cacheSocialPreference, flushSocialOutbox, socialFetch, type SocialHome, type SocialMe } from "@/lib/social/client";

const LABELS: Record<ReactionEmoji, string> = { "💪": "strong", "🔥": "fire", "👏": "applause", "😂": "laughing", "❤️": "heart" };
function localDay(value: string) { try { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`)); } catch { return value; } }

export function SocialHomeCard() {
  const [me, setMe] = useState<SocialMe | null>(null);
  const [home, setHome] = useState<SocialHome | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "unavailable">("loading");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      const identity = await socialFetch<SocialMe>("me");
      setMe(identity); cacheSocialPreference(identity);
      void flushSocialOutbox();
      setHome(await socialFetch<SocialHome>("home"));
      setState("ready");
    } catch (cause) { setState((cause as { status?: number }).status === 401 ? "auth" : "unavailable"); }
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
    try { await socialFetch(`activities/${encodeURIComponent(id)}/reaction`, next ? "PUT" : "DELETE", next ? { emoji: next } : undefined); await refresh(); }
    catch { setHome(previous); setMessage("Reaction could not be saved. Try again."); }
  }
  return <section className="social-home-card" aria-label="Friends"><div className="social-heading"><div><p className="eyebrow">FRIENDS</p><h2>Latest together</h2></div><Link href="/settings/friends/">Manage →</Link></div>
    {state === "loading" && <p className="quiet-note">Loading friends…</p>}
    {state === "auth" && <p className="quiet-note">Connect Google to use Friends. <Link href="/settings/">Connect →</Link></p>}
    {state === "unavailable" && <p className="quiet-note">Friends are temporarily unavailable. Your workouts remain on this device. <button type="button" className="inline-action" onClick={() => void refresh()}>Retry</button></p>}
    {state === "ready" && home && <>
      {home.friendCount === 0 ? <p className="quiet-note">Add a friend to see each other’s latest workouts.</p> : home.activities.length === 0 ? <p className="quiet-note">No shared workouts yet.</p> : <div className="social-activity-list">{home.activities.map((activity) => <article key={activity.id} className="social-activity"><strong>{activity.displayName}</strong><span>{activity.workoutName} · {localDay(activity.localDate)}</span><small>{[activity.durationMinutes === null ? "" : `${activity.durationMinutes} min`, activity.totalExercises === null ? "" : `${activity.completedExercises}/${activity.totalExercises} completed`].filter(Boolean).join(" · ")}</small><div className="reaction-row">{REACTIONS.map((emoji) => <button key={emoji} type="button" aria-label={`React with ${LABELS[emoji]}`} aria-pressed={activity.myReaction === emoji} onClick={() => void react(activity.id, emoji)}>{emoji}<span>{activity.reactions[emoji] || ""}</span></button>)}</div></article>)}</div>}
      {home.received.length > 0 && <div className="social-received"><strong>Reactions to your workouts</strong>{home.received.map((item, index) => <p key={`${item.displayName}-${item.workoutName}-${index}`}>{item.displayName} reacted {item.emoji} to your {item.workoutName}</p>)}</div>}
      {!me?.sharingEnabled && <p className="quiet-note">Your completed workouts are private. Turn on sharing in Friends settings if you want friends to see them.</p>}
    </>}
    {message && <p role="status" className="quiet-note">{message}</p>}
  </section>;
}
