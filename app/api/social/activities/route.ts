import { currentSocialUser, publishActivity, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { parsePublishActivity } from "@/lib/social/model";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await socialBody(request);
    const item = parsePublishActivity(body);
    if (!item) throw new SocialError("Invalid workout summary.");
    await publishActivity(user.id, item);
    return socialResponse({ ok: true });
  } catch (cause) { return socialFailure(cause); }
}
