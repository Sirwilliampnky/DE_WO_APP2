/* Workout v2 — application logic.
 *
 * Loads after js/data.js (classic scripts, shared global scope).
 * Data model (localStorage key 'workout_v10_state'):
 *   {
 *     version: 10,
 *     profile: '' | 'dad' | 'daughter',
 *     activeTab, timerPrefs,
 *     profiles: { dad: {currentWeek, selectedProgramKey, selectedWorkoutKey,
 *                       gymMode, activeDate, metricsByDate}, daughter: {…} },
 *     sessions: { [profile__date__wN__program__workout]: session }
 *   }
 * Every session carries the profile it belongs to, so dad and daughter never
 * collide even when they pick the same program/workout/date/week.
 * For week-based programs a session's progress status is DERIVED from its
 * entries — never stored — so it cannot go stale or lie:
 *   In progress = any weight/reps/RIR entry exists.
 *   Done        = every planned exercise is complete
 *                 (every set has reps > 0 and a non-blank weight; '0' counts,
 *                  so bodyweight work can complete). Per Issue #1.
 * Cycle programs (blockModel 'cycles', see section 4b) instead use explicit
 * completion (session.completedAt), so a workout can be finished with
 * skipped sets; their `week` field is the cycle index (0 = deload) and their
 * sessions carry the block id they belong to.
 *
 * Sections: 1 constants/utils · 2 state & migration · 3 program helpers ·
 * 4 sessions & status engine · 4b cycle-block programs · 5 history/
 * suggestions/trends · 5b cycle progression · 6 stats & warnings ·
 * 7 renderers · 7b cycle-program renderers · 8 targeted updates ·
 * 9 actions · 10 events · 11 rest timer · 12 import/export · 13 init
 */
'use strict';

/* ═══ 1. Constants & utilities ═══ */

const STORAGE_KEY = 'workout_v10_state';
const LEGACY_KEYS = ['workout_v9_state', 'workout_v8_state', 'workout_v7_state',
  'workout_v6_state', 'workout_v5_state', 'workout_v4_state', 'workout_v3_state'];
const WEEK_MIN = 1, WEEK_MAX = 12;
const TABS = ['today', 'history', 'reference', 'settings'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PROFILE_INFO = {
  dad: { label: 'Upper / Lower', defaultProgram: 'upperLower12' },
  daughter: { label: 'Glute Split', defaultProgram: 'glutePullPush' },
};
/* Load conventions whose numbers only mean something on one specific
 * machine/stack — these are never compared across gyms (or across named
 * machines). Free-weight conventions compare anywhere. */
const MACHINE_CONVENTIONS = new Set(['machine_display_lb', 'per_cable_stack_lb', 'plates_only_total_lb']);
const CONVENTION_LABELS = {
  bar_included_total_lb: 'lb total, bar included',
  per_dumbbell_lb: 'lb per dumbbell',
  machine_display_lb: 'lb as shown on the machine',
  per_cable_stack_lb: 'lb on the cable stack',
  plates_only_total_lb: 'lb of plates (sled/carriage not counted)',
  single_implement_lb: 'lb, single DB/KB',
};
/* Confirmed office maximums: 70-lb dumbbells, ~71-lb kettlebell. */
const OFFICE_LOAD_CAPS = { per_dumbbell_lb: 70, single_implement_lb: 71 };
/* Symptom check-in: '' always means unknown — never treated as "fine". */
const CHECKIN_FIELDS = {
  shoulderDuring: ['none', 'some'], catchingOccurred: ['no', 'yes'], repositionNeeded: ['no', 'yes'],
  backDuring: ['none', 'some'], shoulderLaterSameDay: ['none', 'some'],
  shoulderNextDay: ['none', 'some'], backNextDay: ['none', 'some'],
};
const BLOCK_ID_RE = /^b[0-9a-z]{4,20}$/;

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function escapeHTML(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function clampWeek(week) { return Math.max(WEEK_MIN, Math.min(WEEK_MAX, Number(week) || WEEK_MIN)); }
function isISODate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function dateISOFromToday(deltaDays) {
  const now = new Date();
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60000 + deltaDays * 86400000);
  return shifted.toISOString().split('T')[0];
}
function todayISO() { return dateISOFromToday(0); }
/* Local calendar date of an ISO timestamp (toISOString() is UTC). */
function localDateOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isTimestamp(v) { return typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v)); }
function prettyDate(iso) {
  const d = iso ? new Date(iso + 'T12:00:00') : new Date();
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function prettyDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return iso; }
}
function formatSeconds(total) { return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; }
function roundLoad(v) { return Number.isInteger(v) ? v : Math.round(v * 2) / 2; }

/* ═══ 2. State, migration, persistence ═══ */

function defaultTimerPrefs() { return { sound: true, vibrate: true, notify: false, autoStart: true }; }
function normalizeTimerPrefs(raw) {
  const prefs = defaultTimerPrefs();
  if (raw && typeof raw === 'object') for (const k of Object.keys(prefs)) if (typeof raw[k] === 'boolean') prefs[k] = raw[k];
  return prefs;
}
function defaultProfileContext(profileKey) {
  return {
    currentWeek: 1,
    selectedProgramKey: (PROFILE_INFO[profileKey] || {}).defaultProgram || 'glutePullPush',
    selectedWorkoutKey: '',
    gymMode: 'ymca',
    activeDate: '',
    metricsByDate: {},
    // '' = no explicit boundary — every session ever logged for this program
    // counts toward "this week". Set when the user restarts a program at
    // Week 1, so an earlier cycle's Week 1 sessions don't collide with the
    // new one (same week number, different training block).
    blockStartDate: '',
    // Highest week already auto-advanced past — makes maybeAutoAdvanceWeek
    // idempotent (see there).
    autoAdvancedThroughWeek: 0,
    // Local-only weekly planning: when the Sunday review was last approved,
    // and the default time-of-day used for calendar export.
    weekReviewedFor: '',
    workoutTimeOfDay: '17:00',
    // Per-workout calendar overrides: { [baseWorkoutKey]: {dayNumber, time} }.
    // Only entries the user has explicitly customized; a workout with no
    // entry here falls back to the program's own scheduled day and
    // workoutTimeOfDay. Persists week over week until changed again — this
    // customizes the workout's calendar slot, not just a single export.
    workoutScheduleOverrides: {},
    // Cycle programs only: { [programKey]: {id, startedAt, completedAt,
    // viewCycle} }. Kept per program, so starting one never touches another
    // program's week or block (see section 4b).
    cycleBlocks: {},
    // A session opened from History, shown until you pick another workout,
    // tap Next/Today, or change cycle (cycle programs only).
    pinnedSessionKey: '',
  };
}
function defaultState() {
  return {
    version: 10,
    profile: '',
    activeTab: 'today',
    timerPrefs: defaultTimerPrefs(),
    profiles: { dad: defaultProfileContext('dad'), daughter: defaultProfileContext('daughter') },
    sessions: {},
    lastExportAt: '',
  };
}

/* Own-property lookup, so keys like '__proto__' from imported data can't
 * resolve to Object.prototype. */
function programByKey(key) { return Object.prototype.hasOwnProperty.call(PROGRAMS, key) ? PROGRAMS[key] : null; }
function isCycleProgram(p) { return !!(p && p.blockModel && p.blockModel.type === 'cycles'); }
/* Strict programs match history by exact exercise name (one variant = one
 * history) instead of the broad cross-program alias groups. */
function isStrictProgram(p) { return !!(p && p.strictHistory); }
function hasGymToggle(p) { return !!(p && p.gymToggle); }
function firstCycle(p) { return p.blockModel.preBlockDeload ? 0 : 1; }
function cycleCount(p) { return p.blockModel.trainingCycles; }
function cycleLabel(p, c) { return c === 0 && p.blockModel.preBlockDeload ? 'Deload' : `Cycle ${c}`; }
function cycleShort(p, c) { return c === 0 && p.blockModel.preBlockDeload ? 'Deload' : `C${c}`; }
function programAllowedFor(p, profile) { return !!p && (!Array.isArray(p.profiles) || p.profiles.includes(profile)); }

function normalizeGymMode(v) { return v === 'office' ? 'office' : 'ymca'; }
function baseWorkoutKey(k) { return OFFICE_BASE_MAP[k] || k; }
function effectiveWorkoutKey(programKey, workoutKey, gym) {
  const base = baseWorkoutKey(workoutKey);
  return hasGymToggle(programByKey(programKey)) && normalizeGymMode(gym) === 'office' && OFFICE_WORKOUT_MAP[base]
    ? OFFICE_WORKOUT_MAP[base] : base;
}
function inferProgramKey(workoutKey) {
  if (!workoutKey) return 'glutePullPush';
  const found = Object.values(PROGRAMS).find(p => p.workouts[workoutKey]);
  return found ? found.key : 'glutePullPush';
}

/* Cycle-program sessions append their block id, so restarting a block can
 * never overwrite the previous block's session for the same day/slot. */
function sessionKey(profile, date, week, programKey, workoutKey, blockId) {
  return `${profile}__${date}__w${week}__${programKey}__${workoutKey}${blockId ? `__${blockId}` : ''}`;
}
/* Same identity, without the profile — used only to match up legacy/
 * not-yet-profiled sessions (see expandUnassignedSession) before they're
 * assigned a real key. */
function legacyBaseKey(session) {
  return `${session.date}__w${session.week}__${session.programKey}__${session.workoutKey}`;
}
/* Sessions from before per-profile scoping (or an import that predates it)
 * carry no profile and can't be attributed to one retroactively, so — same
 * philosophy as the week/date/metrics migration below — they're duplicated
 * into both profiles rather than guessed at or dropped. */
function expandUnassignedSession(session) {
  if (PROFILE_INFO[session.profile]) return [session];
  return Object.keys(PROFILE_INFO).map(profile => {
    const copy = deepClone(session);
    copy.profile = profile;
    copy.key = sessionKey(profile, session.date, session.week, session.programKey, session.workoutKey, session.blockId);
    return copy;
  });
}
function normalizeSet(raw) {
  return { weight: String(raw?.weight ?? ''), reps: String(raw?.reps ?? ''), rir: String(raw?.rir ?? '') };
}
function normalizeWarmup(raw) { return { weight: String(raw?.weight ?? ''), reps: String(raw?.reps ?? '') }; }
function normalizeExercise(x, strict) {
  const ex = {
    originalName: String(x?.originalName ?? x?.actualName ?? ''),
    actualName: String(x?.actualName ?? x?.originalName ?? ''),
    sets: Array.isArray(x?.sets) ? x.sets.map(normalizeSet) : [],
  };
  if (strict) {
    ex.warmups = Array.isArray(x?.warmups) ? x.warmups.slice(0, 8).map(normalizeWarmup) : [];
    ex.equipmentId = String(x?.equipmentId ?? '').trim().slice(0, 40);
    ex.variantId = /^[a-z0-9_]{1,60}$/.test(String(x?.variantId || '')) ? x.variantId : '';
    ex.convention = Object.prototype.hasOwnProperty.call(CONVENTION_LABELS, x?.convention) ? x.convention : '';
  }
  return ex;
}
function emptyCheckin() { return Object.fromEntries(Object.keys(CHECKIN_FIELDS).map(k => [k, ''])); }
function normalizeCheckin(raw) {
  const out = emptyCheckin();
  if (raw && typeof raw === 'object') {
    for (const [field, allowed] of Object.entries(CHECKIN_FIELDS)) if (allowed.includes(raw[field])) out[field] = raw[field];
  }
  return out;
}
/* Week number for a program: cycle programs store the cycle index there
 * (0 = pre-block deload), so it must not go through clampWeek's [1,12]. */
function normalizeWeekFor(p, week) {
  if (!isCycleProgram(p)) return clampWeek(week);
  const n = Math.round(Number(week));
  return Number.isFinite(n) ? Math.max(firstCycle(p), Math.min(cycleCount(p), n)) : firstCycle(p);
}
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const workoutKey = String(raw.workoutKey || '');
  if (!workoutKey) return null;
  const programKey = programByKey(raw.programKey) ? raw.programKey : inferProgramKey(workoutKey);
  const p = programByKey(programKey);
  const date = isISODate(raw.date) ? raw.date : todayISO();
  const week = normalizeWeekFor(p, raw.week);
  const profile = PROFILE_INFO[raw.profile] ? raw.profile : '';
  const cycle = isCycleProgram(p), strict = isStrictProgram(p);
  const blockId = cycle && BLOCK_ID_RE.test(String(raw.blockId || '')) ? raw.blockId : '';
  // The key is always derived, never trusted from raw input — this also
  // neutralizes '__proto__'/'constructor' etc. as imported keys by construction.
  const session = {
    key: sessionKey(profile, date, week, programKey, workoutKey, blockId),
    profile, date, week, programKey, workoutKey,
    gymMode: normalizeGymMode(raw.gymMode || (baseWorkoutKey(workoutKey) !== workoutKey ? 'office' : 'ymca')),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    updatedAt: raw.updatedAt || raw.savedAt || '',
    exercises: Array.isArray(raw.exercises) ? raw.exercises.map(x => normalizeExercise(x, strict)) : [],
  };
  const extras = Array.isArray(raw.extraExercises) ? raw.extraExercises.map(x => normalizeExercise(x, strict)).filter(exerciseHasEntry) : [];
  if (extras.length) session.extraExercises = extras;
  if (cycle) {
    session.blockId = blockId;
    session.completedAt = isTimestamp(raw.completedAt) ? raw.completedAt : '';
    session.checkin = normalizeCheckin(raw.checkin);
    session.checkinDismissed = raw.checkinDismissed === true;
    if (raw.dateChosen === true) session.dateChosen = true;
  }
  return session;
}

/* Accepts a v10 state, any legacy v3–v9 state, or an export wrapper {data:…},
 * and returns a normalized v10 state. Never mutates or deletes the source. */
function migrateAny(raw) {
  const src = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
  if (!src || typeof src !== 'object') return defaultState();
  return (Number(src.version) >= 10 || src.sessions) ? normalizeV10(src) : migrateLegacy(src);
}

function normalizeScheduleOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const dayNumber = Number(v.dayNumber);
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time || '') ? v.time : '';
    if (Number.isInteger(dayNumber) && dayNumber >= 0 && dayNumber <= 6 && time) out[key] = { dayNumber, time };
  }
  return out;
}

/* Readiness entries: ISO-date keys, object values, the four string fields.
 * Anything else (null, arrays, numbers) is dropped rather than carried
 * along to crash a later lookup. */
const METRIC_FIELDS = ['sleep', 'energy', 'soreness', 'bodyweight'];
function normalizeMetrics(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [date, m] of Object.entries(raw)) {
    if (!isISODate(date) || !m || typeof m !== 'object' || Array.isArray(m)) continue;
    out[date] = Object.fromEntries(METRIC_FIELDS.map(f => [f, typeof m[f] === 'string' || typeof m[f] === 'number' ? String(m[f]) : '']));
  }
  return out;
}

function normalizeCycleBlocks(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, b] of Object.entries(raw)) {
    const p = programByKey(key);
    if (!isCycleProgram(p) || !b || typeof b !== 'object' || !BLOCK_ID_RE.test(String(b.id || ''))) continue;
    const hasView = b.viewCycle !== null && b.viewCycle !== undefined && b.viewCycle !== '';
    const view = Number(b.viewCycle);
    out[key] = {
      id: b.id,
      startedAt: isISODate(b.startedAt) ? b.startedAt : todayISO(),
      completedAt: isISODate(b.completedAt) ? b.completedAt : '',
      viewCycle: hasView && Number.isInteger(view) && view >= firstCycle(p) && view <= cycleCount(p) ? view : null,
    };
  }
  return out;
}

function normalizeV10(src) {
  const state = defaultState();
  if (PROFILE_INFO[src.profile]) state.profile = src.profile;
  if (TABS.includes(src.activeTab)) state.activeTab = src.activeTab;
  state.timerPrefs = normalizeTimerPrefs(src.timerPrefs);
  state.lastExportAt = isTimestamp(src.lastExportAt) ? src.lastExportAt : '';
  for (const key of Object.keys(PROFILE_INFO)) {
    const rawCtx = (src.profiles || {})[key] || {};
    const context = { ...defaultProfileContext(key), ...rawCtx };
    context.currentWeek = clampWeek(context.currentWeek);
    context.gymMode = normalizeGymMode(context.gymMode);
    if (!programAllowedFor(programByKey(context.selectedProgramKey), key)) context.selectedProgramKey = defaultProfileContext(key).selectedProgramKey;
    context.cycleBlocks = normalizeCycleBlocks(rawCtx.cycleBlocks);
    context.pinnedSessionKey = typeof rawCtx.pinnedSessionKey === 'string' ? rawCtx.pinnedSessionKey.slice(0, 200) : '';
    context.selectedWorkoutKey = baseWorkoutKey(String(context.selectedWorkoutKey || ''));
    context.activeDate = isISODate(context.activeDate) ? context.activeDate : '';
    context.blockStartDate = isISODate(context.blockStartDate) ? context.blockStartDate : '';
    // 0 is a valid sentinel ("never auto-advanced") distinct from clampWeek's [1,12] range.
    context.autoAdvancedThroughWeek = Math.max(0, Math.min(WEEK_MAX, Number(context.autoAdvancedThroughWeek) || 0));
    context.weekReviewedFor = isISODate(context.weekReviewedFor) ? context.weekReviewedFor : '';
    context.workoutTimeOfDay = /^([01]\d|2[0-3]):[0-5]\d$/.test(context.workoutTimeOfDay || '') ? context.workoutTimeOfDay : '17:00';
    context.workoutScheduleOverrides = normalizeScheduleOverrides(rawCtx.workoutScheduleOverrides);
    context.metricsByDate = normalizeMetrics(rawCtx.metricsByDate);
    state.profiles[key] = context;
  }
  for (const rawSession of Object.values(src.sessions || {})) {
    const session = normalizeSession(rawSession);
    if (!session) continue;
    for (const copy of expandUnassignedSession(session)) state.sessions[copy.key] = copy;
  }
  return state;
}

function migrateLegacy(src) {
  const state = defaultState();
  if (PROFILE_INFO[src.profile]) state.profile = src.profile;
  if (TABS.includes(src.activeTab)) state.activeTab = src.activeTab;
  state.timerPrefs = normalizeTimerPrefs(src.timerPrefs);
  // Legacy state was global; week/date/gym go to both profiles, and metrics
  // can't be attributed to a person retroactively, so both keep a copy.
  const week = clampWeek(src.currentWeek);
  const date = isISODate(src.activeWorkoutDate) ? src.activeWorkoutDate : '';
  const gym = normalizeGymMode(src.gymMode);
  for (const key of Object.keys(PROFILE_INFO)) {
    const context = state.profiles[key];
    context.currentWeek = week;
    context.activeDate = date;
    context.gymMode = gym;
    context.metricsByDate = normalizeMetrics(src.metricsByDate);
  }
  if (state.profile && PROGRAMS[src.selectedProgramKey]) {
    state.profiles[state.profile].selectedProgramKey = src.selectedProgramKey;
    state.profiles[state.profile].selectedWorkoutKey = baseWorkoutKey(String(src.selectedWorkoutKey || ''));
  }
  // Sessions: import saved logs first, then drafts. When both exist for the
  // same key, the DRAFT wins: in v1 the draft was always the live working
  // copy (saving wrote the snapshot back into drafts), so a diverging draft
  // holds edits made AFTER the last explicit save — dropping it would lose
  // the newest data. v1 had no profile concept, so log/draft matching is
  // done on the profile-less key first; the result is duplicated to both
  // profiles afterward (see expandUnassignedSession).
  const legacySessions = {};
  for (const log of Array.isArray(src.logs) ? src.logs : []) {
    const session = normalizeSession(log);
    if (!session) continue;
    if (!session.updatedAt) session.updatedAt = `${session.date}T12:00:00.000Z`;
    legacySessions[legacyBaseKey(session)] = session;
  }
  const drafts = src.drafts && typeof src.drafts === 'object' ? Object.values(src.drafts) : [];
  for (const draft of drafts) {
    const session = normalizeSession(draft);
    if (!session || !sessionHasContent(session)) continue;
    const baseKey = legacyBaseKey(session);
    const existing = legacySessions[baseKey];
    if (existing && !session.updatedAt) session.updatedAt = existing.updatedAt;
    legacySessions[baseKey] = session;
  }
  for (const session of Object.values(legacySessions)) {
    for (const copy of expandUnassignedSession(session)) state.sessions[copy.key] = copy;
  }
  return state;
}

/* ── Loading and saving ──
 * Three safeguards around the single saved value (STORAGE_KEY):
 *  · Damaged data is never overwritten silently. If the saved state exists
 *    but can't be read, its raw text is copied aside (QUARANTINE_PREFIX)
 *    and `recovery` is set: nothing is written to STORAGE_KEY until the
 *    user picks a way forward from the recovery banner.
 *  · One writer at a time. lastSyncedRaw is the exact text this tab last
 *    read or wrote. When another tab or window saves, this one adopts that
 *    data if it has nothing unsaved — otherwise it stops saving and asks
 *    for a reload, rather than replacing that work with an older snapshot.
 *  · Replacing everything (import, Clear all) only takes effect once it's
 *    durably saved — see commitState.
 */
const QUARANTINE_PREFIX = 'workout_v10_damaged_';
let recovery = null;      // { raw, savedAs, source } while blocked on damaged data
let lastSyncedRaw = null;
let staleTab = false;

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
/* A saved state or backup file: JSON whose payload (or export wrapper's
 * `data`) is workout data. Throws otherwise — valid JSON that isn't ours
 * (null, a list, another app's object) must never load as an empty app. */
function parseStateText(text) {
  const parsed = JSON.parse(text);
  const src = isPlainObject(parsed) && isPlainObject(parsed.data) ? parsed.data : parsed;
  if (!isPlainObject(src) || !(isPlainObject(src.sessions) || Array.isArray(src.logs) || isPlainObject(src.drafts))) {
    throw new Error('not workout data');
  }
  return { parsed, state: pruneEmptySessions(migrateAny(parsed)) };
}

function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable — nothing to protect */ }
  lastSyncedRaw = raw;
  if (raw) {
    try { return parseStateText(raw).state; } catch (e) { recovery = { raw, savedAs: quarantineDamaged(raw), source: '' }; }
  }
  for (const key of LEGACY_KEYS) {
    try {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      const loaded = pruneEmptySessions(migrateAny(JSON.parse(legacy)));
      if (recovery) recovery.source = key;
      return loaded;
    } catch (e) { /* try the next key */ }
  }
  return defaultState();
}
/* Copies an unreadable saved state aside (once per distinct value), so it
 * survives whatever happens next. '' when storage refuses the copy — the
 * original then stays where it is, untouched, under STORAGE_KEY. */
