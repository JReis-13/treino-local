# Workout app: architecture and workbook analysis

## Current implementation (September 2026)

The original analysis below is retained as a historical audit of the Jonatha workbook. Its sections labelled “proposed,” especially the single-plan model and copy-only export, describe the first design and are superseded by this implementation summary.

`types/training.ts` defines schema version 2: a local library of stable-ID `TrainingPlanRecord`s, an `activePlanId`, plan-scoped sessions with a `planVersion` and immutable workout snapshot, and imported `legacyCompletions`. Plan blocks are either structured exercises or instruction text. Workout IDs and completion slots are parsed from each supported source; the UI has no A/B-only or 12-slot assumption. The old `treino-local:v1` data migrates to a `legacy-jonatha` plan, preserving completed and in-progress sessions, loads, dates, and sync status. Invalid stored data blocks writes rather than being replaced. LocalStorage holds small normalized records; IndexedDB holds optional browser file handles. Removing a plan keeps completed sessions and archives its imported dates for the all-plan history filter.

The source pipeline is `.xlsx` OOXML or a Google Sheet connector → `SourceSnapshot` → explicit workbook-family parser → normalized plan → local library. It recognizes the two reviewed workbook variants and rejects unknown layouts. Only `TREINO` sheets are read as workouts; overview/profile, medical, and nutrition fields are not imported. Warnings carry source locations and one of four severities: `info`, `warning`, `syncBlocker`, or `activationBlocker`. An uncertain completion grid disables source sync but leaves identified workouts usable locally; only unidentifiable workout content blocks activation. A refresh shows a change summary, increments plan version, and preserves session snapshots. Imported dates appear in History and counts, deduplicated against matching local sessions. They are read-only source records, not fabricated workouts.

Google Sheets is the preferred optional canonical source. A standalone v2 Apps Script runs under one deploying Google account, opens explicitly supplied and registered spreadsheet IDs, and uses one device-level URL/key for multiple plans. The manifest requests only `https://www.googleapis.com/auth/spreadsheets`; no Drive or unrelated Google scope is requested. Existing container-bound v1 plans remain supported. The browser keeps keys in IndexedDB and calls a same-origin Vercel proxy with narrow operations. Source sync starts disabled; **Validate source** compares the current workout fingerprint and connector mapping identifier, then **Enable sync** permits completion-date updates. The script takes a lock, re-reads the workbook structure and bounded date grid, selects only the first empty `E5:E16` cell on the named `TREINO` tab, writes one date, and reads it back. A changed source, duplicate date, occupied/full range, invalid key, network failure, or write failure leaves the completed local session intact. Automated tests use mocks; no real Google Sheet was written. **Settings** exports and restores local data with connector URL/key excluded.

Local Excel is the alternative. A secure browser with File System Access can save a chosen file handle in IndexedDB and prefer direct update after permission, validation, package-preserving OOXML edit, and readback. Otherwise a safe updated copy is downloaded; local sync remains pending until that saved copy is reconnected and verified. Only parser-derived completion mappings are used. Source fingerprint excludes completion values so filling a date does not appear to change the workout itself. Local history is unlimited even if workbook slots are full.

The app now uses a normal Next.js build: ordinary pages are prerendered, while `/api/google-connector` runs as a server-side POST Route Handler. Workout state changes remain client-side. `/debug/` exposes a nonsecret build ID, origin, storage, service worker, capabilities, active plan/session, and a copyable redacted diagnostic report. A dev server reached through its LAN IP previously blocked Next development resources from that origin, preventing hydration and making taps inert; `pnpm dev:lan` configures the detected private IP as an allowed dev origin. The production worker precaches versioned assets, bypasses connector requests, checks for updates on visibility, and waits for the user to reload after any in-progress workout. Development unregisters any prior production worker and clears the app cache.

### Second workbook: TREINO 4 MILENA.xlsx

