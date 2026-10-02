# Google OAuth developer setup

This is **developer-only** setup. People using Treino Local tap **Connect Google** and paste their own existing Sheet URL. They do not create a Cloud project or Apps Script deployment.

## Why this scope

The app requests `openid`, `email`, and `https://www.googleapis.com/auth/spreadsheets`. Google's [OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect) says `email` adds `email` and `email_verified` claims to the ID token. The server verifies that token before authorizing the account. Google's [Sheets scope table](https://developers.google.com/workspace/sheets/api/scopes) classifies the Sheets scope **Sensitive** and says it permits seeing and editing all spreadsheets available to the authorizing account. The app itself uses only IDs entered as Sheet URLs; it never lists Drive files. No `profile`, Drive, Gmail, Contacts, or Calendar scope is requested.

The implementation uses Google's [web-server authorization code flow](https://developers.google.com/identity/protocols/oauth2/web-server), `state`, S256 PKCE, an exact redirect URI, and a server-only code exchange. The official `google-auth-library` verifies ID-token signature, issuer, audience and expiration; the app additionally requires a verified email matching the current server allowlist. An AES-256-GCM HttpOnly, Secure-on-HTTPS, SameSite=Lax cookie contains only refresh token, verified email, Google subject and creation time. Older cookies without verified identity require one reconnect. The browser never receives tokens in JavaScript or backup JSON. The server checks the current allowlist before every Sheets API call, then refreshes the access token. Each authorization requests offline access and `select_account consent` because the stateless session requires a refresh token and users must be able to select a different account. If Google omits a new refresh token, the previous token is reused only when the verified Google subject matches. Revoked grants require reconnection. Disconnect attempts revocation and clears the cookie without deleting local data.

The implementation uses Google's official library for ID-token verification and calls the documented OAuth token/revocation and Sheets REST endpoints directly. Mocked tests cover those calls without touching a real Sheet.

## Google Cloud Console

1. Create or select a Google Cloud project for Treino Local. In **APIs & Services → Library**, enable **Google Sheets API**.
2. Open **Google Auth Platform**. In **Branding**, set the app name, user support email, developer contact, and required application/privacy links and authorized domain. Google's [current Branding guidance](https://support.google.com/cloud/answer/15549049) describes these fields. Public verification may require a verified domain, homepage, privacy policy, and demonstration.
3. In **Audience**, choose **External** unless all intended users belong to one Workspace organization. During **Testing**, add your Google account and your friend's account as **Test users**.
4. In **Data Access**, configure `openid`, `email`, and `https://www.googleapis.com/auth/spreadsheets`. The Sheets scope is Sensitive. Google may show a test or unverified-app warning. For this three-person personal app, [Google says verification is not mandatory below 100 users](https://support.google.com/cloud/answer/13464323), though the warning and unverified-app cap can still apply.
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
| `GOOGLE_ALLOWED_EMAILS` | Three comma-separated approved emails | Same three approved emails |
| `APP_BASE_URL` | `http://localhost:3000` | `https://treino-local.vercel.app` |

Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Set the values before deploying the new build. Missing or malformed configuration fails closed; no default production secret exists.

Add this line to the Git-ignored `.env.local` for local OAuth:

```dotenv
GOOGLE_ALLOWED_EMAILS=jonathareis.eng@gmail.com,milenasulzbach@gmail.com,cintiadg@gmail.com
```

In **Vercel → Treino Local project → Settings → Environment Variables**, add the same `GOOGLE_ALLOWED_EMAILS` value for **Production**, then redeploy to apply it. Keep the existing four OAuth variables. Preview deployments currently cannot complete OAuth because the server accepts only the exact localhost or production origin; do not copy production secrets into Preview. For Development/local runs, use `.env.local`. The allowlist has no `NEXT_PUBLIC_` prefix and never enters client JavaScript. Google controls OAuth publishing and verification; Treino Local controls the three-account authorization independently.

## Moving Treino Local from Testing to In production

1. In **Google Cloud Console → Google Auth Platform → Data Access**, confirm `openid`, `email`, and `https://www.googleapis.com/auth/spreadsheets`. In **Clients → OAuth Web application**, confirm both exact callbacks: `http://localhost:3000/api/google/auth/callback` and `https://treino-local.vercel.app/api/google/auth/callback`.
2. Set the Production allowlist in Vercel as above, deploy this allowlist-enabled version **first**, and redeploy if you added the variable after a deployment.
3. While **Audience → Publishing status** still says **Testing**, connect with each approved account that is already a Test user. If practical, temporarily add one unrelated Google account as a Test user solely to verify that Google OAuth succeeds but Treino Local rejects it. Never add it to `GOOGLE_ALLOWED_EMAILS`. Confirm local plans and history remain usable.
4. Only after these checks, in **Google Auth Platform → Audience → Publishing status**, select **Publish app** to move from **Testing** to **In production**. This makes the OAuth flow available to other Google accounts; it does **not** authorize them in Treino Local.
5. Recheck all three approved accounts and one unapproved account. Import and write only to a disposable Sheet copy for the first production-mode sync; confirm the write in the same Sheet and local history.

[Google's Audience documentation](https://support.google.com/cloud/answer/15549945) says Testing is limited to listed Test users and their Sheets-scope authorizations expire after seven days, including refresh tokens. In production removes that Testing-specific seven-day expiration; normal token revocation and other token limits still apply. Google may show **“Google hasn't verified this app”** because the Sheets scope is Sensitive. The [personal-use exception](https://support.google.com/cloud/answer/13464323) allows fewer than 100 users to continue without full verification, subject to that warning and the [unverified-app 100-new-user cap](https://support.google.com/googleapi/answer/7454865). Do not bypass the warning; approved users may proceed through Google's own consent flow if Google offers that choice. Treino Local's allowlist does not make the Google app verified.

## Testing-mode limits and manual disposable-Sheet check

Google's [Audience documentation](https://support.google.com/cloud/answer/15549945) states that External/Testing permits only listed test users (up to 100) and that authorizations, including offline refresh tokens for Sheets scope, expire after **seven days**. The account must reconnect then. This is a testing-phase limitation, not a permanent user setup requirement. An unverified warning may appear; the personal-use exception described above applies to this three-person use case.

After automated tests, use a **disposable copy** of a supported workbook converted to Google Sheets: connect as a listed test user, paste its normal URL, review/activate it, finish one test workout, confirm a numeric date appeared in the **same** Sheet's intended E5:E16 grid, confirm no new Sheet was created, and confirm the local session says synced. Repeat with a friend's test-user account and a different disposable Sheet in a fresh browser profile. Do not use a canonical training Sheet for write testing. The app has not run this real-Google write automatically.

Google Sheets has no conditional update primitive for a single cell. The server re-reads immediately before writing, writes only the parser-derived cell, and reads back; uncertain network failures reconcile before retry. Simultaneous external edits in the narrow read/write interval remain a limitation and should be avoided during completion sync.
