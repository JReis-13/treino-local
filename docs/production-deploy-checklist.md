# OAuth production deployment checklist

## Short real-phone check for this bug-bash release

Use a disposable workout with at least four exercises and one grouped pair. Do not use a canonical Sheet or workbook for test writes.

1. Enter Focus, navigate to the second exercise, and tap Complete **once**. Switch to List: only that exercise should be complete. Return to Focus, undo it, and confirm all other states stayed unchanged.
2. Complete one member of the grouped pair. Confirm its partner is still pending and its load is unchanged.
3. On different exercises, use Do later, Skip today, and Complete. Reload or reopen the installed PWA and check the exact queue, completion, skip, load, note, and timer state.
4. Finish a test workout. Add a real phone photo, wait for the preview, then tap Share workout. Confirm the native sheet opens; choose WhatsApp and verify the image is attached where this phone/target supports files. Cancel before sending if desired. If image sharing fails, tap Share text instead once and confirm text sharing opens.
5. Return to History and confirm the workout and its note remain saved. During this run, check that List and Focus feel calm, the Complete action is easy to reach, Details holds video/notes, and the bottom navigation and timer do not cover controls.

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

## Exercise Detail, notes, and rest timer phone check

Use the installed PWA and a disposable training source. Keep canonical Sheets and Excel workbooks untouched.

1. Open the installed PWA and start a workout.
2. Open Exercise Detail, then tap Watch execution on an exercise with a video.
3. Play the inline video, close Detail, and confirm playback and audio stop.
4. Open the exercise's History tab and check recent actual loads and the highest comparable load.
5. Add a persistent exercise note, close Detail, reopen it, and confirm the note remains.
6. Mark an exercise complete. Where the plan gives rest guidance, start the suggested timer.
7. Scroll and navigate while checking that the compact timer remains above navigation.
8. Lock the phone, wait, reopen it, and confirm the timer advanced by elapsed real time.
9. Add 30 seconds, pause and resume, then let the timer finish or skip it.
10. Add an optional workout note on Finish Workout and save; confirm the timer disappears.
11. Open History, check the short note preview, then open the session for the full note.
12. Go offline. Confirm Exercise Detail, History, notes, and timer still work; video shows an internet-required message and retains the Open in YouTube fallback.

Check portrait and landscape video, the phone keyboard with note/load fields, long names and notes, and bottom safe-area spacing. Embedded playback depends on each video's own YouTube settings; the external fallback is always available.

## Workout sharing phone check

Use a disposable workout in a normal phone browser, then repeat the share-sheet check from the installed PWA. The phone chooses the share destination and recipient; browser and OS support for sending an image together with text varies.

1. Complete a test workout and save it. Confirm the share screen appears only after the session is already present in History.
2. Inspect the card and default message: name, local date, actual duration and exercise count where available. Confirm loads, notes, account and source details are absent. Confirm there is no download/save-card action.
3. Tap **Add photo** and use the phone's camera/gallery chooser. Check a portrait, landscape, and square photo, then **Change photo** and **Remove photo**. The card should crop centrally without distortion; your edited message must stay unchanged.
4. Edit the message and tap **Share workout**. Confirm the native share sheet opens, choose WhatsApp manually, then choose a recipient manually. Check whether this device sends both PNG and text; some targets accept only one.
5. Cancel before sending and return to Treino Local. Confirm the workout remains saved. Open its History detail and share the same workout again with a new transient photo.
6. Save another workout and tap **Not now**. Confirm no later share prompt appears and no photo is stored in History or backup.
7. Go offline and open a saved workout's share view. Confirm the card, photo processing, and message work. If Web Share is unavailable, confirm the app shows a calm unsupported message without a download action.
8. Inspect an imported date-only History entry. Its card must omit duration and exercise counts. Check long workout names, accents, emoji, 320px width, keyboard opening and bottom safe area.

## Focus and session queue phone check

Use a disposable workout. The source plan is authoritative; queue and skip actions are local session decisions. For Google and Excel, verify the source order on a disposable copy rather than a canonical file.

1. Start a workout.
2. Enter Focus Mode.
3. Verify the current exercise, prescription, equipment, video and any note indicator.
4. Change today's load, including with the keyboard open on a short viewport.
5. Return to List and verify the same load.
6. Change the load in List and return to Focus; verify the new value.
7. Tap Do later on the current exercise and confirm the next exercise appears.
8. Check List and verify the moved exercise is at the end of today's remaining queue.
9. Undo Do later, then move it again; confirm there is exactly one instance.
10. Skip an exercise today and confirm the lightweight confirmation explains the session-only effect.
11. Confirm the skipped exercise disappears from the remaining queue but remains visible in List.
12. Undo skip in List and verify it is eligible again in Focus.
13. Skip it again and confirm the completed count does not rise.
14. Complete an exercise in Focus and confirm the next eligible one appears.
15. Start the suggested rest timer; confirm the next exercise stays usable.
16. Use Previous and Next without changing completion state.
17. Lock and reopen the phone; confirm Focus, queue, loads, skip and timer state persist.
18. Go offline and repeat Do later, Skip today and load editing.
19. Finish and save the workout; check the completed and skipped totals.
20. Open History detail and confirm skipped exercises are labelled, not shown as completed.
21. Check Statistics and the share card: only completed exercises count.
22. Start the same workout again; verify original plan order and no inherited skips.
23. Verify a grouped pair moves together while its two loads and completion states remain separate.
24. Verify Google Sheet and Excel source order are unchanged, with no new plan version.
25. Check 320px, Pixel-sized and iPhone-sized layouts, safe area, long names, video fallback and phone Back from Focus to List.
