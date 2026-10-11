# History integrity investigation (2026-10-11)

Diagnostic `TL-LYRN6RFH` was recorded on build `fed2ba30` with Jonatha selected. It reports nine verified current source records, nine active source-backed records, zero local-only records, zero removed occurrences, zero ambiguous matches, and zero pending stale writes. The same report does not contain per-occurrence statuses or Home's displayed value. Its two hidden legacy dates are an aggregate across both saved plans. Therefore it confirms that the nine dates reached the selected plan but cannot identify which, if any, was absent from the phone's Home count.

The local private Jonatha workbook files available to this checkout are older than the user-confirmed nine-date source. The parser regression test inserts the nine user-confirmed dates into an in-memory copy of the private workbook, without writing it back. The table below is that reproducible source-to-Home baseline; it is **not** a claim about the inaccessible phone's individual rows. An identity consists of workout, source slot, and date; the app also retains its source-specific occurrence ID.

| Source occurrence | Date | Parsed identity | Reconciliation in test | Home in test | Phone row status |
|---|---|---|---|---|---|
| TREINO A!E5 | 2026-09-12 | A!E5:2026-09-12 | source record | included | unavailable |
| TREINO A!E6 | 2026-09-19 | A!E6:2026-09-19 | source record | included | unavailable |
| TREINO A!E7 | 2026-09-26 | A!E7:2026-09-26 | source record | included | unavailable |
| TREINO A!E8 | 2026-10-03 | A!E8:2026-10-03 | source record | included | unavailable |
| TREINO A!E9 | 2026-10-10 | A!E9:2026-10-10 | source record | included | unavailable |
| TREINO B!E5 | 2026-09-15 | B!E5:2026-09-15 | source record | included | unavailable |
| TREINO B!E6 | 2026-09-23 | B!E6:2026-09-23 | source record | included | unavailable |
| TREINO B!E7 | 2026-09-30 | B!E7:2026-09-30 | source record | included | unavailable |
| TREINO B!E8 | 2026-10-07 | B!E8:2026-10-07 | source record | included | unavailable |

All nine parse as distinct occurrences and yield nine visible completed sessions. In a separate counterfactual test, hiding A!E9 produces eight visible sessions while the Sheet still has nine. This demonstrates a possible mechanism; it does **not** establish that A!E9 was hidden on the phone. The old Home selector also collapsed a same-workout, same-day local session into a source record without an exact source receipt. The new shared selector only merges a local session with its exact source receipt, or a legacy synced session when the source match is unambiguous. A pending same-day local workout remains distinct.

Regression tests cover repeated refresh, local-storage reload, plan switching between Jonatha and Milena, offline count persistence, source deletion and readdition, and exact receipt matching. They verify that a removed date changes the active source count without rewriting a preserved local session, and that restoring it returns the source count. The phone's exact omitted occurrence remains unknown. To identify it, obtain a fresh diagnostic from this build with bounded per-occurrence status, or read the on-device `/debug` Source occurrence check. Neither requires a complete local-storage dump.