function quarantineDamaged(raw) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(QUARANTINE_PREFIX) && localStorage.getItem(k) === raw) return k;
    }
    const k = `${QUARANTINE_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}`;
    localStorage.setItem(k, raw);
    return k;
  } catch (e) { return ''; }
}
/* Sessions created by merely browsing are dropped at load so they don't
 * accumulate forever. Anything the user actually did — entries, notes, an
 * exercise substitution, a check-in, or an explicit completion — counts as
 * content and is kept. Blank warm-up rows are tidied away at the same time
 * (they're kept while you're editing so a just-added row doesn't vanish). */
function pruneEmptySessions(state) {
  for (const [key, session] of Object.entries(state.sessions)) {
    for (const x of session.exercises || []) {
      if (Array.isArray(x.warmups)) x.warmups = x.warmups.filter(setHasEntry);
    }
    if (sessionHasContent(session)) continue;
    // An untouched workout you deliberately dated (say, to log a missed
    // session) keeps that date while its block is the active one.
    const blocks = (state.profiles[session.profile] || {}).cycleBlocks || {};
    const block = session.dateChosen && Object.prototype.hasOwnProperty.call(blocks, session.programKey) ? blocks[session.programKey] : null;
    if (block && block.id === session.blockId) continue;
    delete state.sessions[key];
  }
  return state;
}

let state = loadState();
let saveError = '';
let persistTimer = null;
let lastSaveErrorToast = 0;

function persist() {
  if (recovery || staleTab) return false;
  let stored = lastSyncedRaw;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* the write below reports it */ }
  if (stored !== lastSyncedRaw) { blockStaleTab(); return false; }
  try {
    const text = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, text);
    lastSyncedRaw = text;
    saveError = '';
    return true;
  } catch (e) {
    saveError = e && e.message ? e.message : String(e);
    if (Date.now() - lastSaveErrorToast > 10000) {
      lastSaveErrorToast = Date.now();
      toast('Storage full — export a backup now');
    }
    return false;
  }
}
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 400);
}
function flushPersist() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; persist(); }
}
/* Replace the whole state, keeping the result only if it's durably saved —
 * otherwise the previous state stays, on screen and on disk. */
function commitState(next) {
  const prev = { state, recovery };
  clearTimeout(persistTimer);
  persistTimer = null;
  state = next;
  recovery = null;
  if (persist()) return true;
  ({ state, recovery } = prev);
  return false;
}
/* Another tab or window saved. Adopt its data when this tab has nothing
 * unsaved; otherwise stop saving here (see blockStaleTab). */
function onExternalSave() {
  if (staleTab) return;
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
  if (raw === lastSyncedRaw) return;
  if (persistTimer || recovery || !raw) { blockStaleTab(); return; }
  let incoming;
  try { incoming = parseStateText(raw).state; } catch (e) { blockStaleTab(); return; }
  // Which profile and tab a window shows is that window's own business.
  incoming.profile = state.profile;
  incoming.activeTab = state.activeTab;
  state = incoming;
  lastSyncedRaw = raw;
  completionBanner = null;
  pendingCompletion = null;
  render();
}
/* Single writer: once this tab's snapshot is older than what's saved, it
 * never writes again — the user reloads to pick up the latest data. */
function blockStaleTab() {
  staleTab = true;
  clearTimeout(persistTimer);
  persistTimer = null;
  renderSystemNotices();
}
window.addEventListener('storage', e => { if (e.key === STORAGE_KEY || e.key === null) onExternalSave(); });
window.addEventListener('pagehide', flushPersist);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPersist(); });

/* ═══ 3. Program / context helpers ═══ */

function activeProfile() { return PROFILE_INFO[state.profile] ? state.profile : 'daughter'; }
function ctx() { return state.profiles[activeProfile()]; }
function program() { return programByKey(ctx().selectedProgramKey) || PROGRAMS.glutePullPush; }
function programsForProfile(profile) { return Object.values(PROGRAMS).filter(p => programAllowedFor(p, profile)); }
function programOptionsHTML(p) {
  return programsForProfile(activeProfile()).map(x => `<option value="${escapeHTML(x.key)}" ${x.key === p.key ? 'selected' : ''}>${escapeHTML(x.title)}</option>`).join('');
}
function gymMode() { return normalizeGymMode(ctx().gymMode); }
function gymLabel() { return gymMode() === 'office' ? 'Office' : 'YMCA'; }
function activeDate() { return ctx().activeDate || todayISO(); }
/* Week-based programs: the stepper's week. Cycle programs: the cycle being
 * shown — a session opened from History, else a past cycle you stepped back
 * to, else the current (first incomplete) cycle. */
function currentWeek() {
  const p = program();
  if (!isCycleProgram(p)) return clampWeek(ctx().currentWeek);
  const pinned = pinnedSession(p);
  if (pinned && baseWorkoutKey(pinned.workoutKey) === baseWorkoutKey(ctx().selectedWorkoutKey)) return pinned.week;
  const block = activeBlock(p);
  if (!block) return firstCycle(p);
  const frontier = cycleFrontier(p).cycle;
  return Number.isInteger(block.viewCycle) && block.viewCycle >= firstCycle(p) && block.viewCycle < frontier
    ? block.viewCycle : frontier;
}

function workoutList(p, includeManualOnly = true) {
  return Object.values((p || program()).workouts)
    .filter(w => includeManualOnly || w.autoSchedule !== false)
    .sort((a, b) => (a.dayNumber || 0) - (b.dayNumber || 0));
}
function scheduledWorkouts(p) { return workoutList(p, false); }

function hasDeload(p) { return Number((p || program()).deloadWeek) > 0; }
function isDeloadWeek() { const p = program(); return hasDeload(p) && currentWeek() === p.deloadWeek; }
function targetSets(exerciseTemplate, p, week) {
  // Cycle programs: the pre-block deload is max(1, floor(sets / 2)) — i.e.
  // one working set for every 2- or 3-set exercise.
  if (isCycleProgram(p)) {
    return week === 0 && p.blockModel.preBlockDeload ? Math.max(1, Math.floor(exerciseTemplate.sets / 2)) : exerciseTemplate.sets;
  }
  return (!hasDeload(p) || week !== p.deloadWeek)
    ? exerciseTemplate.sets
    : Math.max(1, Math.ceil(exerciseTemplate.sets / 2));
}
/* Planned targets for one exercise in one session's phase — always display
 * values, never written into the logged sets. */
function phaseTargets(t, p, week) {
  const base = { sets: targetSets(t, p, week), repsMin: t.repsMin, repsMax: t.repsMax };
  if (!isCycleProgram(p)) return { ...base, rirMin: t.rirTarget, rirMax: t.rirTarget, phase: 'normal' };
  if (week === 0) return { ...base, rirMin: 4, rirMax: 5, phase: 'deload' };
  if (week === 1) return { ...base, rirMin: 3, rirMax: 3, phase: 'entry' };
  return { ...base, rirMin: t.rirMin, rirMax: t.rirMax, phase: 'build' };
}
function rirText(tg) { return tg.rirMin === tg.rirMax ? `${tg.rirMin}` : `${tg.rirMin}–${tg.rirMax}`; }

function aliasNames(name) {
  const out = new Set([name]);
  (EXERCISE_ALIASES[name] || []).forEach(n => out.add(n));
  for (const [key, list] of Object.entries(EXERCISE_ALIASES)) {
    if (list.includes(name)) { out.add(key); list.forEach(n => out.add(n)); }
  }
  return [...out].filter(Boolean);
}

function ensureSelection() {
  const context = ctx();
  if (!programAllowedFor(programByKey(context.selectedProgramKey), activeProfile())) {
    context.selectedProgramKey = defaultProfileContext(activeProfile()).selectedProgramKey;
  }
  const p = program();
  context.selectedWorkoutKey = baseWorkoutKey(context.selectedWorkoutKey);
  if (!context.selectedWorkoutKey || !p.workouts[effectiveWorkoutKey(p.key, context.selectedWorkoutKey, context.gymMode)]) {
    context.selectedWorkoutKey = nextWorkoutKey();
  }
}

/* ═══ 4. Sessions & the two-state status engine ═══ */

/* Load convention for an exercise name within a program (substitutions can
 * change it — e.g. a machine row standing in for a DB row). */
function conventionForName(p, name) {
  if (!p) return '';
  if (p.substitutionConventions && Object.prototype.hasOwnProperty.call(p.substitutionConventions, name)) return p.substitutionConventions[name];
  for (const w of Object.values(p.workouts)) {
    const hit = w.exercises.find(x => x.name === name);
    if (hit) return hit.weightConvention || '';
  }
  return '';
}
function variantIdFor(t, name) {
  return t && t.name === name && t.variantId ? t.variantId : String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

function newSession(profile, programKey, workoutKey, date, week, gym, blockId) {
  const p = PROGRAMS[programKey], w = p.workouts[workoutKey];
  const strict = isStrictProgram(p);
  const session = {
    key: sessionKey(profile, date, week, programKey, workoutKey, isCycleProgram(p) ? blockId : ''),
    profile, date, week, programKey, workoutKey,
    gymMode: normalizeGymMode(gym),
    notes: '',
    updatedAt: '',
    exercises: w.exercises.map(x => {
      const ex = {
        originalName: x.name,
        actualName: x.name,
        sets: Array.from({ length: targetSets(x, p, week) }, () => ({ weight: '', reps: '', rir: '' })),
      };
      // Stamped so an exported session stays self-describing even if the
      // program definition changes later.
      if (strict) Object.assign(ex, { warmups: [], equipmentId: '', variantId: variantIdFor(x, x.name), convention: x.weightConvention || '' });
      return ex;
    }),
  };
  if (isCycleProgram(p)) Object.assign(session, { blockId: blockId || '', completedAt: '', checkin: emptyCheckin(), checkinDismissed: false });
  return session;
}

/* Which stored exercise belongs to which template slot. Each stored exercise
 * is claimed by at most one slot, in passes from most to least certain:
 * the slot's own name (same position first), then an older name for the
 * slot (alias of originalName), then the movement actually performed. A
 * substitution that happens to share an alias with ANOTHER slot (Hack Squat
 * swapped into the leg-press slot) can therefore never be handed to that
 * other slot as well. */
function matchStoredExercises(templateExercises, stored, strict) {
  const names = strict ? (n => [n]) : aliasNames;
  const used = new Set();
  const out = templateExercises.map(() => null);
  const claim = (i, j) => { out[i] = stored[j]; used.add(j); };
  templateExercises.forEach((t, i) => {
    if (stored[i] && !used.has(i) && stored[i].originalName === t.name) { claim(i, i); return; }
    const j = stored.findIndex((e, k) => !used.has(k) && e.originalName === t.name);
    if (j >= 0) claim(i, j);
  });
  for (const field of ['originalName', 'actualName']) {
    templateExercises.forEach((t, i) => {
      if (out[i]) return;
      const wanted = new Set(names(t.name));
      const j = stored.findIndex((e, k) => !used.has(k) && wanted.has(e[field]));
      if (j >= 0) claim(i, j);
    });
  }
  return { matched: out, unmatched: stored.filter((_, k) => !used.has(k)) };
}

/* Re-align a stored session with its program template (exercise list or
 * deload set counts may have changed since it was created), preserving the
 * user's entries AND their chosen substitution (v1 reset actualName here,
 * which silently undid every substitution). Sets holding data are never
 * dropped, even when the plan now calls for fewer — and a logged exercise
 * that no longer fits any slot is kept in `extraExercises` (shown in
 * History) rather than discarded. */
function syncSessionWithProgram(session) {
  const p = PROGRAMS[session.programKey], w = p?.workouts?.[session.workoutKey];
  if (!p || !w) return session;
  const strict = isStrictProgram(p);
  // Previously set-aside exercises go last in the pool, so one returns to its
  // slot if the template brings it back, but never displaces the slot's own.
  const pool = [...(session.exercises || []), ...(session.extraExercises || [])];
  const { matched, unmatched } = matchStoredExercises(w.exercises, pool, strict);
  const fresh = newSession(session.profile, session.programKey, session.workoutKey, session.date, session.week, session.gymMode, session.blockId);
  fresh.key = session.key;
  fresh.notes = session.notes || '';
  fresh.updatedAt = session.updatedAt || '';
  if (isCycleProgram(p)) {
    fresh.blockId = session.blockId || '';
    fresh.completedAt = session.completedAt || '';
    fresh.checkin = normalizeCheckin(session.checkin);
    fresh.checkinDismissed = session.checkinDismissed === true;
    if (session.dateChosen) fresh.dateChosen = true;
  }
  const extras = unmatched.filter(exerciseHasEntry);
  if (extras.length) fresh.extraExercises = extras;
  fresh.exercises = fresh.exercises.map((ne, i) => {
    const old = matched[i];
    if (!old) return ne;
    const oldSets = Array.isArray(old.sets) ? old.sets : [];
    let count = ne.sets.length;
    for (let j = count; j < oldSets.length; j++) if (setHasEntry(oldSets[j])) count = j + 1;
    const merged = {
      ...ne,
      actualName: old.actualName || ne.originalName,
      sets: Array.from({ length: count }, (_, j) => oldSets[j] ? normalizeSet(oldSets[j]) : { weight: '', reps: '', rir: '' }),
    };
    if (strict) {
      merged.warmups = Array.isArray(old.warmups) ? old.warmups.map(normalizeWarmup) : [];
      merged.equipmentId = String(old.equipmentId || '');
      merged.variantId = variantIdFor(w.exercises[i], merged.actualName);
      merged.convention = conventionForName(p, merged.actualName);
    }
    return merged;
  });
  return fresh;
}

function currentSession() {
  const p = program();
  if (isCycleProgram(p)) return currentCycleSession(p);
  const profile = activeProfile();
  const workoutKey = effectiveWorkoutKey(p.key, ctx().selectedWorkoutKey, ctx().gymMode);
  const key = sessionKey(profile, activeDate(), currentWeek(), p.key, workoutKey);
  if (state.sessions[key]) {
    state.sessions[key] = syncSessionWithProgram(state.sessions[key]);
  } else {
    state.sessions[key] = newSession(profile, p.key, workoutKey, activeDate(), currentWeek(), ctx().gymMode);
  }
  return state.sessions[key];
}

/* — Status rules (Issue #1) — */
function setHasEntry(s) {
  return String(s?.weight ?? '').trim() !== '' || String(s?.reps ?? '').trim() !== '' || String(s?.rir ?? '').trim() !== '';
}
/* A set is complete with a whole number of reps ≥ 1 and a finite weight
 * ≥ 0 — an explicit '0' counts, so bodyweight movements (pull-ups, push-up
 * variants…) can finish; -50, 'bad' or 0.5 reps never do. */
function validWeight(v) {
  const t = String(v ?? '').trim();
  return t !== '' && Number.isFinite(Number(t)) && Number(t) >= 0;
}
function validReps(v) {
  const t = String(v ?? '').trim();
  return t !== '' && Number.isInteger(Number(t)) && Number(t) >= 1;
}
function setComplete(s) { return validReps(s?.reps) && validWeight(s?.weight); }
/* False when a set holds a weight or rep entry that can never count — the
 * row is outlined so it gets fixed. (0 reps is a legitimate "missed".) The
 * effort column isn't checked: special-intensity lifts log a note there. */
function setValuesValid(s) {
  const w = String(s?.weight ?? '').trim(), r = String(s?.reps ?? '').trim();
  return (w === '' || validWeight(w)) && (r === '' || r === '0' || validReps(r));
}
function exerciseComplete(x) { return x.sets.length > 0 && x.sets.every(setComplete); }
/* Warm-up rows count as "started" but never toward completion, volume or
 * progression — those read `sets` (working sets) only. */
function exerciseHasEntry(x) { return (x.sets || []).some(setHasEntry) || (x.warmups || []).some(setHasEntry); }
/* Planned slots plus any set-aside exercise (see syncSessionWithProgram) —
 * for read-only views of what was actually logged. */
function loggedExercises(session) { return [...(session.exercises || []), ...(session.extraExercises || [])]; }
function sessionHasEntry(session) {
  return (session.exercises || []).some(exerciseHasEntry) || (session.extraExercises || []).some(exerciseHasEntry);
}
function sessionHasSubstitution(session) {
  return (session.exercises || []).some(x => x.actualName && x.originalName && x.actualName !== x.originalName);
}
function checkinHasAnswer(session) { return !!session.checkin && Object.values(session.checkin).some(v => v !== ''); }
/* Anything worth keeping/showing: set entries, notes, a chosen substitution,
 * a named machine, a check-in, or an explicit completion (a workout marked
 * complete with every set skipped still counts toward its cycle). */
function sessionHasContent(session) {
  return sessionHasEntry(session) || String(session.notes || '').trim() !== '' || sessionHasSubstitution(session)
    || !!session.completedAt || checkinHasAnswer(session)
    || (session.exercises || []).some(x => String(x.equipmentId || '').trim() !== '');
}
function sessionProgress(session) {
  const total = (session.exercises || []).length;
  const done = (session.exercises || []).filter(exerciseComplete).length;
  return { done, total };
}
function setsProgress(session) {
  let done = 0, total = 0;
  for (const x of session.exercises || []) for (const s of x.sets || []) { total++; if (setComplete(s)) done++; }
  return { done, total };
}
/* 'done' | 'in-progress' | 'empty' — the only two *progress* states are the
 * first two; 'empty' just means nothing has been entered yet (no label).
 * Cycle programs are Done only when explicitly marked complete. */
function sessionStatus(session) {
  if (isCycleProgram(programByKey(session.programKey))) {
    return session.completedAt ? 'done' : (sessionHasEntry(session) ? 'in-progress' : 'empty');
  }
  const p = sessionProgress(session);
  if (p.total > 0 && p.done === p.total) return 'done';
  return sessionHasEntry(session) ? 'in-progress' : 'empty';
}
function exerciseVolume(x) {
  return x.sets.reduce((sum, s) => sum + (setComplete(s) ? Number(s.weight) * Number(s.reps) : 0), 0);
}

function currentBlockStart() { return ctx().blockStartDate || ''; }
/* With no block boundary set, every session ever logged counts (unchanged
 * behavior). Once a boundary exists, only sessions from that date onward
 * belong to "this week" — otherwise restarting a program at Week 1 collides
 * with an earlier cycle's Week 1 sessions (same week number, same program).
 * Cycle programs match on block id instead, so a back-dated session still
 * belongs to the block it was logged in. */
function sessionInCurrentBlock(session) {
  const sp = programByKey(session.programKey);
  if (isCycleProgram(sp)) {
    const block = activeBlock(sp);
    return !!block && session.blockId === block.id;
  }
  const start = currentBlockStart();
  return !start || session.date >= start;
}

function weekSessions(week, programKey) {
  const profile = activeProfile();
  return Object.values(state.sessions)
    .filter(s => s.profile === profile && s.week === week && s.programKey === programKey && sessionInCurrentBlock(s));
}

/* Explicit action only — never inferred from the week stepper wrapping, so
 * nudging the week down to fix a mis-click can't accidentally wipe out the
 * current block boundary. */
function startNewBlock() {
  const p = program();
  if (!confirm(`Start a new training block for ${p.shortName}? Week resets to 1. History keeps everything — this only changes which past sessions count toward "this week" and "Next".`)) return;
  const context = ctx();
  context.blockStartDate = todayISO();
  context.currentWeek = 1;
  // Otherwise a marker left over at up to 11 from the prior block blocks
  // maybeAutoAdvanceWeek's guard for the entire new block (weeks 1-11).
  context.autoAdvancedThroughWeek = 0;
  persist();
  render();
  toast('New block started — Week 1');
}

/* Weekly status for one scheduled workout card, aggregated per
 * (week, program, base workout) so gym-mode swaps and date changes cannot
 * fork it. Done if ANY session that week is done; In progress if any has
 * entries; the freshest matching session provides the X/N numbers. */
function workoutCardInfo(baseKey) {
  const p = program();
  const matches = weekSessions(currentWeek(), p.key).filter(s => baseWorkoutKey(s.workoutKey) === baseKey);
  const doneSessions = matches.filter(s => sessionStatus(s) === 'done');
  const withEntries = matches.filter(sessionHasEntry);
  const freshest = list => [...list].sort((a, b) =>
    (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''))[0];
  const session = doneSessions.length ? freshest(doneSessions) : (withEntries.length ? freshest(withEntries) : null);
  const status = doneSessions.length ? 'done' : (withEntries.length ? 'in-progress' : 'none');
  let exercisesDone = 0, exercisesTotal;
  if (session) {
    const pr = sessionProgress(session);
    exercisesDone = pr.done; exercisesTotal = pr.total;
  } else {
    const effective = p.workouts[effectiveWorkoutKey(p.key, baseKey, ctx().gymMode)];
    exercisesTotal = effective ? effective.exercises.length : 0;
  }
  return { status, session, exercisesDone, exercisesTotal };
}

/* "Next" pick: resume this week's In Progress workout first, then the first
 * untouched scheduled one; if the whole week is done, fall back to matching
 * today's weekday, then the next scheduled day. */
function nextWorkoutKey() {
  const p = program();
  const infos = scheduledWorkouts(p).map(w => ({ key: w.key, dayNumber: w.dayNumber, status: workoutCardInfo(w.key).status }));
  const inProgress = infos.find(i => i.status === 'in-progress');
  if (inProgress) return inProgress.key;
  const untouched = infos.find(i => i.status === 'none');
  if (untouched) return untouched.key;
  const day = new Date().getDay();
  const byDay = [...infos].sort((a, b) => (a.dayNumber || 0) - (b.dayNumber || 0));
  const exact = byDay.find(i => i.dayNumber === day);
  if (exact) return exact.key;
  const upcoming = byDay.find(i => i.dayNumber > day);
  return (upcoming || byDay[0] || {}).key || '';
}

function weekFullyDone(week, p) {
  const scheduled = scheduledWorkouts(p);
  return scheduled.length > 0 && scheduled.every(w => {
    const matches = weekSessions(week, p.key).filter(s => baseWorkoutKey(s.workoutKey) === w.key);
    return matches.some(s => sessionStatus(s) === 'done');
  });
}

/* Auto-advances the week once every scheduled workout is Done, so you don't
 * have to remember to bump the stepper. Weeks 1-11 only — reaching 12 means
 * the block itself is complete, and that's the explicit "Start new block"
 * decision (see startNewBlock), not something to silently wrap around to
 * Week 1. autoAdvancedThroughWeek makes this idempotent: it only fires once
 * per week, so manually stepping back to a finished week never re-triggers
 * it, and it can't loop forever advancing through already-complete history. */
function maybeAutoAdvanceWeek() {
  const p = program(), context = ctx(), week = clampWeek(context.currentWeek);
  if (week >= WEEK_MAX || Number(context.autoAdvancedThroughWeek) >= week) return false;
  if (!weekFullyDone(week, p)) return false;
  context.autoAdvancedThroughWeek = week;
  context.currentWeek = clampWeek(week + 1);
  return true;
}

/* A workout's calendar day/time, honoring any user customization from the
 * Sunday review card — falls back to the program's own scheduled day and
 * the profile's default time when nothing's been customized. */
function workoutScheduleOverride(key) { return (ctx().workoutScheduleOverrides || {})[key] || null; }
function scheduledDayNumber(w) {
  const override = workoutScheduleOverride(w.key);
  return override ? override.dayNumber : (w.dayNumber || 0);
}
function scheduledTime(w) {
  const override = workoutScheduleOverride(w.key);
  return override ? override.time : ctx().workoutTimeOfDay;
}

/* Next scheduled workout + the actual calendar date it next falls on (today
 * excluded, since "next" is shown right after finishing today's session). */
function nextScheduledInfo() {
  const p = program();
  // Deliberately NOT nextWorkoutKey(): that stays training-order-based (see
  // scheduledWorkouts/workoutList) so calendar customization never affects
  // "Next"/auto-advance. This banner is calendar-facing ("see you Monday"),
  // so among not-yet-done workouts it picks whichever's calendar slot
  // (respecting day overrides) comes up soonest — otherwise moving a
  // workout earlier in the week wouldn't be reflected here, and the banner
  // could point at a later day than what's actually next on the calendar.
  const infos = scheduledWorkouts(p).map(w => ({ w, status: workoutCardInfo(w.key).status }));
  const inProgress = infos.filter(i => i.status === 'in-progress');
  const pool = inProgress.length ? inProgress : infos.filter(i => i.status === 'none');
  if (!pool.length) return null;
  const todayDow = new Date().getDay();
  const withDelta = pool.map(({ w }) => {
    const dayNumber = scheduledDayNumber(w);
    let delta = dayNumber - todayDow;
    if (delta <= 0) delta += 7;
    return { w, dayNumber, delta };
  }).sort((a, b) => a.delta - b.delta);
  const soonest = withDelta[0];
  const actual = p.workouts[effectiveWorkoutKey(p.key, soonest.w.key, ctx().gymMode)] || soonest.w;
  return { name: actual.name, day: DAY_NAMES[soonest.dayNumber], date: dateISOFromToday(soonest.delta) };
}

/* Pure date-only arithmetic via local Y/M/D components — deliberately avoids
 * both `new Date(iso)` (parsed as UTC midnight per spec, one day off in most
 * US timezones) and any UTC round-trip, so month/year rollovers are handled
 * by the Date object's local setters without a timezone-shift bug. */
function addDaysISO(dateISO, days) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}
function mostRecentSunday() { return dateISOFromToday(-new Date().getDay()); }

