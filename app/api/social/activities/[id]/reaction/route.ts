import { currentSocialUser, setReaction, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { isReactionEmoji } from "@/lib/social/model";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { sendReactionPush } from "@/lib/push/server";

export const runtime = "nodejs";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentSocialUser(request, true);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SocialError("Invalid activity.");
    const body = await socialBody(request);
    const emoji = body.emoji;
    if (!isReactionEmoji(emoji)) throw new SocialError("Choose an available reaction.");
    const changed = await setReaction(user.id, id, emoji);
    if (changed) {
      const transitionId = randomUUID();
      after(() => sendReactionPush(id, user.id, emoji, transitionId));
    }
    return socialResponse({ ok: true, changed });
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
