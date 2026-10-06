import { currentSocialUser, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { socialDb } from "@/lib/social/db";

export const runtime = "nodejs";
export async function PUT(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await socialBody(request);
    if (typeof body.friendWorkouts !== "boolean" || typeof body.reactions !== "boolean")
      throw new SocialError("Invalid notification preferences.");
    await socialDb()`insert into treino_social.push_preferences (user_id, friend_workouts, reactions)
      values (${user.id}, ${body.friendWorkouts}, ${body.reactions})
      on conflict (user_id) do update set friend_workouts = excluded.friend_workouts,
        reactions = excluded.reactions, updated_at = now()`;
    return socialResponse({ ok: true, friendWorkouts: body.friendWorkouts, reactions: body.reactions });
  } catch (cause) { return socialFailure(cause); }
}
