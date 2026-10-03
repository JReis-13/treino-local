# Mobile UI review

The phone mockup guided interaction order, density, and emphasis. Labels and values remain tied to the imported plan and recorded sessions.

| Screen | Mockup goal | What changed | Intentional deviation |
| --- | --- | --- | --- |
| Workout | Progress and exercise controls visible during training | Compact header, elapsed time, progress, large completion target, direct session-load field, and reachable finish action | Existing Treino Local colors and five-item navigation remain; load steppers were omitted because source units and increments vary. |
| Exercise completed | Calm success with easy undo | Completed card and toggle show a clear green state and immediate feedback; the same toggle reopens it | Text feedback is kept for accessibility. |
| Same-day save | Focused choice between Add, Replace, and Cancel | Mobile sheet shows the prior session's date, time, duration when available, and completion count with distinct actions | Missing duration is never invented. |
| History | Separate, scannable sessions by day | Grouped compact rows show workout, time, duration when available, and secondary sync status | Imported dates remain visible with their limited available data. |
| Statistics | Compact filters, metrics, and phone-width trends | Small plan/range filters, summary cards, readable chart cards, load selector, and first/latest/highest values | A trend waits for enough recorded values; missing legacy duration or load is not treated as zero. |
| Plans | Current training and Add training first | Compact active-plan card, primary Add training action, simple other-plan rows, small Google status, and management disclosures | Source management remains reachable without dominating daily use. |
| Choose source | One focused source decision | Google Sheets and Excel appear as large, direct choice rows | An optional safe-copy Excel action remains when the device supports direct workbook access. |
| Google URL import | Short path from connection to Sheet link | Focused source screen with connection state, link field when connected, and feedback near its action | Google sign-in is still required where needed. |
| Import progress | Clear status after submission | Importing replaces the source form with a visible progress state and disables repeat submission | Progress represents workflow stages rather than fabricated percentages. |
| Import review | Essential counts and immediate activation | Workout/exercise/history counts, collapsed nonblocking notes, prominent blockers, and Use this training CTA | Technical coordinates stay in expandable details; activation safety remains unchanged. |

Screenshots were reviewed at 320px, Pixel 7-like, and iPhone 13-like emulated viewports, including large text, a short viewport with focused load input, import notes, charts, and the same-day sheet. Physical-device keyboard and safe-area checks remain for the release owner.