The independently inspected file has an overview sheet plus `TREINO A`, `TREINO B`, and `TREINO C`. A/B include three-exercise rows at 26, 28, and 30, a two-exercise row at 32, challenge content, adjacent load/link columns, and sometimes one shared prescription. C has three weekly instruction blocks rather than strength cards. The existing date grids contain 6 A, 6 B, and 8 C entries. The parser keeps source calories and occurrence RIR separate from exercise prescriptions. `TREINO A!H28` is internally a date-like numeric value formatted to display `7.5`; load-field semantics preserve `7.5` and issue a review warning rather than displaying a calendar date. Review warnings also identify shared prescriptions in A/B rows 26/28/30, an uncertain A row 32 load mapping, and an extra B row 33 video. Source notes such as `config flexora: 0, S` are preserved as instructions. No overview profile fields are copied.

Current validation includes parser/migration/source-sync unit tests, disposable-copy Excel preservation tests, and Pixel 7/iPhone-sized browser flows in development and the real production Next.js runtime. The physical-phone LAN flow and a real Apps Script connection have also been tested by the user; hosted HTTPS behaviour remains to be checked after deployment using `docs/production-deploy-checklist.md`.

Status: **architectural source document from the pre-implementation review**. The MVP implementation is described in `README.md`; the workbook findings and open questions below remain the source of truth. This analysis used the original local Jonatha workbook in read-only mode on 30 September 2026. The repository does not contain the original workbook. Source SHA-256: `B3B8CCF292F13AA8DF5646F9838FAE70DFA4677CB6DB80ED833C5B787D31748F`.

## 1. Workbook overview and worksheet inventory

| Sheet | Purpose and meaningful content | Excel-reported dimension | Actual nonempty cells | Other objects |
| --- | --- | --- | ---: | --- |
| `JONATHA` | Profile, goal, scheduling notes, workout-completion dashboard; content in `B1:I17` (first actual value `C1`) | `A1:S28` | 33 | 4 formulas, 2 Excel tables, 7 images, 7 merges |
| `TREINO A` | A date/RIR grid and the A warm-up/strength plan; content in `B1:K32` | `A1:N35` | 81 | 11 hyperlinks, 1 image, 7 merges |
| `TREINO B` | B date/RIR grid and the B warm-up/strength plan; content in `B1:K32` | `A1:AA992` | 77 | 11 hyperlinks, 1 image, 7 merges |

All three sheets are visible. There are no hidden rows or columns, defined names, data validations, active worksheet protection, charts, external workbook links, or cell comments. The date cells have the ordinary `locked` cell flag, but no sheet protection is enabled, so that flag does not currently block editing. The `.xlsx` ZIP container passed integrity checking. The two `JONATHA` tables are `Table_1` at `G8:I15` and `Table_2` at `G19:I19`; they are not workout-history tables. No workbook table covers the date grids or exercise plans.

`TREINO B` is the major used-range trap: **957 styled but empty cells occur below row 35**, including cells through row 992, and the dimension extends to column `AA`; meaningful values stop at row 32 and column `K`. `TREINO A` has 369 styled empty cells and `JONATHA` 295. A parser must inspect values and explicit expected sections, never treat `max_row`, `max_column`, or `usedRange` as records. The visible blocks use merged cells: `JONATHA` has `C1:S2`, `E5:F6`, `J5:M6`, `E8:F9`, `J8:M9`, `J11:M12`, `J14:M15`; A has `C1:J2`, `E23:I23`, `G25:H25`, `J25:K25`, `E27:H27`, `E29:H29`, `E31:H31`; B has the same workout merges except `C1:T2` replaces the title merge. These are presentation structures, not data records.

## 2. Completion dates and dashboard logic

| Workout | Ordinals | Date destination | RIR schedule | Dashboard counter | Current state |
| --- | --- | --- | --- | --- | --- |
| A | `TREINO A!D5:D16` = 1st–12th | `TREINO A!E5:E16` | `TREINO A!G5:G16` | `JONATHA!I11` = `COUNT('TREINO A'!E5:E16)` | 12 empty date cells; cached count 0 |
| B | `TREINO B!D5:D16` = 1st–12th | `TREINO B!E5:E16` | `TREINO B!G5:G16` | `JONATHA!I12` = `COUNT('TREINO B'!E5:E16)` | 12 empty date cells; cached count 0 |

