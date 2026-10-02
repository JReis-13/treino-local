# OAuth production deployment checklist

1. Run frozen dependency install, lint, TypeScript, all unit/Excel/security tests, mobile E2E, and `pnpm build`. Check local production runtime with `pnpm start` and a fresh browser profile. Tests must use mocked Google APIs and disposable Excel copies.
2. Follow [Google OAuth developer setup](google-oauth-developer-setup.md): enable Sheets API, configure Branding/Audience/Data Access, create the Web client, register exact localhost and production callbacks, and add test users while in Testing.
3. In **Vercel → Project → Settings → Environment Variables**, set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_SESSION_SECRET`, and `APP_BASE_URL=https://treino-local.vercel.app` for Production. Keep all four server-side. Do not deploy until they are set.
4. Review Git diff/status. Ensure no real workbook, `.env.local`, OAuth credential, token, generated build output, or test data is staged. Push only when ready; deploy only after review.
5. After deployment, test in a disposable browser profile and **disposable Sheet copy**: Connect Google → consent → paste Sheet URL → import/review/activate → finish a workout → confirm same Sheet gained one date in its intended E5:E16 grid → confirm local session says synced. Confirm no new Sheet was created. Add another Sheet by URL. Repeat with a friend's test-user account and her own disposable Sheet.
6. Verify installed PWA startup, offline access to already-imported training, workout recovery after reopening, history, backup/restore, disconnect/reconnect, and pending-sync retry. Keep canonical Sheets and original Excel fixtures untouched during testing.

The deployed production build currently predates this OAuth change. A local build or read-only smoke of the existing site does not validate real Google authorization or writes. [Earlier connector deployment instructions](../legacy/production-deploy-checklist-connector.md) are historical.
