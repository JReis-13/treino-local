# Treino Local

## Mobile workout tracking (October 2026)

The exercise completion circle and its label are one large accessible toggle; tap again to undo. During a workout, **Current source** is the plan's load, **Last used** is the most recent actual load saved locally for that plan and exercise, and the editable field is the load used in this session. Starting a workout prefers the last local actual load, then the source load. Clean decimal commas such as `7,5` are stored as `7.5`; arbitrary text remains text. A completed session's actual load can be corrected from History. Corrections to older sessions stay local because they are not necessarily the source's current load.

Saving the same workout on the same date asks to **Add another workout**, **Replace previous workout**, or **Cancel**. Add creates a separate stable session ID; Replace retains the chosen session ID and any verified source date receipt, so it does not append another source date. Google and Excel can write another identical date into the next validated empty slot after Add. Each workbook has only 12 date slots per workout; full or ambiguous source grids leave the local session safe. Dates and loads have separate sync states, so a successful date write cannot hide a failed load write.

When a completed exercise's actual load differs from the source load, an OAuth-connected Google Sheet is updated through the server only at a parser-derived field, then read back. The server checks the approved account, signed source identity, workout structure, current load, and target cell. Excel sync uses the same mapped field in a verified direct write or a safe downloaded copy. A downloaded copy remains pending until reconnected and checked. Slash-separated pairs and distinct G/H/I columns are updated individually; ambiguous or formula load cells are left local. Source loads in the saved plan refresh after a verified write or reconnect. The older Apps Script connector supports dates only; migrate it to OAuth for load sync.

**Statistics** uses local plan and session records, including imported completion dates for workout counts. Imported dates have no invented duration or actual load. Duration, frequency, workout mix, and comparable numeric load trends are shown with plan, workout, and date filters. Statistics works offline and adds no cloud workout database. History shows separate same-day sessions and their save times. Export a fresh backup from Settings before changing devices or clearing browser data.

Mobile-first, local-first workout app. Import a supported training workbook once, then use the saved plan without keeping the source open or being online. Each browser/device has its own plan library, active plan, in-progress workouts, and history. Google Sheets is the preferred optional sync source; local Excel is also supported. Google authorization is only for Sheet access; there is no Treino Local cloud account or database.

## Run

The Vercel build targets Node.js 24 and pnpm 10.34.6. To reproduce its dependency install locally in PowerShell:

```powershell
pnpm dlx pnpm@10.34.6 install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local` and fill the developer-only OAuth values before testing Google locally. Open `http://localhost:3000`. A physical phone can use the app over private Wi-Fi with `pnpm dev:lan`, but Google OAuth is available only at its exact configured `localhost:3000` or production redirect origin; test phone OAuth on the production HTTPS site. See [the developer setup](docs/google-oauth-developer-setup.md).

To exercise the actual production Next.js runtime locally:

```powershell
pnpm build
pnpm start
```

Open `http://localhost:3000`. The build includes Node.js Route Handlers for Google OAuth and Sheets access. It also creates a versioned service worker; videos and Google access still require a connection.

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

First launch shows **Choose your training** with Google Sheet and Excel options. In **Plans**, tap **Connect Google**, choose an approved Google account, approve access, paste a Sheet URL that account can access, import, review, and use the plan. The developer sets `GOOGLE_ALLOWED_EMAILS` server-side; only those accounts may use the Google integration. A friend needs no Cloud, Vercel, GitHub, or Apps Script setup. During Google's Testing phase, approved accounts must also be Test users; after the developer moves OAuth to In production, Treino Local's allowlist remains the access control. The public PWA and local/Excel features remain usable without Google. **History** and **Source** preserve local completion and pending sync; **Settings** disconnects Google and exports/restores local data without credentials.

The app supports the reviewed `TREINO 1 JONATHA.xlsx` A/B plan and `TREINO 4 MILENA.xlsx` A/B/C plan. It reads only workout sheets, so overview/profile data stays out of the plan library. It shows import warnings for uncertain shared/grouped fields and blocks unsupported layouts. Workout C is rendered as weekly instruction blocks. Import uses formatted display values for semantically textual cells, including Milena's date-encoded `7.5` load. Previously entered completion dates appear in History but do not become editable app sessions. Local sessions store a snapshot of their plan version so refresh does not rewrite history.

Google import uses a server-side OAuth authorization-code flow and the Sheets API. Tokens stay in an encrypted, authenticated HttpOnly cookie; browser plan records contain only source metadata and a signed source proof. Completion saves locally first, then writes a numeric date into the first parser-derived empty slot and reads it back. Existing Apps Script plans remain usable locally and offer **Reconnect with Google** migration; their connector code is [legacy/deprecated](docs/google-connector-setup.md). A compatible browser can retain an Excel file handle in IndexedDB and update that selected file directly after permission and readback verification. Otherwise the app downloads a safe updated copy and keeps local sessions pending until the saved copy is reconnected and verified. Original supplied workbooks must never be selected for write testing.

Google ID tokens are verified server-side, and the verified email is checked against the current allowlist on connection and every Sheets request. Old connections require a one-time reconnect. Google publishing status governs OAuth availability and verification; it does not grant Treino Local access. See the [manual production transition](docs/google-oauth-developer-setup.md#moving-treino-local-from-testing-to-in-production).

Architecture and source details: [specification](docs/workout-app-spec.md), [Google OAuth developer setup](docs/google-oauth-developer-setup.md), [Excel adapter](docs/excel-adapter.md), [deployment preparation](docs/deployment.md), and [hosted deployment checklist](docs/production-deploy-checklist.md).