The date cells are blank but styled with `dd/mm`; `JONATHA!B5` demonstrates that the file stores actual Excel dates, even though it displays day/month. The counters use `COUNT`, so numeric Excel date serials count; text that merely looks like a date does not. There are **exactly 12 intended slots per workout** in the present design. `F5:F16` is under a calorie-expenditure header and is currently blank; it is not a date destination. `G5:G16` holds `2,2,2,2,1,1,1,1,0,0,0,0` for both workouts. The column is labelled RIR and the neighboring `D` column numbers workout occurrences, so this appears to be an occurrence-level progression, not an RIR attached to individual exercises or sets. That interpretation needs confirmation before the UI presents it as a prescription.

The first empty `E5:E16` cell is the only candidate for a future new date. Writing into `E17` would leave the `COUNT` formula unchanged and put data into a spacer row immediately before the workout section at row 18. Writing later in `TREINO B`'s giant formatted area would also not extend the counter. The application must stop at a full grid and report that Excel export cannot proceed until the workbook's history design is extended deliberately. Local app history should have no such 12-entry limit. A date-only value should be written as a real Excel date and retain `dd/mm` formatting; the UI should store the full year (`YYYY-MM-DD`) so same day/month in different years cannot be confused.

Other formulas, all on `JONATHA`: `B7 = 2026-1991` (cached 35; the year is hard-coded), and `B13 = B11/(B9*B9)` (cached about 20.2865). Neither depends on workouts. The four formulas above are the workbook's complete formula inventory.

## 3. Workout A structure

Header `TREINO A!B3` names the plan. `B5` says `força + estabilidade`; `B7` says `40-45 min`; `B9` says `Intervalos de 1 a 2' entre séries`. `E18` labels a five-minute warm-up; `E24` labels strength. Warm-up exercises are `E20:E22`, with instructions in `F20:F22` and reference links in `G20:G22`. Strength appears as **four ordered pairs**, at rows 26, 28, 30, 32. In each pair, the two newline-separated names in `E` correspond in order to newline-separated prescriptions in `F` where present, load tokens in `H`, equipment in `I`, and separate links in `J` and `K`. Rows 27, 29, 31 each say `intervalo 2'` after a pair. The merged heading `G25:H25` says `CARGA ATUAL`, but the actual A load strings are in **`H26`, `H28`, `H30`, `H32`**.

| Order | Section / pair | Exercise (`E` source) | Prescription (`F`) | Load (`H`) | Equipment (`I`) | Video cell |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Warm-up | Mobilidade de quadril + rotação torácica (`E20`) | `8x/lado` | — | — | `G20` |
| 2 | Warm-up | Caminhada lateral com miniband (`E21`) | `10 passos/lado` | — | — | `G21` |
| 3 | Warm-up | Dead bug (`E22`) | `8x/lado` | — | — | `G22` |
| 4 | Strength / 1 | Agachamento goblet (`E26` line 1) | `3x8-10` | `8` from `8/15` | `Halter` | `J26` |
| 5 | Strength / 1 | Remada baixa neutra (`E26` line 2) | `3x10-12` | `15` from `8/15` | `Polia` | `K26` |
| 6 | Strength / 2 | Levantamento terra romeno com halteres (`E28` line 1) | `3x8-10` | `7.5` from `7.5/6` | `Hhalteres` as written | `J28` |
| 7 | Strength / 2 | Face pull (`E28` line 2) | `3x12-15` | `6` from `7.5/6` | `Polia` | `K28` |
| 8 | Strength / 3 | Afundo reverso (`E30` line 1) | `2x8-10/lado` | `6` from `6/?` | `Halteres` | `J30` |
| 9 | Strength / 3 | Panturrilha em pé unilateral (`E30` line 2) | `2x12-15/lado` | **unknown** (`?`) | `Step, halter` | `K30` |
| 10 | Strength / 4 | Pallof press (`E32` line 1) | `2x10-15/lado` | `5` from `5/2.5` | row says `Polia` | `J32` |
| 11 | Strength / 4 | Rotação externa na polia (`E32` line 2) | `2x12-15/lado` | `2.5` from `5/2.5` | row says `Polia` | `K32` |

