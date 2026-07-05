# Workout

A mobile-first workout tracker for two training programs, built as a small
**vanilla HTML/CSS/JavaScript** app — no frameworks, no build step, no npm.

- **Upper / Lower** — 12-week hypertrophy program with a YMCA / Office gym
  toggle that swaps the two lower days for office-equipment versions.
- **Glute Split** — 12-week Glute / Pull / Legs / Push program.

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
| `js/app.js` | State, migration, status engine, rendering, events, rest timer |
| `sw.js` | Service worker: precaches the app shell for offline use (https only) |

Scripts are classic `<script>` tags (no ES modules) so the app also works
when opened from disk. When shipping a change, bump the `?v=` query strings
in `index.html` and the `CACHE_NAME` in `sw.js` so clients pick it up.

## How progress works (two states)

A workout's status is always **derived from its entries** — there is no
save button:

- **In progress** — any weight/reps/RIR value has been entered.
- **Done** — *every* planned exercise is complete. An exercise is complete
  when all of its sets have reps and a weight (**enter `0` for bodyweight
  movements**). RIR/RPE is never required.

Workout cards show a progress ring with `X/N exercises`. Everything
autosaves as you type; sessions appear on the History tab immediately and
can be reopened or deleted there.

## Data & backups

All data lives in the browser's `localStorage` under `workout_v10_state`
(per browser, per device — there is no sync). Each profile (dad / daughter)
keeps its own week, readiness metrics, and history scope. Older
`workout_v3…v9` data is migrated automatically on first load and the old
keys are left untouched.

**Export a backup** (Settings → Export, or the button under session notes)
regularly — iOS can purge site storage under pressure. Import accepts both
v2 backups and backups from the old single-file version.