/* One review per calendar week (anchored at the most recent Sunday), per
 * profile — approving or dismissing stamps weekReviewedFor so it won't
 * prompt again until the following Sunday rolls around. */
function weekReviewPending() { return ctx().weekReviewedFor !== mostRecentSunday(); }

function weekScheduleForSunday(sunday) {
  const p = program();
  return scheduledWorkouts(p).map(w => {
    const actual = p.workouts[effectiveWorkoutKey(p.key, w.key, ctx().gymMode)] || w;
    const dayNumber = scheduledDayNumber(w);
    return {
      key: w.key, dayNumber, day: DAY_NAMES[dayNumber], name: actual.name, focus: actual.focus || '',
      date: addDaysISO(sunday, dayNumber), time: scheduledTime(w),
    };
  });
}

/* ═══ 4b. Cycle-block programs ═══
 * A cycle program (the six-cycle Upper / Lower) advances by completion, not
 * by dates: a cycle is one explicit completion of every scheduled workout,
 * office and YMCA variants counting as the same workout. The current cycle
 * is DERIVED — the first cycle of the active block that isn't fully
 * complete — so time passing or opening a screen can never advance it, and
 * there's no counter to drift. Each workout has one session per cycle: if
 * it was started, selecting it resumes that session (whatever day it was
 * started), rather than opening a fresh one dated today. */

function cycleBlocks() {
  const context = ctx();
  if (!context.cycleBlocks || typeof context.cycleBlocks !== 'object') context.cycleBlocks = {};
  return context.cycleBlocks;
}
function activeBlock(p) {
  if (!isCycleProgram(p)) return null;
  const block = cycleBlocks()[p.key];
  return block && BLOCK_ID_RE.test(String(block.id || '')) ? block : null;
}
function pinnedSession(p) {
  const key = ctx().pinnedSessionKey || '';
  const s = key && Object.prototype.hasOwnProperty.call(state.sessions, key) ? state.sessions[key] : null;
  return s && s.programKey === p.key && s.profile === activeProfile() ? s : null;
}
/* { cycle, complete } — cycle is the first not-fully-complete cycle; when
 * every cycle is complete it stays on the last one with complete = true. */
function cycleFrontier(p) {
  if (!activeBlock(p)) return { cycle: firstCycle(p), complete: false };
  for (let c = firstCycle(p); c <= cycleCount(p); c++) if (!weekFullyDone(c, p)) return { cycle: c, complete: false };
  return { cycle: cycleCount(p), complete: true };
}
function blockSessions(p, block) {
  const profile = activeProfile();
  return Object.values(state.sessions)
    .filter(s => s.profile === profile && s.programKey === p.key && s.blockId === block.id)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.updatedAt || '').localeCompare(b.updatedAt || ''));
}
function workoutDisplayName(session) {
  return PROGRAMS[session.programKey]?.workouts?.[session.workoutKey]?.name || session.workoutKey;
}
/* Keep the block's completed flag in step with its sessions — reopening or
 * deleting a cycle-6 workout un-completes the block. */
function syncBlockCompletion(p) {
  const block = activeBlock(p);
  if (!block) return;
  const complete = cycleFrontier(p).complete;
  if (complete && !block.completedAt) block.completedAt = todayISO();
  if (!complete && block.completedAt) block.completedAt = '';
}

function currentCycleSession(p) {
  const block = activeBlock(p);
  if (!block) return null;
  const profile = activeProfile();
  const base = baseWorkoutKey(ctx().selectedWorkoutKey);
  const pinned = pinnedSession(p);
  if (pinned && baseWorkoutKey(pinned.workoutKey) === base) {
    state.sessions[pinned.key] = syncSessionWithProgram(pinned);
    return state.sessions[pinned.key];
  }
  const cycle = currentWeek();
  const effective = effectiveWorkoutKey(p.key, base, ctx().gymMode);
  const today = todayISO();
  const matches = weekSessions(cycle, p.key).filter(s => baseWorkoutKey(s.workoutKey) === base);
  const started = matches.filter(sessionHasContent)
    .sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''));
  if (started.length) {
    // Resume: a started workout keeps its own date and gym variant.
    state.sessions[started[0].key] = syncSessionWithProgram(started[0]);
    return state.sessions[started[0].key];
  }
  // Untouched shells from browsing follow the current gym toggle and are
  // re-dated to today — unless their date was picked on purpose.
  const chosenDate = (matches.find(s => s.dateChosen) || {}).date || '';
  for (const s of matches) {
    if (s.workoutKey !== effective || (!s.dateChosen && s.date !== today)) delete state.sessions[s.key];
  }
  const shell = matches.find(s => state.sessions[s.key]);
  if (shell) {
    shell.gymMode = gymMode();
    state.sessions[shell.key] = syncSessionWithProgram(shell);
    return state.sessions[shell.key];
  }
  const fresh = newSession(profile, p.key, effective, chosenDate || today, cycle, ctx().gymMode, block.id);
  if (chosenDate) fresh.dateChosen = true;
  state.sessions[fresh.key] = fresh;
  return fresh;
}

/* ═══ 5. History, suggestions, trends ═══ */

/* All history lookups are scoped to the active profile and program — this is
 * what keeps one user's numbers out of the other's hints/suggestions (v1
 * matched across programs via the alias table, so dad's Hip Thrust
 * suggestions could come from daughter's history and vice versa). */
/* opts (cycle/strict programs): gym — only sessions from that gym (machine
 * loads aren't comparable across gyms); equipmentId — once a machine is
 * named, only entries logged on that same named machine (unnamed history
 * isn't assumed to be the same machine); completedOnly / excludeDeload — the
 * basis for progression ("exclude warm-ups, deloads and incomplete sessions"). */
function historyEntries(name, excludeKey, opts = {}) {
  const p = program();
  const strict = isStrictProgram(p);
  const names = new Set(strict ? [name] : aliasNames(name));
  const wantMachine = String(opts.equipmentId || '').trim().toLowerCase();
  const profile = activeProfile();
  const results = [];
  for (const session of Object.values(state.sessions)) {
    if (session.profile !== profile) continue;
    if (session.programKey !== p.key) continue;
    if (excludeKey && session.key === excludeKey) continue;
    if (!sessionHasEntry(session)) continue;
    if (opts.gym && session.gymMode !== opts.gym) continue;
    if (opts.completedOnly && !session.completedAt) continue;
    if (opts.excludeDeload && isCycleProgram(p) && session.week === 0) continue;
    session.exercises.forEach((x, i) => {
      // The movement actually performed — never the slot it filled, so a DB
      // glute bridge done in the barbell hip-thrust slot is never compared
      // with barbell loads (or the other way round).
      if (strict ? x.actualName !== name : !names.has(x.actualName)) return;
      const theirMachine = String(x.equipmentId || '').trim().toLowerCase();
      if (wantMachine && theirMachine !== wantMachine) return;
      // Skip exercises with no performance data, or a newer partial session
      // (one stray keystroke on another exercise) would shadow older complete
      // history and blank out hints/suggestions/trends for everything else.
      if (!x.sets.some(s => Number(s.weight) > 0 || Number(s.reps) > 0)) return;
      results.push({ session, exercise: x, index: i });
    });
  }
  return results.sort((a, b) =>
    (b.session.date || '').localeCompare(a.session.date || '') ||
    (b.session.updatedAt || '').localeCompare(a.session.updatedAt || ''));
}
/* Week-based programs: history of the movement actually performed (alias
 * table included) and, in a program used at two gyms, only that gym's
 * sessions — the equipment differs. There is deliberately no fallback to the
 * slot's original exercise: a substitute with no history calibrates fresh. */
function movementOpts(session) {
  return hasGymToggle(programByKey(session.programKey)) ? { gym: session.gymMode } : {};
}
function lastPerformance(x, session) {
  return historyEntries(x.actualName, session.key, movementOpts(session))[0] || null;
}
/* "Comparable" for a strict program = same variant name, and for machine
 * conventions also the same gym and (if named) the same machine. */
function comparableOpts(x, session) {
  const p = programByKey(session.programKey);
  if (!isStrictProgram(p)) return {};
  const machine = MACHINE_CONVENTIONS.has(conventionForName(p, x.actualName));
  return machine ? { gym: session.gymMode, equipmentId: x.equipmentId || '' } : {};
}
function comparableHistory(x, session, extra = {}) {
  return historyEntries(x.actualName, session.key, { ...comparableOpts(x, session), ...extra });
}
/* Most recent comparable performance — the "Last:" line and Repeat source.
 * In a training cycle, the deliberately light deload sessions are skipped
 * (a deload is never a regression) unless they're all there is. */
function lastFor(x, session) {
  const p = programByKey(session.programKey);
  if (!isStrictProgram(p)) return lastPerformance(x, session);
  const all = comparableHistory(x, session);
  if (isCycleProgram(p) && session.week > 0) return all.find(e => e.session.week !== 0) || all[0] || null;
  return all[0] || null;
}
function workingSetsOf(exercise) { return (exercise.sets || []).filter(setComplete); }

function formatSets(sets) {
  const entered = sets.filter(s => Number(s.weight) > 0 || Number(s.reps) > 0);
  if (!entered.length) return 'No data';
  const weights = entered.map(s => Number(s.weight) || 0).filter(Boolean);
  const reps = entered.map(s => Number(s.reps) || 0).filter(Boolean);
  return `${weights.length ? weights.join('/') : '-'} × ${reps.length ? reps.join('/') : '-'}`;
}
/* Most common (then heaviest) working weight of a past exercise. */
function commonWeight(sets) {
  const weights = sets.map(s => Number(s.weight)).filter(x => x > 0);
  if (!weights.length) return 0;
  const counts = {};
  weights.forEach(x => counts[x] = (counts[x] || 0) + 1);
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0][0]);
}

function intensityBadge(t) {
  return t.intensityType === 'rpe' ? `RPE ${t.intensityMin}–${t.intensityMax}`
    : t.intensityType === 'special' ? (t.intensityLabel || 'Special')
    : `RIR ${t.rirTarget}`;
}
function intensityLabel(t) { return t.intensityType === 'rpe' ? 'RPE' : t.intensityType === 'special' ? 'Effort' : 'RIR'; }
function intensityPlaceholder(t) {
  return t.intensityType === 'rpe' ? `${t.intensityMin}–${t.intensityMax}`
    : t.intensityType === 'special' ? (t.intensityHint ? 'note' : '-')
    : String(t.rirTarget);
}

/* Double-progression check on the last performance. Met only when every
 * PLANNED set was done (weight and whole reps logged), every one reached the
 * top of the rep range, and the effort is confirmed on each: RIR at or above
 * the target (more in reserve = easier) or RPE at or under the max (higher
 * RPE = harder). 'unknown' = top reps everywhere but effort not logged on
 * every set — never treated as met. */
function progressionCheck(sets, t, planned) {
  const done = sets.filter(setComplete);
  if (!planned || done.length < planned) return 'no';
  const work = done.slice(0, planned);
  if (!work.every(s => Number(s.reps) >= t.repsMax)) return 'no';
  if (t.intensityType === 'special') return 'yes';
  const efforts = work.map(s => (String(s.rir ?? '').trim() === '' || !Number.isFinite(Number(s.rir)) ? null : Number(s.rir)));
  const short = t.intensityType === 'rpe'
    ? efforts.some(e => e !== null && e > t.intensityMax)
    : efforts.some(e => e !== null && e < t.rirTarget);
  if (short) return 'no';
  return efforts.some(e => e === null) ? 'unknown' : 'yes';
}

function suggestLoad(x, t, session) {
  if (!t) return { value: '', label: '' };
  const last = lastPerformance(x, session);
  if (!last) return { value: '', label: 'No prior data' };
  const base = commonWeight(last.exercise.sets);
  if (!base) return { value: '', label: 'No load last time' };
  const check = progressionCheck(last.exercise.sets, t, plannedSetsFor(last, t.sets));
  const step = t.step || 5;
  const value = check === 'yes' ? roundLoad(base + step) : base;
  let label = check === 'yes' ? `Met target → +${step}`
    : check === 'unknown' ? `Top reps hit — log ${intensityLabel(t)} on every set to confirm a load increase`
    : 'Repeat load, beat reps';
  if (t.intensityType === 'special' && t.intensityHint) label += ` · ${t.intensityHint}`;
  return { value, label };
}

function exerciseTemplate(session, index) {
  return PROGRAMS[session.programKey]?.workouts?.[session.workoutKey]?.exercises?.[index];
}

function getTrend(name, limit, opts) {
  const entries = historyEntries(name, null, opts || {}).slice(0, limit || 8).reverse();
  if (entries.length < 2) return null;
  const points = entries
    .map(e => ({ date: e.session.date, weight: commonWeight(e.exercise.sets), vol: Math.round(exerciseVolume(e.exercise)) }))
    .filter(p => p.weight > 0);
  if (points.length < 2) return null;
  const first = points[0].weight, last = points[points.length - 1].weight;
  const delta = last - first, pct = first > 0 ? Math.round((delta / first) * 100) : 0;
  return { points, delta, pct, up: delta > 0, flat: delta === 0 };
}
function sparkSVG(points, w, h) {
  if (!points || points.length < 2) return '';
  const vals = points.map(p => p.weight);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const range = mx - mn || 1;
  const pad = 2, iw = w - pad * 2, ih = h - pad * 2;
  const coords = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * iw;
    const y = pad + ih - (((v - mn) / range) * ih);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = vals[vals.length - 1] >= vals[0] ? 'var(--gn)' : 'var(--rd)';
  const [lx, ly] = coords[coords.length - 1].split(',');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="${coords.join(' ')}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="${lx}" cy="${ly}" r="2" fill="${color}"/></svg>`;
}
function trendHTML(name, opts) {
  const t = getTrend(name, 8, opts);
  if (!t) return '';
  const cls = t.up ? 'spark-up' : t.flat ? '' : 'spark-dn';
  const arrow = t.up ? '↑' : t.flat ? '→' : '↓';
  const label = `${arrow} ${t.up ? '+' : ''}${t.delta} lb (${t.up ? '+' : ''}${t.pct}%) over ${t.points.length} sessions`;
  return `<div class="ex-spark">${sparkSVG(t.points, 80, 24)}<span class="${cls}">${label}</span></div>`;
}

/* ═══ 5b. Cycle-program progression ═══
 * Precedence (per the program spec): phase overrides first (deload, entry
 * cycle, build cycles), then exercise-specific rules (flat bench, incline),
 * then general double progression — and logged symptoms override all of
 * them. The basis is the most recent comparable, explicitly completed,
 * non-deload session; warm-ups never count. A suggestion is advice shown
 * beside the sets — it's only written into a set if you tap Suggest. */

function officeCapFor(session, conv) {
  return session.gymMode === 'office' && OFFICE_LOAD_CAPS[conv] ? OFFICE_LOAD_CAPS[conv] : 0;
}
function incrementFor(conv, t) {
  return conv === 'bar_included_total_lb' || conv === 'per_dumbbell_lb' || conv === 'single_implement_lb' ? 5 : (t.step || 5);
}
function incrementLabel(conv, inc) {
  if (conv === 'bar_included_total_lb') return `${inc} lb`;
  if (conv === 'per_dumbbell_lb') return `${inc} lb per dumbbell (or the smallest jump available)`;
  if (conv === 'single_implement_lb') return `${inc} lb (or the smallest jump available)`;
  return `${inc} lb (or the smallest increment on that machine)`;
}
function reducedLoad(w, inc) {
  let v = Math.round((w * 0.925) / inc) * inc;
  if (v >= w) v = w - inc;
  return Math.max(0, roundLoad(v));
}
function symptomFlag(region, c) {
  if (!c) return false;
  if (region === 'shoulder') {
    return c.shoulderDuring === 'some' || c.catchingOccurred === 'yes' || c.repositionNeeded === 'yes'
      || c.shoulderLaterSameDay === 'some' || c.shoulderNextDay === 'some';
  }
  if (region === 'back') return c.backDuring === 'some' || c.backNextDay === 'some';
  return false;
}
function totalReps(exercise) { return workingSetsOf(exercise).reduce((a, s) => a + (Number(s.reps) || 0), 0); }
/* Three comparable sessions at the same load without more total reps. */
function plateauNote(entries) {
  if (entries.length < 3) return '';
  const [a, b, c] = entries;
  const wa = commonWeight(workingSetsOf(a.exercise));
  if (!wa || wa !== commonWeight(workingSetsOf(b.exercise)) || wa !== commonWeight(workingSetsOf(c.exercise))) return '';
  return totalReps(a.exercise) <= totalReps(c.exercise)
    ? ' Three sessions without added load or reps — check rest, sleep, symptoms and execution before changing anything.' : '';
}

/* A history entry's own planned working sets — Upper A and Upper B share the
 * pulldown's history but plan 2 and 3 sets, so "every set at the top" is
 * judged against the session it came from. */
function plannedSetsFor(entry, fallback) {
  const t = exerciseTemplate(entry.session, entry.index);
  const p = programByKey(entry.session.programKey);
  return t && p ? targetSets(t, p, entry.session.week) : fallback;
}
/* Symptom precedence: symptoms for a region logged in ANY session of this
 * program on or after `sinceDate` — another workout, a lift that was racked
 * and left blank, or the open session itself — hold that region's lifts. */
function symptomsSince(region, sinceDate, session) {
  if (!region) return false;
  return Object.values(state.sessions).some(s => s.profile === session.profile && s.programKey === session.programKey
    && (s.date || '') >= sinceDate && symptomFlag(region, s.checkin));
}

/* Flat bench: both working sets at 10+ reps with logged RIR ≥ 3, and the
 * shoulder explicitly clear during training, later that day AND the next
 * morning. Unknown counts as not-yet-qualified. Symptoms are checked first. */
function benchQualifies(entry, t) {
  const c = entry.session.checkin || emptyCheckin();
  if (symptomFlag('shoulder', c)) return { ok: false, reason: 'symptoms' };
  const sets = workingSetsOf(entry.exercise);
  if (sets.length < t.sets) return { ok: false, reason: 'sets' };
  const work = sets.slice(0, t.sets);
  if (!work.every(s => Number(s.reps) >= t.repsMax)) return { ok: false, reason: 'reps' };
  if (work.some(s => String(s.rir).trim() === '')) return { ok: false, reason: 'rirMissing' };
  if (work.some(s => Number(s.rir) < t.rirMin)) return { ok: false, reason: 'rir' };
  if (c.shoulderDuring !== 'none' || c.shoulderLaterSameDay !== 'none' || c.shoulderNextDay !== 'none') return { ok: false, reason: 'checkinMissing' };
  return { ok: true, reason: '' };
}
function benchSuggestion(t, entries, session) {
  const e0 = entries[0], e1 = entries[1];
  const sets = workingSetsOf(e0.exercise);
  const w = commonWeight(sets);
  const limits = ' Two working sets max · 8–10 reps · no back-off sets.';
  if (!w) return { value: '', tone: 'info', label: 'No load logged last time — calibrate from easy warm-ups.' };
  const q0 = benchQualifies(e0, t);
  if (q0.reason === 'symptoms' || symptomsSince('shoulder', e0.session.date, session)) {
    return { value: '', tone: 'stop', label: 'Shoulder symptoms were logged in or since your last bench session — no increase. Hold or reduce, stop and rack if catching recurs, and arrange a routine sports-physio assessment before any heavier bench work.' };
  }
  if (q0.ok) {
    const q1 = e1 ? benchQualifies(e1, t) : null;
    // A flare anywhere between the two bench sessions breaks the streak.
    if (q1 && q1.ok && commonWeight(workingSetsOf(e1.exercise)) === w && !symptomsSince('shoulder', e1.session.date, session)) {
      return { value: roundLoad(w + 5), tone: 'up', label: `Two clean sessions in a row at ${w} lb (10/10 at 3 RIR, shoulder clear) → add 5 lb.${limits}` };
    }
    return { value: w, tone: 'hold', label: `1 of 2 clean sessions at ${w} lb — repeat it; an increase needs one more clean session in a row.${limits}` };
  }
  if (q0.reason === 'checkinMissing') {
    return { value: w, tone: 'hold', label: `Both sets hit 10 at 3 RIR — waiting on that session’s shoulder check-in (during, later that day, next morning) before any increase. Hold ${w} lb.${limits}` };
  }
  if (q0.reason === 'rirMissing') {
    return { value: w, tone: 'hold', label: `Log RIR on both sets — an increase needs 10 reps at 3 RIR, confirmed. Hold ${w} lb.${limits}` };
  }
  if (Number(sets[0]?.reps) > 0 && Number(sets[0].reps) < t.repsMin) {
    return { value: reducedLoad(w, 5), tone: 'down', label: `First set fell below ${t.repsMin} reps — reduce about 5–10% rather than grinding.${limits}` };
  }
  return { value: w, tone: 'hold', label: `Hold ${w} lb — build both sets toward 10 at 3 RIR.${plateauNote(entries)}${limits}` };
}

