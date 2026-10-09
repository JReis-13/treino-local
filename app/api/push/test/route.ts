import { currentSocialUser, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { pushDeviceId, sendPushSelfTest } from "@/lib/push/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const deviceId = pushDeviceId(request);
    if (!deviceId) throw new SocialError("Enable notifications on this device first.", 409);
    return socialResponse(await sendPushSelfTest(user.id, deviceId));
  } catch (cause) { return socialFailure(cause); }
}
