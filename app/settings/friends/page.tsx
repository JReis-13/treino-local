"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cachedSocialFriends, cachedSocialHome, cacheSocialPreference, discardQueuedSocialForCurrentUser, fetchSocialFriends, fetchSocialHome, invalidateSocialHome,
  retrySocialDeletionsForCurrentAccount, socialDeletionRetryState, socialFetch,
  subscribeSocialChange, type SocialFriend, type SocialMe } from "@/lib/social/client";
import { PushSettings } from "@/components/push-settings";

export default function FriendsPage() {
  const [me, setMe] = useState<SocialMe | null>(() => cachedSocialHome()?.me ?? null);
  const [friends, setFriends] = useState<SocialFriend[]>(() => cachedSocialFriends() ?? []);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(() => cachedSocialHome()?.me.displayName ?? "");
  const [state, setState] = useState<"loading" | "ready" | "auth" | "unavailable">(() => cachedSocialHome() && cachedSocialFriends() ? "ready" : "loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setQueueVersion] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const { me: profile } = await fetchSocialHome(true);
      const list = await fetchSocialFriends(true);
      setMe(profile); setName(profile.displayName); setFriends(list); setState("ready");
    } catch (cause) {
      if ((cause as { status?: number }).status === 401) { setMe(null); setFriends([]); setState("auth"); }
      else if (cachedSocialHome() && cachedSocialFriends()) setMessage("Could not update Friends. Showing the last confirmed settings.");
      else setState("unavailable");
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => subscribeSocialChange(() => { setQueueVersion((value) => value + 1);
    if (!cachedSocialHome()) { setMe(null); setFriends([]); }
  }), []);
  async function updateProfile(patch: { displayName?: string; sharingEnabled?: boolean }) {
    setBusy(true); setMessage("");
    try {
      const result = await socialFetch<{ displayName: string; sharingEnabled: boolean }>("me", "PATCH", patch);
      if (me) {
        const next = { ...me, displayName: result.displayName, sharingEnabled: result.sharingEnabled };
        setMe(next); setName(next.displayName); cacheSocialPreference(next, undefined, true);
        if (!next.sharingEnabled) discardQueuedSocialForCurrentUser();
      }
      invalidateSocialHome(); setMessage("Social settings saved.");
    } catch (cause) { if (me) setMe(me); setMessage(cause instanceof Error ? cause.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  async function addFriend(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await socialFetch("friends", "POST", { email: email.trim() }); invalidateSocialHome(); setEmail(""); await refresh(); setMessage("Friend request sent."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not send request."); }
    finally { setBusy(false); }
  }
  async function act(id: string, action: "accept" | "decline" | "remove") {
    if (action === "remove" && !window.confirm("Remove this friend? You will no longer see each other’s shared workouts.")) return;
    setBusy(true); setMessage("");
    try { await socialFetch("friends", action === "remove" ? "DELETE" : "PATCH", action === "remove" ? { id } : { id, action }); invalidateSocialHome(action === "remove"); await refresh(); setMessage(action === "accept" ? "Friend added." : action === "decline" ? "Request declined." : "Friend removed."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not update friendship."); }
    finally { setBusy(false); }
  }
  const accepted = friends.filter((friend) => friend.status === "accepted");
  const incoming = friends.filter((friend) => friend.status === "pending" && friend.direction === "incoming");
  const outgoing = friends.filter((friend) => friend.status === "pending" && friend.direction === "outgoing");
  const deletionState = me ? socialDeletionRetryState(me) : { pending: 0, result: "none", retryable: false };
  return <div className="page-stack friends-page"><div className="page-heading"><Link className="back-link" href="/friends/">← Friends</Link><p className="eyebrow">FRIENDS & NOTIFICATIONS</p><h1>Friends<span className="dot-accent">.</span></h1><p>See a friend’s latest shared workout and send a quick reaction.</p></div>
    {state === "loading" && <p className="quiet-note">Loading friends…</p>}
    {state === "auth" && <section className="review-card"><h2>Connect Google to use Friends</h2><p className="quiet-note">Your Google account establishes your identity. Workout history remains on this device.</p><Link className="primary-button" href="/settings/#connections">Connect Google →</Link></section>}
    {state === "unavailable" && <section className="review-card"><h2>Friends are unavailable</h2><p className="quiet-note">Your local workouts are unaffected. Reconnect Google or retry to confirm sharing is active.</p><button type="button" className="secondary-button" onClick={() => void refresh()}>Retry</button></section>}
    {state === "ready" && me && <>
      <section className="review-card"><p className="eyebrow">YOUR IDENTITY</p><p className="quiet-note">Connected as {me.email}</p><label className="date-field"><span>DISPLAY NAME</span><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /></label><button type="button" className="secondary-button" disabled={busy || !name.trim() || name.trim() === me.displayName} onClick={() => void updateProfile({ displayName: name })}>Save name</button></section>
      <section className="review-card"><p className="eyebrow">CONNECTED</p><h2>Friends</h2>{accepted.length ? accepted.map((friend) => <div className="social-friend-row" key={friend.id}><div><strong>{friend.displayName}</strong><small>Connected</small><Link className="inline-action" href={`/friends/${friend.id}/`}>View workouts →</Link></div><button type="button" className="inline-action" disabled={busy} onClick={() => void act(friend.id, "remove")}>Remove</button></div>) : <p className="quiet-note">No friends yet.</p>}</section>
      {incoming.length > 0 && <section className="review-card"><h2>Pending requests</h2>{incoming.map((friend) => <div className="social-friend-row" key={friend.id}><div><strong>{friend.displayName}</strong><small>Wants to connect</small></div><button type="button" disabled={busy} onClick={() => void act(friend.id, "accept")}>Accept</button><button type="button" disabled={busy} onClick={() => void act(friend.id, "decline")}>Decline</button></div>)}</section>}
      {outgoing.length > 0 && <section className="review-card"><h2>Sent requests</h2>{outgoing.map((friend) => <div className="social-friend-row" key={friend.id}><strong>{friend.displayName}</strong><small>Pending</small></div>)}</section>}
      <form className="review-card" onSubmit={(event) => void addFriend(event)}><h2>Add friend</h2><label className="date-field"><span>GOOGLE EMAIL</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="friend@example.com" required /></label><button type="submit" className="primary-button" disabled={busy || !email.trim()}>Send request →</button></form>
      <section className="review-card"><p className="eyebrow">SHARING</p><h2>Completed workouts</h2><label className="social-sharing-toggle"><input type="checkbox" checked={me.sharingEnabled} disabled={busy} onChange={(event) => { const sharingEnabled = event.target.checked; setMe({ ...me, sharingEnabled }); void updateProfile({ sharingEnabled }); }} /><span><strong>Share completed workouts with friends</strong><small>Off by default. Friends see name, date, duration and completion count. Loads, notes and exercise details stay private.</small></span></label>{busy && <p className="quiet-note" role="status">Saving Friends settings…</p>}</section>
      {deletionState.pending > 0 && <section className="review-card"><p className="eyebrow">SHARING SYNC</p><h2>Pending Friends deletions</h2><p className="quiet-note">{deletionState.pending} shared workout removal{deletionState.pending === 1 ? "" : "s"} still await server confirmation. Automatic retry runs when this device reconnects.</p>{deletionState.retryable && <button type="button" className="secondary-button" disabled={busy} onClick={() => void (async () => {
        setBusy(true);
        try { await retrySocialDeletionsForCurrentAccount();
          const remaining = socialDeletionRetryState(me).pending;
          setMessage(remaining ? `${remaining} Friends deletion${remaining === 1 ? " is" : "s are"} still pending. Automatic retry remains active.` :
            "Deletion queue checked. No pending removals remain on this device.");
        } catch { setMessage("Could not retry Friends deletions. Automatic retry remains active."); }
        finally { setBusy(false); setQueueVersion((value) => value + 1); }
      })()}>Retry pending removals</button>}</section>}
      <PushSettings />
    </>}
    {message && <p className="context-note" role="status">{message}</p>}
  </div>;
}
