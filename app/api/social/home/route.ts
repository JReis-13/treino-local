import { currentSocialUser, homeFor, socialFailure, socialResponse } from "@/lib/social/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const user = await currentSocialUser(request); return socialResponse(await homeFor(user.id)); }
  catch (cause) { return socialFailure(cause); }
}