/* rirMin is the session's phase target — Cycle 1 requires 3 RIR even where
 * the exercise's own build-phase minimum is lower. */
function doubleProgression(x, t, session, entries, conv, rirMin) {
  const e = entries[0];
  const sets = workingSetsOf(e.exercise);
  const w = commonWeight(sets);
  if (!w) return { value: '', tone: 'info', label: 'No load logged last time — calibrate from easy warm-ups.' };
  const inc = incrementFor(conv, t);
  const cap = officeCapFor(session, conv);
  const side = t.perSide ? `/${t.perSide}` : '';
  // Symptoms first — they override every load and rep target.
  if (symptomsSince(t.symptom, e.session.date, session)) {
    const hold = cap && w > cap ? cap : w;
    return { value: hold, tone: 'stop', label: `${t.symptom === 'back' ? 'Back' : 'Shoulder'} symptoms were logged in or since your last session of this lift — hold ${hold} lb or go lighter; never progress through pain.` };
  }
  // A heavier YMCA load can't carry into the office (no 85-lb split squat).
  if (cap && w > cap) {
    return { value: cap, tone: 'hold', label: `Last time was ${w} lb — above the office max (${cap} lb). Use ${cap} lb here and build reps${t.officeCeiling ? ` (up to ${t.officeCeiling.repsMax}${side})` : ` toward ${t.repsMax}${side}`}.` };
  }
  const ceiling = t.officeCeiling && session.gymMode === 'office' && w >= t.officeCeiling.lb ? t.officeCeiling.repsMax : 0;
  const repsMax = Math.max(t.repsMax, ceiling);
  const plateau = plateauNote(entries);
  const first = Number(sets[0]?.reps) || 0;
  if (first && first < t.repsMin) {
    return { value: reducedLoad(w, inc), tone: 'down', label: `First set fell below ${t.repsMin} reps — reduce about 5–10% and don’t grind.` };
  }
  const planned = plannedSetsFor(e, t.sets);
  const work = sets.slice(0, planned);
  const allTop = sets.length >= planned && work.every(s => Number(s.reps) >= repsMax);
  const rirs = work.map(s => String(s.rir).trim() === '' ? null : Number(s.rir));
  const rirLow = rirs.some(r => r !== null && r < rirMin);
  const rirUnknown = rirs.some(r => r === null);
  if (allTop && !rirLow && rirUnknown) {
    return { value: w, tone: 'hold', label: `Reps are there — log RIR on every set to confirm ≥${rirMin} before adding load. Hold ${w} lb.${plateau}` };
  }
  if (allTop && !rirLow) {
    const target = roundLoad(w + inc);
    if (t.progression === 'inclineReview' && x.actualName === t.name) {
      const capped = cap && target > cap;
      return { value: capped ? w : target, tone: 'review', label: `${repsMax}/${repsMax} at ≥${rirMin} RIR — consider heavier DBs${capped ? ' (office DBs stop at 70 lb — the YMCA has heavier)' : ` (${target} lb)`} or a low-incline barbell press. Your call — the app won’t switch exercises automatically.` };
    }
    if (cap && target > cap) {
      return ceiling && repsMax >= t.officeCeiling.repsMax
        ? { value: w, tone: 'review', label: `${repsMax}${side} at the office max (${cap} lb) — time to reassess: progress the load at the YMCA, or hold here.` }
        : { value: w, tone: 'hold', label: `Top of the range at the office max (${cap} lb) — keep the load and build reps.` };
    }
    return { value: target, tone: 'up', label: `All sets hit ${repsMax}${side} at ≥${rirMin} RIR → add ${incrementLabel(conv, inc)}.` };
  }
  if (allTop && rirLow) return { value: w, tone: 'hold', label: `Reps are there but RIR dipped under ${rirMin} — hold ${w} lb until it’s comfortable.${plateau}` };
  if (sets.slice(1, planned).some(s => Number(s.reps) < t.repsMin)) {
    return { value: w, tone: 'hold', label: `Later sets dropped below ${t.repsMin} — take the full ${formatSeconds(t.rest)} rest; lower the load only if it happens again.${plateau}` };
  }
  if (ceiling) return { value: w, tone: 'hold', label: `At the office load ceiling — hold ${w} lb and build toward ${repsMax}${side}.${plateau}` };
  return { value: w, tone: 'hold', label: `Hold ${w} lb — add reps toward ${repsMax}${side} on every set.${plateau}` };
}

function cycleSuggestion(x, t, session) {
  const p = programByKey(session.programKey);
  const conv = conventionForName(p, x.actualName) || t.weightConvention;
  const tg = phaseTargets(t, p, session.week);
  if (session.week === 0) {
    const last = lastFor(x, session);
    const ref = last ? commonWeight(workingSetsOf(last.exercise)) : 0;
    return { value: '', tone: 'info', calibrating: true, label: `Deload: one set at 4–5 RIR — go lighter than usual${ref ? ` (last working load ${ref} lb)` : ''}. No progression or PRs.` };
  }
  const entries = comparableHistory(x, session, { completedOnly: true, excludeDeload: true })
    .filter(e => workingSetsOf(e.exercise).length);
  if (!entries.length) {
    return { value: '', tone: 'info', calibrating: true, label: `Calibrate: choose a load from easy warm-ups for ${tg.repsMin}–${tg.repsMax} clean reps at ${rirText(tg)} RIR. The RIR target beats any suggested number.` };
  }
  const s = t.progression === 'benchTwoSession' && x.actualName === t.name ? benchSuggestion(t, entries, session) : doubleProgression(x, t, session, entries, conv, tg.rirMin);
  const cap = officeCapFor(session, conv);
  if (cap && s.value !== '' && s.value > cap) s.value = cap;
  return s;
}
function suggestionFor(x, t, session) {
  return isCycleProgram(programByKey(session.programKey)) ? cycleSuggestion(x, t, session) : suggestLoad(x, t, session);
}

/* Same movement logged under an older program — shown during calibration as
 * reference only (the old load convention is unconfirmed, so it's never
 * turned into a target or suggestion). */
function legacyReference(t) {
  if (!Array.isArray(t.legacyRefs) || !t.legacyRefs.length) return null;
  const profile = activeProfile(), current = program().key;
  let best = null;
  for (const s of Object.values(state.sessions)) {
    if (s.profile !== profile || s.programKey === current) continue;
    for (const x of s.exercises || []) {
      if (!t.legacyRefs.includes(x.actualName) || !workingSetsOf(x).length) continue;
      if (!best || (s.date || '') > (best.session.date || '')) best = { session: s, exercise: x };
    }
  }
  return best;
}
/* Warm-up ramp text. First main lift of the workout gets the full ramp
 * (with loads when there's a reference); later compounds get a lighter note. */
function warmupGuidance(t, ei, session, refLoad, conv) {
  if (t.type !== 'compound') return '';
  if (ei > 0) return t.warmupNote || '0–2 brief, easy ramp sets — depending on how different the movement and load are from what you just did.';
  if (session.week === 0 || !refLoad) return 'Ramp up easy: ~40–50% of your working load × 6–8, 65–70% × 4–5, 80–85% × 2–3.';
  const floor = conv === 'bar_included_total_lb' ? 45 : 0;
  const r = f => Math.max(floor, Math.round((refLoad * f) / 5) * 5);
  return `Ramp up easy toward ~${refLoad}: ${r(0.45)} × 6–8 · ${r(0.675)} × 4–5 · ${r(0.825)} × 2–3 (adapt to your increments).`;
}

/* ═══ 6. Stats & entry warnings ═══ */

function programStats() {
  const profile = activeProfile();
  const sessions = Object.values(state.sessions).filter(s => s.profile === profile && s.programKey === program().key && sessionHasEntry(s));
  const chrono = [...sessions].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.updatedAt || '').localeCompare(b.updatedAt || ''));
  let volume = 0, setCount = 0, prCount = 0;
  const best = {};
  const p = program();
  const strict = isStrictProgram(p);
  for (const s of chrono) for (const x of s.exercises) {
    volume += exerciseVolume(x);
    // Machine loads only compete with the same gym's machine (and a deload
    // never counts as a PR attempt).
    const id = strict && MACHINE_CONVENTIONS.has(conventionForName(p, x.actualName)) ? `${x.actualName}@${s.gymMode}` : x.actualName;
    for (const set of x.sets) {
      if (setComplete(set)) setCount++;
      if (strict && isCycleProgram(p) && s.week === 0) continue;
      const w = Number(set.weight) || 0;
      if (w > (best[id] || 0)) {
        if (best[id] !== undefined) prCount++;
        best[id] = w;
      }
    }
  }
  const doneThisWeek = scheduledWorkouts().filter(w => workoutCardInfo(w.key).status === 'done').length;
  return { sessions: sessions.length, volume: Math.round(volume), sets: setCount, prs: prCount, doneThisWeek };
}

function metricsFor(date) { return ctx().metricsByDate[date] || { sleep: '', energy: '', soreness: '', bodyweight: '' }; }
function previousBodyweight(date) {
  const entries = Object.entries(ctx().metricsByDate)
    .filter(([d, m]) => d < date && m && Number(m.bodyweight) > 0)
    .sort((a, b) => a[0] < b[0] ? 1 : -1);
  return entries.length ? Number(entries[0][1].bodyweight) : 0;
}

function entryWarnings(session) {
  const out = [];
  const metrics = metricsFor(session.date);
  const bw = Number(metrics.bodyweight) || 0;
  const prev = previousBodyweight(session.date);
  if (bw && prev && Math.abs(bw - prev) / prev > 0.08) {
    out.push(`Bodyweight differs from your last entry by ${Math.round(((bw - prev) / prev) * 100)}%. Check the entry.`);
  }
  const sp = programByKey(session.programKey);
  session.exercises.forEach((x, i) => {
    const t = exerciseTemplate(session, i);
    if (isCycleProgram(sp)) {
      const conv = conventionForName(sp, x.actualName);
      const cap = officeCapFor(session, conv);
      if (cap && x.sets.some(s => Number(s.weight) > cap)) out.push(`${x.actualName}: the office max is ${cap} lb — check the entry.`);
      if (session.week === 0 && x.sets.some(s => String(s.rir ?? '').trim() !== '' && Number(s.rir) < 4)) out.push(`${x.actualName}: deload sets should stay at 4–5 RIR.`);
    }
    // One load-sanity check per exercise (not per set) against last time's
    // working weight — catches fat-finger entries (a stray extra digit, a
    // missed decimal) without nagging on every set of a legitimate jump.
    // Gated on a >=20lb prior weight so normal swings on light accessory/
    // calf work (e.g. 10 -> 15 lb) don't trigger false positives.
    const last = lastFor(x, session);
    const lastWeight = last ? commonWeight(last.exercise.sets) : 0;
    const curWeight = commonWeight(x.sets);
    if (curWeight > 0 && lastWeight >= 20) {
      const pct = Math.abs(curWeight - lastWeight) / lastWeight;
      if (pct > 0.45) {
        out.push(`${x.actualName}: ${curWeight} lb is ${Math.round(pct * 100)}% ${curWeight > lastWeight ? 'higher' : 'lower'} than your last working weight (${lastWeight} lb). Check the entry.`);
      }
    }
    x.sets.forEach((s, si) => {
      const w = String(s.weight ?? '').trim(), r = Number(s.reps) || 0;
      const rir = String(s.rir ?? '').trim() === '' ? null : Number(s.rir);
      if (!setValuesValid(s)) out.push(`${x.actualName} set ${si + 1}: this entry can’t count — weight must be 0 or more and reps a whole number.`);
      if (w !== '' && Number(w) > 0 && !r) out.push(`${x.actualName} set ${si + 1}: weight entered but reps are blank.`);
      if (r > 0 && w === '') out.push(`${x.actualName} set ${si + 1}: weight is blank — enter 0 for bodyweight.`);
      if (rir !== null && rir > 6) out.push(`${x.actualName} set ${si + 1}: RIR/RPE entry looks unusually high.`);
      if (t?.type === 'compound' && rir !== null && rir <= 0) out.push(`${x.actualName} set ${si + 1}: compound failure logged. Consider backing off next time.`);
    });
  });
  return out.slice(0, 5);
}

/* ═══ 7. Renderers ═══ */

