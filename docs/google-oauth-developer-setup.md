# Google OAuth developer setup

This is **developer-only** setup. People using Treino Local tap **Connect Google** and paste their own existing Sheet URL. They do not create a Cloud project or Apps Script deployment.

## Why this scope

The app requests exactly `https://www.googleapis.com/auth/spreadsheets`. Google's [Sheets scope table](https://developers.google.com/workspace/sheets/api/scopes) classifies it **Sensitive** and says it permits seeing and editing all spreadsheets available to the authorizing account. The app itself uses only IDs entered as Sheet URLs; it never lists Drive files. `drive.file` is non-sensitive, but limits access to files opened/selected with the app. [Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker) would add a selection step and a browser-side token, so it does not match paste-any-accessible-URL. A [service account](https://developers.google.com/identity/protocols/oauth2/service-account) acts as the application, not the user's own Google account, and would require sharing each Sheet with it or Workspace-wide delegation. No email/profile scope is requested.

The implementation uses Google's [web-server authorization code flow](https://developers.google.com/identity/protocols/oauth2/web-server), `state`, S256 PKCE, an exact redirect URI, and a server-only code exchange. A 64-character random session secret derives the AES-256-GCM key for an authenticated, HttpOnly, SameSite=Lax cookie containing only the refresh token and creation time. The browser never receives tokens in JavaScript or backup JSON. The server refreshes access tokens on demand, so no database is required. Each reauthorization requests offline access and consent; if Google omits a new refresh token, the existing encrypted session token is retained. Revoked/expired grants require reconnection. Disconnect attempts Google token revocation and clears the cookie; if Google is temporarily unreachable, the local cookie is still cleared. Rotating the session secret invalidates every connected device and signed source proof, requiring reconnect and reimport/refresh.

The implementation calls Google's documented OAuth token/revocation and Sheets REST endpoints directly. A Google client library would not handle the app's stateless encrypted cookie, source proof, or parser-derived cell validation; these small HTTP calls are covered by mocked tests. Auth.js would add an account/session layer beyond this local-first MVP without removing those responsibilities.

## Google Cloud Console

1. Create or select a Google Cloud project for Treino Local. In **APIs & Services → Library**, enable **Google Sheets API**.
2. Open **Google Auth Platform**. In **Branding**, set the app name, user support email, developer contact, and required application/privacy links and authorized domain. Google's [current Branding guidance](https://support.google.com/cloud/answer/15549049) describes these fields. Public verification may require a verified domain, homepage, privacy policy, and demonstration.
3. In **Audience**, choose **External** unless all intended users belong to one Workspace organization. During **Testing**, add your Google account and your friend's account as **Test users**.
4. In **Data Access**, add only `https://www.googleapis.com/auth/spreadsheets`. It is Sensitive. Google may show an unverified/test warning. For a public long-term feature, move to **In production** and complete the applicable [OAuth app verification](https://support.google.com/cloud/answer/13463073) for this scope. Personal use below Google's threshold can have a verification exception, but warning screens and quota limits may still apply.
5. In **Clients**, create an OAuth **Web application** client. Add these **Authorized redirect URIs** exactly:
   - `http://localhost:3000/api/google/auth/callback`
   - `https://treino-local.vercel.app/api/google/auth/callback`
6. Copy the client ID and client secret at creation. Keep the secret outside Git. Google's [web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server) requires exact redirect URI matching.

The current server accepts only `http://localhost:3000` and `https://treino-local.vercel.app` as `APP_BASE_URL`. Random Vercel Preview origins and LAN IPs cannot perform Google OAuth without an intentional code/configuration change and corresponding registered redirect URI. They can still use already-imported local plans offline.

## Environment variables

Set these server-side values in `.env.local` for localhost and in **Vercel project → Settings → Environment Variables** for Production. Never use a `NEXT_PUBLIC_` prefix.

| Variable | Local value | Production value |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth Web client ID | Same client ID or a dedicated production client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Matching Web client secret | Matching Web client secret |
| `GOOGLE_OAUTH_SESSION_SECRET` | Random secret, 43+ characters | Independent random secret, 43+ characters |
| `APP_BASE_URL` | `http://localhost:3000` | `https://treino-local.vercel.app` |

Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Set the values before deploying the new build. Missing or malformed configuration fails closed; no default production secret exists.

## Testing-mode limits and manual disposable-Sheet check

Google's [Audience documentation](https://support.google.com/cloud/answer/15549945) states that External/Testing permits only listed test users (up to 100) and that authorizations, including offline refresh tokens for Sheets scope, expire after **seven days**. The account must reconnect then. This is a testing-phase limitation, not a permanent user setup requirement. An unverified warning may appear. Before promising seamless public use, configure branding/data access and complete any required verification.

After automated tests, use a **disposable copy** of a supported workbook converted to Google Sheets: connect as a listed test user, paste its normal URL, review/activate it, finish one test workout, confirm a numeric date appeared in the **same** Sheet's intended E5:E16 grid, confirm no new Sheet was created, and confirm the local session says synced. Repeat with a friend's test-user account and a different disposable Sheet in a fresh browser profile. Do not use a canonical training Sheet for write testing. The app has not run this real-Google write automatically.

Google Sheets has no conditional update primitive for a single cell. The server re-reads immediately before writing, writes only the parser-derived cell, and reads back; uncertain network failures reconcile before retry. Simultaneous external edits in the narrow read/write interval remain a limitation and should be avoided during completion sync.
