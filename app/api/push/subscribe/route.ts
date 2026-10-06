import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentSocialUser, socialBody, socialFailure, SocialError } from "@/lib/social/server";
import { socialDb } from "@/lib/social/db";
import { PUSH_DEVICE_COOKIE, pushDeviceId, validateSubscription, vapidConfigured } from "@/lib/push/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    if (!vapidConfigured()) throw new SocialError("Notifications are not configured yet.", 503, "unconfigured");
    const body = await socialBody(request);
    const subscription = validateSubscription(body.subscription);
    const sql = socialDb();
    const previousDevice = pushDeviceId(request);
    const id = randomUUID();
    const rows = await sql`insert into treino_social.push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${id}, ${user.id}, ${subscription.endpoint}, ${subscription.p256dh}, ${subscription.auth})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, updated_at = now(), failure_count = 0 returning id`;
    const boundId = rows[0].id as string;
    if (previousDevice && previousDevice !== boundId) await sql`delete from treino_social.push_subscriptions
      where id = ${previousDevice} and user_id = ${user.id}`;
    await sql`insert into treino_social.push_preferences (user_id) values (${user.id}) on conflict do nothing`;
    const response = NextResponse.json({ ok: true, deviceRegistered: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(PUSH_DEVICE_COOKIE, boundId, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (cause) { return socialFailure(cause); }
}
