/* Shared helpers for the headless-browser test suites (dev-only — nothing
 * here is loaded by the app). Requires Playwright with a Chromium build:
 *   NODE_PATH=$(npm root -g) node tests/cycle.test.js http://127.0.0.1:8000/
 */
'use strict';

let failures = 0, passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log(`  PASS  ${name}`); }
  else { failures++; console.log(`  FAIL  ${name}${extra !== undefined ? ` — ${extra}` : ''}`); }
}
function section(title) { console.log(`— ${title} —`); }

async function launch() {
  const { chromium } = require('playwright'); // loaded here so tests/sw.test.js runs with plain Node
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  const errors = [];
  const dialogs = [];
  page.dialogPolicy = 'accept';
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => { dialogs.push(d.message()); return page.dialogPolicy === 'dismiss' ? d.dismiss() : d.accept(); });
  return { browser, page, errors, dialogs };
}

/* Wait until the app's requestAnimationFrame-batched render has run. */
async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/* Fresh state, profile picked. flushPersist() first so a pending debounced
 * save can't be written back by the pagehide handler after the clear. */
async function fresh(page, base, profile) {
  await page.goto(base);
  await page.evaluate(() => { if (typeof flushPersist === 'function') flushPersist(); localStorage.clear(); });
  await page.reload();
  if (profile) { await page.click(`[data-pf="${profile}"]`); await settle(page); }
}
async function reload(page) {
  await page.evaluate(() => flushPersist());
  await page.reload();
  await settle(page);
}

/* Leave the focused field, as tapping elsewhere or the keyboard's Done does
 * (fires change/focusout — when a finished workout is acted on). */
async function leaveField(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
  await settle(page);
}

/* Fill every working set of the open workout, then leave the last field. */
async function fillAllSets(page, weight = '100', reps = '10') {
  const fields = await page.locator('[data-f$="-weight"]').count();
  for (let i = 0; i < fields; i++) {
    await page.locator('[data-f$="-weight"]').nth(i).fill(weight);
    await page.locator('[data-f$="-reps"]').nth(i).fill(reps);
  }
  await leaveField(page);
}

function finish() {
  console.log(failures === 0 ? `\nALL ${passes} CHECKS PASSED` : `\n${failures} CHECK(S) FAILED (${passes} passed)`);
  process.exit(failures === 0 ? 0 : 1);
}
function done(browser, errors) {
  check('no page errors during the run', errors.length === 0, errors.join(' | '));
  return browser.close().then(finish);
}

module.exports = { check, section, launch, settle, fresh, reload, fillAllSets, leaveField, done, finish };
