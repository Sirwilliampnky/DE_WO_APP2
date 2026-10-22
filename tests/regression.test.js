/* Regression checks for the week-based programs (12-week Upper / Lower and
 * Glute Split): two-state status, persistence, history, gym toggle, profile
 * isolation, legacy migration, blocks, auto-advance and the Sunday review.
 * Usage: NODE_PATH=$(npm root -g) node tests/regression.test.js [baseURL]
 */
'use strict';
const fs = require('fs');
const { check, section, launch, settle, fresh, reload, fillAllSets, done } = require('./lib');

const BASE = process.argv[2] || 'http://127.0.0.1:8931/';
const card = (page, name) => page.locator('#woGrid .wo-b', { hasText: name });

/* Seed a complete 12-week session for dad. */
function seedWeek(page, workout, week, date, weight = '100') {
  return page.evaluate(({ workout, week, date, weight }) => {
    const s = newSession('dad', 'upperLower12', workout, date, week, 'ymca');
    s.exercises.forEach(x => x.sets.forEach(set => { set.weight = weight; set.reps = '8'; }));
    s.updatedAt = new Date(`${date}T18:00:00`).toISOString();
    state.sessions[s.key] = s;
    persist();
    return s.key;
  }, { workout, week, date, weight });
}
async function readICS(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return fs.readFileSync(await dl.path(), 'utf8');
}
const vevent = (ics, summary) => ics.split('BEGIN:VEVENT').find(e => e.includes(`SUMMARY:${summary}`)) || '';

