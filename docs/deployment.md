# Deployment architecture

Treino Local uses Next.js Route Handlers for Google OAuth and Sheets API calls. Pages, plans, active workouts, and history stay in the browser. A server-side encrypted HttpOnly cookie stores the Google refresh token; there is no cloud user database. The browser calls same-origin `/api/google/...` routes and never receives a Google token. The older `/api/google-connector` route and Apps Script sources remain only for legacy compatibility.

The PWA service worker bypasses all `/api/` requests. Already-imported plans, in-progress workouts, and local history remain usable offline. Finishing a session saves it locally before a best-effort Google write; Source can retry pending sessions. Excel import/direct write/safe-copy behavior is unchanged.

Set the four server-side environment variables in [Google OAuth developer setup](google-oauth-developer-setup.md). Vercel should use the repository's Next.js framework, Node.js 24.x, pnpm 10.34.6, default root and output directory, and `pnpm build`. Never put OAuth values in `NEXT_PUBLIC_` variables or Git. Production OAuth works only at the configured `https://treino-local.vercel.app` origin. Preview URLs are disabled.

The scope is Sensitive and broad at the Google grant level because paste-any-existing-Sheet requires it. The app constrains its behavior to user-entered spreadsheet IDs and parser-derived completion cells. This choice and Google's Testing/verification limits are explained in the developer setup. Legacy connector details are retained in [the deprecated deployment document](../legacy/deployment-connector.md).
