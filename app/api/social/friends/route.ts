import { changeFriend, currentSocialUser, friendsFor, requestFriend, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { validEmail } from "@/lib/social/model";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const user = await currentSocialUser(request); return socialResponse({ friends: await friendsFor(user.id) }); }
  catch (cause) { return socialFailure(cause); }
}
export async function POST(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await socialBody(request);
    if (!validEmail(body.email)) throw new SocialError("Enter a valid Google email.");
    await requestFriend(user.id, body.email);
    return socialResponse({ ok: true }, 201);
  } catch (cause) { return socialFailure(cause); }
}
export async function PATCH(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await socialBody(request);
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || !["accept", "decline"].includes(body.action as string)) throw new SocialError("Invalid friendship action.");
    await changeFriend(user.id, body.id, body.action as "accept" | "decline");
    return socialResponse({ ok: true });
  } catch (cause) { return socialFailure(cause); }
}
export async function DELETE(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await socialBody(request);
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new SocialError("Invalid friendship.");
    await changeFriend(user.id, body.id, "remove");
    return socialResponse({ ok: true });
  } catch (cause) { return socialFailure(cause); }
}