(async () => {
  const { browser, page, errors } = await launch();

  section('Fresh start');
  await fresh(page, BASE);
  check('profile gate shows on a fresh load', await page.locator('#gate:not(.hidden)').count() === 1);
  await page.click('[data-pf="dad"]');
  await settle(page);
  check('picking dad opens the 12-week program on Upper A', (await page.textContent('#hT')).includes('Upper A') && (await page.inputValue('#pS')) === 'upperLower12');
  if (await page.locator('#wrDismiss').count()) { await page.click('#wrDismiss'); await settle(page); }

  section('Two-state progress (derived)');
  check('an untouched card has no status label', await card(page, 'Upper A').locator('.tag').count() === 0);
  await page.fill('[data-f="0-0-weight"]', '100');
  await page.fill('[data-f="0-0-reps"]', '5');
  await settle(page);
  check('one set → In progress, not Done', await card(page, 'Upper A').locator('.tag-ip').count() === 1 && await card(page, 'Upper A').locator('.tag-dn').count() === 0);
  for (let si = 1; si < 4; si++) { await page.fill(`[data-f="0-${si}-weight"]`, '100'); await page.fill(`[data-f="0-${si}-reps"]`, '5'); }
  await settle(page);
  check('one full exercise → 1/6 and still In progress', (await card(page, 'Upper A').textContent()).includes('1/6') && await card(page, 'Upper A').locator('.tag-ip').count() === 1);
  await page.selectOption('[data-sb="1"]', 'T-Bar Row');
  await settle(page);
  check('a substitution holds and retitles the exercise', (await page.inputValue('[data-sb="1"]')) === 'T-Bar Row' && (await page.textContent('#C')).includes('T-Bar Row'));
  const exercises = await page.locator('#C .ex').count();
  for (let ei = 0; ei < exercises; ei++) {
    const rows = await page.locator('#C .ex').nth(ei).locator('.sr').count();
    for (let si = 0; si < rows; si++) {
      await page.fill(`[data-f="${ei}-${si}-weight"]`, ei === 3 ? '0' : '100');
      await page.fill(`[data-f="${ei}-${si}-reps"]`, '8');
    }
  }
  await settle(page);
  check('every exercise complete → Done (6/6)', await card(page, 'Upper A').locator('.tag-dn').count() === 1 && (await card(page, 'Upper A').textContent()).includes('6/6'));
  check('a 0-lb (bodyweight) set counts as complete', await page.locator('[data-f="3-0-weight"]').evaluate(el => el.closest('.sr').classList.contains('dn')));
  await reload(page);
  check('Done and the substitution survive a reload', await card(page, 'Upper A').locator('.tag-dn').count() === 1 && (await page.inputValue('[data-sb="1"]')) === 'T-Bar Row');
  check('other cards are untouched', await page.locator('#woGrid .tag-dn').count() === 1);

  section('Next resumes in-progress work');
  await card(page, 'Lower A').click();
  await settle(page);
  await page.fill('[data-f="0-0-weight"]', '200');
  await page.fill('[data-f="0-0-reps"]', '8');
  await card(page, 'Upper B').click();
  await settle(page);
  await page.click('#aBtn');
  await settle(page);
  check('Next jumps back to the in-progress Lower A', (await page.textContent('#hT')).includes('Lower A') && (await page.inputValue('[data-f="0-0-weight"]')) === '200');

  section('History');
  await page.click('.tab[data-tab="history"]');
  await settle(page);
  const historyText = await page.textContent('#C');
  check('History groups Done and In progress', historyText.includes('Done') && historyText.includes('In progress') && historyText.includes('Upper A'));
  check('By Exercise is a separate sub-tab', await page.locator('#hF').count() === 0);
  await page.click('[data-hsub="exercises"]');
  await settle(page);
  check('By Exercise shows the filter without session cards', await page.locator('#hF').count() === 1 && await page.locator('[data-del]').count() === 0);
  await page.click('[data-hsub="sessions"]');
  await settle(page);
  await page.locator('.hi', { hasText: 'Lower A' }).locator('[data-del]').first().click();
  await settle(page);
  check('Delete removes the session', !(await page.textContent('#C')).includes('Lower A'));
  await page.locator('.hi', { hasText: 'Upper A' }).locator('[data-open]').first().click();
  await settle(page);
  check('Open lands on Today with the session', (await page.textContent('#hT')).includes('Upper A') && (await page.inputValue('[data-f="0-0-weight"]')) === '100');

  section('Gym toggle and profile isolation');
  await page.click('#gBtn');
  await settle(page);
  check('office mode swaps the lower days', (await page.textContent('#woGrid')).includes('Lower A — Office'));
  await page.click('#gBtn');
  await page.click('#pBtn');
  check('switching profile shows the gate', await page.locator('#gate:not(.hidden)').count() === 1);
  await page.click('[data-pf="daughter"]');
  await settle(page);
  check('daughter gets her own program with no gym toggle', (await page.inputValue('#pS')) === 'glutePullPush' && await page.locator('#gBtn.hidden').count() === 1);
  check('no cross-profile Done cards', await page.locator('#woGrid .tag-dn').count() === 0);
  await page.selectOption('[data-sb="0"]', 'Barbell Glute Bridge');
  await reload(page);
  check('a substitution-only session survives a reload', (await page.inputValue('[data-sb="0"]')) === 'Barbell Glute Bridge');

  section('Legacy v9 → v10 migration');
  await page.evaluate(() => {
    flushPersist();
    localStorage.clear();
    const ua = PROGRAMS.upperLower12.workouts.upperA.exercises.map(x => ({ originalName: x.name, actualName: x.name, sets: Array.from({ length: x.sets }, () => ({ weight: '100', reps: '8', rir: '2' })) }));
    // v1 drafts were full workout snapshots — one set logged, the rest blank.
    const la = PROGRAMS.upperLower12.workouts.lowerA.exercises.map((x, i) => ({ originalName: x.name, actualName: i === 0 ? '45° Leg Press' : x.name, sets: Array.from({ length: x.sets }, (_, si) => (i === 0 && si === 0 ? { weight: '200', reps: '8', rir: '2' } : { weight: '', reps: '', rir: '' })) }));
    localStorage.setItem('workout_v9_state', JSON.stringify({
      profile: 'dad', currentWeek: 3, selectedProgramKey: 'upperLower12', gymMode: 'ymca',
      metricsByDate: { '2026-03-02': { sleep: '7', energy: '4', soreness: '2', bodyweight: '200' } },
      logs: [{ date: '2026-03-02', week: 3, programKey: 'upperLower12', workoutKey: 'upperA', savedAt: '2026-03-02T18:00:00Z', exercises: ua }],
      drafts: {
        a: { date: '2026-03-04', week: 3, programKey: 'upperLower12', workoutKey: 'lowerA', exercises: la },
        b: { date: '2026-03-05', week: 3, programKey: 'upperLower12', workoutKey: 'upperB', exercises: [] },
      },
    }));
  });
  await page.reload();
  await settle(page);
  const migrated = await page.evaluate(() => ({
    gate: !document.getElementById('gate').classList.contains('hidden'),
    v10: !!localStorage.getItem('workout_v10_state'), v9: !!localStorage.getItem('workout_v9_state'),
    sessions: Object.values(state.sessions).filter(sessionHasContent).length,
    metrics: !!state.profiles.dad.metricsByDate['2026-03-02'] && !!state.profiles.daughter.metricsByDate['2026-03-02'],
    sub: Object.values(state.sessions).some(s => s.workoutKey === 'lowerA' && s.exercises.some(x => x.actualName === '45° Leg Press')),
  }));
  check('profile and week migrate', !migrated.gate && (await page.textContent('#wV')) === 'W3');
  check('v10 state is written and the v9 key is left untouched', migrated.v10 && migrated.v9);
  check('the log and the partial draft migrate to both profiles; the empty draft is dropped', migrated.sessions === 4, migrated.sessions);
  check('metrics migrate to both profiles; substitutions are preserved', migrated.metrics && migrated.sub);
  check('the migrated log is Done and the draft In progress', await card(page, 'Upper A').locator('.tag-dn').count() === 1 && await card(page, 'Lower A').locator('.tag-ip').count() === 1);

  section('Date moves and training blocks');
  await fresh(page, BASE, 'dad');
  await card(page, 'Upper B').click();
  await settle(page);
  await page.fill('[data-f="0-0-weight"]', '95');
  await page.fill('[data-f="0-0-reps"]', '6');
  await page.fill('#wDate', '2026-05-05');
  await page.dispatchEvent('#wDate', 'change');
  await settle(page);
  check('entries survive a date move', (await page.inputValue('#wDate')) === '2026-05-05' && (await page.inputValue('[data-f="0-0-weight"]')) === '95');
  await seedWeek(page, 'upperA', 1, '2026-01-05');
  await page.evaluate(() => { ctx().currentWeek = 1; ctx().activeDate = ''; persist(); });
  await reload(page);
  check('before a block boundary, an old Week 1 session counts', await card(page, 'Upper A').locator('.tag-dn').count() === 1);
  await page.click('.tab[data-tab="settings"]');
  await settle(page);
  await page.click('#sBlk');
  await settle(page);
  await page.click('.tab[data-tab="today"]');
  await settle(page);
  check('a new block resets to Week 1 and ignores the earlier cycle', (await page.textContent('#wV')) === 'W1' && await card(page, 'Upper A').locator('.tag-dn').count() === 0);

  section('Load-jump warning');
  await seedWeek(page, 'upperA', 1, '2026-06-20');
  await reload(page);
  await card(page, 'Upper A').click();
  await settle(page);
  await page.fill('[data-f="0-0-weight"]', '105');
  await page.fill('[data-f="0-0-reps"]', '6');
  await page.dispatchEvent('[data-f="0-0-reps"]', 'change');
  await settle(page);
  check('a normal 5% jump is not flagged', !(await page.textContent('#warnBox')).includes('higher than your last'));
  await page.fill('[data-f="0-0-weight"]', '250');
  await page.dispatchEvent('[data-f="0-0-weight"]', 'change');
  await settle(page);
  check('a >45% jump is flagged', (await page.textContent('#warnBox')).includes('higher than your last working weight (100 lb)'));

  section('Auto-advance and the completion banner');
  await fresh(page, BASE, 'dad');
  for (const w of ['upperA', 'lowerA', 'upperB']) await seedWeek(page, w, 1, '2026-06-01');
  await reload(page);
  await card(page, 'Lower B').click();
  await settle(page);
  await fillAllSets(page, '100', '8');
  check('finishing the week auto-advances to W2', (await page.textContent('#wV')) === 'W2');
  check('the banner names the next workout', /Workout complete!.*(Upper A|Lower A|Upper B|Lower B)/.test(await page.textContent('#completionBanner')));
  await fresh(page, BASE, 'dad');
  for (const w of ['upperA', 'lowerA', 'upperB']) await seedWeek(page, w, 12, '2026-06-01');
  await page.evaluate(() => { ctx().currentWeek = 12; persist(); });
  await reload(page);
  await card(page, 'Lower B').click();
  await settle(page);
  await fillAllSets(page, '100', '8');
  check('week 12 shows Block complete instead of wrapping', (await page.textContent('#wV')) === 'W12' && (await page.textContent('#completionBanner')).includes('Block complete!'));

  section('Sunday review and calendar export');
  await fresh(page, BASE, 'dad');
  check('the weekly review card appears', await page.locator('#weekReviewCard').count() === 1 && await page.locator('[data-wr-day]').count() === 4);
  await page.click('#wrDismiss');
  await reload(page);
  check('dismissing holds for the calendar week', await page.locator('#weekReviewCard').count() === 0);
  await page.evaluate(() => { ctx().weekReviewedFor = ''; persist(); });
  await reload(page);
  const offsets = await page.evaluate(() => { const t = new Date().getDay(); return { ua: (t + 1) % 7, la: (t + 2) % 7 }; });
  await page.selectOption('[data-wr-day="upperA"]', String(offsets.ua));
  await page.fill('[data-wr-time="upperA"]', '09:00');
  await page.selectOption('[data-wr-day="lowerA"]', String(offsets.la));
  await page.fill('[data-wr-time="lowerA"]', '14:00');
  const ics1 = await readICS(page, () => page.click('#wrApprove'));
  check('the .ics has one event per workout with per-workout times', (ics1.match(/BEGIN:VEVENT/g) || []).length === 4
    && /DTSTART:\d{8}T090000/.test(vevent(ics1, 'Upper A')) && /DTSTART:\d{8}T140000/.test(vevent(ics1, 'Lower A')));
  const uid1 = vevent(ics1, 'Upper A').match(/UID:(\S+)/)[1];
  await page.evaluate(() => { ctx().weekReviewedFor = ''; persist(); });
  await reload(page);
  await page.selectOption('[data-wr-day="upperA"]', String((offsets.ua + 2) % 7));
  const ics2 = await readICS(page, () => page.click('#wrApprove'));
  const uid2 = vevent(ics2, 'Upper A').match(/UID:(\S+)/)[1];
  check('moving a workout keeps its calendar UID', uid1 === uid2 && vevent(ics1, 'Upper A').match(/DTSTART:(\d{8})/)[1] !== vevent(ics2, 'Upper A').match(/DTSTART:(\d{8})/)[1]);
  await page.click('#pBtn');
  await page.click('[data-pf="daughter"]');
  await settle(page);
  const ics3 = await readICS(page, () => page.click('#wrApprove'));
  check('different profiles never share UIDs', !ics3.includes(uid1));

  await done(browser, errors);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(2); });
