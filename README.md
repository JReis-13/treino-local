# Treino Local

Mobile-first, local-first workout app. Import a supported training workbook once, then use the saved plan without keeping the source open or being online. Each browser/device has its own plan library, active plan, in-progress workouts, and history. Google Sheets is the preferred optional sync source; local Excel is also supported. No account, server-side database, or paid storage is needed.

## Run

The Vercel build targets Node.js 24 and pnpm 10.34.6. To reproduce its dependency install locally in PowerShell:

```powershell
pnpm dlx pnpm@10.34.6 install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. For a physical phone on the same private Wi-Fi, run `pnpm dev:lan` and open the printed `http://<computer-ip>:3000` address. Set `TREINO_LAN_HOST` to the PC's Wi-Fi IPv4 address if automatic detection chooses the wrong adapter. Next.js serves the same-origin Google connector route in both modes. See [the phone checklist](docs/pre-deploy-checklist.md) for the exact retest.

To exercise the actual production Next.js runtime locally:

```powershell
pnpm build
pnpm start
```

Open `http://localhost:3000`. The build prerenders ordinary pages and includes a Node.js Route Handler for `/api/google-connector`. It also creates a versioned service worker; videos and Google access still require a connection.

## Checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:excel
pnpm build
$env:E2E_BASE_URL='http://localhost:3000'; $env:E2E_PRODUCTION='1'; pnpm test:e2e
```

Run the mobile E2E command against `http://localhost:3000` or the printed LAN URL while `pnpm dev` / `pnpm dev:lan` runs to test development mode; unset `E2E_PRODUCTION` in that case. Playwright uses installed Chrome, emulating Pixel 7 and iPhone 13 sized browsers. Workbook tests use the two originals as **read-only local fixtures**, write only disposable temporary copies, and check source hashes. Set `WORKBOOK_FIXTURE_DIR` to their directory when they are not in the user's Downloads folder. Tests fail with a clear message when private fixtures are absent; no workbook is committed or bundled.

## Using the app

First launch shows **Choose your training** with Google Sheet and Excel options. After import, Home opens the last active plan and lists whatever workouts the workbook contains. **Plans** lets you switch, refresh, rename, or remove a plan. Removing it requires confirmation and retains completed local sessions. **History** filters by plan, including imported completion dates. **Source** validates the connected workbook or Sheet and retries pending completion-date sync. **Settings** exports and restores local plans and history without connector secrets. `/debug/` shows client, storage, service worker, and connection diagnostics without credentials.

The app supports the reviewed `TREINO 1 JONATHA.xlsx` A/B plan and `TREINO 4 MILENA.xlsx` A/B/C plan. It reads only workout sheets, so overview/profile data stays out of the plan library. It shows import warnings for uncertain shared/grouped fields and blocks unsupported layouts. Workout C is rendered as weekly instruction blocks. Import uses formatted display values for semantically textual cells, including Milena's date-encoded `7.5` load. Previously entered completion dates appear in History but do not become editable app sessions. Local sessions store a snapshot of their plan version so refresh does not rewrite history.

Google import uses [one standalone Apps Script connector per Google account](docs/google-connector-setup.md). Set it up once on each device, then paste a normal Google Sheets URL for each new plan. Existing container-bound v1 plans remain supported. There is no Google Cloud Console or Picker setup. Sync is off until **Validate source** and **Enable sync** are used. The connection key stays in browser IndexedDB and is never committed to the repository. A compatible browser can retain an Excel file handle in IndexedDB and update that selected file directly after permission and readback verification. Otherwise the app downloads a safe updated copy and keeps local sessions pending until the saved copy is reconnected and verified. Original supplied workbooks must never be selected for write testing.

Architecture and source details: [specification](docs/workout-app-spec.md), [Excel adapter](docs/excel-adapter.md), [deployment preparation](docs/deployment.md), and [hosted deployment checklist](docs/production-deploy-checklist.md).
