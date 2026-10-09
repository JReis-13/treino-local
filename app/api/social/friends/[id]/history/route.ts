import { currentSocialUser, friendHistoryFor, socialFailure, socialResponse } from "@/lib/social/server";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentSocialUser(request);
    const { id } = await context.params;
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    return socialResponse(await friendHistoryFor(user.id, id, cursor));
  } catch (cause) { return socialFailure(cause); }
}
