/* Six-cycle Upper / Lower program — end-to-end checks in headless Chromium.
 * Usage: NODE_PATH=$(npm root -g) node tests/cycle.test.js [baseURL]
 * Serve the repo root first, e.g. `python3 -m http.server 8931`.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, section, launch, settle, fresh, reload, fillAllSets, done } = require('./lib');

const BASE = process.argv[2] || 'http://127.0.0.1:8931/';
const P = 'upperLower6_20261021';
const CLEAN = { shoulderDuring: 'none', catchingOccurred: 'no', repositionNeeded: 'no', backDuring: 'none', shoulderLaterSameDay: 'none', shoulderNextDay: 'none', backNextDay: 'none' };

/* Seed one session of the active six-cycle block. sets: {exerciseName:
 * [[weight, reps, rir], …]}; fill: default row for everything else (or
 * false for blank sets). */
function seed(page, spec) {
  return page.evaluate(spec => {
    const p = PROGRAMS.upperLower6_20261021;
    const block = activeBlock(p);
    const gym = spec.gym || 'ymca';
    const wk = effectiveWorkoutKey(p.key, spec.workout, gym);
    const date = addDaysISO(todayISO(), -(spec.daysAgo || 0));
    const s = newSession('dad', p.key, wk, date, spec.cycle, gym, block.id);
    s.exercises.forEach(x => {
      const rows = (spec.sets || {})[x.actualName] || (spec.fill === false ? null : [spec.fill || ['100', '10', '2']]);
      if (!rows) return;
      x.sets.forEach((set, i) => {
        const r = rows[Math.min(i, rows.length - 1)];
        set.weight = String(r[0]); set.reps = String(r[1]); set.rir = r[2] === undefined ? '' : String(r[2]);
      });
    });
    const at = new Date(`${date}T18:00:00`).toISOString();
    s.updatedAt = at;
    if (spec.complete !== false) s.completedAt = at;
    if (spec.checkin) Object.assign(s.checkin, spec.checkin);
    state.sessions[s.key] = s;
    syncBlockCompletion(p);
    persist();
    return s.key;
  }, spec);
}
const exCard = (page, name) => page.locator('#C .ex').filter({ has: page.locator('.ex-nm', { hasText: name }) });
const hint = (page, name) => exCard(page, name).locator('.ex-hi').textContent();
async function pick(page, workout) {
  await page.locator('#woGrid .wo-b', { hasText: workout }).click();
  await settle(page);
}
async function patchSession(page, key, fn) {
  await page.evaluate(({ key, src }) => { (0, eval)(`(${src})`)(state.sessions[key]); persist(); render(); }, { key, src: fn.toString() });
  await settle(page);
}