The load unit is not printed; do not silently convert these tokens to kilograms. `Hhalteres` is an apparent source typo and should remain traceable. `I32` contains only one equipment value for two exercises; treating it as shared is plausible but remains an import assumption. The plus sign in the first warm-up name could describe one combined movement; it has one prescription and one link, so the initial structured plan should keep it as one exercise pending confirmation. Warm-up cells do not state set counts: `8x/lado` is a rep instruction, not evidence of eight sets.

## 4. Workout B structure

Header `TREINO B!B3` names the plan. `B5` says `força + prevenção para o vôlei`; `B7` says `40-45 min`; `B9` gives the same 1–2 minute between-set note. `E18` labels a five-minute warm-up. Sections and pairing use the same coordinates as A. B has **no entered load values** in `H26`, `H28`, `H30`, or `H32`; the `CARGA ATUAL` heading does not imply defaults exist.

| Order | Section / pair | Exercise (`E` source) | Prescription (`F`) | Load | Equipment (`I`) | Video cell |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Warm-up | Bom dia sem carga (`E20`) | `10x` | — | — | `G20` |
| 2 | Warm-up | Perdigueiro (`E21`) | `10x/lado` | — | — | `G21` |
| 3 | Warm-up | Ponte unilateral (`E22`) | `8x/lado` | — | — | `G22` |
| 4 | Strength / 1 | Hip thrust com barra (`E26` line 1) | `3x8-10` in shared `F26` | blank | `Banco, barra` | `J26` |
| 5 | Strength / 1 | Supino com halteres (`E26` line 2) | `3x8-10` in shared `F26` **inferred** | blank | `Banco, halteres` | `K26` |
| 6 | Strength / 2 | Step-up (`E28` line 1) | `3x8/lado` | blank | `Step, halteres` | `J28` |
| 7 | Strength / 2 | Puxada alta na polia (`E28` line 2) | `3x10-12` | blank | `Polia` | `K28` |
| 8 | Strength / 3 | Mesa flexora (`E30` line 1) | `2x10-12` | blank | `Máquina` | `J30` |
| 9 | Strength / 3 | Elevação lateral com halteres (`E30` line 2) | `2x12-15` | blank | `Halteres` | `K30` |
| 10 | Strength / 4 | Copenhagen plank (`E32` line 1) | `2x20-30s/lado` | blank | `Banco, colchonete` (row-level) | `J32` |
| 11 | Strength / 4 | Tibial raise (`E32` line 2) | `2x15-20` | blank | **not separately stated** | `K32` |

`F26` contains only one `3x8-10` line for two names. Sharing it is sensible for a draft plan but should be confirmed before implementation. `I32` also supplies a single equipment phrase for the pair and may apply only to Copenhagen plank. `2x20-30s/lado` is a timed, per-side target, not a repetition count.

## 5. Actual hyperlink targets

All 22 listed cells have real hyperlink targets, and all target YouTube (`youtube.com`): 21 Shorts URLs and one standard watch URL. No exercise video hyperlink is missing. Links below are extracted from the Excel hyperlink relationship, **not constructed from the displayed label**. Each strength-row `J` link maps to the first logical exercise and `K` to the second.

