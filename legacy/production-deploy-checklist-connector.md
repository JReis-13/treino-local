# First hosted deployment checklist

## Before deploy

- [ ] Run `pnpm dlx pnpm@10.34.6 install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:excel`, and `pnpm build`. Private workbook fixtures must stay outside Git; set `WORKBOOK_FIXTURE_DIR` if they are not in Downloads.
- [ ] Run `pnpm start` and open `http://localhost:3000` (or another chosen local port). Confirm `/`, `/plans`, `/workout`, `/history`, `/source`, `/settings`, `/debug`, the manifest, `/sw.js`, and `POST /api/google-connector`. For mobile automation, set `E2E_BASE_URL` to that origin and `E2E_PRODUCTION=1`, then run `pnpm test:e2e`.
- [ ] Confirm no key, `.env.local`, personal `.xlsx`, log, Playwright output, or build directory is staged. Confirm the original workbooks' SHA-256 hashes are unchanged. Ensure Git is committed and clean before pushing.
- [ ] Confirm a disposable Google Sheet connector works from local production mode. Do not run automated tests against a real Sheet.

## Private GitHub repository

1. On GitHub, create a **private** repository named `treino-local`. Leave **Add a README**, **.gitignore**, and **license** unchecked; the local repository already has its files.
2. If Git has no local author identity, run these commands with your own values:

   ```powershell
   git config --local user.name "YOUR_NAME"
   git config --local user.email "YOUR_GITHUB_EMAIL"
   git commit -m "feat: prepare workout app for first production deployment"
   ```

3. Push the private repository:

   ```powershell
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/treino-local.git
   git push -u origin main
   ```

Replace `YOUR_GITHUB_USERNAME` with your real account name. If a remote already exists, inspect `git remote -v` before adding another. Never make the repository public to work around an authentication problem.

## Vercel Hobby deployment

1. In Vercel, choose **Add New → Project** and import the private GitHub repository using the GitHub integration. Choose the **Hobby** plan.
2. Confirm framework **Next.js**, root directory **`.`**, Node.js **24.x**, and pnpm from `pnpm-lock.yaml`/`packageManager`. Keep the default Build Command (`pnpm build`), Install Command (`pnpm install`), and Output Directory (Next.js default; no override). The current MVP requires **no production secrets/environment variables**. If the build log selects an incompatible pnpm version, fix that package-manager setting before testing the deployment.
3. Deploy only when you intend to publish. Record the resulting HTTPS `*.vercel.app` URL and open `/debug` to check its build ID. No Vercel deployment was done while preparing this repository.

## First hosted smoke test

On desktop, open the production URL, then `/debug` and confirm the expected build ID. Import a **copy** of a workbook, activate the plan, perform a short test session, and confirm it appears in History after reload. Export a backup in Settings and validate a restore using a disposable browser profile. Check that `/api/google-connector` responds to a deliberately invalid target with a safe 400 response.

On a phone, open the HTTPS URL, navigate through Home, Plans, Source, and History, and install the PWA if supported. Reopen the installed app, start a workout, enter a test load, reload or reopen, and verify the in-progress state returns. Finish and confirm History. Test offline after the app has loaded online once. A later build should show **New version available — Reload**; choose when to reload.

For Google sync, use a **copy/test Sheet** first. Install the standalone v2 connector once from `script.google.com` with the documented manifest and deploy its `/exec` URL. On Plans, connect that URL/key, paste the **copy's normal Google Sheets URL**, and import. On Source, **Validate source** and **Enable sync**. Finish one test workout. Confirm that the **same Sheet copy** received exactly one date in its expected completion range, the app marks the session synced, and no new spreadsheet file was created. Then paste a second test Sheet URL without a new Apps Script deployment. Only after these tests succeed should you connect a canonical Sheet. Existing v1 plans may remain unchanged.
