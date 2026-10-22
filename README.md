# Workout

A mobile-first workout tracker for two people's training programs, built as
a small **vanilla HTML/CSS/JavaScript** app — no frameworks, no build step,
no npm.

- **Upper / Lower** (dad) — 12-week hypertrophy program with a YMCA / Office
  gym toggle that swaps the two lower days for office-equipment versions.
- **Upper / Lower — Six-Cycle Progression** (dad) — a pre-block deload plus
  six training cycles, started with an explicit **Start block** step (see
  below). Same YMCA / Office toggle.
- **Glute Split** (daughter) — 12-week Glute / Pull / Legs / Push program.

## Running it

- **Hosted (recommended):** serve the folder from any static host
  (e.g. GitHub Pages). On iPhone, open it in Safari and tap
  Share → *Add to Home Screen* to install it as a full-screen app.
- **Local:** open `index.html` directly in a browser, or run
  `python3 -m http.server` in the folder and visit `http://localhost:8000`.

## Files

| File | Responsibility |
|---|---|
| `index.html` | Static shell (header, tabs, timer bar) and script/style tags |
| `css/styles.css` | All styling |
| `js/data.js` | Program definitions, substitutions, exercise-alias table (pure data) |
| `js/app.js` | State, migration, status engine, cycle blocks, progression, rendering, events, rest timer |
| `sw.js` | Service worker: precaches the app shell for offline use (https only) |
| `tests/` | Headless-browser test suites (development only — not loaded by the app) |

Scripts are classic `<script>` tags (no ES modules) so the app also works
when opened from disk. When shipping a change, bump the `?v=` query strings
in `index.html` and the `VERSION` (plus its `APP_SHELL` URLs) in `sw.js` so
clients pick it up. The worker's caches are named by its scope, and it only
ever deletes its own — other apps on the same origin keep theirs.

## How progress works (two states)

A workout's status is always **derived from its entries** — there is no
save button:

- **In progress** — any weight/reps/RIR value has been entered.
- **Done** — *every* planned exercise is complete. An exercise is complete
  when all of its sets have a whole number of reps and a weight of 0 or more
  (**enter `0` for bodyweight movements**). Negative, non-numeric or
  fractional-rep entries never count; their row is outlined in red. RIR/RPE
  is never required to finish — but a load increase is only suggested when
  every planned set reached the top of the range with the effort logged
  (RIR at or above the target, RPE at or under the max).

Workout cards show a progress ring with `X/N exercises`. Everything
autosaves as you type; sessions appear on the History tab immediately and
can be reopened or deleted there. Finishing a workout (and any week
advance) happens once you leave the last field, never mid-number.
*Repeat* and *Suggest* only fill blank weights. History follows the movement
you actually did: a substitute keeps its own history, and in the 12-week
program each gym keeps its own.

## The six-cycle program

- **Start block.** Selecting the program shows a start card with a backup
  step; nothing is logged and no other program changes until you tap
  *Start block*. Starting again later begins a fresh block; the old one
  stays in History.
- **Cycles advance by completion, never by dates.** The block opens with a
  pre-block deload (each workout once, one working set per exercise at
  4–5 RIR), then Cycles 1–6. A cycle is Upper A, Lower A, Upper B and
  Lower B each **marked complete** — office and YMCA versions count the
  same. Cycle 1 uses 3 RIR throughout; Cycles 2–6 use each exercise's own
  target.
- **Explicit completion.** Tap *Complete workout* when you finish; unlogged
  sets are recorded as skipped. *Reopen workout* undoes it.
- **One session per workout per cycle.** Picking a started workout resumes
  it, whatever day you started it — a partial session is never duplicated.
- **Suggestions are advice, not entries.** Each exercise shows its planned
  sets, rep range, RIR, rest, load convention, cue and notes, the last
  *comparable* performance and a progression suggestion. Suggested loads are
  only written into a set if you tap *Suggest*; *Repeat* and *Suggest*
  never overwrite a logged weight.
- **Comparable history.** Each exercise variant keeps its own history.
  Machine, cable and plate-loaded loads are only compared within the same
  gym — and the same machine, if you name it on the exercise. Office
  dumbbell suggestions are capped at the office maximum (70 lb; 71 lb
  kettlebell).
- **Progression** is double progression with the program's exceptions: the
  flat bench needs two consecutive clean sessions (both sets at 10 reps,
  3 RIR, and a clear shoulder during, later that day and the next morning)
  before a 5-lb step; incline DBs at 15/15 prompt a review instead of an
  automatic switch; logged symptoms hold load increases.
- **Warm-ups** are logged in their own rows and never count as working sets,
  volume or progression.
- **Symptom check-ins** (shoulder, catching, repositioning, back — during,
  later that day, next morning) live on each workout; recent workouts with
  unknown follow-ups are prompted on Today. Blank always means *unknown*.
- After Cycle 6, Today shows a **block review** (completion, main lifts,
  symptoms, recovery) to decide what's next.

## Data & backups

All data lives in the browser's `localStorage` under `workout_v10_state`
(per browser, per device — there is no sync). Each profile (dad / daughter)
keeps its own week, readiness metrics, and history scope. Older
`workout_v3…v9` data is migrated automatically on first load and the old
keys are left untouched.

**Export a backup** (Settings → Export, or the button under session notes)
regularly — iOS can purge site storage under pressure. Import accepts both
v2 backups and backups from the old single-file version.

Safeguards:

- **Import** checks the whole backup first and only replaces your data once
  it has been saved; if saving fails, nothing changes and you're told so.
- **Two tabs open?** A tab picks up saves made in another tab. If it had
  unsaved changes of its own at that moment, it stops saving and asks you to
  reload — it never overwrites the other tab's work with older data.
- **Unreadable saved data** is never overwritten. It's copied aside
  (`workout_v10_damaged_…`), a banner explains what happened, and nothing is
  saved until you choose: download the damaged copy, import a backup, or
  continue with what loaded.

## Tests

Three headless-Chromium suites (they need [Playwright](https://playwright.dev)
with a Chromium build; nothing is installed into the app itself) and one
plain-Node suite for the service worker:

```sh
python3 -m http.server 8931          # in the repo root, in another terminal
NODE_PATH=$(npm root -g) node tests/regression.test.js http://127.0.0.1:8931/
NODE_PATH=$(npm root -g) node tests/cycle.test.js http://127.0.0.1:8931/
NODE_PATH=$(npm root -g) node tests/review.test.js http://127.0.0.1:8931/
node tests/sw.test.js
```

`regression.test.js` covers the week-based programs (status rules,
persistence, history, gym toggle, profile isolation, legacy migration,
blocks, auto-advance, the Sunday review and calendar export);
`cycle.test.js` covers the six-cycle program end to end; `review.test.js`
covers the data-safety and entry rules above (substitutions, two tabs,
imports, recovery, completion timing, Repeat/Suggest, progression, numeric
validation); `sw.test.js` runs the service worker's cache handling against
an in-memory Cache Storage. Set
`CHROMIUM_PATH` to use a specific Chromium binary.