| Workout | Exercise | Source cell | Actual hyperlink target |
| --- | --- | --- | --- |
| A | Mobilidade de quadril + rotação torácica | `G20` | https://www.youtube.com/shorts/spjnmreGb7U |
| A | Caminhada lateral com miniband | `G21` | https://www.youtube.com/shorts/7saA5QnyJX8 |
| A | Dead bug | `G22` | https://www.youtube.com/shorts/DqLL45uk2Tk |
| A | Agachamento goblet | `J26` | https://www.youtube.com/shorts/jtlT3l7jD1M |
| A | Remada baixa neutra | `K26` | https://www.youtube.com/shorts/6ml0iz19DPw |
| A | Levantamento terra romeno com halteres | `J28` | https://www.youtube.com/shorts/oQwnGfZFfzw |
| A | Face pull | `K28` | https://www.youtube.com/shorts/IeOqdw9WI90 |
| A | Afundo reverso | `J30` | https://www.youtube.com/shorts/755boqDfMe4 |
| A | Panturrilha em pé unilateral | `K30` | https://www.youtube.com/shorts/EOYf2Vau9_E |
| A | Pallof press | `J32` | https://www.youtube.com/shorts/vgkJb94lK10 |
| A | Rotação externa na polia | `K32` | https://www.youtube.com/shorts/goprHr4m6uk |
| B | Bom dia sem carga | `G20` | https://www.youtube.com/shorts/6E6SeWHVP_0 |
| B | Perdigueiro | `G21` | https://www.youtube.com/shorts/ieaIrJeRnZE |
| B | Ponte unilateral | `G22` | https://www.youtube.com/shorts/0e1SXFq806U |
| B | Hip thrust com barra | `J26` | https://www.youtube.com/shorts/eN03zP5ICIs |
| B | Supino com halteres | `K26` | https://www.youtube.com/shorts/ceq2KGuY9Ts |
| B | Step-up | `J28` | https://www.youtube.com/watch?v=KCu2QHbnIZE |
| B | Puxada alta na polia | `K28` | https://www.youtube.com/shorts/oF-RqXrkZHU |
| B | Mesa flexora | `J30` | https://www.youtube.com/shorts/bA5gbGtltFs |
| B | Elevação lateral com halteres | `K30` | https://www.youtube.com/shorts/yURmeIEl1Fg |
| B | Copenhagen plank | `J32` | https://www.youtube.com/shorts/kXTHTV6--Bo |
| B | Tibial raise | `K32` | https://www.youtube.com/shorts/Dd-8s86-zio |

The cells display video titles rather than the URL targets, and the titles often differ from the actual exercise names: for example, A `K28` displays an English “Facepull Mistakes” title, while B `K28` displays a “PULLEY FRENTE...” title for `Puxada alta na polia`. B `J28` is a normal YouTube watch URL while the others are Shorts. These are title/URL differences, not broken hyperlink relationships. No link should be repaired or rewritten without separate review. Link reachability and video content were not checked; the audit establishes the URLs stored in the workbook.

## 6. Workbook quirks, dependencies, and future write boundaries

| Source / destination | Dependency and preservation rule |
| --- | --- |
| `TREINO A!E5:E16`, `TREINO B!E5:E16` | Only completion-date destinations. Preserve real date type and `dd/mm` style. Never overwrite an occupied cell or cross the 12-slot boundary. |
| `TREINO A!D5:D16`, `TREINO B!D5:D16` | Fixed occurrence labels. Preserve their order; they identify the intended slots. |
| `TREINO A!G5:G16`, `TREINO B!G5:G16` | RIR progression by occurrence. Do not treat as per-exercise data or alter when writing dates. |
| `JONATHA!I11:I12` | `COUNT` formulas reference the fixed date grids. Preserve formulas; extending history requires changing this design. |
| `JONATHA!B7`, `JONATHA!B13` | Other formulas unrelated to workouts, but regression comparison should ensure they survive workbook round trips. |
| Workout `E20:K32` | Source plan, load cells, paired cells, links, merged formatting, notes. Date-only sync must not edit this area. |
| Workbook drawings, tables, styles, CF | Preservation risk for file-rewrite libraries; verify a temporary copy before any future export. |

Conditional formatting exists (3 rules on `JONATHA`, 17 on A, 17 on B). Many rules contain literal `#REF!`: 3, 16, and 15 rules respectively. This is already present in the source; a parser should not interpret those broken CF references as plan data, and an exporter must not silently "fix" or discard them. The formatting rules include ranges outside the meaningful content and references to absent rows, reinforcing that workbook layout cannot be inferred from formatting. There are no chart dependencies. The dashboard tables and images are additional objects to preserve if rewriting the file. The workbook's `B5` start date is 5 September 2026, while both workout histories are currently empty; it is not evidence of a completed workout. `JONATHA!B7` is calculated from a fixed 2026 literal, so it will age incorrectly, independently of the app.

## 7. Proposed app data model

The app should use stable IDs and structured data; only the import/export adapter should know coordinates. Keep the original prescription string alongside parsed fields so a value such as `8x/lado` or `2x20-30s/lado` can be displayed faithfully and audited.