(async () => {
  const { browser, page, errors, dialogs } = await launch();

  section('Availability and existing history');
  await fresh(page, BASE, 'daughter');
  const daughterOptions = await page.locator('#pS option').evaluateAll(o => o.map(x => x.value));
  check('the six-cycle program is not offered to the daughter profile', !daughterOptions.includes(P), daughterOptions.join(','));
  await page.click('#pBtn');
  await page.click('[data-pf="dad"]');
  await settle(page);
  await page.evaluate(() => {
    const bench = newSession('dad', 'upperLower12', 'upperA', '2026-09-01', 5, 'ymca');
    bench.exercises[0].sets.forEach(s => { s.weight = '165'; s.reps = '5'; s.rir = '2'; });
    bench.updatedAt = '2026-09-01T18:00:00.000Z';
    state.sessions[bench.key] = bench;
    const ohp = newSession('dad', 'upperLower12', 'upperB', '2026-09-03', 5, 'ymca');
    ohp.exercises[0].sets.forEach(s => { s.weight = '105'; s.reps = '6'; s.rir = '2'; });
    ohp.updatedAt = '2026-09-03T18:00:00.000Z';
    state.sessions[ohp.key] = ohp;
    ctx().currentWeek = 5;
    persist();
  });
  await reload(page);
  const dadOptions = await page.locator('#pS option').evaluateAll(o => o.map(x => x.value));
  check('the six-cycle program is selectable for dad', dadOptions.includes(P));
  check('dad stays on the 12-week program until he chooses otherwise', (await page.inputValue('#pS')) === 'upperLower12');
  check('existing 12-week history still loads (week 5)', (await page.textContent('#wV')) === 'W5');

  section('Explicit Start Block, with a backup step');
  await page.selectOption('#pS', P);
  await settle(page);
  check('selecting the program shows the Start Block card', await page.locator('#blockStart').count() === 1);
  check('nothing is loggable before the block starts', await page.locator('[data-f]').count() === 0);
  check('header says not started', (await page.textContent('#hB')).includes('Not started'));
  page.dialogPolicy = 'dismiss';
  const before = dialogs.length;
  await page.click('#bkStart');
  await settle(page);
  check('starting without a backup today asks first', dialogs.length === before + 1 && /backup/i.test(dialogs[dialogs.length - 1]), dialogs[dialogs.length - 1]);
  check('declining keeps the block unstarted', await page.locator('#blockStart').count() === 1);
  page.dialogPolicy = 'accept';
  const [backup] = await Promise.all([page.waitForEvent('download'), page.click('#bkExport')]);
  check('the start card offers a backup export', /workout-backup-.*\.json/.test(backup.suggestedFilename()));
  await settle(page);
  check('the start card shows the fresh backup', (await page.textContent('#blockStart')).includes('✓'));
  const beforeStart = dialogs.length;
  await page.click('#bkStart');
  await settle(page);
  check('with a backup today, Start needs no extra confirmation', dialogs.length === beforeStart);
  check('block starts at the pre-block deload', (await page.textContent('#wV')) === 'Deload' && (await page.textContent('#hB')).includes('Deload'));
  const oldProgram = await page.evaluate(() => ({ week: ctx().currentWeek, sessions: Object.values(state.sessions).filter(s => s.programKey === 'upperLower12' && sessionHasContent(s)).length }));
  check('starting the block leaves the 12-week program untouched', oldProgram.week === 5 && oldProgram.sessions === 2, JSON.stringify(oldProgram));

  section('Pre-block deload');
  const exCount = await page.locator('#C .ex').count();
  check('Upper A has its six exercises', exCount === 6, exCount);
  check('one working set per exercise in the deload', await page.locator('#C .ex .sr:not(.wu)').count() === exCount);
  check('deload RIR target is 4–5', (await exCard(page, 'Barbell Bench Press').locator('.ex-bd').textContent()).includes('RIR 4–5'));
  check('bench notes carry the lighter-than-165 guidance', (await exCard(page, 'Barbell Bench Press').textContent()).includes('165-lb'));
  check('deload shows the previous-program bench as reference only', /Previous program.*165.*not a target/.test(await hint(page, 'Barbell Bench Press')));
  await page.click('[data-gym="office"]');
  await pick(page, 'Lower A');
  const officeLowerA = await page.locator('#C .ex-nm').allTextContents();
  check('office Lower A shows the office exercises', officeLowerA.join('|') === 'SSB Squat|Landmine Squat|Seated Cable Knee Extension|Standing Cable Leg Curl|Supported Single-Leg DB Calf Raise', officeLowerA.join('|'));
  await page.click('[data-gym="ymca"]');
  await settle(page);
  const ymcaLowerA = await page.locator('#C .ex-nm').allTextContents();
  check('YMCA Lower A shows the YMCA exercises', ymcaLowerA.join('|') === '45-Degree Leg Press|Hack Squat|Leg Extension|Seated Leg Curl|Standing Calf Raise Machine', ymcaLowerA.join('|'));

  section('Explicit completion (skipped sets allowed)');
  await pick(page, 'Upper A');
  await fillAllSets(page, '60', '8');
  check('logging every set does not complete the workout', (await page.textContent('#statusLine')).includes('all sets logged'));
  check('the card stays In progress', await page.locator('#woGrid .wo-b', { hasText: 'Upper A' }).locator('.tag-ip').count() === 1);
  await page.click('#wcComplete');
  await settle(page);
  check('Complete workout marks it Done', await page.locator('#woGrid .wo-b', { hasText: 'Upper A' }).locator('.tag-dn').count() === 1);
  check('the banner points at the next workout in sequence', (await page.textContent('#completionBanner')).includes('Next up: Lower A'));
  await pick(page, 'Lower A');
  await page.locator('[data-f$="-weight"]').first().fill('100');
  await page.locator('[data-f$="-reps"]').first().fill('10');
  const beforeSkip = dialogs.length;
  await page.click('#wcComplete');
  await settle(page);
  check('completing with unlogged sets asks first', dialogs.length === beforeSkip + 1 && dialogs[dialogs.length - 1].includes("aren't logged"), dialogs[dialogs.length - 1]);
  check('skipped sets are recorded as skipped', (await page.textContent('#statusLine')).includes('4 skipped'));

  section('Partial sessions resume on a later day');
  await pick(page, 'Upper B');
  await page.locator('[data-f$="-weight"]').first().fill('70');
  await page.locator('[data-f$="-reps"]').first().fill('10');
  await settle(page);
  const yesterday = await page.evaluate(() => addDaysISO(todayISO(), -1));
  await page.fill('#wDate', yesterday);
  await page.dispatchEvent('#wDate', 'change');
  await settle(page);
  await pick(page, 'Upper A');
  await pick(page, 'Upper B');
  check('re-selecting the workout resumes the started session', (await page.locator('[data-f$="-weight"]').first().inputValue()) === '70');
  check('…keeping its original date', (await page.inputValue('#wDate')) === yesterday);
  await pick(page, 'Upper A');
  await page.click('#aBtn');
  await settle(page);
  check('Next resumes the in-progress workout', (await page.textContent('#hT')).includes('Upper B') && (await page.locator('[data-f$="-weight"]').first().inputValue()) === '70');
  const ubCount = await page.evaluate(() => Object.values(state.sessions).filter(s => s.programKey === 'upperLower6_20261021' && s.workoutKey === 'upperB' && sessionHasContent(s)).length);
  check('no duplicate session was generated', ubCount === 1, ubCount);
  await page.click('#wcComplete');
  await pick(page, 'Lower B');
  await page.click('#wcComplete');
  await settle(page);
  check('finishing all four deload workouts starts Cycle 1', (await page.textContent('#wV')) === 'C1');
  check('the banner announces Cycle 1', (await page.textContent('#completionBanner')).includes('Deload done'));

  section('Cycle 1 (entry) targets');
  await pick(page, 'Upper A');
  check('bench is capped at two working sets', await exCard(page, 'Barbell Bench Press').locator('.sr:not(.wu)').count() === 2);
  check('cycle 1 uses 3 RIR on everything', (await exCard(page, 'Low-Incline DB Press').locator('.ex-bd').textContent()).includes('RIR 3'));
  check('first exposure asks for calibration, not a load', /Calibrate/.test(await hint(page, 'Barbell Bench Press')) && !(await hint(page, 'Barbell Bench Press')).includes('Suggested:'));
  check('the old 165-lb bench is shown as reference only', /Previous program.*165.*not a target/.test(await hint(page, 'Barbell Bench Press')));
  await pick(page, 'Upper B');
  check('overhead press shows the old 105 lb as reference only', /Previous program.*105.*not a target/.test(await hint(page, 'Seated Barbell Overhead Press')));
  check('the old Upper B chest press is gone', !(await page.textContent('#C')).includes('Machine Chest Press'));

  section('Warm-ups are logged separately');
  await pick(page, 'Upper A');
  const setsHint = await page.textContent('#setsHint');
  await exCard(page, 'Barbell Bench Press').locator('[data-wadd]').click();
  await settle(page);
  await page.fill('[data-wf="0-0-weight"]', '45');
  await page.fill('[data-wf="0-0-reps"]', '8');
  await settle(page);
  check('a warm-up set does not count as a working set', (await page.textContent('#setsHint')) === setsHint, `${setsHint} vs ${await page.textContent('#setsHint')}`);
  check('warm-ups never add volume', await page.evaluate(() => exerciseVolume(currentSession().exercises[0])) === 0);
  await exCard(page, 'Barbell Bench Press').locator('[data-wadd]').click();
  await settle(page);
  await reload(page);
  check('the logged warm-up survives a reload and the blank one is tidied away', await exCard(page, 'Barbell Bench Press').locator('.sr.wu').count() === 1
    && (await page.inputValue('[data-wf="0-0-weight"]')) === '45');
  check('a warm-up alone marks the workout In progress, not Done', await page.locator('#woGrid .wo-b', { hasText: 'Upper A' }).locator('.tag-ip').count() === 1);

  section('Progression rules (seeded cycles 1–2)');
  const c1ua = await seed(page, { workout: 'upperA', cycle: 1, daysAgo: 12, checkin: CLEAN, sets: { 'Barbell Bench Press': [['135', '10', '3']] } });
  await seed(page, { workout: 'lowerA', cycle: 1, daysAgo: 11 });
  await seed(page, { workout: 'upperB', cycle: 1, daysAgo: 10 });
  await seed(page, { workout: 'lowerB', cycle: 1, daysAgo: 9 });
  const c2ua = await seed(page, { workout: 'upperA', cycle: 2, daysAgo: 6, checkin: CLEAN, sets: {
    'Barbell Bench Press': [['135', '10', '3']], 'Low-Incline DB Press': [['70', '15', '2']], 'Neutral-Grip Lat Pulldown': [['100', '6', '2'], ['100', '7', '2']] } });
  await seed(page, { workout: 'lowerA', cycle: 2, daysAgo: 5 });
  const c2ub = await seed(page, { workout: 'upperB', cycle: 2, daysAgo: 4, gym: 'office', sets: { 'Neutral-Grip Lat Pulldown': [['50', '12', '2']] } });
  const c2lb = await seed(page, { workout: 'lowerB', cycle: 2, daysAgo: 3, gym: 'office', checkin: { backDuring: 'none', backNextDay: 'none' },
    sets: { 'Barbell Romanian Deadlift': [['100', '10', '2']], 'Hand-Supported Split Squat': [['70', '15', '3']] } });
  await reload(page);
  check('two completed cycles put the block on Cycle 3', (await page.textContent('#wV')) === 'C3');
  await page.click('[data-gym="ymca"]');
  await pick(page, 'Upper A');
  check('bench: two clean sessions in a row → +5 lb', /Two clean sessions in a row at 135/.test(await hint(page, 'Barbell Bench Press')) && (await hint(page, 'Barbell Bench Press')).includes('Suggested: 140 lb'));
  check('bench never suggests extra sets', (await hint(page, 'Barbell Bench Press')).includes('Two working sets max'));
  await patchSession(page, c1ua, s => { s.exercises[0].sets[1].reps = '9'; });
  check('bench: only one qualifying session → repeat the load', /1 of 2 clean sessions at 135/.test(await hint(page, 'Barbell Bench Press')));
  await patchSession(page, c1ua, s => { s.exercises[0].sets[1].reps = '10'; });
  await patchSession(page, c2ua, s => { s.checkin.shoulderNextDay = ''; });
  check('bench: unknown next-morning status defers the increase', /waiting on that session’s shoulder check-in/.test(await hint(page, 'Barbell Bench Press')));
  await patchSession(page, c2ua, s => { s.checkin.catchingOccurred = 'yes'; });
  check('bench: logged catching blocks any increase', /Shoulder symptoms were logged/.test(await hint(page, 'Barbell Bench Press')) && !(await hint(page, 'Barbell Bench Press')).includes('Suggested:'));
  await patchSession(page, c2ua, s => { s.checkin.catchingOccurred = 'no'; s.checkin.shoulderNextDay = 'none'; });
  await patchSession(page, c2ub, s => { s.checkin.catchingOccurred = 'yes'; });
  check('bench: catching logged on a LATER workout (Upper B) still blocks the increase', /in or since your last bench session/.test(await hint(page, 'Barbell Bench Press')) && !(await hint(page, 'Barbell Bench Press')).includes('Suggested:'));
  await patchSession(page, c2ub, s => { s.checkin.catchingOccurred = ''; });
  await patchSession(page, c1ua, s => { s.checkin.shoulderNextDay = ''; });
  await patchSession(page, c1ua, s => { s.checkin.shoulderNextDay = 'none'; });
  check('incline at 15/15 with ≥2 RIR → heavier DBs or a switch, your call', /consider heavier DBs \(75 lb\).*won’t switch/.test(await hint(page, 'Low-Incline DB Press')));
  const pulldown = await hint(page, 'Neutral-Grip Lat Pulldown');
  check('machine history stays within the gym (YMCA pulldown ignores office 50 lb)', /Last:.*100/.test(pulldown) && !/Last:[^S]*50 ×/.test(pulldown), pulldown);
  check('first set below the range → reduce 5–10%', /First set fell below 8/.test(pulldown) && pulldown.includes('Suggested: 95 lb'), pulldown);
  await page.click('[data-gym="office"]');
  await settle(page);
  check('the same Upper A in office mode compares with office pulldown history', /Last:.*50 × 12/.test(await hint(page, 'Neutral-Grip Lat Pulldown')));
  await patchSession(page, c2ua, s => { s.exercises[3].sets.forEach(set => { set.weight = '110'; set.reps = '12'; set.rir = '2'; }); });
  await page.click('[data-gym="ymca"]');
  await pick(page, 'Upper B');
  const ubPulldown = await hint(page, 'Neutral-Grip Lat Pulldown');
  check('Upper B’s 3-set pulldown progresses from Upper A’s 2-set session at the top', /All sets hit 12 at ≥2 RIR → add 5 lb/.test(ubPulldown) && ubPulldown.includes('Suggested: 115 lb'), ubPulldown);
  await page.click('[data-gym="office"]');
  await settle(page);
  await pick(page, 'Lower B');
  const rdl = await hint(page, 'Barbell Romanian Deadlift');
  check('RDL at the top of the range → add 5 lb', /All sets hit 10 at ≥2 RIR → add 5 lb/.test(rdl) && rdl.includes('Suggested: 105 lb'), rdl);
  const split = await hint(page, 'Hand-Supported Split Squat');
  check('office split squat at 70 × 15 → reassess, never above the office max', /office max \(71 lb\).*reassess/.test(split), split);
  await exCard(page, 'Hand-Supported Split Squat').locator('[data-sg]').click();
  await settle(page);
  check('Suggest fills the split squat with ≤71 lb', Number(await exCard(page, 'Hand-Supported Split Squat').locator('[data-f$="-weight"]').first().inputValue()) <= 71);
  await patchSession(page, c2lb, s => { s.checkin.backDuring = 'some'; });
  check('logged back symptoms hold the RDL', /Back symptoms were logged/.test(await hint(page, 'Barbell Romanian Deadlift')));
  await patchSession(page, c2lb, s => { s.checkin.backDuring = 'none'; });
  await seed(page, { workout: 'lowerB', cycle: 2, daysAgo: 1, sets: { 'Hand-Supported Split Squat': [['85', '10', '3']] } });
  await reload(page);
  const overCap = await hint(page, 'Hand-Supported Split Squat');
  check('after an 85-lb YMCA split squat, office advice names the office max — never 85', /above the office max \(71 lb\)\. Use 71 lb/.test(overCap) && !/hold 85|Hold 85/.test(overCap), overCap);
  for (const input of await exCard(page, 'Hand-Supported Split Squat').locator('[data-f$="-weight"]').all()) await input.fill('');
  await settle(page);
  await exCard(page, 'Hand-Supported Split Squat').locator('[data-rp]').click();
  await settle(page);
  check('Repeat never copies an unavailable 85 lb into an office session', (await exCard(page, 'Hand-Supported Split Squat').locator('[data-f$="-weight"]').first().inputValue()) === '71');
  await exCard(page, 'Hand-Supported Split Squat').locator('[data-f$="-weight"]').first().fill('85');
  await page.dispatchEvent('[data-f="1-0-weight"]', 'change');
  await settle(page);
  check('an over-max office entry is flagged', (await page.textContent('#warnBox')).includes('office max is 71 lb'));

  section('Symptom check-ins');
  await page.locator('#ciCard [data-ci$="|backDuring|some"]').click();
  await settle(page);
  check('back symptoms show the guardrail', (await page.textContent('#ciCard')).includes('Back symptoms logged'));
  check('…and symptoms logged in the open session hold the RDL', /Back symptoms were logged/.test(await hint(page, 'Barbell Romanian Deadlift')));
  await reload(page);
  check('check-in answers persist', (await page.locator('#ciCard [data-ci$="|backDuring|some"]').getAttribute('aria-pressed')) === 'true');
  await page.locator('#ciCard [data-ci$="|backDuring|some"]').click();
  await settle(page);
  check('tapping again clears it back to unknown', (await page.locator('#ciCard [data-ci$="|backDuring|some"]').getAttribute('aria-pressed')) === 'false');
  await page.locator('#ciCard [data-ci$="|shoulderDuring|some"]').click();
  await settle(page);
  check('shoulder symptoms show the stop-and-rack guardrail', /stop and safely rack/.test(await page.textContent('#ciCard')));
  check('a follow-up check-in is prompted for a recent workout', await page.locator('#fuCard').count() === 1);
  for (let i = 0; i < 5 && await page.locator('#fuCard').count(); i++) {
    await page.locator('#fuCard [data-cidismiss]').click();
    await settle(page);
  }
  check('skipped follow-ups stop prompting', await page.locator('#fuCard').count() === 0);
  await reload(page);
  check('…including after a reload', await page.locator('#fuCard').count() === 0);

  section('Browsing cycles and opening past sessions');
  await page.click('#wD');
  await settle(page);
  check('stepping back views Cycle 2', (await page.textContent('#wV')) === 'C2' && (await page.textContent('#C')).includes('Viewing Cycle 2'));
  await page.click('#wU');
  await settle(page);
  await page.click('#wU');
  await settle(page);
  check('you can’t step past the current cycle', (await page.textContent('#wV')) === 'C3');
  await page.click('.tab[data-tab="history"]');
  await settle(page);
  await page.locator('.hi', { hasText: 'Deload' }).filter({ hasText: 'Upper A' }).locator('[data-open]').click();
  await settle(page);
  check('opening a deload session from History shows it', (await page.textContent('#wV')) === 'Deload' && (await page.textContent('#statusLine')).includes('Deload'));
  check('…without moving block progress', (await page.textContent('#C')).includes('current: Cycle 3'));
  await page.click('#cyNow');
  await settle(page);
  check('Back to current returns to Cycle 3', (await page.textContent('#wV')) === 'C3');

  section('Block completion and review');
  for (let c = 3; c <= 6; c++) {
    for (const [i, w] of ['upperA', 'lowerA', 'upperB', 'lowerB'].entries()) {
      if (c === 6 && w === 'lowerB') continue;
      if (c === 3 && w === 'lowerB') {
        await page.evaluate(() => { for (const s of Object.values(state.sessions)) if (s.programKey === 'upperLower6_20261021' && s.week === 3 && s.workoutKey.startsWith('lowerB')) delete state.sessions[s.key]; persist(); });
      }
      await seed(page, { workout: w, cycle: c, daysAgo: 0, complete: true, sets: { 'Barbell Bench Press': [[String(130 + c * 5), '10', '3']] }, checkin: CLEAN });
    }
  }
  await reload(page);
  check('only Cycle 6 Lower B remains', (await page.textContent('#wV')) === 'C6');
  await pick(page, 'Lower B');
  await page.click('#wcComplete');
  await settle(page);
  check('the final workout completes the block', (await page.textContent('#completionBanner')).includes('block finished') && (await page.textContent('#hB')).includes('Complete'));
  const review = await page.textContent('#blockReview');
  check('the block review shows completion, lifts, symptoms and recovery', /Workouts completed/.test(review) && /Barbell Bench Press/.test(review) && /Sessions with shoulder symptoms/.test(review) && /Average sleep/.test(review), review.slice(0, 200));
  await page.click('#wcReopen');
  await settle(page);
  check('reopening the last workout un-completes the block', await page.locator('#blockReview').count() === 0 && (await page.textContent('#hB')).includes('Cycle 6/6'));
  await page.click('#wcComplete');
  await settle(page);
  check('…and completing it again restores the review', await page.locator('#blockReview').count() === 1);

  section('Backup round trip');
  const [exported] = await Promise.all([page.waitForEvent('download'), page.click('#blockReview #bkExport')]);
  const backupPath = path.join(os.tmpdir(), `six-cycle-backup-${process.pid}.json`);
  fs.copyFileSync(await exported.path(), backupPath);
  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8')).data;
  const blockId = data.profiles.dad.cycleBlocks[P].id;
  const sixCycle = Object.values(data.sessions).filter(s => s.programKey === P);
  check('the export carries the block and its sessions', !!blockId && sixCycle.length >= 28 && sixCycle.every(s => s.blockId === blockId && s.key.endsWith(`__${blockId}`)));
  check('the export keeps completion, check-ins, warm-ups and conventions', sixCycle.some(s => s.completedAt) && sixCycle.some(s => s.checkin.shoulderNextDay === 'none')
    && sixCycle.some(s => s.exercises.some(x => x.warmups.length)) && sixCycle.every(s => s.exercises.every(x => x.convention && x.variantId)));
  await page.click('.tab[data-tab="settings"]');
  await settle(page);
  await page.setInputFiles('#sI', backupPath);
  await page.waitForTimeout(300);
  await settle(page);
  await page.click('.tab[data-tab="today"]');
  await settle(page);
  check('importing the backup restores the completed block', await page.locator('#blockReview').count() === 1 && (await page.textContent('#hB')).includes('Complete'));

  section('Starting a new block');
  await page.click('#blockReview #bkStart');
  await settle(page);
  check('a new block starts at the deload', (await page.textContent('#wV')) === 'Deload' && (await page.textContent('#C')).includes('0/4 workouts complete'));
  await pick(page, 'Upper A');
  const twoDaysAgo = await page.evaluate(() => addDaysISO(todayISO(), -2));
  await page.fill('#wDate', twoDaysAgo);
  await page.dispatchEvent('#wDate', 'change');
  await reload(page);
  check('a date picked for an untouched workout survives a reload', (await page.inputValue('#wDate')) === twoDaysAgo);
  await page.click('.tab[data-tab="history"]');
  await settle(page);
  check('the finished block stays in History', await page.locator('.hi [data-open]').count() >= 28);
  await page.click('.tab[data-tab="today"]');
  await page.selectOption('#pS', 'upperLower12');
  await settle(page);
  check('the 12-week program is still on week 5', (await page.textContent('#wV')) === 'W5');
  check('six-cycle date moves don’t change the 12-week workout date', (await page.inputValue('#wDate')) === await page.evaluate(() => todayISO()));
  await page.click('.tab[data-tab="history"]');
  await settle(page);
  check('…with its two sessions', await page.locator('.hi [data-open]').count() === 2);

  section('Rest-timer auto-start across a program switch');
  await page.evaluate(() => { delete ctx().cycleBlocks.upperLower6_20261021; persist(); });
  await page.click('.tab[data-tab="today"]');
  await settle(page);
  await page.fill('[data-f="1-0-weight"]', '100');
  await page.fill('[data-f="1-0-reps"]', '8');
  await page.selectOption('#pS', P);
  await page.waitForTimeout(1500);
  check('switching to an unstarted program before auto-start fires throws nothing', errors.length === 0, errors.join(' | '));

  fs.rmSync(backupPath, { force: true });
  await done(browser, errors);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(2); });
