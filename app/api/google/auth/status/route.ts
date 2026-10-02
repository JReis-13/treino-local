import { noStore } from "@/lib/google/http";
import { readAllowedSession } from "@/lib/google/session";
import { googleConfig } from "@/lib/google/config";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { googleConfig(); const session = readAllowedSession(request); return noStore({ connected: Boolean(session), email: session?.email }); }
  catch { return noStore({ connected: false, configured: false }); }
}
