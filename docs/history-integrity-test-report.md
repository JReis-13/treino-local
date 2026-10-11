# History recovery investigation — 2026-10-11

## Physical-phone evidence

TL-AHFXRTKL (11:27:34 UTC) and TL-KFU64UC4 (12:10:20 UTC) were retrieved read-only using the configured database. Both identify build 94cbd564-20261011T111243, selected Jonatha template/parser v3, nine current source occurrences, eight visible History sessions, no local-only sessions, no removed/archived source occurrences, no ambiguous matches, and no stale pending writes. Both follow a successful source refresh. The two hidden dates in their storage summary cover both saved plans; the per-occurrence projection isolates the selected plan's one exclusion.

This comparison combines the reports' safe workout-index/row/status fields with the user's independently verified source dates. Uploaded reports contain neither these dates nor private titles. The readable identity is workout + source slot + date; opaque source IDs are not disclosed.

| Workout | Date | Parsed identity | Source present | Verified local session | History/Home | Hidden reason / merge |
|---|---|---|---|---|---|---|
| A | 2026-09-12 | A!E5:2026-09-12 | yes | no | included | source record |
| A | 2026-09-19 | A!E6:2026-09-19 | yes | no | included | source record |
| A | 2026-09-26 | A!E7:2026-09-26 | yes | no | included | source record |
| A | 2026-10-03 | A!E8:2026-10-03 | yes | no | **excluded** | local hidden/deletion state |
| A | 2026-10-10 | A!E9:2026-10-10 | yes | yes | included once | represented by linked local session |
| B | 2026-09-15 | B!E5:2026-09-15 | yes | no | included | source record |
| B | 2026-09-23 | B!E6:2026-09-23 | yes | no | included | source record |
| B | 2026-09-30 | B!E7:2026-09-30 | yes | no | included | source record |
| B | 2026-10-07 | B!E8:2026-10-07 | yes | yes | included once | represented by linked local session |

**The missing occurrence is A!E8, October 3, not October 10.** It reaches the source snapshot and parser but is excluded by the local History visibility/deletion projection. Reconciliation reports no source removal or archival conflict. Six source-only entries plus two linked sessions explain eight. Home and History use the shared count selector; Stats uses the same History entries.

## What remains unproven

These older reports encode only hidden, without deletion provenance. They cannot distinguish a persistent tombstone from pending deletion, establish intentional user deletion, or date its creation. No deletion event survives in their bounded logs. Persistence across reports 42 minutes apart makes a normal 15-second Undo window unlikely, but does not prove its origin. Current code creates persistent tombstones only through local History deletion; reconciliation preserves them rather than generating them. An old implementation, restored backup, or earlier user action cannot be ruled out.

Automatic restoration is therefore inappropriate. Additional safe metadata now includes an allowlisted reason (PENDING_DELETION, HISTORY_DELETE, LEGACY_UNATTRIBUTED, SOURCE_LINKED_LOCAL, SOURCE_RECORD, RECONCILIATION_CONFLICT) and reviewed boolean. No storage dump is needed. Future explicit deletions save local reason/time; legacy tombstones stay honestly unattributed.

## Recovery and invariants

Home links unreviewed exclusions to History review. It shows workout/date, last verified source presence, precise reason, Restore source date and Keep hidden. Pending Undo cannot be restored through this action. Only a current Google snapshot with successful reconciliation can be recovered. Recovery removes the exact matching local tombstone; it does not append source dates, create detailed sessions, publish social activity, write Google, or change existing session IDs, loads or notes. Expired deleted details are not invented. Keep hidden acknowledges the discrepancy without changing the count; review remains available in History.

New intentional deletions are acknowledged and never restored on refresh. Unknown old tombstones require explicit review. Repeated Restore cannot create duplicates. A verified local receipt represents its source occurrence once; independent local-only sessions remain additional sessions.

## Reproducible verification

The older private Jonatha fixture does not itself contain this current nine-date snapshot. The private parser audit inserts exactly the nine user-confirmed dates into an in-memory copy, preserving the original workbook. All nine parse distinctly. Recovery regression seeds A!E8 hidden and A!E9 linked locally: source stays 9, Home/History/Stats project 8, Keep hidden stays 8, explicit Restore yields 9 without changing source arrays or existing session details. Mobile E2E renders these states, switches to a separate Milena plan, reloads, and restores October 3.

Existing tests additionally cover repeated refresh, source removal/readdition, archived detailed records, same-day Add/Replace, receipt-only merging, pending local sessions, copied plan lineage isolation, offline persistence, deletion Undo, and migration. No real History was modified. Deployment gives the phone an explicit recovery path; it does not remotely change phone storage.

## Quality gate

Frozen-lockfile installation, lint, standalone TypeScript and the production build passed. The full unit/integration suite passed 132 tests; private Jonatha/Milena audits passed 32. Social/push database integration passed, including mismatched-account read rejection, with synthetic records cleaned up. The production-runtime browser suite passed 156 tests across Pixel 7, iPhone-like Chrome and 320px Chrome. After the final active-tab and recoverable-retry refinements, 21 targeted mobile tests passed on the final build. Screenshot review covered Home with nine dates and hidden review, recovered History, initial/multiple/cached Friends, friend history, management/pending removal, Diagnostics, and navigation at 320/393/430/390px. No horizontal overflow or undersized navigation targets was found.

Still requires physical-phone acceptance after updating: explicitly Restore Workout A October 3 if desired, verify Home/History/Stats show nine, and check Friends return behavior using the real signed-in account. The old tombstone's creation intent remains unavailable in the two older reports.
