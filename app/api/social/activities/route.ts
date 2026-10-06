import { currentSocialUser, deleteOwnActivity, ownActivityStatus, publishActivity, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { parsePublishActivity } from "@/lib/social/model";
import { after } from "next/server";
import { sendFriendWorkoutPush } from "@/lib/push/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await currentSocialUser(request);
    const clientSessionId = new URL(request.url).searchParams.get("clientSessionId");
    if (!clientSessionId || !/^[A-Za-z0-9_-]{1,100}$/.test(clientSessionId)) throw new SocialError("Invalid session ID.");
    return socialResponse(await ownActivityStatus(user.id, clientSessionId));
  } catch (cause) { return socialFailure(cause); }
}
export async function POST(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const expectedAccount = request.headers.get("x-treino-social-account");
    if (expectedAccount && expectedAccount !== user.id) throw new SocialError("Reconnect the original Google account to share this workout.", 409, "accountChanged");
    const body = await socialBody(request);
    const item = parsePublishActivity(body);
    if (!item) throw new SocialError("Invalid workout summary.");
    const manualShare = body.manualShare === true;
    const { activityId, created } = await publishActivity(user.id, item, manualShare);
    if (created && !manualShare) after(() => sendFriendWorkoutPush(activityId));
    return socialResponse({ ok: true, activityId, created });
  } catch (cause) { return socialFailure(cause); }
}
export async function DELETE(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const expectedAccount = request.headers.get("x-treino-social-account");
    if (expectedAccount && expectedAccount !== user.id) throw new SocialError("Reconnect the original Google account to delete this workout.", 409, "accountChanged");
    const body = await socialBody(request);
    const clientSessionId = body.clientSessionId;
    if (typeof clientSessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(clientSessionId))
      throw new SocialError("Invalid session ID.");
    return socialResponse({ ok: true, ...await deleteOwnActivity(user.id, clientSessionId) });
  } catch (cause) { return socialFailure(cause); }
}
