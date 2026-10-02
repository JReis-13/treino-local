export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const SESSION_COOKIE = "treino_google_session";
export const FLOW_COOKIE = "treino_google_flow";

export function googleConfig() {
  const base = process.env.APP_BASE_URL;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const sessionSecret = process.env.GOOGLE_OAUTH_SESSION_SECRET;
  if (!base || !clientId || !clientSecret || !sessionSecret || sessionSecret.length < 43) {
    throw new Error("Google connection is not configured on this server.");
  }
  const url = new URL(base);
  if (url.href !== `${url.origin}/` || !(url.origin === "http://localhost:3000" || url.origin === "https://treino-local.vercel.app")) {
    throw new Error("Google connection is unavailable on this deployment.");
  }
  return { origin: url.origin, clientId, clientSecret, sessionSecret,
    redirectUri: `${url.origin}/api/google/auth/callback`, secure: url.protocol === "https:" };
}

export function sameOrigin(request: Request): boolean {
  try {
    const origin = request.headers.get("origin");
    return origin === googleConfig().origin && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}

export function safeReturnPath(value: string | null): string {
  return value === "/plans" || value === "/settings" || value === "/source" ? value : "/plans";
}