```ts
type WorkoutId = "A" | "B";
type SectionId = "warmup" | "strength";
type TargetUnit = "reps" | "steps" | "seconds";

interface ExercisePrescription {
  sourceText: string;       // e.g. "2x20-30s/lado"
  sets?: number;            // absent when workbook gives no set count
  min: number;
  max?: number;
  unit: TargetUnit;
  perSide?: boolean;
}

interface Exercise {
  id: string;               // e.g. "a-strength-3-2"; stable across sessions
  name: string;
  section: SectionId;
  order: number;
  pairId?: string;          // keeps row pairing without combining exercises
  prescription: ExercisePrescription;
  defaultLoad?: string;     // preserve source token; unit not established
  equipment?: string;
  videoUrl?: string;
  note?: string;
}

interface WorkoutPlan {
  id: WorkoutId;
  title: string;
  description: string;
  expectedMinutes: { min: number; max: number };
  warmupMinutes?: number;
  betweenSetRestNote?: string;
  rirByOccurrence?: number[]; // 12 values; no extrapolation past the grid
  exercises: Exercise[];
  planVersion: string;
}

interface ExerciseSession {
  exerciseId: string;
  completed: boolean;
  actualLoad?: string;      // optional per-session override
}

interface WorkoutSession {
  id: string;               // UUID; also used for sync idempotency locally
  workoutId: WorkoutId;
  planVersion: string;
  status: "inProgress" | "completed";
  startedAt: string;        // ISO timestamp
  completedAt?: string;     // ISO timestamp
  localDate?: string;       // YYYY-MM-DD in the user's local time zone
  exercises: ExerciseSession[];
}
```

The completed `WorkoutSession` records **are** the history; a duplicate `WorkoutHistoryEntry` store is unnecessary. Duration can be derived from `startedAt` and `completedAt` when present. Current prescribed load and actual load are separate. No default is invented for B, A's `?`, or missing warm-up loads. The UI may show the next RIR value only if the occurrence interpretation is confirmed; otherwise show the RIR schedule as plan context.

Data ownership is explicit: plan JSON/TypeScript owns names, prescriptions, equipment, notes, and video URLs; local session storage owns dates, completion flags, actual loads, and duration; the Excel adapter alone owns sheet names, ranges, import source hashes, and write destinations. A plan update should not silently mutate saved sessions because each records its `planVersion`.

## 8. Proposed Excel adapter and migration resilience

For the first import, convert the inspected workbook once into reviewed `workouts.json` (or a typed TypeScript constant). Keep a small versioned mapping adjacent to the adapter, for example:

```ts
interface WorkbookMapping {
  mappingVersion: number;
  expectedSheetNames: ["JONATHA", "TREINO A", "TREINO B"];
  sourceFingerprint: string;
  workouts: Record<WorkoutId, {
    sheet: "TREINO A" | "TREINO B";
    dateSlots: string[];     // E5 ... E16, exactly 12 addresses
    ordinalRange: "D5:D16";
    rirRange: "G5:G16";
    dashboardCountCell: "I11" | "I12";
  }>;
}
```

`sourceFingerprint` is a provenance aid, not a requirement that every date write leave the whole-file hash unchanged. At import/export time, validate sheet names, expected labels, the `COUNT` formula targets, date-cell types/styles, and video/prescription structure. If the layout changes, fail safely and generate a reviewable mapping update rather than guessing new coordinates. A small database is unnecessary for this static personal plan; the Excel workbook should be a source and later an export target, not the app's live database. If the plan becomes user-editable or multi-device, revisit storage separately.

Future date export algorithm (design only): obtain a **copy**, validate its structure, read the target's 12 slots, compare existing full dates and app session IDs/records, select the first genuinely empty slot, write one Excel date preserving the number format, save to a new output file, reopen and verify the date, formulas, links, styles, images, and tables, then let the user replace or import the result. Never overwrite the source automatically. If no slot is empty, leave that session pending export; do not append to row 17 or later. A failed write must leave the app's completed session intact with an unsynced state. For repeated exports, reconcile against workbook dates before writing; workbook dates have no session IDs, so same-workout/same-date conflicts need a stated policy (initially skip and flag for review).

## 9. Mobile UX and MVP

