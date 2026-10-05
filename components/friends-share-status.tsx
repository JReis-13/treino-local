"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { localSocialPublishState, serverSocialPublishState, shareSessionWithFriends,
  socialFetch, type SocialMe, type SocialPublishState } from "@/lib/social/client";
import type { TrainingSession } from "@/types/training";

export function FriendsShareStatus({ session }: { session: TrainingSession }) {
  const [state, setState] = useState<SocialPublishState>("not_shared");
  const [me, setMe] = useState<SocialMe | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!active) return;
      setState(localSocialPublishState(session.id));
      try {
        const identity = await socialFetch<SocialMe>("me");
        const remote = await serverSocialPublishState(session.id);
        if (active) { setMe(identity); setState(remote); }
      } catch { if (active) setMe(null); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (active) setState(localSocialPublishState(session.id)); }, 1200);
    const foreground = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", foreground);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", foreground); };
  }, [session.id]);

  async function share() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const queued = await shareSessionWithFriends(session);
      setState(localSocialPublishState(session.id));
      if (!queued) setMessage("Connect Google in Friends settings, then try again.");
      else {
        try { setState(await serverSocialPublishState(session.id)); }
        catch { setMessage("Not shared yet. It will retry when Friends is available."); }
      }
    } finally { setBusy(false); }
  }

  const label = state === "shared" ? "✓ Shared with friends" :
    state === "publishing" ? "Sharing with friends…" :
    state === "failed_retryable" ? "Not shared yet · retry needed" :
    state === "queued" ? "Not shared yet · retry pending" :
    state === "eligibility_pending" ? "Checking Friends sharing…" :
    me?.sharingEnabled ? "Not shared yet" : me ? "Friends sharing is off" : "Friends account not ready";
  return <section className="review-card friends-share-status" aria-label="Friends sharing">
    <p className="eyebrow">FRIENDS</p><p role="status">{label}</p>
    {state !== "shared" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void share()}>
      {busy ? "Checking Friends…" : "Share with friends"}</button>}
    {state === "queued" && <button type="button" className="inline-action" onClick={() => void share()} disabled={busy}>Retry</button>}
    {!me && <Link className="inline-action" href="/settings/friends/">Friends settings →</Link>}
    {message && <p className="quiet-note" role="status">{message}</p>}
    <small className="quiet-note">Only workout name, date, duration and completion count are shared. Loads and notes stay here.</small>
  </section>;
}