function progressRing(fraction, done) {
  const size = 26, stroke = 3, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, fraction)));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="tk" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/><circle class="fl" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>${done ? `<text class="ck" x="50%" y="56%" dominant-baseline="middle" text-anchor="middle">✓</text>` : ''}</svg>`;
}
function statusTag(status) {
  if (status === 'done') return '<span class="tag tag-dn">Done</span>';
  if (status === 'in-progress') return '<span class="tag tag-ip">In progress</span>';
  return '';
}

function workoutGridHTML() {
  const p = program(), context = ctx();
  const scheduled = scheduledWorkouts(p);
  return scheduled.map(w => {
    const info = workoutCardInfo(w.key);
    const actual = p.workouts[effectiveWorkoutKey(p.key, w.key, context.gymMode)] || w;
    const swapped = actual.key !== w.key;
    const fraction = info.exercisesTotal ? info.exercisesDone / info.exercisesTotal : 0;
    const selected = w.key === baseWorkoutKey(context.selectedWorkoutKey);
    const sub = `${info.exercisesDone}/${info.exercisesTotal} exercises${swapped ? ' · Office' : ''}`;
    return `<button class="wo-b ${selected ? 'on' : ''} ${info.status === 'done' ? 'done' : ''}" data-wo="${escapeHTML(w.key)}">${progressRing(fraction, info.status === 'done')}<span class="wo-bt"><strong>${escapeHTML(actual.name)}</strong><span>${sub} ${statusTag(info.status)}</span></span></button>`;
  }).join('');
}

function statsCardHTML() {
  const stats = programStats();
  return `<div class="card"><div class="stats"><div class="st"><strong>${stats.doneThisWeek}</strong><span>${isCycleProgram(program()) ? 'Done this cycle' : 'Done this wk'}</span></div><div class="st"><strong>${stats.sessions}</strong><span>Sessions</span></div><div class="st"><strong>${stats.sets}</strong><span>Sets</span></div><div class="st"><strong>${stats.prs}</strong><span>PRs</span></div></div></div>`;
}

function warningsHTML(session) {
  const warnings = entryWarnings(session);
  if (!warnings.length) return '';
  return `<div class="bn bn-w"><strong>Check entries:</strong><br>${warnings.map(escapeHTML).join('<br>')}</div>`;
}

function weekLabelFor(session) {
  const p = programByKey(session.programKey);
  return isCycleProgram(p) ? cycleLabel(p, session.week) : `Week ${session.week}`;
}

function statusLineHTML(session) {
  const status = sessionStatus(session);
  const ex = sessionProgress(session), sets = setsProgress(session);
  const when = `${escapeHTML(prettyDate(session.date))} · ${escapeHTML(weekLabelFor(session))}`;
  if (isCycleProgram(programByKey(session.programKey))) {
    if (status === 'done') {
      const skipped = sets.total - sets.done;
      return `<div class="stat-line"><span class="tag tag-dn">Done</span><span>${sets.done}/${sets.total} sets${skipped ? ` (${skipped} skipped)` : ''} · ${when} · <small>completed ${escapeHTML(prettyDateTime(session.completedAt))}</small></span></div>`;
    }
    if (status === 'in-progress') {
      const allIn = sets.total > 0 && sets.done === sets.total;
      return `<div class="stat-line"><span class="tag tag-ip">In progress</span><span>${ex.done}/${ex.total} exercises · ${sets.done}/${sets.total} sets · ${when} · <small>${allIn ? '<strong>all sets logged — tap Complete workout</strong>' : 'autosaved'}</small></span></div>`;
    }
    return `<div class="stat-line"><span>Not started · ${ex.total} exercises · ${when}</span><small>Mark it complete when you finish — skipped sets are fine.</small></div>`;
  }
  if (status === 'done') {
    return `<div class="stat-line"><span class="tag tag-dn">Done</span><span>${ex.done}/${ex.total} exercises · ${sets.done}/${sets.total} sets · ${when}${session.updatedAt ? ` · <small>updated ${escapeHTML(prettyDateTime(session.updatedAt))}</small>` : ''}</span></div>`;
  }
  if (status === 'in-progress') {
    return `<div class="stat-line"><span class="tag tag-ip">In progress</span><span>${ex.done}/${ex.total} exercises · ${sets.done}/${sets.total} sets · ${when} · <small>autosaved</small></span></div>`;
  }
  return `<div class="stat-line"><span>Not started · ${ex.total} exercises · ${when}</span><small>Entries autosave as you type.</small></div>`;
}

function gymChoiceHTML() {
  return `<span class="lbl">Gym</span><div class="gym-choice"><button class="${gymMode() === 'ymca' ? 'on' : ''}" data-gym="ymca">YMCA</button><button class="${gymMode() === 'office' ? 'on' : ''}" data-gym="office">Office Gym</button></div>`;
}
function readinessCardHTML(date) {
  const metrics = metricsFor(date);
  return `<div class="card"><div class="card-h"><h2>Readiness</h2><span class="hint">Check-in</span></div><div class="met">` +
    `<div class="mf"><label for="mS">Sleep</label><input type="number" step="0.5" min="0" max="14" id="mS" value="${escapeHTML(metrics.sleep || '')}" placeholder="hrs" inputmode="decimal"></div>` +
    `<div class="mf"><label for="mB">Weight</label><input type="number" step="0.1" min="0" id="mB" value="${escapeHTML(metrics.bodyweight || '')}" placeholder="lbs" inputmode="decimal"></div>` +
    `<div class="mf"><label for="mE">Energy</label><input type="number" min="1" max="5" id="mE" value="${escapeHTML(metrics.energy || '')}" placeholder="1-5" inputmode="numeric"></div>` +
    `<div class="mf"><label for="mO">Sore</label><input type="number" min="1" max="5" id="mO" value="${escapeHTML(metrics.soreness || '')}" placeholder="1-5" inputmode="numeric"></div></div></div>`;
}

function renderToday() {
  const p = program();
  if (isCycleProgram(p)) return renderCycleToday(p);
  const session = currentSession();
  const sets = setsProgress(session);
  const deload = isDeloadWeek();
  const showGym = hasGymToggle(p);

  let h = completionBannerHTML();
  if (weekReviewPending()) h += weekReviewCardHTML();
  h += `<div class="card"><div class="card-h"><h2>${escapeHTML(p.title)}</h2><span class="hint" id="setsHint">${sets.done}/${sets.total} sets</span></div>` +
    `<span class="lbl">Program</span><select class="sel mb12" id="pS" aria-label="Program">${programOptionsHTML(p)}</select>` +
    (showGym ? gymChoiceHTML() : '') +
    `<span class="lbl">Workout date</span><input class="sel mb12" type="date" id="wDate" value="${escapeHTML(session.date)}">` +
    (deload ? '<div class="bn bn-w mb8">Deload week — volume auto-halved. Use 4–5 RIR, no failure, and no new exercises.</div>' : '') +
    `<div class="wo-g" id="woGrid">${workoutGridHTML()}</div></div>`;

  h += readinessCardHTML(session.date);

  h += `<div id="statsCard">${statsCardHTML()}</div>`;

  h += `<div id="statusLine">${statusLineHTML(session)}</div>`;

  h += `<div id="warnBox">${warningsHTML(session)}</div>`;

  session.exercises.forEach((x, ei) => {
    const t = exerciseTemplate(session, ei);
    if (!t) return;
    const last = lastPerformance(x, session);
    const suggestion = suggestLoad(x, t, session);
    const substitutions = [x.originalName, ...(p.substitutions[x.originalName] || [])];
    if (!substitutions.includes(x.actualName)) substitutions.push(x.actualName);
    const doneSets = x.sets.filter(setComplete).length;
    const allDone = doneSets === x.sets.length && x.sets.length > 0;
    h += `<div class="ex"><div class="ex-top"><div class="ex-nm">${escapeHTML(x.actualName)}</div>` +
      `<div class="ex-bd"><span class="bd">${x.sets.length} × ${t.repsMin}–${t.repsMax}</span><span class="bd">${escapeHTML(intensityBadge(t))}</span><span class="bd">Rest ${formatSeconds(t.rest)}</span><span class="bd ${allDone ? 'bd-ok' : ''}" data-exdone="${ei}">${doneSets}/${x.sets.length}</span></div>` +
      (t.note ? `<div class="ex-nt">${escapeHTML(t.note)}</div>` : '') +
      (t.intensityHint ? `<div class="ex-nt">${escapeHTML(t.intensityHint)}</div>` : '') + `</div>` +
      `<select class="ex-sb" data-sb="${ei}" aria-label="Substitute exercise">${substitutions.map(n => `<option value="${escapeHTML(n)}" ${n === x.actualName ? 'selected' : ''}>${escapeHTML(n)}</option>`).join('')}</select>` +
      `<div class="ex-hi"><strong>${last ? 'Last:' : 'History:'}</strong> ${last ? `${escapeHTML(last.session.date)} · ${escapeHTML(formatSets(last.exercise.sets))} · W${last.session.week}` : 'No prior session.'}<br><span style="color:var(--t3)">${escapeHTML(suggestion.label)}${suggestion.value ? ` → <strong style="color:var(--ac)">${suggestion.value}</strong>` : ''}</span>${trendHTML(x.actualName, movementOpts(session))}</div>` +
      `<div class="ex-tl"><button class="tb" data-rp="${ei}">↻ Repeat</button><button class="tb" data-sg="${ei}">↑ Suggest</button><button class="tb tb-t" data-rt="${t.rest}" data-rl="${escapeHTML(x.actualName)}">⏱ ${formatSeconds(t.rest)}</button></div>` +
      `<div class="sets">${x.sets.map((s, si) => {
        const done = setComplete(s);
        return `<div class="sr${done ? ' dn' : ''}${setValuesValid(s) ? '' : ' inv'}"><div class="sn">${si + 1}</div>` +
          `<div class="sf"><label>Weight</label><input type="number" inputmode="decimal" step="0.5" min="0" value="${escapeHTML(s.weight)}" placeholder="lb / 0" data-f="${ei}-${si}-weight"></div>` +
          `<div class="sf"><label>Reps</label><input type="number" inputmode="numeric" step="1" min="0" value="${escapeHTML(s.reps)}" placeholder="${t.repsMin}–${t.repsMax}" data-f="${ei}-${si}-reps"></div>` +
          `<div class="sf"><label>${escapeHTML(intensityLabel(t))}</label><input type="number" inputmode="decimal" step="0.5" min="0" max="10" value="${escapeHTML(s.rir)}" placeholder="${escapeHTML(intensityPlaceholder(t))}" data-f="${ei}-${si}-rir"></div></div>`;
      }).join('')}</div></div>`;
  });

  h += `<div class="card"><span class="lbl">Session notes</span><textarea class="notes" id="sN" placeholder="How did it feel?">${escapeHTML(session.notes || '')}</textarea><div class="acts"><button class="bg" id="qE">Export backup</button><button class="bg" id="nxB">Next workout →</button></div></div><div class="spacer"></div>`;
  return h;
}

/* ═══ 7b. Cycle-program renderers ═══ */

function renderCycleToday(p) {
  const block = activeBlock(p);
  let h = completionBannerHTML();
  if (!block) {
    h += `<div class="card"><div class="card-h"><h2>${escapeHTML(p.title)}</h2><span class="hint">Not started</span></div>` +
      `<span class="lbl">Program</span><select class="sel mb12" id="pS" aria-label="Program">${programOptionsHTML(p)}</select>` +
      (hasGymToggle(p) ? gymChoiceHTML() : '') + `</div>`;
    return h + blockStartCardHTML(p) + '<div class="spacer"></div>';
  }
  const session = currentSession();
  const sets = setsProgress(session);
  h += pendingFollowupHTML(p, session.key);
  if (weekReviewPending()) h += weekReviewCardHTML();
  if (block.completedAt) h += blockReviewHTML(p, block);
  h += `<div class="card"><div class="card-h"><h2>${escapeHTML(p.title)}</h2><span class="hint" id="setsHint">${sets.done}/${sets.total} sets</span></div>` +
    `<span class="lbl">Program</span><select class="sel mb12" id="pS" aria-label="Program">${programOptionsHTML(p)}</select>` +
    (hasGymToggle(p) ? gymChoiceHTML() : '') +
    cycleProgressHTML(p, block, session) +
    `<span class="lbl">Workout date</span><input class="sel mb12" type="date" id="wDate" value="${escapeHTML(session.date)}">` +
    `<div class="wo-g" id="woGrid">${workoutGridHTML()}</div></div>`;
  h += readinessCardHTML(session.date);
  h += `<div id="statsCard">${statsCardHTML()}</div>`;
  h += `<div id="statusLine">${statusLineHTML(session)}</div>`;
  h += cyclePlanHTML(p, block, session);
  h += `<div id="warnBox">${warningsHTML(session)}</div>`;
  session.exercises.forEach((x, ei) => {
    const t = exerciseTemplate(session, ei);
    if (t) h += cycleExerciseCardHTML(p, session, x, ei, t);
  });
  h += checkinCardHTML(session);
  const done = !!session.completedAt;
  h += `<div class="card"><span class="lbl">Session notes</span><textarea class="notes" id="sN" placeholder="How did it feel? Skipped sets, swaps, equipment…">${escapeHTML(session.notes || '')}</textarea>` +
    (done
      ? `<button class="bg wc-btn" id="wcReopen">Reopen workout</button>`
      : `<button class="bp wc-btn" id="wcComplete">✓ Complete workout</button>`) +
    `<div class="acts"><button class="bg" id="qE">Export backup</button><button class="bg" id="nxB">Next workout →</button></div></div><div class="spacer"></div>`;
  return h;
}

function cycleProgressHTML(p, block, session) {
  const frontier = cycleFrontier(p);
  const pills = [];
  for (let c = firstCycle(p); c <= cycleCount(p); c++) {
    const cls = (c < frontier.cycle || frontier.complete) ? 'done' : (c === frontier.cycle ? 'cur' : '');
    pills.push(`<span class="cy-pill ${cls}${c === session.week ? ' on' : ''}">${escapeHTML(cycleShort(p, c))}</span>`);
  }
  const doneHere = scheduledWorkouts(p).filter(w => workoutCardInfo(w.key).status === 'done').length;
  const status = frontier.complete
    ? `Block complete · started ${prettyDate(block.startedAt)}, finished ${prettyDate(block.completedAt || todayISO())}`
    : `${cycleLabel(p, frontier.cycle)}${frontier.cycle > 0 ? ` of ${cycleCount(p)}` : ''} · ${doneHere}/${scheduledWorkouts(p).length} workouts complete · started ${prettyDate(block.startedAt)}`;
  return `<span class="lbl">Block</span><div class="cy-pills">${pills.join('')}</div><div class="cy-meta">${escapeHTML(status)}</div>`;
}

function cyclePlanHTML(p, block, session) {
  const w = p.workouts[session.workoutKey] || {};
  const cycle = session.week, n = cycleCount(p);
  const frontier = cycleFrontier(p);
  let phase;
  if (cycle === 0) phase = `<strong>Pre-block deload</strong> — one working set per exercise at 4–5 RIR. Lower the load or reps as needed, keep normal rest, no PRs. These sessions don’t count toward the ${n} cycles.`;
  else if (cycle === 1) phase = `<strong>Cycle 1 of ${n} — entry.</strong> Listed sets and reps at 3 RIR on everything. Calibrate loads from your warm-ups — the RIR target beats any suggested number.`;
  else phase = `<strong>Cycle ${cycle} of ${n} — build.</strong> Each exercise’s own RIR target with double progression. Flat bench and overhead press stay at 3 RIR.`;
  let viewing = '';
  if (session.blockId !== block.id) {
    viewing = `<div class="bn bn-w mb8">This session is from an earlier block. <button class="lnk" id="cyNow">Back to the current block</button></div>`;
  } else if (cycle !== frontier.cycle) {
    viewing = `<div class="bn bn-w mb8">Viewing ${escapeHTML(cycleLabel(p, cycle))} — current: ${escapeHTML(frontier.complete ? 'block complete' : cycleLabel(p, frontier.cycle))}. <button class="lnk" id="cyNow">Back to current</button></div>`;
  }
  const tm = Array.isArray(w.targetMinutes) ? `~${w.targetMinutes[0]}–${w.targetMinutes[1]} min incl. warm-up` : '';
  const pairs = (w.pairs || []).map(pr => pr.join(' + ')).join('; ');
  return `<div class="card"><div class="card-h"><h2>${escapeHTML(w.name || '')}</h2><span class="hint">${escapeHTML(tm)}</span></div>` +
    viewing +
    `<div class="bn ${cycle === 0 ? 'bn-w' : 'bn-p'} mb8">${phase}</div>` +
    `<div class="ex-nt">Full rest on the first two exercises.${pairs ? ` Optional pair: ${escapeHTML(pairs)} — keep at least 90 s between sets of the same exercise.` : ''} Short on time? Drop an accessory set and log it rather than rushing the main lifts. Gym: ${session.gymMode === 'office' ? 'Office' : 'YMCA'}${session.gymMode !== gymMode() ? ' (this workout was started there)' : ''}.</div></div>`;
}

function cycleExerciseCardHTML(p, session, x, ei, t) {
  const tg = phaseTargets(t, p, session.week);
  const conv = conventionForName(p, x.actualName) || t.weightConvention || '';
  const machine = MACHINE_CONVENTIONS.has(conv);
  const side = t.perSide ? ` /${t.perSide}` : '';
  const last = lastFor(x, session);
  const suggestion = cycleSuggestion(x, t, session);
  const substitutions = [x.originalName, ...(p.substitutions[x.originalName] || [])];
  if (!substitutions.includes(x.actualName)) substitutions.push(x.actualName);
  const doneSets = x.sets.filter(setComplete).length;
  const allDone = doneSets === x.sets.length && x.sets.length > 0;
  const gymName = session.gymMode === 'office' ? 'Office' : 'YMCA';
  const legacy = suggestion.calibrating && x.actualName === t.name ? legacyReference(t) : null;
  const refLoad = Number(suggestion.value) || (last ? commonWeight(workingSetsOf(last.exercise)) : 0);
  const toneCls = { up: 'sug-up', down: 'sug-down', stop: 'sug-stop', review: 'sug-up' }[suggestion.tone] || '';
  const warmGuide = warmupGuidance(t, ei, session, refLoad, conv);
  const warmups = x.warmups || [];
  let h = `<div class="ex"><div class="ex-top"><div class="ex-nm">${escapeHTML(x.actualName)}</div>` +
    `<div class="ex-bd"><span class="bd">${x.sets.length} × ${tg.repsMin}–${tg.repsMax}${escapeHTML(side)}</span><span class="bd">RIR ${rirText(tg)}</span><span class="bd">Rest ${formatSeconds(t.rest)}</span><span class="bd ${allDone ? 'bd-ok' : ''}" data-exdone="${ei}">${doneSets}/${x.sets.length}</span></div>` +
    `<div class="ex-nt">Load: ${escapeHTML(CONVENTION_LABELS[conv] || 'lb')}${machine ? ` · compared only with ${gymName} sessions` : ''}${t.perSide ? ` · log reps per ${escapeHTML(t.perSide)} (match your weaker side)` : ''}</div>` +
    (t.cue && x.actualName === t.name ? `<div class="ex-nt"><strong>Cue:</strong> ${escapeHTML(t.cue)}</div>` : '') +
    (t.note ? `<div class="ex-nt">${escapeHTML(t.note)}</div>` : '') + `</div>`;
  if (substitutions.length > 1) {
    h += `<select class="ex-sb" data-sb="${ei}" aria-label="Choose an explicit alternative">${substitutions.map(n => `<option value="${escapeHTML(n)}" ${n === x.actualName ? 'selected' : ''}>${escapeHTML(n)}</option>`).join('')}</select>`;
  }
  if (machine) {
    h += `<input class="ex-eq" data-eq="${ei}" value="${escapeHTML(x.equipmentId || '')}" maxlength="40" placeholder="Machine / station (optional — keeps its loads separate)" aria-label="Machine for ${escapeHTML(x.actualName)}">`;
  }
  h += `<div class="ex-hi"><strong>Last:</strong> ${last
    ? `${escapeHTML(prettyDate(last.session.date))} · ${escapeHTML(formatSets(last.exercise.sets))} · ${escapeHTML(weekLabelFor(last.session))} · ${last.session.gymMode === 'office' ? 'Office' : 'YMCA'}${last.exercise.equipmentId ? ` · ${escapeHTML(last.exercise.equipmentId)}` : ''}`
    : 'No comparable session yet.'}` +
    `<br><span class="${toneCls}">${escapeHTML(suggestion.label)}</span>` +
    (suggestion.value !== '' ? ` <span class="sug-v">Suggested: <strong>${escapeHTML(String(suggestion.value))} lb</strong> (not logged)</span>` : '') +
    (legacy ? `<br><span class="sug-legacy">Previous program, ${escapeHTML(prettyDate(legacy.session.date))}: ${escapeHTML(formatSets(legacy.exercise.sets))} — reference only (load convention unconfirmed), not a target.</span>` : '') +
    trendHTML(x.actualName, { ...comparableOpts(x, session), excludeDeload: true }) + `</div>`;
  h += `<div class="ex-tl"><button class="tb" data-rp="${ei}">↻ Repeat</button><button class="tb" data-sg="${ei}">↑ Suggest</button><button class="tb tb-t" data-rt="${t.rest}" data-rl="${escapeHTML(x.actualName)}">⏱ ${formatSeconds(t.rest)}</button></div>`;
  h += `<div class="wu-h"><span>Warm-up${warmups.length ? ` · ${warmups.length}` : ''} <small>(not counted)</small></span><button class="tb wu-add" data-wadd="${ei}">+ Warm-up set</button></div>` +
    (warmGuide ? `<div class="ex-wu">${escapeHTML(warmGuide)}</div>` : '');
  if (warmups.length) {
    h += `<div class="sets">${warmups.map((s, wi) => `<div class="sr wu"><div class="sn">W${wi + 1}</div>` +
      `<div class="sf"><label>Weight</label><input type="number" inputmode="decimal" step="0.5" min="0" value="${escapeHTML(s.weight)}" placeholder="lb" data-wf="${ei}-${wi}-weight"></div>` +
      `<div class="sf"><label>Reps</label><input type="number" inputmode="numeric" step="1" min="0" value="${escapeHTML(s.reps)}" placeholder="reps" data-wf="${ei}-${wi}-reps"></div>` +
      `<button class="wu-x" data-wdel="${ei}-${wi}" aria-label="Remove warm-up set ${wi + 1}">✕</button></div>`).join('')}</div>`;
  }
  h += `<div class="sets-h">Working sets</div><div class="sets">${x.sets.map((s, si) => {
    const done = setComplete(s);
    return `<div class="sr${done ? ' dn' : ''}${setValuesValid(s) ? '' : ' inv'}"><div class="sn">${si + 1}</div>` +
      `<div class="sf"><label>Weight</label><input type="number" inputmode="decimal" step="0.5" min="0" value="${escapeHTML(s.weight)}" placeholder="lb / 0" data-f="${ei}-${si}-weight"></div>` +
      `<div class="sf"><label>Reps${escapeHTML(side)}</label><input type="number" inputmode="numeric" step="1" min="0" value="${escapeHTML(s.reps)}" placeholder="${tg.repsMin}–${tg.repsMax}" data-f="${ei}-${si}-reps"></div>` +
      `<div class="sf"><label>RIR</label><input type="number" inputmode="decimal" step="0.5" min="0" max="10" value="${escapeHTML(s.rir)}" placeholder="${escapeHTML(rirText(tg))}" data-f="${ei}-${si}-rir"></div></div>`;
  }).join('')}</div></div>`;
  return h;
}

const SHOULDER_GUARD = 'Shoulder symptoms logged. Whenever catching, pain or a need to reposition occurs, stop and safely rack — don’t reposition under load and push through. Bench increases are on hold. Arrange a routine sports-physio assessment before heavier, lower-rep bench work. If the shoulder gets stuck and won’t release, or you notice sudden marked weakness or can’t lift the arm, seek urgent assessment.';
const BACK_GUARD = 'Back symptoms logged — don’t force range or progression through pain. Load increases on RDLs, SSB squats and split squats are on hold.';

function checkinChip(session, field, value, label) {
  const c = session.checkin || emptyCheckin();
  const warn = value === 'some' || value === 'yes';
  return `<button class="ci-b${c[field] === value ? ' on' : ''}${warn ? ' warn' : ''}" data-ci="${escapeHTML(`${session.key}|${field}|${value}`)}" aria-pressed="${c[field] === value}">${label}</button>`;
}
function checkinRow(session, label, field) {
  const yesNo = CHECKIN_FIELDS[field][0] === 'no';
  return `<div class="ci-r"><span>${label}</span><div class="ci-bs">${yesNo
    ? checkinChip(session, field, 'no', 'No') + checkinChip(session, field, 'yes', 'Yes')
    : checkinChip(session, field, 'none', 'None') + checkinChip(session, field, 'some', 'Symptoms')}</div></div>`;
}
function checkinCardHTML(session) {
  const c = session.checkin || emptyCheckin();
  return `<div class="card" id="ciCard"><div class="card-h"><h2>Symptom check-in</h2><span class="hint">Blank = unknown</span></div>` +
    `<span class="lbl">During training</span>` +
    checkinRow(session, 'Shoulder', 'shoulderDuring') + checkinRow(session, 'Catching / jamming', 'catchingOccurred') +
    checkinRow(session, 'Had to reposition', 'repositionNeeded') + checkinRow(session, 'Back', 'backDuring') +
    `<span class="lbl" style="margin-top:10px">Afterwards</span>` +
    checkinRow(session, 'Shoulder later that day', 'shoulderLaterSameDay') + checkinRow(session, 'Shoulder next morning', 'shoulderNextDay') +
    checkinRow(session, 'Back next morning', 'backNextDay') +
    (symptomFlag('shoulder', c) ? `<div class="bn bn-r mt8">${SHOULDER_GUARD}</div>` : '') +
    (symptomFlag('back', c) ? `<div class="bn bn-r mt8">${BACK_GUARD}</div>` : '') +
    `<div class="ex-nt">A flat-bench increase needs a clear shoulder during, later that day and the next morning, on two sessions in a row. Stop and get assessed for exertional chest symptoms, new neurological signs or severe persistent joint pain.</div></div>`;
}

/* Follow-up prompt for a recently completed session whose after-training
 * answers are still unknown — the bench rule waits on these. */
function pendingFollowupHTML(p, excludeKey) {
  const block = activeBlock(p);
  if (!block) return '';
  const today = todayISO(), oldest = addDaysISO(today, -3);
  const s = blockSessions(p, block)
    .filter(x => x.completedAt && !x.checkinDismissed && x.key !== excludeKey && x.date < today && x.date >= oldest)
    .filter(x => !x.checkin || !x.checkin.shoulderLaterSameDay || !x.checkin.shoulderNextDay || !x.checkin.backNextDay)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!s) return '';
  return `<div class="card" id="fuCard"><div class="card-h"><h2>Follow-up check-in</h2><span class="hint">${escapeHTML(workoutDisplayName(s))} · ${escapeHTML(prettyDate(s.date))}</span></div>` +
    checkinRow(s, 'Shoulder later that day', 'shoulderLaterSameDay') + checkinRow(s, 'Shoulder next morning', 'shoulderNextDay') +
    checkinRow(s, 'Back next morning', 'backNextDay') +
    (symptomFlag('shoulder', s.checkin) ? `<div class="bn bn-r mt8">${SHOULDER_GUARD}</div>` : '') +
    (symptomFlag('back', s.checkin) ? `<div class="bn bn-r mt8">${BACK_GUARD}</div>` : '') +
    `<div class="acts"><button class="bg" data-cidismiss="${escapeHTML(s.key)}">Skip (leave unknown)</button><button class="bg" data-open="${escapeHTML(s.key)}">Open workout</button></div></div>`;
}

function blockStartCardHTML(p) {
  const n = cycleCount(p);
  const last = state.lastExportAt;
  const backedUpToday = last && localDateOf(last) === todayISO();
  return `<div class="card" id="blockStart"><div class="card-h"><h2>Start the ${n}-cycle block</h2><span class="hint">Explicit start</span></div>` +
    `<div class="ri">First, one easier <strong>pre-block deload</strong>: each workout once over about 7–10 days, one working set per exercise at 4–5 RIR. Then <strong>${n} training cycles</strong> — a cycle is one completion of Upper A, Lower A, Upper B and Lower B, however many days that takes. Cycles only advance when you mark workouts complete.</div>` +
    `<div class="ri">Your other programs’ history, week and block stay exactly as they are — nothing is reset.</div>` +
    `<div class="ri"><strong>Step 1 — back up first.</strong> Last export: ${last ? `${escapeHTML(prettyDateTime(last))}${backedUpToday ? ' ✓' : ''}` : 'none yet'}.</div>` +
    `<div class="acts"><button class="bg" id="bkExport">Export backup</button><button class="bp" id="bkStart">Start block</button></div>` +
    `<div class="ex-nt mt8">The full prescriptions, guardrails and progression rules are on the Ref tab.</div></div>`;
}

/* End-of-block summary: performance, completion, symptoms and recovery —
 * a prompt to review, never an automatic volume change or deload. */
function blockReviewHTML(p, block) {
  const sessions = blockSessions(p, block);
  const training = sessions.filter(s => s.week >= 1);
  const completed = sessions.filter(s => s.completedAt);
  let planned = 0, logged = 0;
  for (const s of training.filter(x => x.completedAt)) { const sp = setsProgress(s); planned += sp.total; logged += sp.done; }
  const lifts = new Map();
  for (const s of training) {
    s.exercises.forEach((x, i) => {
      const t = exerciseTemplate(s, i);
      if (!t || t.type !== 'compound' || !workingSetsOf(x).length) return;
      // Machine loads only line up within one gym and one named machine.
      const machine = MACHINE_CONVENTIONS.has(conventionForName(p, x.actualName));
      const gym = s.gymMode === 'office' ? 'Office' : 'YMCA';
      const eq = machine ? String(x.equipmentId || '').trim() : '';
      const id = machine ? `${x.actualName}|${gym}|${eq.toLowerCase()}` : x.actualName;
      const name = machine ? `${x.actualName} (${gym}${eq ? ` · ${eq}` : ''})` : x.actualName;
      const entry = { label: weekLabelFor(s), sets: formatSets(x.sets) };
      if (!lifts.has(id)) lifts.set(id, { name, first: entry, last: entry });
      else lifts.get(id).last = entry;
    });
  }
  const shoulder = sessions.filter(s => symptomFlag('shoulder', s.checkin)).length;
  const catching = sessions.filter(s => s.checkin && (s.checkin.catchingOccurred === 'yes' || s.checkin.repositionNeeded === 'yes')).length;
  const back = sessions.filter(s => symptomFlag('back', s.checkin)).length;
  const unknownNextDay = completed.filter(s => !s.checkin || !s.checkin.shoulderNextDay).length;
  const end = block.completedAt || todayISO();
  const metrics = Object.entries(ctx().metricsByDate).filter(([d]) => d >= block.startedAt && d <= end).map(([, m]) => m);
  const avg = key => { const v = metrics.map(m => Number(m[key])).filter(x => x > 0); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'; };
  const bws = Object.entries(ctx().metricsByDate).filter(([d, m]) => d >= block.startedAt && d <= end && Number(m.bodyweight) > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const row = (k, v) => `<div class="rv-row"><span>${escapeHTML(k)}</span><span>${escapeHTML(v)}</span></div>`;
  return `<div class="card" id="blockReview"><div class="card-h"><h2>Block review</h2><span class="hint">${escapeHTML(prettyDate(block.startedAt))} → ${escapeHTML(prettyDate(end))}</span></div>` +
    `<div class="bn bn-i mb8">All ${cycleCount(p)} cycles complete. Review progress and recovery to decide whether to repeat, adjust or deload — nothing changes automatically.</div>` +
    `<span class="lbl">Completion</span>` +
    row('Workouts completed', `${completed.length} (incl. ${sessions.filter(s => s.week === 0 && s.completedAt).length} deload)`) +
    row('Working sets logged (cycles 1–6)', planned ? `${logged}/${planned} (${Math.round((logged / planned) * 100)}%)` : '—') +
    `<span class="lbl mt8">Main lifts — first → latest</span>` +
    ([...lifts.values()].map(v => row(v.name, `${v.first.sets} (${v.first.label}) → ${v.last.sets} (${v.last.label})`)).join('') || row('No compound lifts logged', '—')) +
    `<span class="lbl mt8">Symptoms</span>` +
    row('Sessions with shoulder symptoms', String(shoulder)) + row('Catching or repositioning', String(catching)) +
    row('Sessions with back symptoms', String(back)) + row('Next-morning shoulder unknown', String(unknownNextDay)) +
    `<span class="lbl mt8">Recovery</span>` +
    row('Average sleep (hrs)', avg('sleep')) + row('Average energy (1–5)', avg('energy')) +
    row('Bodyweight', bws.length >= 2 ? `${bws[0][1].bodyweight} → ${bws[bws.length - 1][1].bodyweight} lb (use weekly averages)` : '—') +
    `<div class="ex-nt mt8">Don’t read a plateau into an illness session, a different machine or a deload.${shoulder || catching ? ' Shoulder symptoms were logged — arrange a routine sports-physio assessment before heavier, lower-rep bench work.' : ''}</div>` +
    `<div class="acts"><button class="bg" id="bkExport">Export backup</button><button class="bp" id="bkStart">Start a new block</button></div></div>`;
}

/* Reference tables: each workout with its YMCA and office variants. */
function programDetailHTML(p) {
  return scheduledWorkouts(p).map(w => {
    const office = OFFICE_WORKOUT_MAP[w.key] ? p.workouts[OFFICE_WORKOUT_MAP[w.key]] : null;
    const total = w.exercises.reduce((a, x) => a + x.sets, 0);
    const rows = w.exercises.map((x, i) => {
      const o = office && office.exercises[i];
      const name = o && o.name !== x.name
        ? `${escapeHTML(x.name)} <small>YMCA</small> / ${escapeHTML(o.name)} <small>Office</small>`
        : escapeHTML(x.name);
      const side = x.perSide || (o && o.perSide) ? ` /${escapeHTML(x.perSide || o.perSide)}` : '';
      const rir = x.rirMin === x.rirMax ? x.rirMin : `${x.rirMin}–${x.rirMax}`;
      return `<div class="ri"><strong>${name}</strong><br><span class="ref-sub">${x.sets} × ${x.repsMin}–${x.repsMax}${side} · RIR ${rir} (cycles 2–6) · rest ${formatSeconds(x.rest)}</span></div>`;
    }).join('');
    const tm = Array.isArray(w.targetMinutes) ? ` · ~${w.targetMinutes[0]}–${w.targetMinutes[1]} min` : '';
    return `<div class="card"><div class="card-h"><h2>${escapeHTML(w.name)}</h2><span class="hint">${total} sets${escapeHTML(tm)}</span></div>${rows}</div>`;
  }).join('');
}

function sessionCardHTML(session) {
  const p = PROGRAMS[session.programKey];
  const name = p?.workouts?.[session.workoutKey]?.name || session.workoutKey;
  const ex = sessionProgress(session);
  const fraction = ex.total ? ex.done / ex.total : 0;
  const status = sessionStatus(session);
  const volume = session.exercises.reduce((a, x) => a + exerciseVolume(x), 0);
  return `<div class="hi"><div class="hi-row">${progressRing(fraction, status === 'done')}<span class="wo-bt"><div class="hi-tp"><span class="hi-n">${escapeHTML(name)}</span><span class="hi-v">${Math.round(volume).toLocaleString()}</span></div>` +
    `<div class="hi-m">${escapeHTML(prettyDate(session.date))} · ${escapeHTML(weekLabelFor(session))} · ${session.gymMode === 'office' ? 'Office' : 'YMCA'} · ${ex.done}/${ex.total} exercises ${statusTag(status)}</div>` +
    (session.updatedAt ? `<div class="hi-m">Updated ${escapeHTML(prettyDateTime(session.updatedAt))}</div>` : '') +
    (session.notes ? `<div class="hi-s">${escapeHTML(session.notes)}</div>` : '') +
    (session.extraExercises || []).map(x => `<div class="hi-m">Also logged (no longer in this workout): ${escapeHTML(x.actualName)} · ${escapeHTML(formatSets(x.sets))}</div>`).join('') +
    `</span></div><div class="hi-acts"><button data-open="${escapeHTML(session.key)}">Open</button><button class="red" data-del="${escapeHTML(session.key)}">Delete</button></div></div>`;
}

/* 'sessions' (default) or 'exercises' — split so picking an exercise never
 * requires scrolling past the full session list to reach the picker. */
let historySubTab = 'sessions';
let historyFilter = '';

function renderHistory() {
  const p = program();
  const profile = activeProfile();
  const stats = programStats();
  const sessions = Object.values(state.sessions)
    .filter(s => s.profile === profile && s.programKey === p.key && sessionHasContent(s))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const names = [...new Set(sessions.flatMap(s => loggedExercises(s).filter(x => x.sets.some(setHasEntry)).map(x => x.actualName)))].sort();

  let h = `<div class="card"><div class="stats"><div class="st"><strong>${stats.sessions}</strong><span>Sessions</span></div><div class="st"><strong>${stats.volume.toLocaleString()}</strong><span>Volume</span></div><div class="st"><strong>${stats.sets}</strong><span>Sets</span></div><div class="st"><strong>${names.length}</strong><span>Moves</span></div></div></div>`;
  h += `<div class="tabs" style="padding-top:0"><button class="tab ${historySubTab === 'sessions' ? 'on' : ''}" data-hsub="sessions">Sessions</button><button class="tab ${historySubTab === 'exercises' ? 'on' : ''}" data-hsub="exercises">By Exercise</button></div>`;

  h += historySubTab === 'exercises' ? renderHistoryByExercise(sessions, names) : renderHistorySessions(sessions);
  return h + '<div class="spacer"></div>';
}

function renderHistorySessions(sessions) {
  // Everything that isn't Done lives in the "In progress" group, including
  // notes/substitution-only sessions — so nothing saved is ever unreachable.
  const inProgress = sessions.filter(s => sessionStatus(s) !== 'done');
  const done = sessions.filter(s => sessionStatus(s) === 'done');
  let h = '';
  if (inProgress.length) {
    h += `<div class="card"><div class="card-h"><h2>In progress</h2><span class="hint">${inProgress.length}</span></div>${inProgress.map(sessionCardHTML).join('')}</div>`;
  }
  const emptyMsg = isCycleProgram(program())
    ? 'No completed workouts yet. A workout shows here once you mark it complete.'
    : 'No completed workouts yet. A workout shows here once every planned exercise is complete.';
  h += `<div class="card"><div class="card-h"><h2>Done</h2><span class="hint">${done.length}</span></div>${done.length ? done.map(sessionCardHTML).join('') : `<div class="hi">${emptyMsg}</div>`}</div>`;
  return h;
}

function renderHistoryByExercise(sessions, names) {
  const filter = names.includes(historyFilter) ? historyFilter : '';
  const rows = [];
  for (const s of sessions) {
    loggedExercises(s).forEach(x => {
      if (!x.sets.some(setHasEntry)) return;
      if (filter && x.actualName !== filter) return;
      rows.push({
        name: x.actualName, original: x.originalName,
        workout: PROGRAMS[s.programKey]?.workouts?.[s.workoutKey]?.name || s.workoutKey,
        gym: s.gymMode === 'office' ? 'Office' : 'YMCA',
        date: s.date, weekLabel: weekLabelFor(s), summary: formatSets(x.sets), volume: Math.round(exerciseVolume(x)),
        warmups: (x.warmups || []).filter(setHasEntry).length,
      });
    });
  }
  let trendBlock = '';
  if (filter) {
    // Machine/cable loads only trend within one gym; deloads are left out.
    const p = program();
    // Week-based programs used at two gyms trend one gym at a time too.
    const machine = isStrictProgram(p) && MACHINE_CONVENTIONS.has(conventionForName(p, filter));
    const opts = isStrictProgram(p) ? { excludeDeload: true, ...(machine ? { gym: gymMode() } : {}) } : (hasGymToggle(p) ? { gym: gymMode() } : {});
    const t = getTrend(filter, 12, opts);
    if (t) trendBlock = `<div class="hi" style="background:rgba(99,220,255,.04);border-color:rgba(99,220,255,.12)"><div class="hi-tp"><span class="hi-n" style="color:var(--ac)">Trend${opts.gym ? ` · ${escapeHTML(gymLabel())}` : ''}</span><span class="hi-v">${t.points[t.points.length - 1].weight} lb</span></div><div class="ex-spark" style="margin-top:4px">${sparkSVG(t.points, 120, 28)}<span class="${t.up ? 'spark-up' : t.flat ? '' : 'spark-dn'}">${t.up ? '↑' : t.flat ? '→' : '↓'} ${t.up ? '+' : ''}${t.delta} lb (${t.up ? '+' : ''}${t.pct}%) over ${t.points.length} sessions</span></div></div>`;
  }
  return `<div class="card"><div class="card-h"><h2>Exercise history</h2></div><span class="lbl">Filter</span><select class="sel mb12" id="hF"><option value="">All</option>${names.map(n => `<option value="${escapeHTML(n)}" ${n === filter ? 'selected' : ''}>${escapeHTML(n)}</option>`).join('')}</select>${trendBlock}` +
    (rows.length ? rows.map(r => `<div class="hi"><div class="hi-tp"><span class="hi-n">${escapeHTML(r.name)}</span><span class="hi-v">${r.volume.toLocaleString()}</span></div><div class="hi-m">${escapeHTML(prettyDate(r.date))} · ${escapeHTML(r.weekLabel)} · ${escapeHTML(r.gym)} · ${escapeHTML(r.workout)}</div>${r.name !== r.original ? `<div class="hi-m">Subbed from ${escapeHTML(r.original)}</div>` : ''}<div class="hi-s">${escapeHTML(r.summary)}${r.warmups ? ` <span class="hi-m">+ ${r.warmups} warm-up${r.warmups === 1 ? '' : 's'}</span>` : ''}</div></div>`).join('') : '<div class="hi">No exercise history yet.</div>') +
    `</div>`;
}

function cycleStatusText(p) {
  const block = activeBlock(p);
  if (!block) return 'Not started — start the block from the Today tab';
  const f = cycleFrontier(p);
  return f.complete
    ? `Block complete (${prettyDate(block.startedAt)} → ${prettyDate(block.completedAt || todayISO())})`
    : `${cycleLabel(p, f.cycle)}${f.cycle > 0 ? ` of ${cycleCount(p)}` : ''} · started ${prettyDate(block.startedAt)}`;
}

function renderReference() {
  const p = program();
  const scheduled = scheduledWorkouts(p);
  const showGym = hasGymToggle(p);
  const cycle = isCycleProgram(p);
  const statusLine = cycle
    ? `<strong>${escapeHTML(cycleStatusText(p))}</strong>${showGym ? ` · ${gymLabel()} mode` : ''}`
    : `<strong>Week ${currentWeek()}</strong> · ${hasDeload(p) ? `Deload W${p.deloadWeek}` : 'No deload'}${showGym ? ` · ${gymLabel()} mode` : ''}${currentBlockStart() ? ` · Block started ${escapeHTML(prettyDate(currentBlockStart()))}` : ''}`;
  let h = `<div class="card"><div class="card-h"><h2>Active program</h2></div><span class="lbl">Program</span><select class="sel mb12" id="rS">${programOptionsHTML(p)}</select>` +
    (showGym ? gymChoiceHTML() : '') +
    `<div class="ri">${statusLine}</div></div>`;
  if (cycle) {
    h += `<div class="card"><div class="card-h"><h2>Block structure</h2></div>` +
      `<div class="ri"><strong>Pre-block deload</strong> — each workout once, one working set per exercise at 4–5 RIR. Doesn’t count toward the cycles.</div>` +
      `<div class="ri"><strong>Cycle 1 (entry)</strong> — listed sets and reps, 3 RIR on everything.</div>` +
      `<div class="ri"><strong>Cycles 2–${cycleCount(p)} (build)</strong> — each exercise’s RIR target, double progression; flat bench and overhead press stay at 3 RIR.</div>` +
      `<div class="ri">A cycle = Upper A, Lower A, Upper B and Lower B each marked complete (office and YMCA versions count the same). It never advances from dates or from opening a screen.</div></div>`;
    h += programDetailHTML(p);
  }
  h += `<div class="card"><div class="card-h"><h2>${cycle ? 'Coaching decisions' : 'Program rules'}</h2></div>${p.checklist.map(l => `<div class="ri">${escapeHTML(l)}</div>`).join('')}</div>`;
  h += `<div class="card"><div class="card-h"><h2>${cycle ? 'Sequence & default days' : 'Schedule'}</h2></div>${scheduled.map(w => {
    const actual = p.workouts[effectiveWorkoutKey(p.key, w.key, ctx().gymMode)] || w;
    const swapped = actual.key !== w.key;
    const day = cycle ? DAY_NAMES[scheduledDayNumber(w)] : w.day;
    return `<div class="ri"><strong>${escapeHTML(day)}</strong> — ${escapeHTML(actual.name)}${swapped ? ' <span style="color:var(--ac);font-size:12px">Office swap</span>' : ''}<br><span style="color:var(--t3);font-size:12px">${escapeHTML(actual.focus)}</span></div>`;
  }).join('')}${cycle ? '<div class="ri">Days are your calendar defaults (change them in the Sunday review). If a session is delayed, just continue the sequence — no catch-up doubles.</div>' : ''}<div class="ri"><strong>Recovery</strong><br><span style="color:var(--t3);font-size:12px">${escapeHTML(p.recoveryNote || 'Rest.')}</span></div></div>`;
  if (Array.isArray(p.referenceSections)) {
    p.referenceSections.forEach(sec => {
      h += `<div class="card"><div class="card-h"><h2>${escapeHTML(sec.title)}</h2></div>${sec.items.map(l => `<div class="ri">${escapeHTML(l)}</div>`).join('')}</div>`;
    });
  }
  return h + '<div class="spacer"></div>';
}

function notificationStatus() {
  if (!('Notification' in window)) return 'Not supported';
  if (Notification.permission === 'granted') return state.timerPrefs.notify ? 'Enabled' : 'Allowed';
  return Notification.permission === 'denied' ? 'Blocked' : 'Not enabled';
}

function renderSettings() {
  const prefs = state.timerPrefs || {};
  let h = `<div class="card"><div class="card-h"><h2>Data &amp; backups</h2><span class="hint">Local-first</span></div><div class="ri mb12">Everything lives in this browser's local storage and autosaves as you type. Export a backup regularly — especially on iPhone, where the system can purge site storage.</div>` +
    (saveError ? `<div class="bn bn-w"><strong>Storage warning:</strong><br>${escapeHTML(saveError)}</div>` : '') +
    `<div class="acts mb12"><button class="bg" id="sE">Export</button><label class="bg" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Import<input type="file" id="sI" accept="application/json" style="display:none"></label></div><button class="bg red" id="sR">Reset all data</button></div>`;
  h += `<div class="card"><div class="card-h"><h2>Rest timer</h2><span class="hint">${escapeHTML(notificationStatus())}</span></div><div class="ri mb12">Sound and vibration work while the app is open. Auto-start begins the rest timer when you complete a set (today's workouts only). Notifications need permission and device support.</div>` +
    `<div class="gym-choice"><button class="${prefs.sound ? 'on' : ''}" data-tpref="sound">Sound ${prefs.sound ? 'On' : 'Off'}</button><button class="${prefs.vibrate ? 'on' : ''}" data-tpref="vibrate">Vibrate ${prefs.vibrate ? 'On' : 'Off'}</button></div>` +
    `<div class="gym-choice"><button class="${prefs.autoStart ? 'on' : ''}" data-tpref="autoStart">Auto-start ${prefs.autoStart ? 'On' : 'Off'}</button><button class="bg" id="tPerm" style="border-radius:var(--Rs)">Enable notifications</button></div>` +
    `<div class="acts"><button class="bg" id="tTest">Test alert</button></div></div>`;
  h += `<div class="card"><div class="card-h"><h2>Profile</h2></div><div class="ri mb12">Current: <strong>${state.profile ? escapeHTML(PROFILE_INFO[state.profile].label) : 'Not set'}</strong> — history, week and readiness are kept separately per profile.</div><button class="bg" id="sP">Switch profile</button></div>`;
  if (isCycleProgram(program())) {
    const p = program(), block = activeBlock(p);
    h += `<div class="card"><div class="card-h"><h2>Training block</h2><span class="hint">${escapeHTML(p.shortName)}</span></div>` +
      `<div class="ri mb12">${escapeHTML(cycleStatusText(p))}. Cycles advance only when all four workouts are marked complete. Starting a new block never changes your other programs.</div>` +
      `<div class="acts"><button class="bg" id="bkExport">Export backup</button><button class="bg" id="bkStart">${block ? 'Start new block' : 'Start block'}</button></div></div>`;
  } else {
    h += `<div class="card"><div class="card-h"><h2>Training block</h2></div><div class="ri mb12">${currentBlockStart() ? `Current block started <strong>${escapeHTML(prettyDate(currentBlockStart()))}</strong>. Weekly status and "Next" only count sessions from that date onward, so an earlier block's Week 1 doesn't collide with this one.` : `No block boundary set — weekly status counts every session ever logged at each week number. Set one when you restart ${escapeHTML(program().shortName)} from Week 1.`}</div><button class="bg" id="sBlk">Start new block (reset to Week 1)</button></div>`;
  }
  if (hasGymToggle(program())) {
    h += `<div class="card"><div class="card-h"><h2>Gym mode</h2><span class="hint">${gymLabel()}</span></div><div class="ri mb12">Office mode automatically swaps Lower A and Lower B to office-gym versions. Upper days stay unchanged.</div><div class="gym-choice"><button class="${gymMode() === 'ymca' ? 'on' : ''}" data-gym="ymca">YMCA</button><button class="${gymMode() === 'office' ? 'on' : ''}" data-gym="office">Office Gym</button></div></div>`;
  }
  h += `<div class="card"><div class="card-h"><h2>iPhone tips</h2></div><div class="ri">Tap Share → "Add to Home Screen" in Safari to install as a full-screen app.</div><div class="ri">iOS can purge local storage under pressure. Export after each session.</div></div><div class="spacer"></div>`;
  return h;
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNow(); });
}
function renderNow() {
  renderSystemNotices();
  ensureSelection();
  const p = program();
  const workout = p.workouts[effectiveWorkoutKey(p.key, ctx().selectedWorkoutKey, ctx().gymMode)];
  const deload = isDeloadWeek();
  document.getElementById('gate').classList.toggle('hidden', !!state.profile);
  document.getElementById('hT').textContent = workout ? workout.name : p.shortName;
  if (isCycleProgram(p)) {
    const block = activeBlock(p);
    const week = currentWeek();
    const session = block && state.activeTab === 'today' ? currentSession() : null;
    document.getElementById('hS').textContent = prettyDate(session ? session.date : todayISO());
    document.getElementById('hB').textContent = !block ? `${p.shortName} · Not started`
      : `${p.shortName} · ${gymLabel()} · ${cycleFrontier(p).complete && week === cycleCount(p) ? 'Complete' : (week === 0 ? 'Deload' : `Cycle ${week}/${cycleCount(p)}`)}`;
    document.getElementById('wV').textContent = block ? cycleShort(p, week) : '—';
    document.getElementById('wD').setAttribute('aria-label', 'Previous cycle');
    document.getElementById('wU').setAttribute('aria-label', 'Next cycle');
  } else {
    document.getElementById('hS').textContent = prettyDate(activeDate());
    document.getElementById('hB').textContent = deload ? `W${currentWeek()} · ${gymLabel()} · Deload` : `${p.shortName} · ${gymLabel()} · W${currentWeek()}`;
    document.getElementById('wV').textContent = `W${currentWeek()}`;
    document.getElementById('wD').setAttribute('aria-label', 'Previous week');
    document.getElementById('wU').setAttribute('aria-label', 'Next week');
  }
  const gymBtn = document.getElementById('gBtn');
  gymBtn.innerHTML = `<span class="chip-lbl">Gym: </span>${gymLabel()}`;
  gymBtn.classList.toggle('hidden', !hasGymToggle(p));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === state.activeTab));
  const content = document.getElementById('C');
  if (state.activeTab === 'today') content.innerHTML = renderToday();
  else if (state.activeTab === 'history') content.innerHTML = renderHistory();
  else if (state.activeTab === 'reference') content.innerHTML = renderReference();
  else content.innerHTML = renderSettings();
  updateTimerUI();
}

