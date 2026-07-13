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
 * A session's progress status is always DERIVED from its entries — never
 * stored — so it cannot go stale or lie:
 *   In progress = any weight/reps/RIR entry exists.
 *   Done        = every planned exercise is complete
 *                 (every set has reps > 0 and a non-blank weight; '0' counts,
 *                  so bodyweight work can complete). Per Issue #1.
 *
 * Sections: 1 constants/utils · 2 state & migration · 3 program helpers ·
 * 4 sessions & status engine · 5 history/suggestions/trends · 6 stats &
 * warnings · 7 renderers · 8 targeted updates · 9 actions · 10 events ·
 * 11 rest timer · 12 import/export · 13 init
 */
'use strict';

/* ═══ 1. Constants & utilities ═══ */

const STORAGE_KEY = 'workout_v10_state';
const LEGACY_KEYS = ['workout_v9_state', 'workout_v8_state', 'workout_v7_state',
  'workout_v6_state', 'workout_v5_state', 'workout_v4_state', 'workout_v3_state'];
const WEEK_MIN = 1, WEEK_MAX = 12;
const TABS = ['today', 'history', 'reference', 'settings'];
const PROFILE_INFO = {
  dad: { label: 'Upper / Lower', defaultProgram: 'upperLower12' },
  daughter: { label: 'Glute Split', defaultProgram: 'glutePullPush' },
};

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
  };
}

function normalizeGymMode(v) { return v === 'office' ? 'office' : 'ymca'; }
function baseWorkoutKey(k) { return OFFICE_BASE_MAP[k] || k; }
function effectiveWorkoutKey(programKey, workoutKey, gym) {
  const base = baseWorkoutKey(workoutKey);
  return programKey === 'upperLower12' && normalizeGymMode(gym) === 'office' && OFFICE_WORKOUT_MAP[base]
    ? OFFICE_WORKOUT_MAP[base] : base;
}
function inferProgramKey(workoutKey) {
  if (!workoutKey) return 'glutePullPush';
  const found = Object.values(PROGRAMS).find(p => p.workouts[workoutKey]);
  return found ? found.key : 'glutePullPush';
}

function sessionKey(profile, date, week, programKey, workoutKey) {
  return `${profile}__${date}__w${week}__${programKey}__${workoutKey}`;
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
    copy.key = sessionKey(profile, session.date, session.week, session.programKey, session.workoutKey);
    return copy;
  });
}
function normalizeSet(raw) {
  return { weight: String(raw?.weight ?? ''), reps: String(raw?.reps ?? ''), rir: String(raw?.rir ?? '') };
}
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const workoutKey = String(raw.workoutKey || '');
  if (!workoutKey) return null;
  const programKey = PROGRAMS[raw.programKey] ? raw.programKey : inferProgramKey(workoutKey);
  const date = isISODate(raw.date) ? raw.date : todayISO();
  const week = clampWeek(raw.week);
  const profile = PROFILE_INFO[raw.profile] ? raw.profile : '';
  // The key is always derived, never trusted from raw input — this also
  // neutralizes '__proto__'/'constructor' etc. as imported keys by construction.
  return {
    key: sessionKey(profile, date, week, programKey, workoutKey),
    profile, date, week, programKey, workoutKey,
    gymMode: normalizeGymMode(raw.gymMode || (baseWorkoutKey(workoutKey) !== workoutKey ? 'office' : 'ymca')),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    updatedAt: raw.updatedAt || raw.savedAt || '',
    exercises: Array.isArray(raw.exercises) ? raw.exercises.map(x => ({
      originalName: String(x?.originalName ?? x?.actualName ?? ''),
      actualName: String(x?.actualName ?? x?.originalName ?? ''),
      sets: Array.isArray(x?.sets) ? x.sets.map(normalizeSet) : [],
    })) : [],
  };
}

/* Accepts a v10 state, any legacy v3–v9 state, or an export wrapper {data:…},
 * and returns a normalized v10 state. Never mutates or deletes the source. */
function migrateAny(raw) {
  const src = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
  if (!src || typeof src !== 'object') return defaultState();
  return (Number(src.version) >= 10 || src.sessions) ? normalizeV10(src) : migrateLegacy(src);
}

function normalizeV10(src) {
  const state = defaultState();
  if (PROFILE_INFO[src.profile]) state.profile = src.profile;
  if (TABS.includes(src.activeTab)) state.activeTab = src.activeTab;
  state.timerPrefs = { ...defaultTimerPrefs(), ...(src.timerPrefs || {}) };
  for (const key of Object.keys(PROFILE_INFO)) {
    const rawCtx = (src.profiles || {})[key] || {};
    const context = { ...defaultProfileContext(key), ...rawCtx };
    context.currentWeek = clampWeek(context.currentWeek);
    context.gymMode = normalizeGymMode(context.gymMode);
    if (!PROGRAMS[context.selectedProgramKey]) context.selectedProgramKey = defaultProfileContext(key).selectedProgramKey;
    context.selectedWorkoutKey = baseWorkoutKey(String(context.selectedWorkoutKey || ''));
    context.activeDate = isISODate(context.activeDate) ? context.activeDate : '';
    context.blockStartDate = isISODate(context.blockStartDate) ? context.blockStartDate : '';
    // 0 is a valid sentinel ("never auto-advanced") distinct from clampWeek's [1,12] range.
    context.autoAdvancedThroughWeek = Math.max(0, Math.min(WEEK_MAX, Number(context.autoAdvancedThroughWeek) || 0));
    context.weekReviewedFor = isISODate(context.weekReviewedFor) ? context.weekReviewedFor : '';
    context.workoutTimeOfDay = /^([01]\d|2[0-3]):[0-5]\d$/.test(context.workoutTimeOfDay || '') ? context.workoutTimeOfDay : '17:00';
    context.metricsByDate = rawCtx.metricsByDate && typeof rawCtx.metricsByDate === 'object' ? deepClone(rawCtx.metricsByDate) : {};
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
  state.timerPrefs = { ...defaultTimerPrefs(), ...(src.timerPrefs || {}) };
  // Legacy state was global; week/date/gym go to both profiles, and metrics
  // can't be attributed to a person retroactively, so both keep a copy.
  const week = clampWeek(src.currentWeek);
  const date = isISODate(src.activeWorkoutDate) ? src.activeWorkoutDate : '';
  const gym = normalizeGymMode(src.gymMode);
  const metrics = src.metricsByDate && typeof src.metricsByDate === 'object' ? src.metricsByDate : {};
  for (const key of Object.keys(PROFILE_INFO)) {
    const context = state.profiles[key];
    context.currentWeek = week;
    context.activeDate = date;
    context.gymMode = gym;
    context.metricsByDate = deepClone(metrics);
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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return pruneEmptySessions(migrateAny(JSON.parse(raw)));
  } catch (e) { /* fall through to legacy keys */ }
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return pruneEmptySessions(migrateAny(JSON.parse(raw)));
    } catch (e) { /* try the next key */ }
  }
  return defaultState();
}
/* Sessions created by merely browsing are dropped at load so they don't
 * accumulate forever. Anything the user actually did — entries, notes, or an
 * exercise substitution — counts as content and is kept. */
