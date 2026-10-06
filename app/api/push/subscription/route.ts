import { NextResponse } from "next/server";
import { currentSocialUser, socialFailure } from "@/lib/social/server";
import { socialDb } from "@/lib/social/db";
import { PUSH_DEVICE_COOKIE, pushDeviceId } from "@/lib/push/server";

export const runtime = "nodejs";
export async function DELETE(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const id = pushDeviceId(request);
    if (id) await socialDb()`delete from treino_social.push_subscriptions where id = ${id} and user_id = ${user.id}`;
    const response = NextResponse.json({ ok: true, deviceRegistered: false }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.delete(PUSH_DEVICE_COOKIE);
    return response;
  } catch (cause) { return socialFailure(cause); }
}
