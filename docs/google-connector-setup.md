# One Google connector per account

Treino Local v2 uses one **standalone** Apps Script project for the Google account that deploys it. After one-time setup, each additional training needs only its normal Google Sheets URL. The account running the script must have access to that Sheet. Each browser/device stores its own connector and workout history; the public Vercel app has no shared account or database.

## One-time setup

1. Go to [script.google.com](https://script.google.com), choose **New project**, and paste the complete [v2 source](../google-apps-script/WorkoutConnectorV2.gs) into `Code.gs`. This is a standalone project; do not create it from a Sheet's **Extensions** menu.
2. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace its contents with [the v2 manifest](../google-apps-script/appsscript.v2.json). It requests exactly `https://www.googleapis.com/auth/spreadsheets` for read/write access. It requests no Drive, Gmail, Calendar, Contacts, or Docs scope. This Sheets scope can access any spreadsheet the deploying account can access, so keep the deployment URL and key private.
3. Save, select `initializeConnector`, click **Run**, and authorize the requested spreadsheet scope. In **Project Settings → Script Properties**, copy `WORKOUT_CONNECTOR_KEY` privately. Do not paste it into code, a URL, a Sheet, a screenshot, or Git.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Copy the deployment URL ending in `/exec` (not `/dev`). If your account does not permit anonymous web apps, use the Excel path; the current proxy cannot forward a Google sign-in session.
5. In Treino Local **Plans → Google connection**, enter that `/exec` URL and key and choose **Connect Google connector**. Test with a disposable Sheet copy before connecting a canonical Sheet.

Hosted users do not need a Google Cloud Console project. The app sends credentials only to its same-origin `/api/google-connector` proxy for each request; it stores the v2 URL/key in this device's IndexedDB and never in Vercel environment variables.

## Future training plans

Open the Sheet in Google Sheets, copy its normal `https://docs.google.com/spreadsheets/d/…` URL, paste it in **Plans**, and choose **Import training**. The connector validates the ID, opens only that explicitly supplied Sheet, checks for `TREINO` tabs, and registers its ID in its script properties. The app then checks the supported layout before you save the plan. The Sheet identity stays with that plan, so refresh and sync do not need the URL again. If the deploying account lacks access, share the Sheet with that account or use another connector; the app does not discover or bypass Google permissions.

On **Source**, use **Validate source**, then **Enable sync**. Completion writes are limited to the first unoccupied date in `E5:E16` of the selected `TREINO` tab after the connector rechecks the mapping, sheet markers, date format, duplicate date, and occupancy. The browser never supplies a cell address. A source change, full grid, network failure, or denied permission leaves the local completed session intact and available for retry.

## Security and older connections

This is a bearer-key design. Anyone with both the `/exec` URL and key could ask this connector to register another spreadsheet ID that the deploying account can access. The connector-side registration list prevents unregistered IDs from being read or written during normal operation, but it **does not limit a stolen master key**. A per-Sheet token would add rotation and recovery complexity without removing the master key's broad scope, so v2 keeps one key. Run `rotateConnectorKey` and reconnect devices if it leaks; remove the web-app deployment to revoke the endpoint. Do not use this design if account-wide spreadsheet access is unacceptable.

Existing container-bound v1 plans continue using their saved per-plan key and bound `/exec` URL. **Plans → Existing bound-sheet connector (v1)** remains available. Migration is optional: configure v2 once, import the same Sheet URL as a separate plan, review it, and keep the old plan/history until satisfied. A copied Sheet no longer needs another connector deployment under v2; the standalone account must simply have access to the copy.

Automated tests use mocks and disposable local workbook copies. They do not write a real Google Sheet. Any hosted end-to-end write test must use a disposable Sheet copy and verify that same copy received one date.