function pruneEmptySessions(state) {
  for (const [key, session] of Object.entries(state.sessions)) {
    if (!sessionHasContent(session)) delete state.sessions[key];
  }
  return state;
}

let state = loadState();
let saveError = '';
let persistTimer = null;
let lastSaveErrorToast = 0;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
window.addEventListener('pagehide', flushPersist);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPersist(); });

/* ═══ 3. Program / context helpers ═══ */

function activeProfile() { return PROFILE_INFO[state.profile] ? state.profile : 'daughter'; }
function ctx() { return state.profiles[activeProfile()]; }
function program() { return PROGRAMS[ctx().selectedProgramKey] || PROGRAMS.glutePullPush; }
function gymMode() { return normalizeGymMode(ctx().gymMode); }
function gymLabel() { return gymMode() === 'office' ? 'Office' : 'YMCA'; }
function activeDate() { return ctx().activeDate || todayISO(); }
function currentWeek() { return clampWeek(ctx().currentWeek); }

function workoutList(p, includeManualOnly = true) {
  return Object.values((p || program()).workouts)
    .filter(w => includeManualOnly || w.autoSchedule !== false)
    .sort((a, b) => (a.dayNumber || 0) - (b.dayNumber || 0));
}
function scheduledWorkouts(p) { return workoutList(p, false); }

function hasDeload(p) { return Number((p || program()).deloadWeek) > 0; }
function isDeloadWeek() { const p = program(); return hasDeload(p) && currentWeek() === p.deloadWeek; }
function targetSets(exerciseTemplate, p, week) {
  return (!hasDeload(p) || week !== p.deloadWeek)
    ? exerciseTemplate.sets
    : Math.max(1, Math.ceil(exerciseTemplate.sets / 2));
}

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
  if (!PROGRAMS[context.selectedProgramKey]) context.selectedProgramKey = defaultProfileContext(activeProfile()).selectedProgramKey;
  const p = program();
  context.selectedWorkoutKey = baseWorkoutKey(context.selectedWorkoutKey);
  if (!context.selectedWorkoutKey || !p.workouts[effectiveWorkoutKey(p.key, context.selectedWorkoutKey, context.gymMode)]) {
    context.selectedWorkoutKey = nextWorkoutKey();
  }
}

/* ═══ 4. Sessions & the two-state status engine ═══ */

function newSession(profile, programKey, workoutKey, date, week, gym) {
  const p = PROGRAMS[programKey], w = p.workouts[workoutKey];
  return {
    key: sessionKey(profile, date, week, programKey, workoutKey),
    profile, date, week, programKey, workoutKey,
    gymMode: normalizeGymMode(gym),
    notes: '',
    updatedAt: '',
    exercises: w.exercises.map(x => ({
      originalName: x.name,
      actualName: x.name,
      sets: Array.from({ length: targetSets(x, p, week) }, () => ({ weight: '', reps: '', rir: '' })),
    })),
  };
}

/* Re-align a stored session with its program template (exercise list or
 * deload set counts may have changed since it was created), preserving the
 * user's entries AND their chosen substitution (v1 reset actualName here,
 * which silently undid every substitution). Sets holding data are never
 * dropped, even when the plan now calls for fewer. */
function syncSessionWithProgram(session) {
  const p = PROGRAMS[session.programKey], w = p?.workouts?.[session.workoutKey];
  if (!p || !w) return session;
  const byName = new Map();
  for (const e of session.exercises) {
    for (const n of aliasNames(e.originalName)) if (n && !byName.has(n)) byName.set(n, e);
    for (const n of aliasNames(e.actualName)) if (n && !byName.has(n)) byName.set(n, e);
  }
  const fresh = newSession(session.profile, session.programKey, session.workoutKey, session.date, session.week, session.gymMode);
  fresh.key = session.key;
  fresh.notes = session.notes || '';
  fresh.updatedAt = session.updatedAt || '';
  fresh.exercises = fresh.exercises.map(ne => {
    const old = aliasNames(ne.originalName).map(n => byName.get(n)).find(Boolean);
    if (!old) return ne;
    const oldSets = Array.isArray(old.sets) ? old.sets : [];
    let count = ne.sets.length;
    for (let i = count; i < oldSets.length; i++) if (setHasEntry(oldSets[i])) count = i + 1;
    return {
      ...ne,
      actualName: old.actualName || ne.originalName,
      sets: Array.from({ length: count }, (_, i) => oldSets[i] ? normalizeSet(oldSets[i]) : { weight: '', reps: '', rir: '' }),
    };
  });
  return fresh;
}

