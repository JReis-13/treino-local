import { noStore } from "@/lib/google/http";
import { readSession } from "@/lib/google/session";
import { googleConfig } from "@/lib/google/config";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { googleConfig(); return noStore({ connected: Boolean(readSession(request)) }); }
  catch { return noStore({ connected: false, configured: false }); }
}
