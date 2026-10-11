"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SocialHomeCard } from "@/components/social-home-card";
import { cachedSocialFriends, fetchSocialFriends, subscribeSocialChange, type SocialFriend } from "@/lib/social/client";

export default function FriendsPage() {
  const [friends, setFriends] = useState<SocialFriend[] | null>(() => cachedSocialFriends());
  const [state, setState] = useState<"loading" | "ready" | "auth" | "error">(friends ? "ready" : "loading");
  const [updating, setUpdating] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const cached = cachedSocialFriends();
    setFriends(cached); setUpdating(true); setState(cached ? "ready" : "loading");
    try {
      const result = await fetchSocialFriends(true);
      if (request === sequence.current) { setFriends(result); setState("ready"); }
    } catch (cause) {
      if (request === sequence.current) {
        setFriends(cachedSocialFriends());
        setState((cause as { status?: number })?.status === 401 ? "auth" : "error");
      }
    } finally { if (request === sequence.current) setUpdating(false); }
  }, []);
  const connectionChanged = useCallback((connection: "loading" | "ready" | "auth" | "unavailable") => {
    if (connection === "auth") { ++sequence.current; setFriends(null); setState("auth"); setUpdating(false); }
    else if (connection === "ready" && !cachedSocialFriends()) void refresh();
  }, [refresh]);
  useEffect(() => {
    void refresh();
    const invalidateRequests = () => { ++sequence.current; };
    const foreground = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => { invalidateRequests(); window.removeEventListener("online", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, [refresh]);
  useEffect(() => subscribeSocialChange(() => {
    if (friends !== null && !cachedSocialFriends()) { setFriends(null); setState("error"); }
  }), [friends]);
  const accepted = friends?.filter((friend) => friend.status === "accepted") ?? [];
  const pending = friends?.filter((friend) => friend.status === "pending") ?? [];
  return <div className="page-stack friends-hub"><div className="page-heading"><p className="eyebrow">TOGETHER</p><h1>Friends<span className="dot-accent">.</span></h1><p>See shared workouts and stay in touch with your friends.</p></div>
    <SocialHomeCard onConnectionChange={connectionChanged} />
    <section className="review-card friends-directory"><p className="eyebrow">YOUR FRIENDS</p><h2>Connected friends</h2>
      {state === "auth" ? <p className="quiet-note">Sign in with Google using Connect above to view your friends.</p> : friends === null ?
        state === "loading" ? <p className="quiet-note" role="status">Loading your friends…</p> : null : accepted.length ? accepted.map((friend) =>
        <Link className="social-friend-row friend-directory-link" href={`/friends/${encodeURIComponent(friend.id)}/`} key={friend.id}>
          <span><strong>{friend.displayName}</strong><small>Shared workout history</small></span><span aria-hidden="true">→</span>
        </Link>) : <p className="quiet-note">{state === "error" ? "The last confirmed list had no connected friends." : "No connected friends yet."}</p>}
      {pending.length > 0 && <p className="quiet-note">{pending.length} pending request{pending.length === 1 ? "" : "s"}</p>}
      {updating && friends !== null && <p className="quiet-note" role="status">Updating the list…</p>}
      {state === "error" && <div role="status"><p className="quiet-note">{friends !== null ? "Could not update the list. Showing the last confirmed friends." : "Could not load your friends. Check your connection and retry."}</p><button type="button" className="secondary-button" onClick={() => void refresh()}>Retry friends list</button></div>}
      {state !== "auth" && <Link className="secondary-button" href="/settings/friends/">Manage friends and requests →</Link>}
    </section>
    <section className="review-card"><p className="eyebrow">SHARING</p><h2>Sharing & notifications</h2><p className="quiet-note">Choose what you share and which phone notifications you receive.</p><Link className="secondary-button" href="/settings/friends/">Manage preferences →</Link></section>
  </div>;
}