function currentSession() {
  const p = program();
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
/* A set is complete with reps > 0 and any non-blank weight — an explicit '0'
 * counts, so bodyweight movements (pull-ups, push-up variants…) can finish. */
function setComplete(s) {
  return Number(s?.reps) > 0 && String(s?.weight ?? '').trim() !== '';
}
function exerciseComplete(x) { return x.sets.length > 0 && x.sets.every(setComplete); }
function sessionHasEntry(session) {
  return (session.exercises || []).some(x => (x.sets || []).some(setHasEntry));
}
function sessionHasSubstitution(session) {
  return (session.exercises || []).some(x => x.actualName && x.originalName && x.actualName !== x.originalName);
}
/* Anything worth keeping/showing: set entries, notes, or a chosen substitution. */
function sessionHasContent(session) {
  return sessionHasEntry(session) || String(session.notes || '').trim() !== '' || sessionHasSubstitution(session);
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
 * first two; 'empty' just means nothing has been entered yet (no label). */
function sessionStatus(session) {
  const p = sessionProgress(session);
  if (p.total > 0 && p.done === p.total) return 'done';
  return sessionHasEntry(session) ? 'in-progress' : 'empty';
}
function exerciseVolume(x) {
  return x.sets.reduce((sum, s) => sum + ((Number(s.weight) || 0) * (Number(s.reps) || 0)), 0);
}

function currentBlockStart() { return ctx().blockStartDate || ''; }
/* With no block boundary set, every session ever logged counts (unchanged
 * behavior). Once a boundary exists, only sessions from that date onward
 * belong to "this week" — otherwise restarting a program at Week 1 collides
 * with an earlier cycle's Week 1 sessions (same week number, same program). */
function sessionInCurrentBlock(session) {
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

/* Next scheduled workout + the actual calendar date it next falls on (today
 * excluded, since "next" is shown right after finishing today's session). */
function nextScheduledInfo() {
  const p = program();
  const key = nextWorkoutKey();
  const w = scheduledWorkouts(p).find(x => x.key === key);
  if (!w) return null;
  const actual = p.workouts[effectiveWorkoutKey(p.key, key, ctx().gymMode)] || w;
  const todayDow = new Date().getDay();
  let delta = (w.dayNumber || 0) - todayDow;
  if (delta <= 0) delta += 7;
  return { name: actual.name, day: w.day, date: dateISOFromToday(delta) };
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
    return { day: w.day, name: actual.name, focus: actual.focus || '', date: addDaysISO(sunday, w.dayNumber || 0) };
  });
}

/* ═══ 5. History, suggestions, trends ═══ */

/* All history lookups are scoped to the active profile and program — this is
 * what keeps one user's numbers out of the other's hints/suggestions (v1
 * matched across programs via the alias table, so dad's Hip Thrust
 * suggestions could come from daughter's history and vice versa). */
function historyEntries(name, excludeKey) {
  const names = new Set(aliasNames(name));
  const profile = activeProfile();
  const results = [];
  for (const session of Object.values(state.sessions)) {
    if (session.profile !== profile) continue;
    if (session.programKey !== program().key) continue;
    if (excludeKey && session.key === excludeKey) continue;
    if (!sessionHasEntry(session)) continue;
    session.exercises.forEach((x, i) => {
      if (!names.has(x.actualName) && !names.has(x.originalName)) return;
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
function lastPerformance(actualName, originalName, excludeKey) {
  const byActual = historyEntries(actualName, excludeKey);
  if (byActual.length) return byActual[0];
  const byOriginal = historyEntries(originalName, excludeKey);
  return byOriginal.length ? byOriginal[0] : null;
}

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

/* Double-progression check: did the last performance hit the top of the rep
 * range at (or under) the target intensity on every completed set? */
function metProgressionTarget(sets, t) {
  const valid = sets.filter(s => Number(s.weight) > 0 && Number(s.reps) > 0);
  if (!valid.length || !valid.every(s => Number(s.reps) >= t.repsMax)) return false;
  if (t.intensityType === 'rpe') {
    const efforts = valid.map(s => Number(s.rir)).filter(x => x > 0);
    return !efforts.length || (efforts.reduce((a, b) => a + b, 0) / efforts.length) <= t.intensityMax;
  }
  if (t.intensityType === 'special') return true;
  const efforts = valid.map(s => Number(s.rir)).filter(x => x >= 0);
  const avg = efforts.length ? efforts.reduce((a, b) => a + b, 0) / efforts.length : t.rirTarget;
  return avg <= (t.rirTarget + 0.5);
}

function suggestLoad(exercise, t, excludeKey) {
  if (!t) return { value: '', label: '' };
  const last = lastPerformance(exercise.actualName, exercise.originalName, excludeKey);
  if (!last) return { value: '', label: 'No prior data' };
  const prevSets = last.exercise.sets;
  const base = commonWeight(prevSets);
  if (!base) return { value: '', label: 'No load last time' };
  const completed = prevSets.filter(s => Number(s.weight) > 0 && Number(s.reps) > 0);
  const bump = metProgressionTarget(completed, t);
  const value = bump ? roundLoad(base + (t.step || 5)) : base;
  let label = bump ? `Met target → +${t.step || 5}` : 'Repeat load, beat reps';
  if (t.intensityType === 'special' && t.intensityHint) label += ` · ${t.intensityHint}`;
  return { value, label };
}

function exerciseTemplate(session, index) {
  return PROGRAMS[session.programKey]?.workouts?.[session.workoutKey]?.exercises?.[index];
}

function getTrend(name, limit) {
  const entries = historyEntries(name).slice(0, limit || 8).reverse();
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
function trendHTML(name) {
  const t = getTrend(name, 8);
  if (!t) return '';
  const cls = t.up ? 'spark-up' : t.flat ? '' : 'spark-dn';
  const arrow = t.up ? '↑' : t.flat ? '→' : '↓';
  const label = `${arrow} ${t.up ? '+' : ''}${t.delta} lb (${t.up ? '+' : ''}${t.pct}%) over ${t.points.length} sessions`;
  return `<div class="ex-spark">${sparkSVG(t.points, 80, 24)}<span class="${cls}">${label}</span></div>`;
}

/* ═══ 6. Stats & entry warnings ═══ */

function programStats() {
  const profile = activeProfile();
  const sessions = Object.values(state.sessions).filter(s => s.profile === profile && s.programKey === program().key && sessionHasEntry(s));
  const chrono = [...sessions].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.updatedAt || '').localeCompare(b.updatedAt || ''));
  let volume = 0, setCount = 0, prCount = 0;
  const best = {};
  for (const s of chrono) for (const x of s.exercises) {
    volume += exerciseVolume(x);
    for (const set of x.sets) {
      if (setComplete(set)) setCount++;
      const w = Number(set.weight) || 0;
      if (w > (best[x.actualName] || 0)) {
        if (best[x.actualName] !== undefined) prCount++;
        best[x.actualName] = w;
      }
    }
  }
  const doneThisWeek = scheduledWorkouts().filter(w => workoutCardInfo(w.key).status === 'done').length;
  return { sessions: sessions.length, volume: Math.round(volume), sets: setCount, prs: prCount, doneThisWeek };
}

function metricsFor(date) { return ctx().metricsByDate[date] || { sleep: '', energy: '', soreness: '', bodyweight: '' }; }
function previousBodyweight(date) {
  const entries = Object.entries(ctx().metricsByDate)
    .filter(([d, m]) => d < date && Number(m.bodyweight) > 0)
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
  session.exercises.forEach((x, i) => {
    const t = exerciseTemplate(session, i);
    // One load-sanity check per exercise (not per set) against last time's
    // working weight — catches fat-finger entries (a stray extra digit, a
    // missed decimal) without nagging on every set of a legitimate jump.
    // Gated on a >=20lb prior weight so normal swings on light accessory/
    // calf work (e.g. 10 -> 15 lb) don't trigger false positives.
    const last = lastPerformance(x.actualName, x.originalName, session.key);
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
  return `<div class="card"><div class="stats"><div class="st"><strong>${stats.doneThisWeek}</strong><span>Done this wk</span></div><div class="st"><strong>${stats.sessions}</strong><span>Sessions</span></div><div class="st"><strong>${stats.sets}</strong><span>Sets</span></div><div class="st"><strong>${stats.prs}</strong><span>PRs</span></div></div></div>`;
}

function warningsHTML(session) {
  const warnings = entryWarnings(session);
  if (!warnings.length) return '';
  return `<div class="bn bn-w"><strong>Check entries:</strong><br>${warnings.map(escapeHTML).join('<br>')}</div>`;
}

function statusLineHTML(session) {
  const status = sessionStatus(session);
  const ex = sessionProgress(session), sets = setsProgress(session);
  const when = `${escapeHTML(prettyDate(session.date))} · Week ${session.week}`;
  if (status === 'done') {
    return `<div class="stat-line"><span class="tag tag-dn">Done</span><span>${ex.done}/${ex.total} exercises · ${sets.done}/${sets.total} sets · ${when}${session.updatedAt ? ` · <small>updated ${escapeHTML(prettyDateTime(session.updatedAt))}</small>` : ''}</span></div>`;
  }
  if (status === 'in-progress') {
    return `<div class="stat-line"><span class="tag tag-ip">In progress</span><span>${ex.done}/${ex.total} exercises · ${sets.done}/${sets.total} sets · ${when} · <small>autosaved</small></span></div>`;
  }
  return `<div class="stat-line"><span>Not started · ${ex.total} exercises · ${when}</span><small>Entries autosave as you type.</small></div>`;
}

function renderToday() {
  const p = program(), context = ctx();
  const session = currentSession();
  const sets = setsProgress(session);
  const deload = isDeloadWeek();
  const metrics = metricsFor(session.date);
  const showGym = p.key === 'upperLower12';

  let h = completionBannerHTML();
  if (weekReviewPending()) h += weekReviewCardHTML();
  h += `<div class="card"><div class="card-h"><h2>${escapeHTML(p.title)}</h2><span class="hint" id="setsHint">${sets.done}/${sets.total} sets</span></div>` +
    `<span class="lbl">Program</span><select class="sel mb12" id="pS" aria-label="Program">${Object.values(PROGRAMS).map(x => `<option value="${escapeHTML(x.key)}" ${x.key === p.key ? 'selected' : ''}>${escapeHTML(x.title)}</option>`).join('')}</select>` +
    (showGym ? `<span class="lbl">Gym</span><div class="gym-choice"><button class="${gymMode() === 'ymca' ? 'on' : ''}" data-gym="ymca">YMCA</button><button class="${gymMode() === 'office' ? 'on' : ''}" data-gym="office">Office Gym</button></div>` : '') +
    `<span class="lbl">Workout date</span><input class="sel mb12" type="date" id="wDate" value="${escapeHTML(session.date)}">` +
    (deload ? '<div class="bn bn-w mb8">Deload week — volume auto-halved. Use 4–5 RIR, no failure, and no new exercises.</div>' : '') +
    `<div class="wo-g" id="woGrid">${workoutGridHTML()}</div></div>`;

  h += `<div class="card"><div class="card-h"><h2>Readiness</h2><span class="hint">Check-in</span></div><div class="met">` +
    `<div class="mf"><label for="mS">Sleep</label><input type="number" step="0.5" min="0" max="14" id="mS" value="${escapeHTML(metrics.sleep || '')}" placeholder="hrs" inputmode="decimal"></div>` +
    `<div class="mf"><label for="mB">Weight</label><input type="number" step="0.1" min="0" id="mB" value="${escapeHTML(metrics.bodyweight || '')}" placeholder="lbs" inputmode="decimal"></div>` +
    `<div class="mf"><label for="mE">Energy</label><input type="number" min="1" max="5" id="mE" value="${escapeHTML(metrics.energy || '')}" placeholder="1-5" inputmode="numeric"></div>` +
    `<div class="mf"><label for="mO">Sore</label><input type="number" min="1" max="5" id="mO" value="${escapeHTML(metrics.soreness || '')}" placeholder="1-5" inputmode="numeric"></div></div></div>`;

  h += `<div id="statsCard">${statsCardHTML()}</div>`;

  h += `<div id="statusLine">${statusLineHTML(session)}</div>`;

  h += `<div id="warnBox">${warningsHTML(session)}</div>`;

  session.exercises.forEach((x, ei) => {
    const t = exerciseTemplate(session, ei);
    if (!t) return;
    const last = lastPerformance(x.actualName, x.originalName, session.key);
    const suggestion = suggestLoad(x, t, session.key);
    const substitutions = [x.originalName, ...(p.substitutions[x.originalName] || [])];
    if (!substitutions.includes(x.actualName)) substitutions.push(x.actualName);
    const doneSets = x.sets.filter(setComplete).length;
    const allDone = doneSets === x.sets.length && x.sets.length > 0;
    h += `<div class="ex"><div class="ex-top"><div class="ex-nm">${escapeHTML(x.actualName)}</div>` +
      `<div class="ex-bd"><span class="bd">${x.sets.length} × ${t.repsMin}–${t.repsMax}</span><span class="bd">${escapeHTML(intensityBadge(t))}</span><span class="bd">Rest ${formatSeconds(t.rest)}</span><span class="bd ${allDone ? 'bd-ok' : ''}" data-exdone="${ei}">${doneSets}/${x.sets.length}</span></div>` +
      (t.note ? `<div class="ex-nt">${escapeHTML(t.note)}</div>` : '') +
      (t.intensityHint ? `<div class="ex-nt">${escapeHTML(t.intensityHint)}</div>` : '') + `</div>` +
      `<select class="ex-sb" data-sb="${ei}" aria-label="Substitute exercise">${substitutions.map(n => `<option value="${escapeHTML(n)}" ${n === x.actualName ? 'selected' : ''}>${escapeHTML(n)}</option>`).join('')}</select>` +
      `<div class="ex-hi"><strong>${last ? 'Last:' : 'History:'}</strong> ${last ? `${escapeHTML(last.session.date)} · ${escapeHTML(formatSets(last.exercise.sets))} · W${last.session.week}` : 'No prior session.'}<br><span style="color:var(--t3)">${escapeHTML(suggestion.label)}${suggestion.value ? ` → <strong style="color:var(--ac)">${suggestion.value}</strong>` : ''}</span>${trendHTML(x.actualName)}</div>` +
      `<div class="ex-tl"><button class="tb" data-rp="${ei}">↻ Repeat</button><button class="tb" data-sg="${ei}">↑ Suggest</button><button class="tb tb-t" data-rt="${t.rest}" data-rl="${escapeHTML(x.actualName)}">⏱ ${formatSeconds(t.rest)}</button></div>` +
      `<div class="sets">${x.sets.map((s, si) => {
        const done = setComplete(s);
        return `<div class="sr${done ? ' dn' : ''}"><div class="sn">${si + 1}</div>` +
          `<div class="sf"><label>Weight</label><input type="number" inputmode="decimal" step="0.5" min="0" value="${escapeHTML(s.weight)}" placeholder="lb / 0" data-f="${ei}-${si}-weight"></div>` +
          `<div class="sf"><label>Reps</label><input type="number" inputmode="numeric" step="1" min="0" value="${escapeHTML(s.reps)}" placeholder="${t.repsMin}–${t.repsMax}" data-f="${ei}-${si}-reps"></div>` +
          `<div class="sf"><label>${escapeHTML(intensityLabel(t))}</label><input type="number" inputmode="decimal" step="0.5" min="0" max="10" value="${escapeHTML(s.rir)}" placeholder="${escapeHTML(intensityPlaceholder(t))}" data-f="${ei}-${si}-rir"></div></div>`;
      }).join('')}</div></div>`;
  });

  h += `<div class="card"><span class="lbl">Session notes</span><textarea class="notes" id="sN" placeholder="How did it feel?">${escapeHTML(session.notes || '')}</textarea><div class="acts"><button class="bg" id="qE">Export backup</button><button class="bg" id="nxB">Next workout →</button></div></div><div class="spacer"></div>`;
  return h;
}

function sessionCardHTML(session) {
  const p = PROGRAMS[session.programKey];
  const name = p?.workouts?.[session.workoutKey]?.name || session.workoutKey;
  const ex = sessionProgress(session);
  const fraction = ex.total ? ex.done / ex.total : 0;
  const status = sessionStatus(session);
  const volume = session.exercises.reduce((a, x) => a + exerciseVolume(x), 0);
  return `<div class="hi"><div class="hi-row">${progressRing(fraction, status === 'done')}<span class="wo-bt"><div class="hi-tp"><span class="hi-n">${escapeHTML(name)}</span><span class="hi-v">${Math.round(volume).toLocaleString()}</span></div>` +
    `<div class="hi-m">${escapeHTML(prettyDate(session.date))} · Week ${session.week} · ${session.gymMode === 'office' ? 'Office' : 'YMCA'} · ${ex.done}/${ex.total} exercises ${statusTag(status)}</div>` +
    (session.updatedAt ? `<div class="hi-m">Updated ${escapeHTML(prettyDateTime(session.updatedAt))}</div>` : '') +
    (session.notes ? `<div class="hi-s">${escapeHTML(session.notes)}</div>` : '') +
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
  const names = [...new Set(sessions.flatMap(s => s.exercises.filter(x => x.sets.some(setHasEntry)).map(x => x.actualName)))].sort();

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
  h += `<div class="card"><div class="card-h"><h2>Done</h2><span class="hint">${done.length}</span></div>${done.length ? done.map(sessionCardHTML).join('') : '<div class="hi">No completed workouts yet. A workout shows here once every planned exercise is complete.</div>'}</div>`;
  return h;
}

function renderHistoryByExercise(sessions, names) {
  const filter = names.includes(historyFilter) ? historyFilter : '';
  const rows = [];
  for (const s of sessions) {
    s.exercises.forEach(x => {
      if (!x.sets.some(setHasEntry)) return;
      if (filter && x.actualName !== filter) return;
      rows.push({
        name: x.actualName, original: x.originalName,
        workout: PROGRAMS[s.programKey]?.workouts?.[s.workoutKey]?.name || s.workoutKey,
        gym: s.gymMode === 'office' ? 'Office' : 'YMCA',
        date: s.date, week: s.week, summary: formatSets(x.sets), volume: Math.round(exerciseVolume(x)),
      });
    });
  }
  let trendBlock = '';
  if (filter) {
    const t = getTrend(filter, 12);
    if (t) trendBlock = `<div class="hi" style="background:rgba(99,220,255,.04);border-color:rgba(99,220,255,.12)"><div class="hi-tp"><span class="hi-n" style="color:var(--ac)">Trend</span><span class="hi-v">${t.points[t.points.length - 1].weight} lb</span></div><div class="ex-spark" style="margin-top:4px">${sparkSVG(t.points, 120, 28)}<span class="${t.up ? 'spark-up' : t.flat ? '' : 'spark-dn'}">${t.up ? '↑' : t.flat ? '→' : '↓'} ${t.up ? '+' : ''}${t.delta} lb (${t.up ? '+' : ''}${t.pct}%) over ${t.points.length} sessions</span></div></div>`;
  }
  return `<div class="card"><div class="card-h"><h2>Exercise history</h2></div><span class="lbl">Filter</span><select class="sel mb12" id="hF"><option value="">All</option>${names.map(n => `<option value="${escapeHTML(n)}" ${n === filter ? 'selected' : ''}>${escapeHTML(n)}</option>`).join('')}</select>${trendBlock}` +
    (rows.length ? rows.map(r => `<div class="hi"><div class="hi-tp"><span class="hi-n">${escapeHTML(r.name)}</span><span class="hi-v">${r.volume.toLocaleString()}</span></div><div class="hi-m">${escapeHTML(prettyDate(r.date))} · Week ${r.week} · ${escapeHTML(r.gym)} · ${escapeHTML(r.workout)}</div>${r.name !== r.original ? `<div class="hi-m">Subbed from ${escapeHTML(r.original)}</div>` : ''}<div class="hi-s">${escapeHTML(r.summary)}</div></div>`).join('') : '<div class="hi">No exercise history yet.</div>') +
    `</div>`;
}

function renderReference() {
  const p = program();
  const scheduled = scheduledWorkouts(p);
  const showGym = p.key === 'upperLower12';
  let h = `<div class="card"><div class="card-h"><h2>Active program</h2></div><span class="lbl">Program</span><select class="sel mb12" id="rS">${Object.values(PROGRAMS).map(x => `<option value="${escapeHTML(x.key)}" ${x.key === p.key ? 'selected' : ''}>${escapeHTML(x.title)}</option>`).join('')}</select>` +
    (showGym ? `<span class="lbl">Gym</span><div class="gym-choice"><button class="${gymMode() === 'ymca' ? 'on' : ''}" data-gym="ymca">YMCA</button><button class="${gymMode() === 'office' ? 'on' : ''}" data-gym="office">Office Gym</button></div>` : '') +
    `<div class="ri"><strong>Week ${currentWeek()}</strong> · ${hasDeload(p) ? `Deload W${p.deloadWeek}` : 'No deload'}${showGym ? ` · ${gymLabel()} mode` : ''}${currentBlockStart() ? ` · Block started ${escapeHTML(prettyDate(currentBlockStart()))}` : ''}</div></div>`;
  h += `<div class="card"><div class="card-h"><h2>Program rules</h2></div>${p.checklist.map(l => `<div class="ri">${escapeHTML(l)}</div>`).join('')}</div>`;
  h += `<div class="card"><div class="card-h"><h2>Schedule</h2></div>${scheduled.map(w => {
    const actual = p.workouts[effectiveWorkoutKey(p.key, w.key, ctx().gymMode)] || w;
    const swapped = actual.key !== w.key;
    return `<div class="ri"><strong>${escapeHTML(w.day)}</strong> — ${escapeHTML(actual.name)}${swapped ? ' <span style="color:var(--ac);font-size:12px">Office swap</span>' : ''}<br><span style="color:var(--t3);font-size:12px">${escapeHTML(actual.focus)}</span></div>`;
  }).join('')}<div class="ri"><strong>Recovery</strong><br><span style="color:var(--t3);font-size:12px">${escapeHTML(p.recoveryNote || 'Rest.')}</span></div></div>`;
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
  h += `<div class="card"><div class="card-h"><h2>Training block</h2></div><div class="ri mb12">${currentBlockStart() ? `Current block started <strong>${escapeHTML(prettyDate(currentBlockStart()))}</strong>. Weekly status and "Next" only count sessions from that date onward, so an earlier block's Week 1 doesn't collide with this one.` : `No block boundary set — weekly status counts every session ever logged at each week number. Set one when you restart ${escapeHTML(program().shortName)} from Week 1.`}</div><button class="bg" id="sBlk">Start new block (reset to Week 1)</button></div>`;
  if (program().key === 'upperLower12') {
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
  ensureSelection();
  const p = program();
  const workout = p.workouts[effectiveWorkoutKey(p.key, ctx().selectedWorkoutKey, ctx().gymMode)];
  const deload = isDeloadWeek();
  document.getElementById('gate').classList.toggle('hidden', !!state.profile);
  document.getElementById('hT').textContent = workout ? workout.name : p.shortName;
  document.getElementById('hS').textContent = prettyDate(activeDate());
  document.getElementById('hB').textContent = deload ? `W${currentWeek()} · ${gymLabel()} · Deload` : `${p.shortName} · ${gymLabel()} · W${currentWeek()}`;
  document.getElementById('wV').textContent = `W${currentWeek()}`;
  const gymBtn = document.getElementById('gBtn');
  gymBtn.textContent = `Gym: ${gymLabel()}`;
  gymBtn.classList.toggle('hidden', p.key !== 'upperLower12');
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
  const body = b.kind === 'block'
    ? `<strong>Block complete! 🎉</strong><br>All ${WEEK_MAX} weeks done. Start a new block in Settings when you're ready to go again.`
    : `<strong>Workout complete! 💪</strong><br>See you ${escapeHTML(b.day)} for ${escapeHTML(b.name)} · ${escapeHTML(prettyDate(b.date))}`;
  return `<div class="bn bn-i mb8" id="completionBanner" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div>${body}</div><button id="completionX" aria-label="Dismiss" style="flex-shrink:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px 8px;font-size:12px;color:inherit">✕</button></div>`;
}

function weekReviewCardHTML() {
  const p = program();
  const sunday = mostRecentSunday();
  const items = weekScheduleForSunday(sunday);
  const rows = items.map(it => `<div class="ri"><strong>${escapeHTML(it.day)}</strong> — ${escapeHTML(it.name)}<br><span style="color:var(--t3);font-size:12px">${escapeHTML(prettyDate(it.date))}</span></div>`).join('');
  return `<div class="card" id="weekReviewCard"><div class="card-h"><h2>Review this week</h2><span class="hint">${escapeHTML(p.shortName)}</span></div>` +
    `<div class="ri mb12">Approve this week's schedule to download a calendar file — one tap adds all ${items.length} workouts to your phone's Calendar app.</div>${rows}` +
    `<span class="lbl">Workout time</span><input type="time" class="sel mb12" id="wrTime" value="${escapeHTML(ctx().workoutTimeOfDay)}">` +
    `<div class="acts"><button class="bg" id="wrDismiss">Dismiss</button><button class="bp" id="wrApprove">Approve &amp; add to calendar</button></div></div>`;
}

function onSetFieldInput(input) {
  const [ei, si, field] = input.dataset.f.split('-');
  const session = currentSession();
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
    if (!wasComplete && complete) maybeAutoStartRest(Number(ei), Number(si), input);
  }
  if (!wasSessionDone && sessionStatus(session) === 'done') {
    celebrateCompletion(session);
    persist();
    render(); // week/header may have changed — a full render, not the light path
    return;
  }
  refreshEntryUI();
}

function setSubstitution(index, name) {
  const session = currentSession();
  if (!session.exercises[index]) return;
  session.exercises[index].actualName = name;
  touchSession(session);
  persist();
  render();
  toast('Swapped');
}

function applyPrevious(index, mode) {
  const session = currentSession();
  const x = session.exercises[index];
  const t = exerciseTemplate(session, index);
  if (!x || !t) return;
  const last = lastPerformance(x.actualName, x.originalName, session.key);
  if (!last) { toast('No previous data'); return; }
  const lastSets = last.exercise.sets;
  const suggestion = suggestLoad(x, t, session.key);
  x.sets.forEach((set, i) => {
    if (mode === 'repeat') {
      const prev = lastSets[i] || lastSets[lastSets.length - 1] || {};
      if (prev.weight !== undefined && String(prev.weight) !== '') set.weight = String(prev.weight);
    } else if (suggestion.value !== '' && suggestion.value !== undefined) {
      set.weight = String(suggestion.value);
    }
  });
  touchSession(session);
  persist();
  render();
  toast(mode === 'repeat' ? 'Repeated last weights' : 'Suggested loads applied');
}

/* Date moves are merge-safe: moving onto a date that already holds entries
 * for the same workout asks before replacing (v1 silently deleted the moved
 * entries whenever any stale session existed at the target). */
function changeSessionDate(newDate) {
  if (!isISODate(newDate)) { toast('Invalid date'); return; }
  const session = currentSession();
  if (session.date === newDate) { ctx().activeDate = newDate; persist(); render(); return; }
  const targetKey = sessionKey(session.profile, newDate, session.week, session.programKey, session.workoutKey);
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
    state.sessions[targetKey] = moved;
  }
  ctx().activeDate = newDate;
  persist();
  render();
  toast('Workout date set');
}

function openSession(key) {
  const session = state.sessions[key];
  if (!session) return;
  const context = ctx();
  context.activeDate = session.date;
  context.currentWeek = clampWeek(session.week);
  if (PROGRAMS[session.programKey]) context.selectedProgramKey = session.programKey;
  context.gymMode = normalizeGymMode(session.gymMode);
  context.selectedWorkoutKey = baseWorkoutKey(session.workoutKey);
  state.activeTab = 'today';
  persist();
  render();
  toast('Workout opened');
}

function deleteSession(key) {
  const session = state.sessions[key];
  if (!session) return;
  if (!confirm('Delete this workout and all its entries? This cannot be undone.')) return;
  delete state.sessions[key];
  persist();
  render();
  toast('Workout deleted');
}

function setMetric(field, value) {
  const date = currentSession().date;
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

function resetAll() {
  if (!confirm('Clear ALL data for BOTH profiles? Export a backup first if unsure.')) return;
  state = defaultState();
  persist();
  render();
  toast('Cleared');
}

/* ═══ 10. Events (bound once — content handlers are delegated) ═══ */

function bindStaticEvents() {
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
  document.getElementById('wD').addEventListener('click', () => { ctx().currentWeek = clampWeek(currentWeek() - 1); persist(); render(); });
  document.getElementById('wU').addEventListener('click', () => { ctx().currentWeek = clampWeek(currentWeek() + 1); persist(); render(); });
  document.getElementById('aBtn').addEventListener('click', () => {
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
  document.getElementById('tBtn').addEventListener('click', () => { ctx().activeDate = todayISO(); state.activeTab = 'today'; persist(); render(); });
  document.getElementById('gBtn').addEventListener('click', () => {
    ctx().gymMode = gymMode() === 'office' ? 'ymca' : 'office';
    ctx().selectedWorkoutKey = baseWorkoutKey(ctx().selectedWorkoutKey);
    persist();
    render();
    toast(`${gymLabel()} mode`);
  });

  const content = document.getElementById('C');
  content.addEventListener('click', e => {
    const workoutBtn = e.target.closest('[data-wo]');
    if (workoutBtn) { ctx().selectedWorkoutKey = baseWorkoutKey(workoutBtn.dataset.wo); persist(); render(); return; }
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
    if (gymBtn) {
      ctx().gymMode = normalizeGymMode(gymBtn.dataset.gym);
      ctx().selectedWorkoutKey = baseWorkoutKey(ctx().selectedWorkoutKey);
      persist(); render(); toast(`${gymLabel()} mode`);
      return;
    }
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
    }
  });
  content.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'pS' || t.id === 'rS') {
      if (!PROGRAMS[t.value]) return;
      ctx().selectedProgramKey = t.value;
      ctx().selectedWorkoutKey = '';
      ensureSelection();
      persist(); render(); toast('Program changed');
      return;
    }
    if (t.dataset.sb !== undefined) { setSubstitution(Number(t.dataset.sb), t.value); return; }
    if (t.dataset.f) { refreshSecondaryUI(); return; }
    if (t.id === 'wDate') { changeSessionDate(t.value); return; }
    if (t.id === 'hF') { historyFilter = t.value; render(); return; }
    if (t.id === 'sI') { const f = t.files?.[0]; if (f) importData(f); t.value = ''; return; }
  });
  content.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f) { onSetFieldInput(t); return; }
    if (t.id === 'sN') { const s = currentSession(); s.notes = t.value; touchSession(s); persistSoon(); return; }
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
  if (scheduledFor.date !== todayISO()) return;
  if (restTimer.running || restTimer.pausedRemaining > 0) return;
  const timerBtn = input.closest('.ex')?.querySelector('[data-rt]');
  if (!timerBtn) return;
  clearTimeout(pendingAutoStart);
  pendingAutoStart = setTimeout(() => {
    const session = currentSession();
    if (session.key !== scheduledFor.key) return; // user switched workouts meanwhile
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
  flushPersist();
  const payload = { exportedAt: new Date().toISOString(), app: 'Workout v2', data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workout-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
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
function buildWeekICS(sunday, timeHHMM) {
  const items = weekScheduleForSunday(sunday);
  const stamp = `${icsDateTime(todayISO(), '00:00')}Z`;
  // Profile + program in the UID: without it, dad's and daughter's same-
  // weekday events collide on date+index alone, so importing the second
  // profile's .ics into a shared calendar replaces the first profile's
  // event instead of adding a separate one.
  const uidScope = `${activeProfile()}-${program().key}`;
  const events = items.map((it, i) => [
    'BEGIN:VEVENT',
    `UID:workout-${uidScope}-${it.date.replace(/-/g, '')}-${i}@workout-app`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsDateTime(it.date, timeHHMM)}`,
    `DTEND:${icsDateTimePlusMinutes(it.date, timeHHMM, 75)}`,
    `SUMMARY:${icsEscapeText(it.name)}`,
    it.focus ? `DESCRIPTION:${icsEscapeText(it.focus)}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Workout App//v2//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

function approveWeekReview() {
  const timeInput = document.getElementById('wrTime');
  const time = timeInput && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput.value) ? timeInput.value : ctx().workoutTimeOfDay;
  const sunday = mostRecentSunday();
  ctx().workoutTimeOfDay = time;
  ctx().weekReviewedFor = sunday;
  persist();
  downloadFile(`workout-week-${sunday}.ics`, buildWeekICS(sunday, time), 'text/calendar;charset=utf-8');
  render();
  toast('Week approved — calendar file downloaded');
}

function dismissWeekReview() {
  ctx().weekReviewedFor = mostRecentSunday();
  persist();
  render();
  toast('Dismissed for this week');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const src = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
      if (!src || typeof src !== 'object' || !(src.sessions || src.logs || src.drafts)) throw new Error('not a backup');
      const incoming = pruneEmptySessions(migrateAny(parsed));
      const count = Object.keys(incoming.sessions).length;
      const existing = Object.keys(state.sessions).length;
      if (!confirm(`Import backup${parsed.exportedAt ? ` from ${prettyDateTime(parsed.exportedAt)}` : ''} with ${count} workout${count === 1 ? '' : 's'}? This replaces ALL current data for both profiles (${existing} workout${existing === 1 ? '' : 's'}).`)) return;
      state = incoming;
      persist();
      render();
      toast(`Imported ${count} workout${count === 1 ? '' : 's'}`);
    } catch (e) {
      toast('Import failed — not a valid backup file');
    }
  };
  reader.readAsText(file);
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
