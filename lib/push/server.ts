import "server-only";
import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { socialDb } from "@/lib/social/db";
import { SocialError } from "@/lib/social/server";
import type { ReactionEmoji } from "@/lib/social/model";

export const PUSH_DEVICE_COOKIE = "treino_push_device";
const cookiePattern = /(?:^|;\s*)treino_push_device=([0-9a-f-]{36})(?:;|$)/i;
export function pushDeviceId(request: Request) { return cookiePattern.exec(request.headers.get("cookie") ?? "")?.[1] ?? null; }
export async function detachPushDevice(request: Request, googleSub: string) {
  const id = pushDeviceId(request);
  if (!id) return;
  const sql = socialDb();
  await sql`delete from treino_social.push_subscriptions s using treino_social.users u
    where s.id = ${id} and s.user_id = u.id and u.google_sub = ${googleSub}`;
}
export function vapidConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY &&
    /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(process.env.VAPID_SUBJECT ?? ""));
}
export function validateSubscription(value: unknown) {
  if (!value || typeof value !== "object") throw new SocialError("Invalid push subscription.");
  const input = value as Record<string, unknown>;
  const keys = input.keys;
  if (!keys || typeof keys !== "object") throw new SocialError("Invalid push subscription keys.");
  const keyPair = keys as Record<string, unknown>;
  const endpoint = input.endpoint, p256dh = keyPair.p256dh, auth = keyPair.auth;
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > 2048 ||
      typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{40,256}$/.test(p256dh) ||
      typeof auth !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(auth))
    throw new SocialError("Invalid push subscription.");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new SocialError("Invalid push endpoint."); }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || isIP(url.hostname) ||
      url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      [".local", ".internal", ".test", ".invalid", ".example"].some((suffix) => url.hostname.endsWith(suffix)) ||
      url.username || url.password || url.hash || url.port)
    throw new SocialError("Invalid push endpoint.");
  return { endpoint, p256dh, auth };
}

export type Target = { id: string; endpoint: string; p256dh: string; auth: string };
type PushKind = "friend_workout" | "reaction" | "test";
export type PushTransport = (target: Target, payload: string) => Promise<void>;
const standardTransport: PushTransport = async (target, payload) => {
  await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    payload, { TTL: 3600, timeout: 5000 });
};
function displayName(value: string) { return value.replace(/[\p{Cc}\p{Cf}\r\n]/gu, "").trim().slice(0, 50) || "A friend"; }

async function deliver(eventKey: string, kind: PushKind, actor: string, activityId: string,
  targets: Target[], emoji?: ReactionEmoji, send: PushTransport = standardTransport, preclaimed = false) {
  if (!vapidConfigured() || !targets.length) return;
  const sql = socialDb();
  try { await sql`delete from treino_social.push_deliveries where created_at < now() - interval '14 days'`; }
  catch { /* Retention maintenance must not prevent delivery. */ }
  const body = kind === "friend_workout" ? `${displayName(actor)} finished a workout 💪` :
    kind === "reaction" ? `${displayName(actor)} reacted ${emoji} to your workout` : "Test notification";
  const traceId = eventKey.slice(eventKey.indexOf(":") + 1);
  const payload = JSON.stringify({ type: kind, activityId, traceId, title: "Treino Local", body,
    tag: kind === "friend_workout" ? `friend-workout:${activityId}` :
      kind === "reaction" ? `reaction:${activityId}:${traceId}` : `test:${traceId}` });
  let sent = 0, expired = 0, failed = 0;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  for (const target of targets) {
    try {
      if (!preclaimed) {
        const claim = await sql`insert into treino_social.push_deliveries (event_key, subscription_id)
          values (${eventKey}, ${target.id}) on conflict do nothing returning event_key`;
        if (!claim.length) continue;
      }
      try {
        await send(target, payload);
        sent++;
        await sql`update treino_social.push_subscriptions set last_success_at = now(), failure_count = 0
          where id = ${target.id}`;
        await sql`update treino_social.push_deliveries set status = 'sent', updated_at = now()
          where event_key = ${eventKey} and subscription_id = ${target.id}`;
      } catch (cause) {
        const code = (cause as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          expired++;
          await sql`update treino_social.push_deliveries set status = 'expired', updated_at = now()
            where event_key = ${eventKey} and subscription_id = ${target.id}`;
          await sql`delete from treino_social.push_subscriptions where id = ${target.id}`;
        } else {
          failed++;
          await sql`update treino_social.push_subscriptions set last_failure_at = now(), failure_count = failure_count + 1
            where id = ${target.id}`;
          await sql`update treino_social.push_deliveries set status = 'failed', updated_at = now()
            where event_key = ${eventKey} and subscription_id = ${target.id}`;
        }
      }
    } catch { failed++; /* A single device or DB write cannot affect the social event. */ }
  }
  console.info("Friends push delivery", { type: kind, recipients: targets.length, sent, expired, failed });
  return { sent, expired, failed };
}

