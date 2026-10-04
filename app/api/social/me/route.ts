import { currentSocialUser, socialBody, socialFailure, socialResponse, SocialError } from "@/lib/social/server";
import { socialDb } from "@/lib/social/db";
import { validDisplayName } from "@/lib/social/model";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const user = await currentSocialUser(request); return socialResponse({ accountId: user.id, email: user.email, displayName: user.display_name, sharingEnabled: user.sharing_enabled }); }
  catch (cause) { return socialFailure(cause); }
}
export async function PATCH(request: Request) {
  try {
    const user = await currentSocialUser(request, true);
    const body = await socialBody(request);
    if (!validDisplayName(body.displayName) && typeof body.sharingEnabled !== "boolean") throw new SocialError("Invalid profile update.");
    if (body.displayName !== undefined && !validDisplayName(body.displayName)) throw new SocialError("Display name must be 1–50 characters.");
    if (body.sharingEnabled !== undefined && typeof body.sharingEnabled !== "boolean") throw new SocialError("Invalid sharing preference.");
    const sql = socialDb();
    const rows = await sql`update treino_social.users set display_name = ${body.displayName === undefined ? user.display_name : (body.displayName as string).trim()},
      sharing_enabled = ${body.sharingEnabled === undefined ? user.sharing_enabled : body.sharingEnabled}, updated_at = now()
      where id = ${user.id} returning display_name, sharing_enabled`;
    return socialResponse({ displayName: rows[0].display_name, sharingEnabled: rows[0].sharing_enabled });
  } catch (cause) { return socialFailure(cause); }
}
