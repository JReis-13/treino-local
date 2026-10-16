# Excel copy lifecycle regression evidence

This report uses only `tests/fixtures/mobile-audit.xlsx` and disposable synthetic variants. It does not establish the exact cause of the independent audit without that audit's load operations and workbook output.

## Confirmed defects and distinct partial outcomes

Before this change, exporting two different historical loads to one current-load cell retained only the latest value, but reconnect required each earlier value to equal that cell. An older session could therefore remain pending indefinitely. The adapter now verifies the latest safely associated target while retaining both actual historical strings. Per-block verification prevents one successful load from hiding a different failed load.

A disposable ambiguous grouped-load fixture reproduces **two dates verified / two sessions pending** legitimately: neither changed load has a safe destination. Those operations remain unresolved and the UI identifies loads as needing attention. The original audit did not specify its edits, so this condition must not be confused with a stale counter.

Two other reproducible writer defects were fixed: valid ISO completion dates failed a numeric-only date scan; filling a self-closing blank load cell consumed neighboring XML. Regression tests preserve every unrelated source cell and the existing package/fingerprint guards.

## Synthetic operation comparison

The browser journey saves two partial sessions through the real workout UI, including explicit Save load & complete. The fixture's existing January occurrence is preserved.

| Local session date | Prepared / verified date cell | Nova actual in History | Quartz actual in History | Workbook current-load readback | Receipt and pending result |
|---|---|---|---|---|---|
| 2026-10-01 | A!E6, exact Excel serial | 14kg | 2x9kg | G26=15kg; G28=2x10kg, later session targets | Date receipt; earlier load obligation not applicable after later readback |
| 2026-10-02 | A!E7, exact Excel serial | 15kg | 2x10kg | G26=15kg; G28=2x10kg | Date receipt and required loads verified |

Both receipts retain distinct slots and the same stable plan source identity. Pending is 2 after generation, 0 after correct readback and remains 0 after reload, repeated reconnect and a fresh browser context restored from the same local data. Offline reload preserves prepared evidence. Corrupting only G26 to 13kg verifies both dates but leaves 2 genuine partial sessions; reconnecting the correct copy resolves them without writing another date. Storage-failure injection prevents receipt persistence and reports retry guidance without losing sessions.

Unit coverage also exercises same-day Add/Replace, a missing previously verified date, stale loads with intact dates, competing claims for one slot, initially blank loads, backups, incompatible source structure and ambiguous grouped loads. Stats covers numeric, composite, empty and older ambiguous identity outcomes. Browser screenshots cover Source verified/partial and composite Stats at 320 and 393 px. Browser emulation and fresh contexts do not establish a physical Android/PWA restart result.

## Diagnostic TL-C5LD95PY

The read-only report identifies build `2d8eed4c-20261016T131924` in an installed PWA. Its active source is **Google**, not the Excel audit. The latest session has verified completion/load state and a receipt. It reports 8 historical pending sessions, 23 source occurrences and 23 active source-backed records, with reconciliation verified. Recent events include Google conflicts and successful syncs. It cannot identify the two Excel operations or confirm that audit's root cause.

To correlate the original case safely, a report captured while the affected Excel plan is active would need per-session date/load states, prepared-slot presence, receipt presence, prepared/verified load-target counts, mapping error codes and report-scoped export identity. Exact loads, names, workbook bytes, source URLs and full local-storage dumps are unnecessary.

## Verification boundaries

Automated tests use isolated browser storage, mocked account APIs, disposable workbook copies and read-only private fixture checks. No production database or Google Sheet is written. Full release results and deployed revision are recorded in the delivery report. Physical Android downloads/file picking, installed-PWA restart and direct file permissions remain separate manual checks. The browser cannot prove a download was actually saved; safe-copy synchronization still requires readback.