export async function sendPushSelfTest(userId: string, deviceId: string, send: PushTransport = standardTransport) {
  if (!vapidConfigured()) throw new SocialError("Notifications are not configured.", 503);
  const sql = socialDb();
  const traceId = randomUUID();
  const target = await sql.begin(async (tx) => {
    const targets = await tx`select id, endpoint, p256dh, auth from treino_social.push_subscriptions
      where id = ${deviceId} and user_id = ${userId} for update`;
    if (!targets.length) throw new SocialError("Enable notifications on this device first.", 409);
    const recent = await tx`select count(*)::int as count from treino_social.push_deliveries
      where subscription_id = ${deviceId} and event_key like 'test:%'
        and created_at > now() - interval '10 minutes'`;
    if (Number(recent[0].count) > 0) throw new SocialError("Wait 10 minutes before sending another test.", 429);
    await tx`insert into treino_social.push_deliveries (event_key, subscription_id)
      values (${`test:${traceId}`}, ${deviceId})`;
    return { id: targets[0].id as string, endpoint: targets[0].endpoint as string,
      p256dh: targets[0].p256dh as string, auth: targets[0].auth as string };
  });
  const result = await deliver(`test:${traceId}`, "test", "", traceId,
    [target], undefined, send, true);
  return { traceId, accepted: result?.sent === 1 };
}

export async function sendFriendWorkoutPush(activityId: string, send: PushTransport = standardTransport) {
  try {
    if (!vapidConfigured()) return;
    const sql = socialDb();
    const rows = await sql`select actor.display_name, s.id, s.endpoint, s.p256dh, s.auth
      from treino_social.workout_activities a join treino_social.users actor on actor.id = a.user_id
      join treino_social.friendships f on f.status = 'accepted'
        and (f.requester_user_id = actor.id or f.addressee_user_id = actor.id)
      join treino_social.push_subscriptions s on s.user_id = case
        when f.requester_user_id = actor.id then f.addressee_user_id else f.requester_user_id end
      left join treino_social.push_preferences p on p.user_id = s.user_id
      where a.id = ${activityId} and actor.sharing_enabled = true and coalesce(p.friend_workouts, true) = true`;
    if (rows.length) await deliver(`workout:${activityId}`, "friend_workout", rows[0].display_name as string,
      activityId, rows.map((row) => ({ id: row.id as string, endpoint: row.endpoint as string,
        p256dh: row.p256dh as string, auth: row.auth as string })), undefined, send);
  } catch { console.warn("Friends push delivery failed", { type: "friend_workout" }); }
}

export async function sendReactionPush(activityId: string, actorId: string, emoji: ReactionEmoji, transitionId: string,
  send: PushTransport = standardTransport) {
  try {
    if (!vapidConfigured()) return;
    const sql = socialDb();
    const rows = await sql`select actor.display_name, s.id, s.endpoint, s.p256dh, s.auth
      from treino_social.workout_activities a
      join treino_social.users owner on owner.id = a.user_id and (owner.sharing_enabled or a.manual_shared)
      join treino_social.users actor on actor.id = ${actorId}
      join treino_social.friendships f on f.status = 'accepted' and
        ((f.requester_user_id = actor.id and f.addressee_user_id = owner.id) or
         (f.addressee_user_id = actor.id and f.requester_user_id = owner.id))
      join treino_social.activity_reactions r on r.activity_id = a.id and r.user_id = actor.id and r.emoji = ${emoji}
      join treino_social.push_subscriptions s on s.user_id = owner.id
      left join treino_social.push_preferences p on p.user_id = owner.id
      where a.id = ${activityId} and owner.id <> actor.id and coalesce(p.reactions, true) = true`;
    if (rows.length) await deliver(`reaction:${transitionId}`, "reaction", rows[0].display_name as string,
      activityId, rows.map((row) => ({ id: row.id as string, endpoint: row.endpoint as string,
        p256dh: row.p256dh as string, auth: row.auth as string })), emoji, send);
  } catch { console.warn("Friends push delivery failed", { type: "reaction" }); }
}
