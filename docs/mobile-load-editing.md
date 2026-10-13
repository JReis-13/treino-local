# Mobile load editing and navigation reliability

Baseline `2f3e101`, reviewed 2026-10-13. No real phone storage, source workbook or production database was modified.

## Confirmed causes and behavior

- History's filter lived only in component state. The selected filter and last scroll position now use tab-session storage under the current social account identity, with a separate device-local scope. Account switches load that account's preference rather than copying the previous user's filter. Restoration captures the previous scroll position before Next navigation can replace it with zero. Storage failure does not block History.
- Friends cached authenticated activity but forgot a confirmed 401 on remount. An in-memory disconnected state now renders authentication-required UI immediately while checking again in the background. Successful account confirmation resets it; changed-account errors are not treated as confirmed disconnection. Existing account-owned activity remains visible during authenticated refresh. No account identity or activity is added to the disconnected cache.
- The workbook parser could return no workouts after content failures, and preview/activation had separate incomplete checks. Empty parsing now fails with supported-layout guidance. Preview and library activation/refresh share the usability guard. Unsafe partial imports show **Import needs review**, without activation. Supported instruction-only workouts remain valid; no exercises are invented. Detected header text is limited to known header words, never arbitrary workbook contents.
- Load Today previously saved every keystroke, including unfinished numbers, and normalized on blur. List, Focus and Details now share explicit confirmation. Numeric editing is conservative: plain numbers and complete kg/g/lb/lbs amounts separate the amount from a visible, accessible unit. Decimal commas and periods are accepted; incomplete decimals cannot be saved. Unknown units, ranges, paired weights and embedded notes remain complete text. **Edit full expression** allows an intentional change to text entry.

## Confirmation and drafts

Editing creates a separate draft keyed by session and logical exercise. It never changes Plan, Last Used, completed History or source cells. Drafts survive mode/exercise changes, Details close, app navigation and same-tab reload through separate session storage. Optional empty-load fields also reopen when a draft exists. They are excluded from diagnostics and ordinary training backups.

**Save load** shows saving, then saved only after the existing local persistence callback succeeds. Failures retain the draft and offer retry. Changed drafts cancel stale in-flight confirmation. Discard restores the confirmed value. Finish is disabled while drafts remain, and the provider independently rejects finalization, including Add/Replace, until edits are resolved. Confirmed writes are authoritative if draft-store cleanup fails; stale draft copies matching that new confirmed value are retired on reload. Cancelled/finished/missing sessions remove their drafts.

If draft storage fails, the editor warns that the draft is held in this tab only. The unload guard is a browser safeguard, not an Android OS guarantee. Closing a tab, storage denial or process termination still needs physical-device validation; save edits explicitly before closing. Source synchronization is separate from local confirmation and keeps its existing mapped-write/readback checks.

## Reusable, fully synthetic audit workbook

Use `tests/fixtures/mobile-audit.xlsx` as an Excel **safe copy**. It has one supported TREINO A sheet, three fictional warm-ups, six fictional strength exercises (including two pairs), synthetic guidance and one artificial 2001-01-02 source occurrence. Its load cases are `12kg`, `12,5 kg`, `2x8kg`, `20kg (17,5 no final)`, blank and numeric `16`. Missing video links are honest nonblocking warnings. It contains no private names, original notes, source URLs or creator metadata.

Optional regeneration: `node scripts/create-mobile-audit-fixture.mjs --render`. This authoring-only command requires the installed Codex bundled workbook SDK; it adds no application dependency. `CODEX_WORKBOOK_MODULES` can point to the verified bundled Node modules directory on another host. CI and Work audits can simply reuse the committed file. Fixed ZIP dates, stripped core metadata and normalized relationship IDs make exports repeatable on the tested SDK: two consecutive exports matched SHA-256 `003a6ba0e2353305d1d04d5dc6b62bde3f6255eccf96387f9d82a51745d2ca1e`. Preview and intermediate output stay in ignored `screenshots/mobile-load-audit/`.

## Verification

Start with `corepack pnpm workflow ui --plan` / `--run`; its seed now includes load-model and real fixture-pipeline tests. Target browser cases are `e2e/load-editing.spec.ts` and `e2e/navigation-reliability.spec.ts`. They check full safe-copy import/activation, simple and composite saves, unchanged Plan, future Last Used, notes, groups, drafts across views/reload, optional blank loads, failure/retry, failed cleanup, authenticated/disconnected Friends, scoped History filters/scroll, incompatible headers and zero-workout responses. Existing source-sync, same-day, History, privacy, PWA and Focus regressions remain part of the release gate in `docs/testing.md`.

The final local production browser suite passed 213 cases across Pixel-like, iPhone-like and 320px Chrome emulation. New load captures include 320px and 393px; these do not prove physical Android keyboard behavior. Ordinary units passed 135, private read-only workbook audits 32, UI seed 27 and workflow tests 6. Frozen install, warning-free lint, typecheck and production build PASS. Two database checks, live authenticated integrations and physical Android are NOT RUN. Final deployed revision/smoke results are reported with delivery.
