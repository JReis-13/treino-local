# Friends Web Push V1

Treino Local sends only two social alerts: a friend newly completing a workout and a friend creating or changing a reaction to your shared workout. Push is a best-effort side effect after the social database write. A failed push cannot undo a local workout, social activity, or reaction.

## Setup

Apply `db/migrations/003_friends_push.sql` once with `pnpm db:migrate`. It adds private `treino_social.push_subscriptions`, `push_preferences`, and `push_deliveries`; it does not change migrations 001/002 or existing social records. The schema remains inaccessible to Supabase browser roles.

Run `pnpm push:generate-vapid` to write one key pair to the ignored `.env.push.generated` file. The command refuses to overwrite an existing file and never prints the private key. Set a real `VAPID_SUBJECT` contact URI, normally `mailto:you@example.com`. Copy `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` into local `.env.local` and into **Vercel → Project → Settings → Environment Variables → Production**. Redeploy after changing Vercel variables. Never prefix the private key with `NEXT_PUBLIC_`, commit it, or include it in diagnostics. The public key is returned by `/api/push/status` for browser subscription.

If any VAPID setting is absent, Friends settings says notifications are not configured, while workouts and reactions continue normally.

## Device and account lifecycle

Settings → Friends is the only place that requests permission. **Enable notifications** checks browser support and existing permission, then uses the app's existing service worker and `PushManager`. An existing browser subscription is reused. The authenticated POST validates the endpoint and keys, upserts by unique endpoint, and binds it to the verified Google social user. An HttpOnly same-site device cookie identifies that browser's row without exposing endpoint or encryption keys. Multiple rows may belong to one user; each browser is independent.

The two checkboxes are account-level preferences. They default on when the first subscription is registered and may be changed without unsubscribing the device. **Disable notifications on this device** unsubscribes the browser first, then removes only that device's server row. If server removal fails, the UI still shows the device as stopped and retries stale server registration cleanup on the next Friends-settings visit. Google disconnect removes this device row before clearing the session; a direct Google account switch removes the old account's row before setting the new session. If the same endpoint is explicitly registered by another account, its unique row moves to that verified account. Other devices remain registered.

Unsupported browsers show a calm status. On iPhone, Web Push may require the app to be installed on the Home Screen; capability detection decides whether to offer Enable. A denied permission is shown with an instruction to change browser/device settings; the app does not ask again automatically.

## Event and delivery rules

An automatically shared, **newly inserted** workout activity can alert accepted friends whose workout preference is on. Offline outbox publication can alert them once when the new activity reaches the server. Retrying the same client session or updating it through same-day Replace does not start another workout alert. Same-day Add creates a new activity and may alert. V1 conservatively suppresses alerts for every explicit `manualShare` publication, including historical backfill; the item may still appear on Friends Home.

A valid friend reaction insert or emoji change can alert the workout owner when the reaction preference is on. Replaying the same emoji, removing a reaction, failed/unauthorized reactions, and self-reactions do not alert. The server constructs a short body from the stored display name and event type; no email, load, note, exercise, source, or user-supplied notification text enters the payload.

Each event/device pair is claimed once in `push_deliveries` before sending. A successful send updates the subscription's last-success metadata. HTTP 404/410 removes the expired subscription. Other failures record only safe timestamps/counts and do not delete the device. There is no general push API, inbox, analytics, or automatic retry queue. Server logs contain event type and counts, never endpoint or keys.

The generated `/sw.js` retains install, cache, waiting-worker, `SKIP_WAITING`, activation, and fetch behavior. Its `push` handler validates the small payload and shows a notification without opening Home first. Clicking focuses an existing Treino Local window, or opens `/?friends=1`; Friends is directly below the Home training banner. Worker diagnostics store only safe event type and click outcome. The browser's PushManager subscription persists across normal worker updates; no new permission request is made.

## Verification

Run frozen install, lint, typecheck, `pnpm test`, `pnpm db:integration`, production build, and local mobile E2E. The isolated Postgres tests create synthetic users, friendships, activities, reactions, preferences and devices, simulate a 410 response, and remove those users afterward. The worker test checks push/click plus the existing update handlers; the PWA transition suite checks waiting-worker activation and exactly one reload. Browser emulation does not prove phone delivery.

For a physical test, both users should open Settings → Friends, enable notifications by tapping the button, and grant permission. B closes the PWA; A completes a disposable automatically shared workout. B should receive the short workout alert and tap it to reach Home with Friends below Current Training. B reacts; A should receive and open the reaction alert. Then turn B's workout preference off while leaving reactions on, repeat with disposable activity, and confirm only reaction alerts arrive. Test on the actual phone/browser combination; no automated production test should send surprise alerts to other users.