/* ═══ 8. Targeted updates (no full re-render while typing) ═══ */

function refreshEntryUI() {
  const session = currentSession();
  if (!session) return;
  const statusLine = document.getElementById('statusLine');
  if (statusLine) statusLine.innerHTML = statusLineHTML(session);
  const grid = document.getElementById('woGrid');
  if (grid) grid.innerHTML = workoutGridHTML();
  const hint = document.getElementById('setsHint');
  if (hint) {
    const sets = setsProgress(session);
    hint.textContent = `${sets.done}/${sets.total} sets`;
  }
  session.exercises.forEach((x, ei) => {
    const badge = document.querySelector(`[data-exdone="${ei}"]`);
    if (!badge) return;
    const doneSets = x.sets.filter(setComplete).length;
    badge.textContent = `${doneSets}/${x.sets.length}`;
    badge.classList.toggle('bd-ok', doneSets === x.sets.length && x.sets.length > 0);
  });
}

/* Heavier secondary panels (stats, entry warnings) refresh on committed
 * values ('change', i.e. leaving the field) rather than every keystroke, so
 * warnings don't flash mid-row but never go stale either (v1 relied on a
 * focus-stealing full re-render on blur for this). */
function refreshSecondaryUI() {
  const session = currentSession();
  if (!session) return;
  const statsCard = document.getElementById('statsCard');
  if (statsCard) statsCard.innerHTML = statsCardHTML();
  const warnBox = document.getElementById('warnBox');
  if (warnBox) warnBox.innerHTML = warningsHTML(session);
}