Recommended screen flow:

```text
HOME                  WORKOUT A/B                 FINISH                 HISTORY
Workout A / Workout B  Warm-up then strength       Today (editable date)  Date + A/B
Completed count        11 large exercise cards      Completed summary      Duration if known
History                Sets × target, load          Save workout           Loads if recorded
                       Equipment / RIR context
                       Watch example / Complete
```

Tap targets should be thumb-sized, the primary action near the lower edge, and each exercise should be a card rather than a dense table. Preserve the exercise order; show pair association visually without forcing the user to complete both together. Video opens the stored target URL. Show the default load only where known and let an entered actual load override it for that session. Date defaults to today's **local** date at finish and is shown before saving. A small confirmation for an existing A/B entry on the same date can prevent accidental duplicate taps. Home should show A and B equally; the workbook contains no rule that safely establishes a "recommended next" workout. Once local history exists, the most recent type can be displayed, but an alternating recommendation remains a separate decision.

**Version 1:** Home; A and B plans; warm-up and strength cards with prescriptions, equipment, available loads and videos; completion controls; optional actual load; start/finish; today's local date; locally saved session history and counts; installable, offline-capable PWA shell. Videos themselves need a connection. Keep an in-progress session locally so closing the phone does not erase it. No Microsoft login or workbook access at runtime.

**Phase 2:** Reviewed one-time plan import refresh and manual **import/export using a copy** of the workbook for completion dates, with validation and an explicit pending/failed export state. Add a simple history backup/export so browser storage loss or phone replacement can be recovered.

**Later, only if useful:** OneDrive/Microsoft Graph connection, automatic sync, editable plans, or multi-device history. No social features, subscriptions, AI coaching, gamification, or complex analytics are justified here.

## 10. Recommended implementation architecture and repository structure

Keep the user's preferred Next.js + React + TypeScript stack. A statically deployed, client-side Next.js PWA can serve this one-person app without a server, database, or Microsoft authentication in version 1. Local storage is enough for a small plan and history; write full session records atomically, validate their schema on read, and provide an eventual backup/export path. If storage grows or transactional needs appear, IndexedDB can replace the persistence adapter without changing UI types. A service worker should cache the app shell and plan for offline use; external YouTube pages are outside that cache. Avoid placing private profile details from `JONATHA` in the public app bundle unless deliberately needed.

```text
app/                  Home, workout, finish, and history routes
components/           Mobile exercise cards and navigation
data/workouts.json    Reviewed static A/B plan extracted from workbook
lib/storage/          Session persistence and schema validation
lib/excel/            Future import/export mapping and validation (Phase 2)
types/                Plan and session types
docs/                 This specification and later mapping decisions
tests/                Focused parser, session, and workbook-copy regression tests
public/               PWA manifest/icons and offline assets
```

The `lib/excel` folder is a future boundary, not work to implement in this step. A source workbook placed under `data/` should be clearly labelled read-only. Do not put Excel cell addresses in UI components or session objects.

## 11. Future Excel synchronization options and recommendation

