import "server-only";
import { randomUUID } from "node:crypto";
import { normalizeEmail } from "@/lib/google/identity";
import { readAllowedSession } from "@/lib/google/session";
import { sameOrigin } from "@/lib/google/config";
import { socialDb } from "@/lib/social/db";
import type { PublishActivity, ReactionEmoji, SocialActivity } from "@/lib/social/model";

export class SocialError extends Error {
  constructor(message: string, public status = 400, public code = "invalid") { super(message); }
}
export function socialResponse(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function socialFailure(cause: unknown) {
  if (cause instanceof SocialError) return socialResponse({ error: cause.message, code: cause.code }, cause.status);
  return socialResponse({ error: "Social features are temporarily unavailable.", code: "unavailable" }, 503);
}
export async function socialBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 4096) throw new SocialError("Request is too large.", 413);
  const text = await request.text();
  if (text.length > 4096) throw new SocialError("Request is too large.", 413);
  try { const value: unknown = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; }
  catch { /* Invalid JSON. */ }
  throw new SocialError("Invalid request.");
}
export async function currentSocialUser(request: Request, mutate = false) {
  if (mutate && !sameOrigin(request)) throw new SocialError("This request must come from Treino Local.", 403, "csrf");
  let session;
  try { session = readAllowedSession(request); }
  catch { throw new SocialError("Google account authorization is unavailable.", 503, "unconfigured"); }
  if (!session) throw new SocialError("Connect Google to use Friends.", 401, "authRequired");
  const sql = socialDb();
  const email = normalizeEmail(session.email);
  const fallback = email.split("@")[0].slice(0, 50) || "Friend";
  const rows = await sql`insert into treino_social.users (id, google_sub, email, display_name)
    values (${randomUUID()}, ${session.sub}, ${email}, ${fallback})
    on conflict (google_sub) do update set email = excluded.email, updated_at = now()
    returning id, email, display_name, sharing_enabled`;
  return rows[0] as { id: string; email: string; display_name: string; sharing_enabled: boolean };
}

