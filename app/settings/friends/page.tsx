"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cacheSocialPreference, discardQueuedSocialForCurrentUser, socialFetch, socialPreferenceRevision, type SocialFriend, type SocialMe } from "@/lib/social/client";
import { PushSettings } from "@/components/push-settings";

export default function FriendsPage() {
  const [me, setMe] = useState<SocialMe | null>(null);
  const [friends, setFriends] = useState<SocialFriend[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "auth" | "unavailable">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const revision = socialPreferenceRevision();
    try {
      const profile = await socialFetch<SocialMe>("me");
      const list = await socialFetch<{ friends: SocialFriend[] }>("friends");
      if (revision !== socialPreferenceRevision()) return;
      setMe(profile); setName(profile.displayName); setFriends(list.friends); cacheSocialPreference(profile, revision); setState("ready");
    } catch (cause) { setState((cause as { status?: number }).status === 401 ? "auth" : "unavailable"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function updateProfile(patch: { displayName?: string; sharingEnabled?: boolean }) {
    setBusy(true); setMessage("");
    try {
      const result = await socialFetch<{ displayName: string; sharingEnabled: boolean }>("me", "PATCH", patch);
      if (me) {
        const next = { ...me, displayName: result.displayName, sharingEnabled: result.sharingEnabled };
        setMe(next); setName(next.displayName); cacheSocialPreference(next, undefined, true);
        if (!next.sharingEnabled) discardQueuedSocialForCurrentUser();
      }
      setMessage("Social settings saved.");
    } catch (cause) { if (me) setMe(me); setMessage(cause instanceof Error ? cause.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  async function addFriend(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await socialFetch("friends", "POST", { email: email.trim() }); setEmail(""); await refresh(); setMessage("Friend request sent."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not send request."); }
    finally { setBusy(false); }
  }
  async function act(id: string, action: "accept" | "decline" | "remove") {
    if (action === "remove" && !window.confirm("Remove this friend? You will no longer see each other’s shared workouts.")) return;
    setBusy(true); setMessage("");
    try { await socialFetch("friends", action === "remove" ? "DELETE" : "PATCH", action === "remove" ? { id } : { id, action }); await refresh(); setMessage(action === "accept" ? "Friend added." : action === "decline" ? "Request declined." : "Friend removed."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not update friendship."); }
    finally { setBusy(false); }
  }
  const accepted = friends.filter((friend) => friend.status === "accepted");
  const incoming = friends.filter((friend) => friend.status === "pending" && friend.direction === "incoming");
  const outgoing = friends.filter((friend) => friend.status === "pending" && friend.direction === "outgoing");
  return <div className="page-stack friends-page"><div className="page-heading"><Link className="back-link" href="/settings/">← Settings</Link><p className="eyebrow">FRIENDS & NOTIFICATIONS</p><h1>Friends<span className="dot-accent">.</span></h1><p>See a friend’s latest shared workout and send a quick reaction.</p></div>
    {state === "loading" && <p className="quiet-note">Loading friends…</p>}
    {state === "auth" && <section className="review-card"><h2>Connect Google to use Friends</h2><p className="quiet-note">Your Google account establishes your identity. Workout history remains on this device.</p><Link className="primary-button" href="/settings/#connections">Connect Google →</Link></section>}
    {state === "unavailable" && <section className="review-card"><h2>Friends are unavailable</h2><p className="quiet-note">Your local workouts are unaffected. Reconnect Google or retry to confirm sharing is active.</p><button type="button" className="secondary-button" onClick={() => void refresh()}>Retry</button></section>}
    {state === "ready" && me && <>
      <section className="review-card"><p className="eyebrow">YOUR IDENTITY</p><p className="quiet-note">Connected as {me.email}</p><label className="date-field"><span>DISPLAY NAME</span><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /></label><button type="button" className="secondary-button" disabled={busy || !name.trim() || name.trim() === me.displayName} onClick={() => void updateProfile({ displayName: name })}>Save name</button></section>
      <section className="review-card"><p className="eyebrow">CONNECTED</p><h2>Friends</h2>{accepted.length ? accepted.map((friend) => <div className="social-friend-row" key={friend.id}><div><strong>{friend.displayName}</strong><small>Connected</small></div><button type="button" className="inline-action" disabled={busy} onClick={() => void act(friend.id, "remove")}>Remove</button></div>) : <p className="quiet-note">No friends yet.</p>}</section>
      {incoming.length > 0 && <section className="review-card"><h2>Pending requests</h2>{incoming.map((friend) => <div className="social-friend-row" key={friend.id}><div><strong>{friend.displayName}</strong><small>Wants to connect</small></div><button type="button" disabled={busy} onClick={() => void act(friend.id, "accept")}>Accept</button><button type="button" disabled={busy} onClick={() => void act(friend.id, "decline")}>Decline</button></div>)}</section>}
      {outgoing.length > 0 && <section className="review-card"><h2>Sent requests</h2>{outgoing.map((friend) => <div className="social-friend-row" key={friend.id}><strong>{friend.displayName}</strong><small>Pending</small></div>)}</section>}
      <form className="review-card" onSubmit={(event) => void addFriend(event)}><h2>Add friend</h2><label className="date-field"><span>GOOGLE EMAIL</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="friend@example.com" required /></label><button type="submit" className="primary-button" disabled={busy || !email.trim()}>Send request →</button></form>
      <section className="review-card"><p className="eyebrow">SHARING</p><h2>Completed workouts</h2><label className="social-sharing-toggle"><input type="checkbox" checked={me.sharingEnabled} disabled={busy} onChange={(event) => { const sharingEnabled = event.target.checked; setMe({ ...me, sharingEnabled }); void updateProfile({ sharingEnabled }); }} /><span><strong>Share completed workouts with friends</strong><small>Off by default. Friends see name, date, duration and completion count. Loads, notes and exercise details stay private.</small></span></label>{busy && <p className="quiet-note" role="status">Saving Friends settings…</p>}</section>
      <PushSettings />
    </>}
    {message && <p className="context-note" role="status">{message}</p>}
  </div>;
}
