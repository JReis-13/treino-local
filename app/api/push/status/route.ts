import { currentSocialUser, socialFailure } from "@/lib/social/server";
import { socialDb } from "@/lib/social/db";
import { pushDeviceId, vapidConfigured } from "@/lib/push/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await currentSocialUser(request);
    const sql = socialDb();
    const deviceId = pushDeviceId(request);
    const [prefs, device, deliveries] = await Promise.all([
      sql`select friend_workouts, reactions from treino_social.push_preferences where user_id = ${user.id}`,
      deviceId ? sql`select id from treino_social.push_subscriptions where id = ${deviceId} and user_id = ${user.id}` : Promise.resolve([]),
      deviceId ? sql`select d.event_key, d.status from treino_social.push_deliveries d
        join treino_social.push_subscriptions s on s.id = d.subscription_id
        where s.id = ${deviceId} and s.user_id = ${user.id}
          and d.created_at > now() - interval '14 days'
        order by d.created_at desc limit 20` : Promise.resolve([]),
    ]);
    return Response.json({ configured: vapidConfigured(), publicKey: vapidConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
      friendWorkouts: prefs.length ? Boolean(prefs[0].friend_workouts) : true,
      reactions: prefs.length ? Boolean(prefs[0].reactions) : true,
      deviceRegistered: device.length > 0,
      recentDeliveries: deliveries.flatMap((row) => {
        const match = /^(workout|reaction|test):([0-9a-f-]{36})$/i.exec(String(row.event_key));
        return match ? [{ type: match[1], eventId: match[2], result: row.status }] : [];
      }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return socialFailure(cause); }
}