export async function friendsFor(userId: string) {
  const sql = socialDb();
  const rows = await sql`select f.id, f.status, f.requester_user_id, f.addressee_user_id,
    u.id as friend_id, u.display_name, u.email
    from treino_social.friendships f join treino_social.users u
      on u.id = case when f.requester_user_id = ${userId} then f.addressee_user_id else f.requester_user_id end
    where f.requester_user_id = ${userId} or f.addressee_user_id = ${userId}
    order by f.updated_at desc`;
  return rows.map((row) => ({ id: row.id as string, status: row.status as string,
    direction: row.requester_user_id === userId ? "outgoing" : "incoming",
    displayName: row.display_name as string, email: row.email as string }));
}
export async function requestFriend(userId: string, targetEmail: string) {
  const sql = socialDb();
  const target = await sql`select id from treino_social.users where email = ${normalizeEmail(targetEmail)}`;
  if (!target.length) throw new SocialError("This person needs to open Treino Local and connect Google once before you can add them.", 404, "notReady");
  if (target[0].id === userId) throw new SocialError("You cannot add yourself.");
  const existing = await sql`select id, status from treino_social.friendships
    where (requester_user_id = ${userId} and addressee_user_id = ${target[0].id})
       or (requester_user_id = ${target[0].id} and addressee_user_id = ${userId})`;
  if (existing.length && existing[0].status !== "declined") throw new SocialError("A request or friendship already exists.", 409, "duplicate");
  if (existing.length) await sql`update treino_social.friendships set requester_user_id = ${userId}, addressee_user_id = ${target[0].id}, status = 'pending', updated_at = now() where id = ${existing[0].id} and status = 'declined'`;
  else await sql`insert into treino_social.friendships (id, requester_user_id, addressee_user_id, status)
    values (${randomUUID()}, ${userId}, ${target[0].id}, 'pending')`;
}
export async function changeFriend(userId: string, friendshipId: string, action: "accept" | "decline" | "remove") {
  const sql = socialDb();
  if (action === "remove") {
    const rows = await sql`delete from treino_social.friendships where id = ${friendshipId} and status = 'accepted'
      and (requester_user_id = ${userId} or addressee_user_id = ${userId}) returning id`;
    if (!rows.length) throw new SocialError("Friendship not found.", 404);
  } else {
    const rows = await sql`update treino_social.friendships set status = ${action === "accept" ? "accepted" : "declined"}, updated_at = now()
      where id = ${friendshipId} and addressee_user_id = ${userId} and status = 'pending' returning id`;
    if (!rows.length) throw new SocialError("Pending request not found.", 404);
  }
}
export async function publishActivity(userId: string, item: PublishActivity, manual = false): Promise<string> {
  const sql = socialDb();
  const rows = await sql`insert into treino_social.workout_activities
    (id, user_id, client_session_id, workout_name, completed_at, local_date, duration_minutes, completed_exercises, total_exercises, manual_shared)
    select ${randomUUID()}, id, ${item.clientSessionId}, ${item.workoutName}, ${item.completedAt}, ${item.localDate},
      ${item.durationMinutes}, ${item.completedExercises}, ${item.totalExercises}, ${manual}
    from treino_social.users where id = ${userId} and (sharing_enabled = true or ${manual})
    on conflict (user_id, client_session_id) do update set workout_name = excluded.workout_name,
      completed_at = excluded.completed_at, local_date = excluded.local_date,
      duration_minutes = excluded.duration_minutes, completed_exercises = excluded.completed_exercises,
      total_exercises = excluded.total_exercises,
      manual_shared = treino_social.workout_activities.manual_shared or excluded.manual_shared, updated_at = now()
      where treino_social.workout_activities.completed_at <= excluded.completed_at
    returning id`;
  if (!rows.length) {
    const existing = await sql`select a.id from treino_social.workout_activities a
      join treino_social.users u on u.id = a.user_id and (u.sharing_enabled = true or a.manual_shared = true)
      where a.user_id = ${userId} and a.client_session_id = ${item.clientSessionId}`;
    if (!existing.length) throw new SocialError("Enable automatic sharing or use Share with friends.", 403, "sharingDisabled");
    return existing[0].id as string;
  }
  return rows[0].id as string;
}
export async function ownActivityStatus(userId: string, clientSessionId: string) {
  const sql = socialDb();
  const rows = await sql`select a.id, a.manual_shared, u.sharing_enabled from treino_social.workout_activities a
    join treino_social.users u on u.id = a.user_id
    where a.user_id = ${userId} and a.client_session_id = ${clientSessionId}`;
  return rows.length ? { activityId: rows[0].id as string,
    shared: Boolean(rows[0].manual_shared || rows[0].sharing_enabled) } : { activityId: null, shared: false };
}
export async function deleteOwnActivity(userId: string, clientSessionId: string): Promise<{ deleted: boolean }> {
  const sql = socialDb();
  const removed = await sql`delete from treino_social.workout_activities
    where user_id = ${userId} and client_session_id = ${clientSessionId} returning id`;
  if (removed.length) return { deleted: true };
  const foreign = await sql`select id from treino_social.workout_activities
    where client_session_id = ${clientSessionId} and user_id <> ${userId} limit 1`;
  if (foreign.length) throw new SocialError("Workout is unavailable.", 404, "notOwned");
  return { deleted: false };
}
export async function homeFor(userId: string): Promise<{ activities: SocialActivity[]; received: Array<{ displayName: string; emoji: ReactionEmoji; workoutName: string }> ; friendCount: number }> {
  const sql = socialDb();
  const friends = await sql`select u.id, u.display_name from treino_social.friendships f
    join treino_social.users u on u.id = case when f.requester_user_id = ${userId} then f.addressee_user_id else f.requester_user_id end
    where f.status = 'accepted' and (f.requester_user_id = ${userId} or f.addressee_user_id = ${userId}) limit 20`;
  const rows = await sql`select a.id, u.display_name, a.workout_name, a.completed_at, a.local_date,
    a.duration_minutes, a.completed_exercises, a.total_exercises
    from treino_social.friendships f
    join treino_social.users u on u.id = case when f.requester_user_id = ${userId} then f.addressee_user_id else f.requester_user_id end
    join lateral (select * from treino_social.workout_activities a where a.user_id = u.id
      and (u.sharing_enabled = true or a.manual_shared = true) order by a.completed_at desc limit 1) a on true
    where f.status = 'accepted' and
      (f.requester_user_id = ${userId} or f.addressee_user_id = ${userId})
    order by a.completed_at desc limit 10`;
  const activities: SocialActivity[] = [];
  for (const row of rows) {
    const reactionRows = await sql`select r.user_id, r.emoji from treino_social.activity_reactions r
      join treino_social.workout_activities a on a.id = r.activity_id
      join treino_social.friendships f on f.status = 'accepted' and
        ((f.requester_user_id = a.user_id and f.addressee_user_id = r.user_id) or
         (f.addressee_user_id = a.user_id and f.requester_user_id = r.user_id))
      where r.activity_id = ${row.id}`;
    const reactions: SocialActivity["reactions"] = {};
    for (const reaction of reactionRows) { const emoji = reaction.emoji as ReactionEmoji; reactions[emoji] = (reactions[emoji] ?? 0) + 1; }
    activities.push({ id: row.id as string, displayName: row.display_name as string, workoutName: row.workout_name as string,
      completedAt: new Date(row.completed_at as Date).toISOString(), localDate: String(row.local_date).slice(0, 10),
      durationMinutes: row.duration_minutes as number | null, completedExercises: row.completed_exercises as number | null,
      totalExercises: row.total_exercises as number | null, reactions,
      myReaction: (reactionRows.find((reaction) => reaction.user_id === userId)?.emoji ?? null) as ReactionEmoji | null });
  }
  const receivedRows = await sql`select u.display_name, r.emoji, a.workout_name
    from treino_social.activity_reactions r
    join treino_social.workout_activities a on a.id = r.activity_id
    join treino_social.users owner on owner.id = a.user_id and (owner.sharing_enabled = true or a.manual_shared = true)
    join treino_social.users u on u.id = r.user_id
    join treino_social.friendships f on f.status = 'accepted' and
      ((f.requester_user_id = ${userId} and f.addressee_user_id = r.user_id) or
       (f.addressee_user_id = ${userId} and f.requester_user_id = r.user_id))
    where a.user_id = ${userId} order by r.updated_at desc limit 5`;
  return { activities, received: receivedRows.map((row) => ({ displayName: row.display_name as string,
    emoji: row.emoji as ReactionEmoji, workoutName: row.workout_name as string })), friendCount: friends.length };
}
export async function setReaction(userId: string, activityId: string, emoji: ReactionEmoji | null) {
  const sql = socialDb();
  const allowed = await sql`select a.id from treino_social.workout_activities a
    join treino_social.users owner on owner.id = a.user_id and (owner.sharing_enabled = true or a.manual_shared = true)
    join treino_social.friendships f on f.status = 'accepted' and
      ((f.requester_user_id = ${userId} and f.addressee_user_id = a.user_id) or
       (f.addressee_user_id = ${userId} and f.requester_user_id = a.user_id))
    where a.id = ${activityId} and a.user_id <> ${userId}`;
  if (!allowed.length) throw new SocialError("Workout is unavailable.", 404);
  if (emoji === null) await sql`delete from treino_social.activity_reactions r where r.activity_id = ${activityId} and r.user_id = ${userId}
    and exists (select 1 from treino_social.workout_activities a join treino_social.users owner
      on owner.id = a.user_id and (owner.sharing_enabled = true or a.manual_shared = true)
      join treino_social.friendships f on f.status = 'accepted' and
        ((f.requester_user_id = ${userId} and f.addressee_user_id = a.user_id) or
         (f.addressee_user_id = ${userId} and f.requester_user_id = a.user_id))
      where a.id = r.activity_id)`;
  else await sql`insert into treino_social.activity_reactions (id, activity_id, user_id, emoji)
    select ${randomUUID()}, a.id, ${userId}, ${emoji} from treino_social.workout_activities a
    join treino_social.users owner on owner.id = a.user_id and (owner.sharing_enabled = true or a.manual_shared = true)
    join treino_social.friendships f on f.status = 'accepted' and
      ((f.requester_user_id = ${userId} and f.addressee_user_id = a.user_id) or
       (f.addressee_user_id = ${userId} and f.requester_user_id = a.user_id))
    where a.id = ${activityId} and a.user_id <> ${userId}
    on conflict (activity_id,user_id) do update set emoji = excluded.emoji, updated_at = now()`;
}
