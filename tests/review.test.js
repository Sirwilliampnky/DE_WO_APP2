/* Regression checks for the code-review findings on the shared app core:
 * slot-safe session sync, multi-tab saves, validated imports, deferred
 * completion, Repeat/Suggest, the progression rule, substitution history,
 * startup recovery and numeric validation. (Service-worker handlers are
 * covered separately in tests/sw.test.js.)
 * Usage: NODE_PATH=$(npm root -g) node tests/review.test.js [baseURL]
 */
'use strict';
const fs = require('fs');
const { check, section, launch, settle, fresh, reload, fillAllSets, leaveField, done } = require('./lib');

const BASE = process.argv[2] || 'http://127.0.0.1:8931/';
const card = (page, name) => page.locator('#woGrid .wo-b', { hasText: name });
const hint = (page, i) => page.locator('#C .ex').nth(i).locator('.ex-hi').textContent();
const val = (page, f) => page.inputValue(`[data-f="${f}"]`);

async function dismissReview(page) {
  if (await page.locator('#wrDismiss').count()) { await page.click('#wrDismiss'); await settle(page); }
}
/* A 12-week session for dad, every set filled the same way. */
function seed(page, spec) {
  return page.evaluate(spec => {
    const s = newSession('dad', 'upperLower12', spec.workout, spec.date, spec.week || 1, spec.gym || 'ymca');
    s.exercises.forEach((x, i) => {
      if (spec.subs && spec.subs[i]) x.actualName = spec.subs[i];
      const v = (spec.byIndex && spec.byIndex[i]) || spec;
      x.sets.forEach(set => { set.weight = v.weight ?? '100'; set.reps = v.reps ?? '8'; set.rir = v.rir ?? ''; });
    });
    s.updatedAt = new Date(`${spec.date}T18:00:00`).toISOString();
    state.sessions[s.key] = s;
    persist();
    return s.key;
  }, spec);
}
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)));
async function importFile(page, name, obj) {
  await page.click('.tab[data-tab="settings"]');
  await settle(page);
  await page.setInputFiles('#sI', { name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  await page.waitForTimeout(150);
  await settle(page);
}

(async () => {
  const { browser, page, errors, dialogs } = await launch();

  section('1 · Substituting into one slot never overwrites another slot');
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await card(page, 'Lower A').click();
  await settle(page);
  await page.fill('[data-f="0-0-weight"]', '450');
  await page.fill('[data-f="0-0-reps"]', '8');
  await page.fill('[data-f="1-0-weight"]', '110');
  await page.fill('[data-f="1-0-reps"]', '10');
  await leaveField(page);
  await page.selectOption('[data-sb="0"]', 'Hack Squat');
  await settle(page);
  check('the second lift keeps 110 × 10 after Hack Squat goes into the first slot',
    (await val(page, '1-0-weight')) === '110' && (await val(page, '1-0-reps')) === '10', `${await val(page, '1-0-weight')} × ${await val(page, '1-0-reps')}`);
  check('the first lift keeps 450 × 8', (await val(page, '0-0-weight')) === '450' && (await val(page, '0-0-reps')) === '8');
  await page.fill('#sN', 'edited after the swap');
  await page.fill('[data-f="2-0-weight"]', '90');
  await leaveField(page);
  await reload(page);
  check('…and both survive editing, saving and a reload',
    (await val(page, '0-0-weight')) === '450' && (await val(page, '1-0-weight')) === '110' && (await val(page, '1-0-reps')) === '10'
    && (await page.inputValue('[data-sb="0"]')) === 'Hack Squat');
  await page.click('.tab[data-tab="history"]');
  await settle(page);
  await page.click('[data-hsub="exercises"]');
  await settle(page);
  const byEx = await page.textContent('#C');
  check('History lists Hack Squat 450 × 8 and the second lift 110 × 10 separately',
    byEx.includes('Hack Squat') && byEx.includes('450 × 8') && byEx.includes('110 × 10'));
  await page.click('[data-hsub="sessions"]');
  await page.click('.tab[data-tab="today"]');
  await settle(page);
  await page.evaluate(() => {
    const s = currentSession();
    s.exercises.push({ originalName: 'Retired Lift', actualName: 'Retired Lift', sets: [{ weight: '70', reps: '12', rir: '' }] });
    persist();
  });
  await reload(page);
  await page.click('.tab[data-tab="today"]');
  await settle(page);
  check('a logged exercise that no longer fits the workout is set aside, not dropped',
    await page.evaluate(() => (currentSession().extraExercises || []).some(x => x.actualName === 'Retired Lift' && x.sets[0].weight === '70')));
  await page.fill('#sN', 'another edit');
  await leaveField(page);
  await reload(page);
  await page.click('.tab[data-tab="history"]');
  await settle(page);
  check('…persists, and shows in History', (await page.textContent('#C')).includes('Also logged (no longer in this workout): Retired Lift · 70 × 12'));
  await page.click('.tab[data-tab="today"]');
  await settle(page);

  section('2 · Two open tabs never silently erase each other');
  const tabs = await browser.newContext();
  const tabA = await tabs.newPage();
  const pageB = await tabs.newPage();
  for (const [t, label] of [[tabA, 'tab A'], [pageB, 'tab B']]) {
    t.on('pageerror', e => errors.push(`${label}: ${e}`));
    t.on('dialog', d => d.accept());
  }
  await fresh(tabA, BASE, 'dad');
  await dismissReview(tabA);
  await tabA.fill('[data-f="0-0-weight"]', '100');
  await tabA.fill('[data-f="0-0-reps"]', '5');
  await tabA.evaluate(() => flushPersist());
  await pageB.goto(BASE);
  await settle(pageB);
  await pageB.click('#pBtn');
  await pageB.click('[data-pf="daughter"]');
  await settle(pageB);
  await pageB.fill('[data-f="0-0-weight"]', '50');
  await pageB.fill('[data-f="0-0-reps"]', '10');
  await pageB.evaluate(() => flushPersist());
  await tabA.waitForTimeout(100);
  await settle(tabA);
  check('tab A (dad) picks up tab B’s save and stays on its own profile',
    await tabA.evaluate(() => state.profile === 'dad' && Object.values(state.sessions).some(s => s.profile === 'daughter' && s.exercises[0].sets[0].weight === '50')));
  await tabA.fill('[data-f="0-1-weight"]', '100');
  await tabA.fill('[data-f="0-1-reps"]', '5');
  await tabA.evaluate(() => flushPersist());
  let disk = await stored(tabA);
  const dadSets = s => Object.values(s.sessions).filter(x => x.profile === 'dad').flatMap(x => x.exercises[0].sets).filter(x => x.weight === '100').length;
  const kidSet = s => Object.values(s.sessions).some(x => x.profile === 'daughter' && x.exercises[0].sets[0].weight === '50');
  check('interleaved saves keep both dad’s and daughter’s work', dadSets(disk) === 2 && kidSet(disk));
  check('no tab was blocked while saves didn’t conflict',
    await tabA.locator('#sysBlock').isHidden() && await pageB.locator('#sysBlock').isHidden());
  // A has an unsaved edit pending when B saves: A must stop, not overwrite.
  await tabA.fill('[data-f="0-2-weight"]', '999');
  await pageB.fill('[data-f="0-1-weight"]', '55');
  await pageB.evaluate(() => flushPersist());
  await tabA.waitForTimeout(600);
  await tabA.evaluate(() => flushPersist());
  await settle(tabA);
  disk = await stored(tabA);
  check('a stale tab is blocked with an explanation', await tabA.locator('#sysBlock').isVisible()
    && (await tabA.textContent('#sysBlock')).includes('Updated in another tab'));
  check('…and never overwrites the other tab’s save',
    Object.values(disk.sessions).some(x => x.profile === 'daughter' && x.exercises[0].sets[1].weight === '55')
    && !JSON.stringify(disk).includes('"999"') && dadSets(disk) === 2);
  await Promise.all([tabA.waitForEvent('load'), tabA.click('#sysReload')]);
  await settle(tabA);
  check('reloading shows the latest data and saves normally again',
    await tabA.locator('#sysBlock').isHidden() && await tabA.evaluate(() => persist()));
  await tabs.close();

  section('3 · Imports are validated and only replace data once saved');
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await seed(page, { workout: 'upperA', date: '2026-10-05' });
  await seed(page, { workout: 'lowerA', date: '2026-10-06' });
  const logged = () => page.evaluate(() => Object.values(state.sessions).filter(sessionHasContent).length);
  const before = await logged();
  const backup = await page.evaluate(() => JSON.parse(JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Workout v2', data: state })));
  backup.data.profiles.dad.metricsByDate = { '2026-10-01': null, '2026-10-02': { bodyweight: '200' }, 'nonsense': { bodyweight: '1' } };
  backup.data.profiles.dad.activeDate = '2026-10-20';
  delete backup.data.sessions[Object.keys(backup.data.sessions).find(k => k.includes('lowerA'))];
  await importFile(page, 'null-readiness.json', backup);
  check('a backup with a null readiness entry imports without crashing',
    errors.length === 0 && await logged() === before - 1, errors.join(' | '));
  check('…with the null and malformed readiness entries dropped',
    await page.evaluate(() => JSON.stringify(state.profiles.dad.metricsByDate) === JSON.stringify({ '2026-10-02': { sleep: '', energy: '', soreness: '', bodyweight: '200' } })));
  await page.click('.tab[data-tab="today"]');
  await settle(page);
  await page.fill('#mB', '205');
  await leaveField(page);
  check('…and Today (bodyweight lookups included) still works', errors.length === 0 && (await page.locator('#C .ex').count()) > 0);
  const diskBefore = await page.evaluate(() => localStorage.getItem(STORAGE_KEY));
  const countBefore = await logged();
  await page.evaluate(() => {
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  dialogs.length = 0;
  await importFile(page, 'full-backup.json', { ...backup, data: { ...backup.data, sessions: {} } });
  check('an import that can’t be saved reports failure', dialogs.some(d => d.includes('Import failed') && d.includes('Nothing was changed')), dialogs.join(' | '));
  check('…and keeps the current data in the app and on disk',
    await logged() === countBefore
    && await page.evaluate(() => localStorage.getItem(STORAGE_KEY)) === diskBefore);
  check('…without a success toast', !(await page.textContent('#toast')).includes('Imported'));
  await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
  await importFile(page, 'not-a-backup.json', { foo: 1 });
  check('a JSON file that isn’t a backup is rejected without touching data',
    (await page.textContent('#toast')).includes('not a valid backup') && await logged() === countBefore);
  await importFile(page, 'null.json', 'null');
  check('…as is a bare null', await logged() === countBefore);

  section('4 · Finishing a workout waits for the last field to be committed');
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await page.evaluate(() => { state.timerPrefs.autoStart = false; persist(); });
  for (const w of ['upperA', 'lowerA', 'upperB']) await seed(page, { workout: w, date: '2026-06-01' });
  await reload(page);
  await card(page, 'Lower B').click();
  await settle(page);
  const repsFields = await page.locator('[data-f$="-reps"]').count();
  for (let i = 0; i < repsFields; i++) {
    await page.locator('[data-f$="-weight"]').nth(i).fill('100');
    if (i < repsFields - 1) await page.locator('[data-f$="-reps"]').nth(i).fill('8');
  }
  const lastReps = page.locator('[data-f$="-reps"]').nth(repsFields - 1);
  const lastF = await lastReps.getAttribute('data-f');
  await lastReps.click();
  const handle = await lastReps.elementHandle();
  await page.keyboard.type('1');
  await page.waitForTimeout(80);
  await settle(page);
  check('typing the first digit of the final rep count doesn’t redraw or move the week',
    await handle.evaluate(el => el.isConnected && document.activeElement === el) && (await page.textContent('#wV')) === 'W1');
  check('…while the progress indicators already show it done', (await card(page, 'Lower B').locator('.tag-dn').count()) === 1);
  await page.keyboard.type('2');
  await settle(page);
  check('the full value 12 is entered and focus stays in the field',
    await handle.evaluate(el => el.value === '12' && el.isConnected && document.activeElement === el));
  await page.locator('#C .ex').nth(0).locator('[data-rt]').click();
  await page.waitForTimeout(50);
  await settle(page);
  check('a button tapped right after the last digit still works (rest timer starts)', await page.locator('#tmr').evaluate(el => el.classList.contains('show')));
  check('once the field is left, the week advances exactly once',
    (await page.textContent('#wV')) === 'W2' && await page.evaluate(() => ctx().currentWeek === 2 && ctx().autoAdvancedThroughWeek === 1));
  check('…with the completion banner', (await page.locator('#completionBanner').count()) === 1);
  check('the logged 12 is saved on the week-1 session', await page.evaluate(f => {
    const [ei, si] = f.split('-').map(Number);
    const s = Object.values(state.sessions).find(x => x.workoutKey === 'lowerB' && x.week === 1);
    return s && s.exercises[ei].sets[si].reps === '12';
  }, lastF));
  await page.evaluate(() => clearRestTimer());

  section('5 · Repeat and Suggest only fill blank weights');
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await seed(page, { workout: 'upperA', date: '2026-10-01', weight: '100', reps: '7', rir: '2' });
  await reload(page);
  await card(page, 'Upper A').click();
  await settle(page);
  await page.fill('[data-f="0-0-weight"]', '80');
  await page.fill('[data-f="0-0-reps"]', '5');
  await page.fill('[data-f="0-0-rir"]', '3');
  await leaveField(page);
  await page.click('[data-rp="0"]');
  await settle(page);
  check('Repeat keeps the logged 80 × 5', (await val(page, '0-0-weight')) === '80' && (await val(page, '0-0-reps')) === '5');
  check('…and fills the blank sets with last time’s 100', (await val(page, '0-1-weight')) === '100' && (await val(page, '0-3-weight')) === '100');
  dialogs.length = 0;
  page.dialogPolicy = 'dismiss';
  await page.click('[data-sg="0"]');
  await settle(page);
  check('with every weight filled, Suggest asks before replacing anything', dialogs.some(d => d.includes('Replace the planned weight on 3 sets')));
  check('…and declining changes nothing', (await val(page, '0-1-weight')) === '100' && (await val(page, '0-0-weight')) === '80');
  page.dialogPolicy = 'accept';
  await page.click('[data-sg="0"]');
  await settle(page);
  check('accepting replaces only the sets with no reps logged', (await val(page, '0-0-weight')) === '80' && (await val(page, '0-1-weight')) === '105');
  for (let si = 1; si < 4; si++) await page.fill(`[data-f="0-${si}-reps"]`, '5');
  await leaveField(page);
  await page.click('[data-rp="0"]');
  await settle(page);
  check('once every set is logged, Repeat changes nothing', (await val(page, '0-0-weight')) === '80' && (await val(page, '0-1-weight')) === '105'
    && (await page.textContent('#toast')).includes('Logged sets keep their weights'));
  check('the logged 80 is what’s saved', await page.evaluate(() => currentSession().exercises[0].sets[0].weight === '80'));

  section('6 · Progression needs every planned set at the top, at the target effort');
  const pc = await page.evaluate(() => {
    const rir = { repsMax: 8, rirTarget: 2 }, rpe = { repsMax: 8, intensityType: 'rpe', intensityMax: 9 };
    const sets = (n, reps, effort) => Array.from({ length: n }, () => ({ weight: '100', reps: String(reps), rir: String(effort) }));
    return {
      failure: progressionCheck(sets(4, 8, 0), rir, 4),
      easy: progressionCheck(sets(4, 8, 4), rir, 4),
      atTarget: progressionCheck(sets(4, 8, 2), rir, 4),
      oneSet: progressionCheck(sets(1, 8, 2), rir, 4),
      partial: progressionCheck([...sets(3, 8, 2), { weight: '100', reps: '', rir: '' }], rir, 4),
      blank: progressionCheck([...sets(3, 8, 2), { weight: '100', reps: '8', rir: '' }], rir, 4),
      shortReps: progressionCheck([...sets(3, 8, 2), { weight: '100', reps: '7', rir: '2' }], rir, 4),
      rpeOk: progressionCheck(sets(4, 8, 8), rpe, 4),
      rpeHard: progressionCheck([...sets(3, 8, 8), { weight: '100', reps: '8', rir: '9.5' }], rpe, 4),
      rpeBlank: progressionCheck([...sets(3, 8, 8), { weight: '100', reps: '8', rir: '' }], rpe, 4),
    };
  });
  check('top reps at 0 RIR (failure) is not progress', pc.failure === 'no');
  check('top reps with more in reserve than the target qualifies', pc.easy === 'yes' && pc.atTarget === 'yes');
  check('one qualifying set of four doesn’t qualify', pc.oneSet === 'no' && pc.partial === 'no');
  check('blank RIR is unknown — never an increase', pc.blank === 'unknown');
  check('one set short of the top rep doesn’t qualify', pc.shortReps === 'no');
  check('RPE keeps its own direction (≤ max qualifies, above max doesn’t, blank unknown)', pc.rpeOk === 'yes' && pc.rpeHard === 'no' && pc.rpeBlank === 'unknown');
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await seed(page, { workout: 'upperA', date: '2026-10-01', weight: '100', reps: '7', rir: '0' });
  await reload(page);
  await card(page, 'Upper A').click();
  await settle(page);
  check('a session at 0 RIR suggests repeating the load', (await hint(page, 0)).includes('Repeat load, beat reps'));
  await seed(page, { workout: 'upperA', date: '2026-10-08', weight: '100', reps: '7', rir: '' });
  await reload(page);
  check('top reps with RIR not logged asks for it instead of adding load', (await hint(page, 0)).includes('log RIR on every set'));
  await seed(page, { workout: 'upperA', date: '2026-10-15', weight: '100', reps: '7', rir: '3' });
  await reload(page);
  check('every set at the top with RIR ≥ 2 adds load', (await hint(page, 0)).includes('Met target') && (await hint(page, 0)).includes('105'));

  section('7 · A substitute uses its own history, at its own gym');
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await seed(page, { workout: 'lowerBOffice', gym: 'office', date: '2026-10-01', byIndex: { 2: { weight: '200', reps: '12', rir: '2' } } });
  await page.evaluate(() => { ctx().gymMode = 'office'; ctx().selectedWorkoutKey = 'lowerB'; persist(); });
  await reload(page);
  check('the barbell hip thrust shows its 200-lb history', (await hint(page, 2)).includes('200'));
  await page.selectOption('[data-sb="2"]', 'DB Glute Bridge');
  await settle(page);
  let h2 = await hint(page, 2);
  check('switching to DB Glute Bridge drops the barbell numbers', !h2.includes('200') && !h2.includes('210') && h2.includes('No prior'), h2);
  await page.click('[data-rp="2"]');
  await settle(page);
  check('…and Repeat finds nothing to copy', (await val(page, '2-0-weight')) === '' && (await page.textContent('#toast')).includes('No previous data'));
  await seed(page, { workout: 'lowerBOffice', gym: 'office', date: '2026-10-08', subs: { 2: 'DB Glute Bridge' }, byIndex: { 2: { weight: '40', reps: '10', rir: '2' } } });
  await reload(page);
  h2 = await hint(page, 2);
  check('with its own history, DB Glute Bridge shows 40 lb', h2.includes('40') && !h2.includes('200'), h2);
  await page.selectOption('[data-sb="2"]', 'Barbell Hip Thrust / Glute Bridge');
  await settle(page);
  h2 = await hint(page, 2);
  check('switching back shows the barbell 200 again, not the DB loads', h2.includes('200') && h2.includes('210') && !h2.includes('× 10'), h2);
  await seed(page, { workout: 'upperA', gym: 'ymca', date: '2026-10-02', weight: '150' });
  await page.evaluate(() => { ctx().gymMode = 'office'; ctx().selectedWorkoutKey = 'upperA'; persist(); });
  await reload(page);
  check('a YMCA bench session isn’t offered as office history', (await hint(page, 0)).includes('No prior session'));
  await page.evaluate(() => { ctx().gymMode = 'ymca'; persist(); });
  await reload(page);
  check('…but is at the YMCA', (await hint(page, 0)).includes('150'));

  section('8 · Unreadable saved data is kept, never silently replaced');
  const ctx2 = await browser.newContext({ acceptDownloads: true });
  const rec = await ctx2.newPage();
  rec.on('pageerror', e => errors.push(`recovery: ${e}`));
  rec.on('dialog', d => d.accept());
  const DAMAGED = '{"version":10,"profile":"dad","sessions":{"dad__2026';
  await rec.goto(BASE);
  await rec.evaluate(d => {
    localStorage.clear();
    localStorage.setItem('workout_v10_state', d);
    localStorage.setItem('workout_v9_state', JSON.stringify({ profile: 'dad', currentWeek: 3, logs: [], drafts: {} }));
  }, DAMAGED);
  await rec.reload();
  await settle(rec);
  check('a recovery banner explains what happened', await rec.locator('#sysBanner').isVisible()
    && (await rec.textContent('#sysBanner')).includes('couldn’t be read') && (await rec.textContent('#sysBanner')).includes('workout_v9_state'));
  check('the older legacy data is shown (week 3)', (await rec.textContent('#wV')) === 'W3');
  if (await rec.locator('[data-pf="dad"]').isVisible()) { await rec.click('[data-pf="dad"]'); await settle(rec); }
  await rec.fill('[data-f="0-0-weight"]', '100');
  await rec.fill('[data-f="0-0-reps"]', '5');
  await rec.evaluate(() => flushPersist());
  const recKeys = await rec.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  check('the damaged value is still in place after loading and editing', recKeys.workout_v10_state === DAMAGED);
  const quarantined = Object.keys(recKeys).find(k => k.startsWith('workout_v10_damaged_'));
  check('…and a copy was set aside', !!quarantined && recKeys[quarantined] === DAMAGED);
  const [dl] = await Promise.all([rec.waitForEvent('download'), rec.click('#rcDownload')]);
  check('the damaged copy can be downloaded as-is', fs.readFileSync(await dl.path(), 'utf8') === DAMAGED);
  await rec.reload();
  await settle(rec);
  check('reloading doesn’t make another copy', (await rec.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('workout_v10_damaged_')).length)) === 1);
  await rec.click('#rcKeep');
  await settle(rec);
  const after = await rec.evaluate(() => ({ cur: JSON.parse(localStorage.getItem('workout_v10_state')), q: Object.keys(localStorage).filter(k => k.startsWith('workout_v10_damaged_')) }));
  check('choosing to continue saves the shown data and clears the banner',
    after.cur.version === 10 && after.cur.profiles.dad.currentWeek === 3 && await rec.locator('#sysBanner').isHidden());
  check('…while the set-aside copy stays', after.q.length === 1);
  await rec.evaluate(() => { localStorage.clear(); localStorage.setItem('workout_v10_state', '[]'); });
  await rec.reload();
  await settle(rec);
  check('valid JSON that isn’t workout data is treated as damaged too',
    await rec.locator('#sysBanner').isVisible() && (await rec.textContent('#sysBanner')).includes('an empty app')
    && await rec.evaluate(() => localStorage.getItem('workout_v10_state')) === '[]');
  await ctx2.close();

  section('9 · Only real numbers complete a set');
  const sc = await page.evaluate(() => ({
    zero: setComplete({ weight: '0', reps: '8' }),
    neg: setComplete({ weight: '-50', reps: '8' }),
    bad: setComplete({ weight: 'bad', reps: '8' }),
    half: setComplete({ weight: '10', reps: '0.5' }),
    inf: setComplete({ weight: 'Infinity', reps: '8' }) || setComplete({ weight: '10', reps: 'Infinity' }),
    blank: setComplete({ weight: '', reps: '8' }) || setComplete({ weight: '10', reps: '' }),
    ok: setComplete({ weight: '102.5', reps: '6' }),
    volume: exerciseVolume({ sets: [{ weight: '-50', reps: '8' }, { weight: '100', reps: '5' }, { weight: 'bad', reps: '8' }] }),
  }));
  check('0 lb counts; normal entries count', sc.zero && sc.ok);
  check('negative, non-numeric, fractional-rep, infinite and blank entries don’t', !sc.neg && !sc.bad && !sc.half && !sc.inf && !sc.blank);
  check('invalid entries add no volume', sc.volume === 500);
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  await page.fill('[data-f="0-0-weight"]', '-50');
  await page.fill('[data-f="0-0-reps"]', '8');
  await leaveField(page);
  check('an invalid set is outlined, not marked done', await page.locator('[data-f="0-0-weight"]').evaluate(el => el.closest('.sr').classList.contains('inv') && !el.closest('.sr').classList.contains('dn')));
  check('…and explained', (await page.textContent('#warnBox')).includes('can’t count'));
  await fresh(page, BASE, 'dad');
  await dismissReview(page);
  for (const w of ['upperA', 'lowerA', 'upperB', 'lowerB']) await seed(page, { workout: w, date: '2026-06-01', weight: w === 'lowerB' ? 'bad' : '100' });
  await reload(page);
  check('an imported non-numeric weight never completes the workout or the week',
    await page.evaluate(() => sessionStatus(Object.values(state.sessions).find(s => s.workoutKey === 'lowerB')) !== 'done' && !weekFullyDone(1, program()) && !maybeAutoAdvanceWeek()));
  await page.evaluate(() => { ctx().activeDate = '2026-06-01'; ctx().selectedWorkoutKey = 'lowerB'; persist(); });
  await reload(page);
  check('…and the row is flagged when shown', (await page.locator('#C .sr.inv').count()) > 0);

  await done(browser, errors);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