| Option | Fit | Main costs / risks |
| --- | --- | --- |
| Direct local `.xlsx` rewrite | Possible for a controlled manual export from a copy. | Browser file access, exclusive edits, and round-trip preservation of this workbook's images, tables, merged ranges, hyperlinks, formulas and already-broken CF must be proven. A server rewrite would add infrastructure. |
| Import/export of a copied workbook | **Recommended first integration.** App remains offline during workouts; user explicitly chooses a workbook and reviews a newly generated file. | Manual step; must detect stale copies and duplicates; still needs strict preservation tests. |
| OneDrive + Microsoft Graph Excel range API | Potential later live sync to a cloud workbook using Microsoft sign-in. Microsoft documents `.xlsx` support and range updates with delegated `Files.ReadWrite` for personal and work/school accounts. [Excel API overview](https://learn.microsoft.com/en-us/graph/excel-concept-overview); [range update permissions](https://learn.microsoft.com/en-us/graph/api/range-update?view=graph-rest-1.0). | OAuth consent, network availability, concurrent edits, throttling/locking, layout drift, and idempotency. The persistent workbook-session endpoint's permissions page currently says **personal Microsoft accounts are not supported**, even though the range update endpoint lists them; a personal-account design would need to verify no-session behavior in a prototype. [Session permissions and persistence](https://learn.microsoft.com/en-us/graph/api/workbook-createsession?view=graph-rest-1.0). |
| Server-side sync layer | Useful only if auth/token management, queueing, or multiple devices make direct client access impractical. | Hosting, token storage, operational work; disproportionate for version 1. |
| OneDrive file download/reupload | Could apply the copy-based adapter to a cloud file with conditional writes. | Whole-file collision/preservation risk remains; OneDrive's upload-session API documents `If-Match`/ETag conflict checks, which help detect concurrent replacement but do not merge edits. [Upload-session conditions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0). |

For any automatic path: keep the completed local session as the source of truth until remote confirmation; queue while offline; re-read the workbook before each write; reject changed layout or a now-occupied slot; use a stable session ID locally; read back after write; mark a sync attempt successful only after verification. If the network fails after a remote write, reconciliation must search for the date before retrying. Because Excel currently records only a date, two same-type sessions on one day cannot be distinguished in it. Never resolve a collision by overwriting a cell. File locks or concurrent manual edits should produce a retryable conflict, not a forced upload. A changed workbook layout should suspend export until its mapping is reviewed.

The greatest synchronization risk is the **fixed, 12-date formula boundary**, compounded by this workbook's nontrivial drawing/formatting objects. Merely finding empty formatted cells below row 16 is unsafe.

## 12. Test and validation strategy before any real-workbook write

1. Parse a read-only fixture/copy and assert exactly three sheets, 11 logical exercises per workout in order, four two-exercise strength pairs each, raw prescriptions, load alignment, and the 22 exact hyperlink targets above. Explicitly test B's shared `F26`, A's unknown `6/?`, and timed `2x20-30s/lado`.
2. Test local sessions: completion flags, optional actual loads, local-date behavior across midnight/time zones, in-progress recovery, same-day duplicates, plan-version display, and history/counts after reload.
3. Test the Excel adapter **only on a disposable copy**: first empty A and B slot, gaps, non-date text, duplicate same-type/date, full 12-slot grids, wrong sheet/label/formula, modified layout, and no writes outside the chosen `E5:E16` cell. Assert Excel `COUNT` rises only for a real date and the complete date (including year) survives reopening.
4. Snapshot/compare the copied workbook before and after an export: all formulas (especially `JONATHA!I11:I12`), other cell values, number formats, merges, tables, images, hyperlink targets, conditional formatting, and ZIP integrity. Test save failure/interruption and retry reconciliation. Compare against a **copy of the original** as a regression fixture; never run write tests on the source file.
5. For a future Graph path, integration-test the exact Microsoft account type, permission scopes, concurrent edit/ETag or session behavior, offline retry, a lost acknowledgment after successful write, and read-after-write confirmation before enabling real sync.

This analysis checked the source with `openpyxl` without saving it, loaded cached formula values separately, enumerated workbook hyperlinks and formatting metadata, and checked ZIP integrity. The original source hash above is the baseline for any later check.

## 13. Open questions for architecture approval

1. Is `G5:G16` intended as RIR for the 1st–12th **occurrence of each workout**, and what should happen after the 12th occurrence?
2. Does B's single `F26` prescription apply to both paired exercises? Does `I32` in each plan apply to both exercises in that pair?
3. What unit is used for A's load tokens (`8/15`, `7.5/6`, `6/?`, `5/2.5`), and should the app keep unknown loads blank until entered?
4. Is the first A warm-up (`Mobilidade de quadril + rotação torácica`) one combined movement as its single link suggests?
5. Can A and B both occur on one date, and can the same workout occur twice on one date? The current workbook cannot distinguish two same-type sessions on one day.
6. If Excel sync becomes desirable, will the canonical workbook be a local file, OneDrive Personal, or OneDrive for work/school? That choice affects the available Microsoft Graph workflow.

These questions were recorded before implementation and remain open; the MVP uses the conservative interpretations documented in `README.md` and `docs/excel-adapter.md`. The original workbook has not been modified.
