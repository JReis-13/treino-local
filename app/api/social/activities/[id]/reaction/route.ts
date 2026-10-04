import { currentSocialUser, setReaction, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { isReactionEmoji } from "@/lib/social/model";

export const runtime = "nodejs";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentSocialUser(request, true);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SocialError("Invalid activity.");
    const body = await socialBody(request);
    if (!isReactionEmoji(body.emoji)) throw new SocialError("Choose an available reaction.");
    await setReaction(user.id, id, body.emoji);
    return socialResponse({ ok: true });
  } catch (cause) { return socialFailure(cause); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentSocialUser(request, true);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SocialError("Invalid activity.");
    await setReaction(user.id, id, null);
    return socialResponse({ ok: true });
  } catch (cause) { return socialFailure(cause); }
}
