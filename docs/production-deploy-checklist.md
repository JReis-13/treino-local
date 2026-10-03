# OAuth production deployment checklist

## Real-phone gym smoke test for this release

Use the installed PWA on a phone and a **disposable copy** of a supported Sheet for source-write checks. Do not use the canonical training Sheet as a test target.

1. Open the installed PWA, select the active training, and open a workout.
2. Check that the current source load and any last-used local load are distinct and readable.
3. Tap a completion circle and its label; tap again to undo, then complete several exercises.
4. Change one actual load, including a decimal comma (`7,5`), and check the displayed session value.
5. Lock and reopen the phone; confirm completion and load edits survived.
6. Finish and save. If the same workout/date exists, choose Cancel once, then test Add or Replace deliberately. Confirm Add makes two History entries and Replace keeps the count unchanged.
7. In History, check date, time, duration, load, and sync status. Open Statistics and check count, timed-session sample, and load trend.
8. Start a new workout and confirm the edited value appears as Last used and as the editable initial load.
9. Online with the disposable Google Sheet, confirm the intended completion date and changed current load in the mapped cells; check that neighboring grouped loads stayed unchanged.
10. Go offline, start or resume a workout, change a load, finish or leave it in progress, then reopen the PWA. Confirm local persistence and offline Statistics. Reconnect and use Source to retry pending writes; confirm separate date/load outcomes.

For Excel, use only a disposable workbook copy. Confirm a safe-copy download remains pending until the saved copy is reconnected and verified. Check `7.5` displays as a load, not a calendar date. Browser E2E emulation is evidence of layout and behavior, not a substitute for this real-phone test.

Google **Publishing status** controls OAuth availability and verification. Treino Local's server-only `GOOGLE_ALLOWED_EMAILS` controls the three accounts allowed to use Google Sheets. In production does not restrict Google OAuth to those three accounts. [Developer setup](google-oauth-developer-setup.md) explains the configuration and Google's unverified warning.

## Before changing Google to In production

1. Run frozen dependency install, lint, TypeScript, all unit/Excel/security tests, mobile E2E, production build, and local production runtime checks. Automated Google tests use mocks, never a real Sheet.
2. In Google Auth Platform → **Data Access**, confirm `openid`, `email`, and `https://www.googleapis.com/auth/spreadsheets`. In **Clients**, confirm the OAuth Web client's exact redirects: `http://localhost:3000/api/google/auth/callback` and `https://treino-local.vercel.app/api/google/auth/callback`.
3. In **Vercel → Treino Local project → Settings → Environment Variables**, configure `GOOGLE_ALLOWED_EMAILS=jonathareis.eng@gmail.com,milenasulzbach@gmail.com,cintiadg@gmail.com` for **Production**. Preserve `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_SESSION_SECRET`, and `APP_BASE_URL=https://treino-local.vercel.app`. Do not use `NEXT_PUBLIC_`. Preview OAuth is intentionally unavailable at unregistered preview origins; local development uses `.env.local` with the same allowlist and `http://localhost:3000`.
4. Deploy the allowlist-enabled version **first**. Redeploy if a Vercel environment variable was added after deployment.
5. While Google OAuth remains **Testing**, test `jonathareis.eng@gmail.com`; test `cintiadg@gmail.com` and `milenasulzbach@gmail.com` if they are already Test users. Older Google cookies require reconnect. If possible, temporarily add one unrelated account as a Google Test user solely to confirm Google OAuth succeeds but Treino Local rejects it. Do not add it to the app allowlist. Confirm plans, local workout completion, history, Excel, and backup remain usable after rejection.

## Then change Google Publishing status

6. In **Google Cloud Console → Google Auth Platform → Audience → Publishing status**, select **Publish app** to move from **Testing** to **In production**. This step is manual. Personal use by fewer than 100 users may remain unverified under Google's [exception](https://support.google.com/cloud/answer/13464323); approved users may see Google's own unverified-app warning. Do not bypass it. The [unverified-app cap](https://support.google.com/googleapi/answer/7454865) remains relevant.
7. Test all three approved accounts again, each in a fresh browser profile if practical. Confirm a non-approved Google account is rejected by Treino Local with the safe message and can retry with another account. Confirm Settings shows only the connected user's own email.
8. For the first production-mode write, use a **disposable copy** of a supported Sheet. Connect, import by URL, review/activate, finish one test workout, confirm one numeric date in the same Sheet's intended E5:E16 grid, and confirm local history says synced. Never use a canonical training Sheet for this test.
9. Verify installed PWA startup, offline access to already-imported training, recovery after reopening, pending-sync retry, backup/restore, and disconnect/reconnect. Disconnect and rejection must not delete local plans or history.

Review Git diff/status before pushing. Ensure `.env.local`, OAuth credentials, tokens, real workbooks, and generated build output are not staged. This checklist does not authorize Codex to push, deploy, or change Google Cloud settings.
