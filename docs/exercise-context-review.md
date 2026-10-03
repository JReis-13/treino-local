# Exercise context mobile review

| Mockup screen | Implemented behavior | Intentional difference |
| --- | --- | --- |
| 1. Workout list | Completion, prescription, loads, Details and Video stay on compact cards. | Equipment and longer context live in Detail. |
| 2. Video sheet | Video opens inside Exercise Detail on demand, with a privacy-enhanced embed and YouTube fallback. | No source-provided HTML or automatic player loading. |
| 3. Exercise overview | Prescription, equipment, current/previous/session loads, video action and completion appear together. | Unrequested video stays a short action row to keep loads near the top. |
| 4. Exercise history | Up to five recent actual loads, a compact trend, and highest comparable load. | Mixed units or absent numeric history do not produce a misleading high. |
| 5. Exercise notes | One editable local note per plan and normalized exercise name, available offline and in backups. | Per-session exercise notes are deferred to keep the journal simple. |
| 6. Completion and rest | Explicit rest guidance offers a Start button after a strength exercise is completed. | A range uses its upper end and says so; rest never starts automatically. |
| 7. Rest timer | Timestamp-based countdown with pause, resume, skip, +30 seconds and +1 minute. | No background job, permission request or push notification. |
| 8. Compact timer | Persistent strip above phone navigation while an active session has a timer. | The sticky Finish action becomes part of the scroll flow while the timer strip is present, avoiding stacked overlays. |
| 9. Workout note | Optional local note on Finish, saved with the session. | The note does not sync to the training source. |
| 10. History notes | Short preview in History and full note in session details. | Long text is truncated only in the list. |

All modal, timer, notes and history states were reviewed in 320px, Pixel 7-like and iPhone 13-like browser emulation. The installed-PWA checks for actual video playback, phone locking, physical keyboard and safe areas are in [the production checklist](production-deploy-checklist.md).

Per-session exercise notes and a deep link from Exercise Detail to a prefiltered Statistics view were deferred. The persistent exercise note and local History tab cover the immediate gym use case without changing the existing Statistics filters.