/* ═══ 9. Actions ═══ */

function touchSession(session) { session.updatedAt = new Date().toISOString(); }

/* In-memory only (not persisted) — a "just now" celebratory moment, not a
 * durable notification. Cleared by an explicit dismiss or replaced by the
 * next completion. */
let completionBanner = null;

/* Fires once, on the true empty/partial → done edge (mirrors the existing
 * set-level wasComplete/complete pattern in onSetFieldInput below), not on
 * every render of an already-done session. */
function celebrateCompletion(session) {
  const p = program();
  const week = session.week;
  maybeAutoAdvanceWeek();
  const fullyDone = weekFullyDone(week, p);
  let banner = null;
  if (fullyDone && week >= WEEK_MAX) {
    banner = { kind: 'block', week };
  } else {
    const next = nextScheduledInfo();
    if (next) banner = { kind: 'next', name: next.name, day: next.day, date: next.date };
  }
  if (!banner) return;
  completionBanner = banner;
  if (navigator.vibrate && timerPref('vibrate')) navigator.vibrate([30, 60, 30, 60, 120]);
  toast(banner.kind === 'block' ? 'Block complete!' : 'Workout complete!');
}

function completionBannerHTML() {
  if (!completionBanner) return '';
  const b = completionBanner;
  let body;
  if (b.kind === 'block') body = `<strong>Block complete! 🎉</strong><br>All ${WEEK_MAX} weeks done. Start a new block in Settings when you're ready to go again.`;
  else if (b.kind === 'cycleBlock') body = `<strong>Cycle ${escapeHTML(String(b.cycles))} complete — block finished! 🎉</strong><br>Look over the block review below before deciding to repeat, adjust or deload.`;
  else if (b.kind === 'cycleUp' && b.from === 0) body = `<strong>Deload done 🎉</strong><br>Cycle 1 starts now: listed sets and reps, 3 RIR on everything. Calibrate loads from your warm-ups.`;
  else if (b.kind === 'cycleUp') body = `<strong>Cycle ${escapeHTML(String(b.from))} complete 🎉</strong><br>On to Cycle ${escapeHTML(String(b.to))} of ${escapeHTML(String(b.cycles))}. Next up: ${escapeHTML(b.name)}.`;
  else if (b.kind === 'seq') body = `<strong>Workout complete! 💪</strong><br>Next up: ${escapeHTML(b.name)} (usually ${escapeHTML(b.day)}). Delayed? Just continue the sequence — no catch-up doubles.`;
  else body = `<strong>Workout complete! 💪</strong><br>See you ${escapeHTML(b.day)} for ${escapeHTML(b.name)} · ${escapeHTML(prettyDate(b.date))}`;
  return `<div class="bn bn-i mb8" id="completionBanner" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div>${body}</div><button id="completionX" aria-label="Dismiss" style="flex-shrink:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px 8px;font-size:12px;color:inherit">✕</button></div>`;
}

function weekReviewCardHTML() {
  const p = program();
  const sunday = mostRecentSunday();
  const items = weekScheduleForSunday(sunday);
  const rows = items.map(it => `<div class="ri">` +
    `<strong>${escapeHTML(it.name)}</strong>` +
    `<div class="wr-row">` +
    `<select class="sel" data-wr-day="${escapeHTML(it.key)}" aria-label="Day for ${escapeHTML(it.name)}">${DAY_NAMES.map((d, i) => `<option value="${i}" ${i === it.dayNumber ? 'selected' : ''}>${d}</option>`).join('')}</select>` +
    `<input type="time" class="sel" data-wr-time="${escapeHTML(it.key)}" aria-label="Time for ${escapeHTML(it.name)}" value="${escapeHTML(it.time)}">` +
    `</div>` +
    `<span style="color:var(--t3);font-size:12px" data-wr-date="${escapeHTML(it.key)}">${escapeHTML(prettyDate(it.date))}</span></div>`).join('');
  return `<div class="card" id="weekReviewCard"><div class="card-h"><h2>Review this week</h2><span class="hint">${escapeHTML(p.shortName)}</span></div>` +
    `<div class="ri mb12">Adjust the day or time for any workout, then approve to download a calendar file — one tap adds all ${items.length} workouts to your phone's Calendar app.</div>${rows}` +
    `<div class="acts"><button class="bg" id="wrDismiss">Dismiss</button><button class="bp" id="wrApprove">Approve &amp; add to calendar</button></div></div>`;
}

/* — Cycle-program actions — */

function nextWorkoutInfo(p) {
  const key = nextWorkoutKey();
  const w = p.workouts[key];
  const actual = p.workouts[effectiveWorkoutKey(p.key, key, ctx().gymMode)] || w;
  return { name: actual ? actual.name : key, day: w ? DAY_NAMES[scheduledDayNumber(w)] : '' };
}

/* Explicit completion — the only way a cycle-program workout becomes Done,
 * so it can be finished with skipped sets (recorded as blank, i.e. not
 * done) and a cycle never advances from logging alone. */
function completeWorkout() {
  const p = program();
  const session = currentSession();
  if (!isCycleProgram(p) || !session || session.completedAt) return;
  const sets = setsProgress(session);
  const missing = sets.total - sets.done;
  const name = workoutDisplayName(session);
  if (missing > 0 && !confirm(`${missing} of ${sets.total} working sets aren't logged. Mark ${name} complete and record them as skipped?`)) return;
  const before = cycleFrontier(p);
  session.completedAt = new Date().toISOString();
  touchSession(session);
  const after = cycleFrontier(p);
  syncBlockCompletion(p);
  const block = activeBlock(p);
  if (block && Number.isInteger(block.viewCycle) && block.viewCycle >= after.cycle) block.viewCycle = null;
  if (after.complete && !before.complete) completionBanner = { kind: 'cycleBlock', cycles: cycleCount(p) };
  else if (after.cycle > before.cycle) completionBanner = { kind: 'cycleUp', from: before.cycle, to: after.cycle, cycles: cycleCount(p), name: firstWorkoutName(p) };
  else completionBanner = { kind: 'seq', ...nextWorkoutInfo(p) };
  if (navigator.vibrate && timerPref('vibrate')) navigator.vibrate([30, 60, 30, 60, 120]);
  persist();
  render();
  toast(completionBanner.kind === 'cycleBlock' ? 'Block complete!' : 'Workout complete!');
}
function firstWorkoutName(p) {
  const w = scheduledWorkouts(p)[0];
  const actual = w && (p.workouts[effectiveWorkoutKey(p.key, w.key, ctx().gymMode)] || w);
  return actual ? actual.name : '';
}
function reopenWorkout() {
  const p = program();
  const session = currentSession();
  if (!session || !session.completedAt) return;
  if (!confirm(`Reopen ${workoutDisplayName(session)}? It stops counting as complete until you mark it complete again.`)) return;
  session.completedAt = '';
  touchSession(session);
  syncBlockCompletion(p);
  completionBanner = null;
  persist();
  render();
  toast('Workout reopened');
}

function startCycleBlock() {
  const p = program();
  if (!isCycleProgram(p)) return;
  const existing = activeBlock(p);
  if (existing && !existing.completedAt && !confirm(`Start a NEW ${p.shortName} block from the pre-block deload? The current block (started ${prettyDate(existing.startedAt)}) stops counting toward cycles — its sessions stay in History.`)) return;
  const backedUpToday = state.lastExportAt && localDateOf(state.lastExportAt) === todayISO();
  if (!backedUpToday && !confirm('You haven\'t exported a backup today. Start the block anyway?')) return;
  let id = `b${Date.now().toString(36)}`;
  if (existing && existing.id === id) id += 'x';
  cycleBlocks()[p.key] = { id, startedAt: todayISO(), completedAt: '', viewCycle: null };
  ctx().pinnedSessionKey = '';
  ctx().selectedWorkoutKey = scheduledWorkouts(p)[0]?.key || '';
  completionBanner = null;
  state.activeTab = 'today';
  persist();
  render();
  toast('Block started — pre-block deload');
}

/* Browse back through completed cycles (to review or correct a session);
 * you can't step past the current cycle — that's what completing it does. */
function stepCycle(delta) {
  const p = program();
  const block = activeBlock(p);
  if (!block) { toast('Start the block first'); return; }
  const frontier = cycleFrontier(p).cycle;
  const target = currentWeek() + delta;
  if (target > frontier) { toast(`${cycleLabel(p, frontier)} is the current cycle — complete its workouts to move on`); return; }
  if (target < firstCycle(p)) return;
  ctx().pinnedSessionKey = '';
  block.viewCycle = target >= frontier ? null : target;
  persist();
  render();
}
function backToCurrentCycle() {
  const p = program();
  const block = activeBlock(p);
  ctx().pinnedSessionKey = '';
  if (block) block.viewCycle = null;
  persist();
  render();
}

function addWarmup(index) {
  const session = currentSession();
  const x = session && session.exercises[index];
  if (!x || !Array.isArray(x.warmups) || x.warmups.length >= 8) return;
  x.warmups.push({ weight: '', reps: '' });
  persist();
  render();
}
function removeWarmup(index, wi) {
  const session = currentSession();
  const x = session && session.exercises[index];
  if (!x || !Array.isArray(x.warmups) || !x.warmups[wi]) return;
  x.warmups.splice(wi, 1);
  touchSession(session);
  persist();
  render();
}
function onWarmupInput(input) {
  const [ei, wi, field] = input.dataset.wf.split('-');
  const session = currentSession();
  const x = session && session.exercises[Number(ei)];
  const row = x && Array.isArray(x.warmups) ? x.warmups[Number(wi)] : null;
  if (!row || !['weight', 'reps'].includes(field)) return;
  row[field] = input.value;
  touchSession(session);
  persistSoon();
  refreshEntryUI();
}
function setEquipment(index, value) {
  const session = currentSession();
  const x = session && session.exercises[index];
  if (!x) return;
  x.equipmentId = String(value || '').trim().slice(0, 40);
  touchSession(session);
  persist();
  render();
}
function setCheckin(key, field, value) {
  const session = Object.prototype.hasOwnProperty.call(state.sessions, key) ? state.sessions[key] : null;
  if (!session || !Object.prototype.hasOwnProperty.call(CHECKIN_FIELDS, field) || !CHECKIN_FIELDS[field].includes(value)) return;
  session.checkin = normalizeCheckin(session.checkin);
  session.checkin[field] = session.checkin[field] === value ? '' : value;
  touchSession(session);
  persist();
  render();
}
function dismissCheckin(key) {
  const session = Object.prototype.hasOwnProperty.call(state.sessions, key) ? state.sessions[key] : null;
  if (!session) return;
  session.checkinDismissed = true;
  persist();
  render();
  toast('Left as unknown — bench increases wait for a known answer');
}

function onSetFieldInput(input) {
  const [ei, si, field] = input.dataset.f.split('-');
  const session = currentSession();
  if (!session) return;
  const exercise = session.exercises[Number(ei)];
  if (!exercise || !['weight', 'reps', 'rir'].includes(field)) return;
  // The DOM can show an extra (kept) set row that a sync just trimmed for
  // being empty again — pad so typing into a visible row always lands.
  while (exercise.sets.length <= Number(si) && Number(si) < 20) {
    exercise.sets.push({ weight: '', reps: '', rir: '' });
  }
  const set = exercise.sets[Number(si)];
  if (!set) return;
  const wasSessionDone = sessionStatus(session) === 'done';
  set[field] = input.value;
  touchSession(session);
  persistSoon();
  const row = input.closest('.sr');
  if (row) {
    const complete = setComplete(set);
    const wasComplete = row.classList.contains('dn');
    row.classList.toggle('dn', complete);
    row.classList.toggle('inv', !setValuesValid(set));
    if (!wasComplete && complete) maybeAutoStartRest(Number(ei), Number(si), input);
  }
  const nowDone = sessionStatus(session) === 'done';
  if (!wasSessionDone && nowDone) pendingCompletion = session.key;
  else if (!nowDone && pendingCompletion === session.key) pendingCompletion = null;
  refreshEntryUI();
}

/* Finishing a workout redraws the screen (and may move the week), so it's
 * detected while typing but only acted on once the field is committed —
 * typing "12" in the last reps box must not redraw on the "1". It also
 * waits out a tap in progress (the redraw would swallow its click) and
 * stays pending while focus is in another entry field. */
let pendingCompletion = null;
/* Anything that redraws or reflows the screen when a field is committed runs
 * after a tap in progress: moving or replacing content between press and
 * release lands the release elsewhere, and the tap is lost. */
let pointerIsDown = false;
const afterPointer = [];
function afterTap(fn) {
  if (pointerIsDown) afterPointer.push(fn);
  else fn();
}
function scheduleCompletionCheck() {
  if (pendingCompletion) afterTap(() => setTimeout(finishPendingCompletion, 0));
}
function finishPendingCompletion(force) {
  const key = pendingCompletion;
  if (!key) return;
  const active = document.activeElement;
  if (!force && active && active.closest && active.closest('#C') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
  pendingCompletion = null;
  const session = Object.prototype.hasOwnProperty.call(state.sessions, key) ? state.sessions[key] : null;
  if (!session || sessionStatus(session) !== 'done') return;
  celebrateCompletion(session);
  persist();
  renderNow(); // week/header may have changed — a full render, not the light path
}

function setSubstitution(index, name) {
  const session = currentSession();
  if (!session || !session.exercises[index]) return;
  session.exercises[index].actualName = name;
  touchSession(session);
  persist();
  render();
  toast('Swapped');
}

/* Cycle programs: fills only blank weights (never overwrites a logged
 * entry), never applies a phase that has no suggestion, and caps at the
 * office maximums. */
function applyPreviousCycle(session, x, t, mode) {
  const p = programByKey(session.programKey);
  const cap = officeCapFor(session, conventionForName(p, x.actualName) || t.weightConvention);
  let values;
  if (mode === 'repeat') {
    const last = lastFor(x, session);
    if (!last) { toast('No comparable previous session'); return; }
    const prev = workingSetsOf(last.exercise);
    if (!prev.length) { toast('No logged loads last time'); return; }
    values = x.sets.map((_, i) => Number((prev[i] || prev[prev.length - 1]).weight));
  } else {
    const s = cycleSuggestion(x, t, session);
    if (s.value === '' || s.value === undefined) { toast('No load suggestion here — calibrate from your warm-ups'); return; }
    values = x.sets.map(() => Number(s.value));
  }
  let filled = 0, capped = false;
  x.sets.forEach((set, i) => {
    if (String(set.weight ?? '').trim() !== '' || !Number.isFinite(values[i])) return;
    let v = values[i];
    if (cap && v > cap) { v = cap; capped = true; }
    set.weight = String(v);
    filled++;
  });
  if (!filled) { toast('Weights already entered — nothing overwritten'); return; }
  touchSession(session);
  persist();
  render();
  toast(`${mode === 'repeat' ? 'Repeated last loads' : 'Suggested load filled'} (${filled} set${filled === 1 ? '' : 's'})${capped ? ` — capped at the office max ${cap} lb` : ''}`);
}

/* Fills blank weights only — a logged set keeps the weight it was done
 * with. With every weight already filled, it offers (with confirmation) to
 * replace only the planned weights of sets that have no reps logged yet. */
function applyPrevious(index, mode) {
  const session = currentSession();
  if (!session) return;
  const x = session.exercises[index];
  const t = exerciseTemplate(session, index);
  if (!x || !t) return;
  if (isCycleProgram(programByKey(session.programKey))) { applyPreviousCycle(session, x, t, mode); return; }
  const last = lastPerformance(x, session);
  if (!last) { toast('No previous data'); return; }
  const lastSets = last.exercise.sets;
  const suggestion = suggestLoad(x, t, session);
  const values = x.sets.map((_, i) => {
    if (mode === 'repeat') return String((lastSets[i] || lastSets[lastSets.length - 1] || {}).weight ?? '').trim();
    return suggestion.value !== '' && suggestion.value !== undefined ? String(suggestion.value) : '';
  });
  if (!values.some(v => validWeight(v))) { toast(mode === 'repeat' ? 'No logged weights last time' : 'No load suggestion yet'); return; }
  const usable = i => validWeight(values[i]);
  let targets = x.sets.map((_, i) => i).filter(i => usable(i) && String(x.sets[i].weight ?? '').trim() === '');
  if (!targets.length) {
    const open = x.sets.map((_, i) => i).filter(i => usable(i) && String(x.sets[i].reps ?? '').trim() === '' && x.sets[i].weight !== values[i]);
    if (!open.length) { toast('Logged sets keep their weights — edit one directly to change it'); return; }
    if (!confirm(`Replace the planned weight on ${open.length} set${open.length === 1 ? '' : 's'} with no reps logged yet? Logged sets keep their weights.`)) return;
    targets = open;
  }
  targets.forEach(i => { x.sets[i].weight = values[i]; });
  touchSession(session);
  persist();
  render();
  toast(`${mode === 'repeat' ? 'Repeated last weights' : 'Suggested load applied'} (${targets.length} set${targets.length === 1 ? '' : 's'})`);
}

/* Date moves are merge-safe: moving onto a date that already holds entries
 * for the same workout asks before replacing (v1 silently deleted the moved
 * entries whenever any stale session existed at the target). */
function changeSessionDate(newDate) {
  if (!isISODate(newDate)) { toast('Invalid date'); return; }
  const session = currentSession();
  if (!session) return;
  // Cycle programs date each workout's own session; ctx().activeDate is the
  // week-based programs' working date and must not be moved from here.
  const cycle = isCycleProgram(programByKey(session.programKey));
  if (session.date === newDate) { if (!cycle) ctx().activeDate = newDate; persist(); render(); return; }
  const targetKey = sessionKey(session.profile, newDate, session.week, session.programKey, session.workoutKey, session.blockId);
  const target = state.sessions[targetKey];
  const sourceHasData = sessionHasContent(session);
  if (target && sessionHasContent(target) && sourceHasData) {
    const name = PROGRAMS[session.programKey]?.workouts?.[session.workoutKey]?.name || session.workoutKey;
    if (!confirm(`${name} already has entries on ${prettyDate(newDate)}. Replace them with the workout you are moving?`)) { render(); return; }
  }
  delete state.sessions[session.key];
  if (sourceHasData || !target) {
    const moved = deepClone(session);
    moved.date = newDate;
    moved.key = targetKey;
    // Cycle programs: a deliberately dated shell isn't re-dated to today.
    if (cycle) moved.dateChosen = true;
    state.sessions[targetKey] = moved;
  }
  if (ctx().pinnedSessionKey === session.key) ctx().pinnedSessionKey = state.sessions[targetKey] ? targetKey : '';
  if (!cycle) ctx().activeDate = newDate;
  persist();
  render();
  toast('Workout date set');
}

function openSession(key) {
  const session = Object.prototype.hasOwnProperty.call(state.sessions, key) ? state.sessions[key] : null;
  if (!session) return;
  const context = ctx();
  const sp = programByKey(session.programKey);
  if (isCycleProgram(sp)) {
    // Pinned rather than re-pointing the cycle: viewing an old session
    // never moves block progress.
    context.pinnedSessionKey = key;
  } else {
    context.activeDate = session.date;
    context.currentWeek = clampWeek(session.week);
  }
  if (sp && programAllowedFor(sp, activeProfile())) context.selectedProgramKey = session.programKey;
  context.gymMode = normalizeGymMode(session.gymMode);
  context.selectedWorkoutKey = baseWorkoutKey(session.workoutKey);
  state.activeTab = 'today';
  persist();
  render();
  toast('Workout opened');
}

function deleteSession(key) {
  const session = Object.prototype.hasOwnProperty.call(state.sessions, key) ? state.sessions[key] : null;
  if (!session) return;
  if (!confirm('Delete this workout and all its entries? This cannot be undone.')) return;
  delete state.sessions[key];
  if (ctx().pinnedSessionKey === key) ctx().pinnedSessionKey = '';
  const sp = programByKey(session.programKey);
  if (isCycleProgram(sp)) syncBlockCompletion(sp);
  persist();
  render();
  toast('Workout deleted');
}

function setMetric(field, value) {
  const session = currentSession();
  if (!session) return;
  const date = session.date;
  const metrics = ctx().metricsByDate;
  if (!metrics[date]) metrics[date] = { sleep: '', energy: '', soreness: '', bodyweight: '' };
  metrics[date][field] = value;
  persistSoon();
}

function switchProfile() {
  flushPersist();
  state.profile = '';
  persist();
  document.getElementById('gate').classList.remove('hidden');
}

/* Cycle programs: switching gym while an in-progress workout is open moves
 * it to that gym when its exercises are identical in both (the Upper days)
 * — its machine loads then compare with the right gym. A started workout
 * whose exercises differ by gym (Lower A/B) stays on the gym it began in. */
function setGym(gym) {
  const p = program();
  let moved = '';
  if (isCycleProgram(p) && activeBlock(p) && state.activeTab === 'today') {
    const s = currentSession();
    const next = normalizeGymMode(gym);
    if (s && !s.completedAt && sessionHasContent(s) && s.gymMode !== next
        && effectiveWorkoutKey(p.key, s.workoutKey, next) === s.workoutKey) {
      s.gymMode = next;
      touchSession(s);
      moved = workoutDisplayName(s);
    }
  }
  ctx().gymMode = normalizeGymMode(gym);
  ctx().selectedWorkoutKey = baseWorkoutKey(ctx().selectedWorkoutKey);
  persist();
  render();
  toast(`${gymLabel()} mode${moved ? ` — ${moved} logged as ${gymLabel()}` : ''}`);
}

function resetAll() {
  if (!confirm('Clear ALL data for BOTH profiles? Export a backup first if unsure.')) return;
  if (!commitState(defaultState())) { toast('Couldn’t save — nothing was cleared'); return; }
  completionBanner = null;
  pendingCompletion = null;
  render();
  toast('Cleared');
}

/* ═══ 10. Events (bound once — content handlers are delegated) ═══ */

function bindStaticEvents() {
  document.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
    if (id === 'sysReload') location.reload();
    else if (id === 'rcDownload') downloadDamagedCopy();
    else if (id === 'rcImport') pickImportFile();
    else if (id === 'rcKeep') keepRecoveredState();
  });
  // See afterTap: queued redraws run once the tap's click has been handled.
  document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
  const pointerDone = () => {
    pointerIsDown = false;
    const queued = afterPointer.splice(0);
    if (queued.length) setTimeout(() => queued.forEach(fn => fn()), 0);
  };
  document.addEventListener('pointerup', pointerDone, true);
  document.addEventListener('pointercancel', pointerDone, true);
  // Leaving the app with the last field still focused still finishes it.
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishPendingCompletion(true); });
  document.querySelectorAll('[data-pf]').forEach(b => b.addEventListener('click', () => {
    const profile = b.dataset.pf;
    if (!PROFILE_INFO[profile]) return;
    state.profile = profile;
    ensureSelection();
    persist();
    document.getElementById('gate').classList.add('hidden');
    render();
    toast("Let's go!");
  }));
  document.getElementById('pBtn').addEventListener('click', switchProfile);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    state.activeTab = t.dataset.tab;
    persist();
    render();
  }));
  document.getElementById('wD').addEventListener('click', () => {
    if (isCycleProgram(program())) { stepCycle(-1); return; }
    ctx().currentWeek = clampWeek(currentWeek() - 1); persist(); render();
  });
  document.getElementById('wU').addEventListener('click', () => {
    if (isCycleProgram(program())) { stepCycle(1); return; }
    ctx().currentWeek = clampWeek(currentWeek() + 1); persist(); render();
  });
  document.getElementById('aBtn').addEventListener('click', () => {
    const p = program();
    if (isCycleProgram(p)) {
      // Back to the current cycle, then the in-progress workout or the next
      // one in sequence — selecting it resumes its session automatically.
      const block = activeBlock(p);
      if (!block) { state.activeTab = 'today'; persist(); render(); toast('Start the block first'); return; }
      ctx().pinnedSessionKey = '';
      block.viewCycle = null;
      const key = nextWorkoutKey();
      const resuming = workoutCardInfo(key).status === 'in-progress';
      ctx().selectedWorkoutKey = key;
      state.activeTab = 'today';
      persist();
      render();
      toast(resuming ? 'Resuming workout in progress' : 'Next workout selected');
      return;
    }
    const key = nextWorkoutKey();
    const info = workoutCardInfo(key);
    if (info.status === 'in-progress' && info.session) {
      // Jump to the actual in-progress session (its date/gym mode may differ
      // from the current view) instead of opening a fresh empty one.
      openSession(info.session.key);
      toast('Resuming workout in progress');
      return;
    }
    ctx().selectedWorkoutKey = key;
    persist();
    render();
    toast('Next workout selected');
  });
  document.getElementById('tBtn').addEventListener('click', () => {
    ctx().activeDate = todayISO();
    const block = activeBlock(program());
    if (block) { ctx().pinnedSessionKey = ''; block.viewCycle = null; }
    state.activeTab = 'today';
    persist();
    render();
  });
  document.getElementById('gBtn').addEventListener('click', () => setGym(gymMode() === 'office' ? 'ymca' : 'office'));

  const content = document.getElementById('C');
  content.addEventListener('click', e => {
    const workoutBtn = e.target.closest('[data-wo]');
    if (workoutBtn) {
      ctx().selectedWorkoutKey = baseWorkoutKey(workoutBtn.dataset.wo);
      if (isCycleProgram(program())) ctx().pinnedSessionKey = '';
      persist(); render(); return;
    }
    const ciBtn = e.target.closest('[data-ci]');
    if (ciBtn) {
      const [key, field, value] = ciBtn.dataset.ci.split('|');
      setCheckin(key, field, value);
      return;
    }
    const ciSkip = e.target.closest('[data-cidismiss]');
    if (ciSkip) { dismissCheckin(ciSkip.dataset.cidismiss); return; }
    const wAdd = e.target.closest('[data-wadd]');
    if (wAdd) { addWarmup(Number(wAdd.dataset.wadd)); return; }
    const wDel = e.target.closest('[data-wdel]');
    if (wDel) { const [ei, wi] = wDel.dataset.wdel.split('-').map(Number); removeWarmup(ei, wi); return; }
    const repeatBtn = e.target.closest('[data-rp]');
    if (repeatBtn) { applyPrevious(Number(repeatBtn.dataset.rp), 'repeat'); return; }
    const suggestBtn = e.target.closest('[data-sg]');
    if (suggestBtn) { applyPrevious(Number(suggestBtn.dataset.sg), 'suggest'); return; }
    const timerBtn = e.target.closest('[data-rt]');
    if (timerBtn) { startRestTimer(Number(timerBtn.dataset.rt), timerBtn.dataset.rl || 'Rest'); return; }
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) { openSession(openBtn.dataset.open); return; }
    const deleteBtn = e.target.closest('[data-del]');
    if (deleteBtn) { deleteSession(deleteBtn.dataset.del); return; }
    const hsubBtn = e.target.closest('[data-hsub]');
    if (hsubBtn) { historySubTab = hsubBtn.dataset.hsub; render(); return; }
    const gymBtn = e.target.closest('[data-gym]');
    if (gymBtn) { setGym(gymBtn.dataset.gym); return; }
    const prefBtn = e.target.closest('[data-tpref]');
    if (prefBtn) {
      const key = prefBtn.dataset.tpref;
      state.timerPrefs = { ...defaultTimerPrefs(), ...(state.timerPrefs || {}) };
      state.timerPrefs[key] = !state.timerPrefs[key];
      persist(); render(); toast(`${key === 'autoStart' ? 'Auto-start' : key} ${state.timerPrefs[key] ? 'on' : 'off'}`);
      return;
    }
    switch (e.target.closest('button, label')?.id) {
      case 'qE': case 'sE': exportData(); break;
      case 'nxB': document.getElementById('aBtn').click(); break;
      case 'sR': resetAll(); break;
      case 'sP': switchProfile(); break;
      case 'sBlk': startNewBlock(); break;
      case 'tPerm': enableNotifications(); break;
      case 'tTest': testTimerAlert(); break;
      case 'completionX': completionBanner = null; document.getElementById('completionBanner')?.remove(); break;
      case 'wrApprove': approveWeekReview(); break;
      case 'wrDismiss': dismissWeekReview(); break;
      case 'bkExport': exportData(); break;
      case 'bkStart': startCycleBlock(); break;
      case 'wcComplete': completeWorkout(); break;
      case 'wcReopen': reopenWorkout(); break;
      case 'cyNow': backToCurrentCycle(); break;
    }
  });
  content.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'pS' || t.id === 'rS') {
      if (!programAllowedFor(programByKey(t.value), activeProfile())) return;
      ctx().selectedProgramKey = t.value;
      ctx().selectedWorkoutKey = '';
      ctx().pinnedSessionKey = '';
      completionBanner = null;
      ensureSelection();
      persist(); render(); toast('Program changed');
      return;
    }
    if (t.dataset.eq !== undefined) { setEquipment(Number(t.dataset.eq), t.value); return; }
    if (t.dataset.sb !== undefined) { setSubstitution(Number(t.dataset.sb), t.value); return; }
    if (t.dataset.f) { afterTap(refreshSecondaryUI); return; }
    if (t.id === 'wDate') { changeSessionDate(t.value); return; }
    if (t.dataset.wrDay !== undefined) {
      const dateEl = document.querySelector(`[data-wr-date="${t.dataset.wrDay}"]`);
      if (dateEl) dateEl.textContent = prettyDate(addDaysISO(mostRecentSunday(), Number(t.value)));
      return;
    }
    if (t.id === 'hF') { historyFilter = t.value; render(); return; }
    if (t.id === 'sI') { const f = t.files?.[0]; if (f) importData(f); t.value = ''; return; }
  });
  // Any field losing focus may be the moment a finished workout is acted on.
  content.addEventListener('focusout', scheduleCompletionCheck);
  content.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f) { onSetFieldInput(t); return; }
    if (t.dataset.wf) { onWarmupInput(t); return; }
    if (t.id === 'sN') { const s = currentSession(); if (!s) return; s.notes = t.value; touchSession(s); persistSoon(); return; }
    const metricField = { mS: 'sleep', mB: 'bodyweight', mE: 'energy', mO: 'soreness' }[t.id];
    if (metricField) setMetric(metricField, t.value);
  });
}

