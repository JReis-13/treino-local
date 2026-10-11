"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SocialHomeCard } from "@/components/social-home-card";
import { cachedSocialFriends, fetchSocialFriends, subscribeSocialChange, type SocialFriend } from "@/lib/social/client";

export default function FriendsPage() {
  const [friends, setFriends] = useState<SocialFriend[] | null>(() => cachedSocialFriends());
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void fetchSocialFriends(true).then((result) => { if (active) { setFriends(result); setError(false); } })
      .catch((cause) => { if (active) { setError(true); if (cause?.status === 401) setFriends([]); } });
    return () => { active = false; };
  }, []);
  useEffect(() => subscribeSocialChange(() => {
    if (!cachedSocialFriends()) setFriends((previous) => previous ? [] : previous);
  }), []);
  const accepted = friends?.filter((friend) => friend.status === "accepted") ?? [];
  const pending = friends?.filter((friend) => friend.status === "pending") ?? [];
  return <div className="page-stack friends-hub"><div className="page-heading"><p className="eyebrow">TOGETHER</p><h1>Friends<span className="dot-accent">.</span></h1><p>See shared workouts and stay in touch with your friends.</p></div>
    <SocialHomeCard />
    <section className="review-card friends-directory"><p className="eyebrow">YOUR FRIENDS</p><h2>Connected friends</h2>
      {friends === null ? <p className="quiet-note">Loading your friends…</p> : accepted.length ? accepted.map((friend) =>
        <Link className="social-friend-row friend-directory-link" href={`/friends/${encodeURIComponent(friend.id)}/`} key={friend.id}>
          <span><strong>{friend.displayName}</strong><small>Shared workout history</small></span><span aria-hidden="true">→</span>
        </Link>) : <p className="quiet-note">No connected friends yet.</p>}
      {pending.length > 0 && <p className="quiet-note">{pending.length} pending request{pending.length === 1 ? "" : "s"}</p>}
      {error && <p className="quiet-note" role="status">Could not update the list. Last confirmed friends remain visible.</p>}
      <Link className="secondary-button" href="/settings/friends/">Manage friends and requests →</Link>
    </section>
    <section className="review-card"><p className="eyebrow">SHARING</p><h2>Sharing & notifications</h2><p className="quiet-note">Choose what you share and which phone notifications you receive.</p><Link className="secondary-button" href="/settings/friends/">Manage preferences →</Link></section>
  </div>;
}