/* ═══ 11. Rest timer ═══ */

const restTimer = { duration: 0, endsAt: 0, pausedRemaining: 0, running: false, label: '', interval: null };
let restAlertInfo = null;
let pendingAutoStart = null;

function timerPref(key) { return !!(state.timerPrefs && state.timerPrefs[key]); }
function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!window.__workoutAudio) window.__workoutAudio = new Ctx();
    if (window.__workoutAudio.state === 'suspended') window.__workoutAudio.resume();
  } catch (e) { /* audio unavailable */ }
}
function beep() {
  if (!timerPref('sound')) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const audio = window.__workoutAudio || new Ctx();
    window.__workoutAudio = audio;
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.5);
  } catch (e) { /* audio unavailable */ }
}

function showRestAlert(label) {
  restAlertInfo = { label: label || 'Rest', at: new Date().toISOString() };
  const el = document.getElementById('restAlert');
  if (!el) return;
  el.innerHTML = `<div><strong>Rest complete</strong><br><span>${escapeHTML(restAlertInfo.label)} · ${escapeHTML(prettyDateTime(restAlertInfo.at))}</span></div><button id="raX">Dismiss</button>`;
  el.classList.remove('hidden');
  document.getElementById('raX')?.addEventListener('click', () => { el.classList.add('hidden'); restAlertInfo = null; });
}

/* iOS never supported page-context `new Notification()` — v1 reported
 * "Enabled" but nothing could ever fire. Prefer the service-worker path,
 * which works in installed web apps (iOS 16.4+), and fall back for desktop. */
function fireNotification(label) {
  if (!timerPref('notify')) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body: `${label || 'Rest'} timer is done.`, tag: 'workout-rest-timer' };
  const fallback = () => { try { new Notification('Rest complete', options); } catch (e) { /* unsupported */ } };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification('Rest complete', options)).catch(fallback);
  } else {
    fallback();
  }
}

async function enableNotifications() {
  try {
    if (!('Notification' in window)) { toast('Notifications not supported on this device'); return; }
    const permission = await Notification.requestPermission();
    state.timerPrefs.notify = permission === 'granted';
    persist();
    render();
    toast(permission === 'granted' ? 'Notifications enabled' : 'Notifications not enabled');
  } catch (e) { toast('Notifications unavailable'); }
}
function testTimerAlert() {
  primeAudio();
  beep();
  if (timerPref('vibrate') && navigator.vibrate) navigator.vibrate([80, 40, 80]);
  fireNotification('Test');
  showRestAlert('Test alert');
  toast('Test alert sent');
}

function timerFinished() {
  restTimer.running = false;
  restTimer.endsAt = Date.now();
  clearInterval(restTimer.interval);
  if (timerPref('vibrate') && navigator.vibrate) navigator.vibrate([160, 70, 160, 70, 240]);
  beep();
  fireNotification(restTimer.label);
  showRestAlert(restTimer.label);
  toast(`${restTimer.label} done`);
  updateTimerUI();
}
function timerTick() {
  if (!restTimer.running) return;
  const remaining = Math.ceil((restTimer.endsAt - Date.now()) / 1000);
  if (remaining <= 0) { timerFinished(); return; }
  updateTimerUI();
}
function startRestTimer(seconds, label) {
  primeAudio();
  clearInterval(restTimer.interval);
  restTimer.duration = seconds;
  restTimer.endsAt = Date.now() + seconds * 1000;
  restTimer.pausedRemaining = 0;
  restTimer.running = true;
  restTimer.label = label || 'Rest';
  updateTimerUI();
  restTimer.interval = setInterval(timerTick, 250);
}
function clearRestTimer() {
  clearInterval(restTimer.interval);
  Object.assign(restTimer, { duration: 0, endsAt: 0, pausedRemaining: 0, running: false, label: '', interval: null });
  updateTimerUI();
}
function updateTimerUI() {
  const bar = document.getElementById('tmr');
  document.body.classList.toggle('timer-open', !!restTimer.duration);
  if (!restTimer.duration) { bar.classList.remove('show'); return; }
  bar.classList.add('show');
  const remaining = restTimer.running ? Math.max(0, Math.ceil((restTimer.endsAt - Date.now()) / 1000)) : restTimer.pausedRemaining;
  document.getElementById('tT').textContent = formatSeconds(remaining);
  document.getElementById('tL').textContent = restTimer.label;
  document.getElementById('tF').style.width = `${Math.max(0, ((restTimer.duration - remaining) / restTimer.duration) * 100)}%`;
  document.getElementById('tP').textContent = restTimer.running ? 'Pause' : 'Play';
}

/* Auto-start waits a beat so typing "1" of "12" doesn't fire it, only runs
 * for today's session, and never tramples a running or paused timer. */
function maybeAutoStartRest(exerciseIndex, setIndex, input) {
  if (!timerPref('autoStart')) return;
  const scheduledFor = currentSession();
  if (!scheduledFor || scheduledFor.date !== todayISO()) return;
  if (restTimer.running || restTimer.pausedRemaining > 0) return;
  const timerBtn = input.closest('.ex')?.querySelector('[data-rt]');
  if (!timerBtn) return;
  clearTimeout(pendingAutoStart);
  pendingAutoStart = setTimeout(() => {
    // The user may have switched workouts — or to a program with no
    // started block (no session at all) — in the meantime.
    const session = currentSession();
    if (!session || session.key !== scheduledFor.key) return;
    const set = session.exercises[exerciseIndex]?.sets[setIndex];
    if (!set || !setComplete(set)) return;
    if (restTimer.running || restTimer.pausedRemaining > 0) return;
    startRestTimer(Number(timerBtn.dataset.rt), timerBtn.dataset.rl || 'Rest');
  }, 1200);
}

function bindTimerEvents() {
  document.getElementById('tAdd').addEventListener('click', () => {
    if (!restTimer.duration) return;
    restTimer.duration += 30;
    if (restTimer.running) restTimer.endsAt += 30000;
    else restTimer.pausedRemaining += 30;
    updateTimerUI();
  });
  document.getElementById('tP').addEventListener('click', () => {
    if (!restTimer.duration) return;
    if (restTimer.running) {
      restTimer.pausedRemaining = Math.max(0, Math.ceil((restTimer.endsAt - Date.now()) / 1000));
      restTimer.running = false;
      clearInterval(restTimer.interval);
    } else {
      primeAudio();
      restTimer.endsAt = Date.now() + restTimer.pausedRemaining * 1000;
      restTimer.running = true;
      restTimer.interval = setInterval(timerTick, 250);
    }
    updateTimerUI();
  });
  document.getElementById('tX').addEventListener('click', clearRestTimer);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && restTimer.duration && restTimer.running) timerTick(); });
}

/* ═══ 12. Toast, import/export ═══ */

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => el.classList.remove('show'), 2000);
}

function exportData() {
  state.lastExportAt = new Date().toISOString();
  persist();
  flushPersist();
  const payload = { exportedAt: state.lastExportAt, app: 'Workout v2', data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workout-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
  if (document.getElementById('blockStart') || document.getElementById('bkStart')) render();
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* Generates a standard .ics (RFC 5545) calendar file client-side — no
 * backend, no Calendar API/OAuth. DTSTART/DTEND are deliberately "floating"
 * local time (no timezone suffix), which iOS Calendar and Google Calendar
 * both interpret as the importing device's local time; that's the right
 * behavior for a personal workout reminder and avoids needing a VTIMEZONE
 * block. Re-approving the same week with a new time reuses the same UIDs
 * (date-derived), so re-importing updates those events rather than
 * duplicating them. */
function icsEscapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function icsDateTime(dateISO, timeHHMM) {
  const [y, m, d] = dateISO.split('-');
  const [hh, mm] = (timeHHMM || '17:00').split(':');
  return `${y}${m}${d}T${hh.padStart(2, '0')}${mm.padStart(2, '0')}00`;
}
function icsDateTimePlusMinutes(dateISO, timeHHMM, minutes) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = (timeHHMM || '17:00').split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm + minutes);
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}` +
    `T${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}00`;
}
function buildWeekICS(sunday) {
  const items = weekScheduleForSunday(sunday);
  const stamp = `${icsDateTime(todayISO(), '00:00')}Z`;
  // Profile + program in the UID: without it, dad's and daughter's same-
  // weekday events collide on date+index alone, so importing the second
  // profile's .ics into a shared calendar replaces the first profile's
  // event instead of adding a separate one.
  // UID is anchored to the week (sunday) + workout key, NOT the possibly-
  // overridden event date: the date can change (moving a workout to a
  // different day) while re-approving the SAME week, and a date-derived UID
  // would make the calendar app treat that as a new event, leaving the old
  // one behind as a stale duplicate instead of updating it in place.
  const uidScope = `${activeProfile()}-${program().key}`;
  const events = items.map(it => [
    'BEGIN:VEVENT',
    `UID:workout-${uidScope}-${sunday.replace(/-/g, '')}-${it.key}@workout-app`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsDateTime(it.date, it.time)}`,
    `DTEND:${icsDateTimePlusMinutes(it.date, it.time, 75)}`,
    `SUMMARY:${icsEscapeText(it.name)}`,
    it.focus ? `DESCRIPTION:${icsEscapeText(it.focus)}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Workout App//v2//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

function approveWeekReview() {
  const p = program();
  const overrides = { ...(ctx().workoutScheduleOverrides || {}) };
  scheduledWorkouts(p).forEach(w => {
    const dayInput = document.querySelector(`[data-wr-day="${w.key}"]`);
    const timeInput = document.querySelector(`[data-wr-time="${w.key}"]`);
    const dayNumber = dayInput ? Number(dayInput.value) : (w.dayNumber || 0);
    const time = timeInput && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput.value) ? timeInput.value : ctx().workoutTimeOfDay;
    overrides[w.key] = { dayNumber: Number.isInteger(dayNumber) && dayNumber >= 0 && dayNumber <= 6 ? dayNumber : (w.dayNumber || 0), time };
  });
  const sunday = mostRecentSunday();
  ctx().workoutScheduleOverrides = overrides;
  ctx().weekReviewedFor = sunday;
  persist();
  downloadFile(`workout-week-${sunday}.ics`, buildWeekICS(sunday), 'text/calendar;charset=utf-8');
  render();
  toast('Week approved — calendar file downloaded');
}

function dismissWeekReview() {
  ctx().weekReviewedFor = mostRecentSunday();
  persist();
  render();
  toast('Dismissed for this week');
}

/* Dry-runs the main screens for both profiles against a copy of a candidate
 * state, so data that normalizes but still can't be displayed is rejected
 * before it replaces anything. The live state is always restored. */
function validateCandidate(candidate) {
  const live = state;
  try {
    state = deepClone(candidate);
    for (const profile of Object.keys(PROFILE_INFO)) {
      state.profile = profile;
      ensureSelection();
      renderToday();
      renderHistory();
      renderSettings();
    }
  } finally {
    state = live;
  }
}

/* Validate fully, confirm, then commit only once it's saved — a failed save
 * leaves the current data exactly as it was, and says so. */
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed, incoming;
    try {
      ({ parsed, state: incoming } = parseStateText(String(reader.result)));
      validateCandidate(incoming);
    } catch (e) {
      toast('Import failed — not a valid backup file');
      return;
    }
    const count = Object.keys(incoming.sessions).length;
    const existing = Object.keys(state.sessions).length;
    if (!confirm(`Import backup${parsed.exportedAt ? ` from ${prettyDateTime(parsed.exportedAt)}` : ''} with ${count} workout${count === 1 ? '' : 's'}? This replaces ALL current data for both profiles (${existing} workout${existing === 1 ? '' : 's'}).`)) return;
    if (!commitState(incoming)) {
      alert(staleTab
        ? 'Import cancelled: this data was just changed in another tab. Reload, then import again. Nothing was changed.'
        : 'Import failed: the backup couldn\'t be saved on this device (storage full or unavailable). Nothing was changed.');
      return;
    }
    completionBanner = null;
    pendingCompletion = null;
    render();
    toast(`Imported ${count} workout${count === 1 ? '' : 's'}`);
  };
  reader.onerror = () => toast('Import failed — the file couldn\'t be read');
  reader.readAsText(file);
}
function pickImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) importData(f); });
  input.click();
}

/* — Recovery banner and the stale-tab block (see section 2) — */

function recoveryBannerHTML() {
  const kept = recovery.savedAs
    ? `A copy was kept on this device (${escapeHTML(recovery.savedAs)}).`
    : 'There wasn’t room to keep a separate copy, so it was left untouched in place.';
  const showing = recovery.source ? `older data found under ${escapeHTML(recovery.source)}` : 'an empty app';
  return `<div><strong>Your saved workout data couldn’t be read.</strong> ${kept} Until you choose below, this shows ${showing} and <strong>nothing you enter is saved</strong>.</div>` +
    `<div class="sys-acts"><button id="rcDownload">Download damaged copy</button><button id="rcImport">Import a backup</button><button id="rcKeep">Continue with what’s shown</button></div>`;
}
function renderSystemNotices() {
  const banner = document.getElementById('sysBanner');
  if (banner) {
    banner.classList.toggle('hidden', !recovery);
    banner.innerHTML = recovery ? recoveryBannerHTML() : '';
  }
  const block = document.getElementById('sysBlock');
  if (block) {
    block.classList.toggle('hidden', !staleTab);
    block.innerHTML = staleTab
      ? `<div class="sys-card"><h2>Updated in another tab</h2><p>Your workout data was just saved from another tab or window. This one has stopped saving, so it can’t overwrite that with older data. Anything entered here in the last moment may not have been saved.</p><button class="bp" id="sysReload">Reload with the latest data</button></div>`
      : '';
  }
}
function downloadDamagedCopy() {
  if (!recovery) return;
  downloadFile(`workout-damaged-${todayISO()}.json`, recovery.raw, 'application/json');
}
/* Explicit choice to replace the unreadable saved data with what's loaded. */
function keepRecoveredState() {
  if (!recovery) return;
  const copy = recovery.savedAs
    ? `The damaged copy stays on this device as ${recovery.savedAs}.`
    : 'There is no other copy of the damaged data — download it first if you might need it.';
  if (!confirm(`Replace the unreadable saved data with what's shown now? ${copy}`)) return;
  if (!commitState(state)) { toast('Couldn’t save — nothing was replaced'); return; }
  render();
  toast('Saving again');
}

/* ═══ 13. Init ═══ */

if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
}

bindStaticEvents();
bindTimerEvents();
/* Write the (possibly just-migrated) v10 state immediately, so legacy keys
 * are only ever read once and a reload before any interaction is safe. */
persist();
renderNow();
