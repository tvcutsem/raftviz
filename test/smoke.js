/**
 * smoke.mjs — End-to-end smoke test for RaftViz
 *
 * Starts a local HTTP server, drives a headless Chromium browser through key
 * scenes, and checks DOM/SVG state against expected behaviour.
 *
 * Usage (from raftviz/):
 *   npm install
 *   npx playwright install chromium
 *   node test/smoke.mjs
 *
 * The server is started on port 8742 (distinct from the dev port 8741) and
 * torn down automatically when the test finishes.
 */

import { chromium } from 'playwright';
import { spawn }    from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PORT = 8742;
const BASE = `http://localhost:${PORT}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Minimal test harness ─────────────────────────────────────────────────────

let _passed = 0, _failed = 0;

function suite(name) {
  console.log(`\n── ${name} ──`);
}

function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); _passed++; }
  else           { console.error(`  ✗ ${label}`); _failed++; }
}

// ── HTTP server helpers ──────────────────────────────────────────────────────

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT],
    { stdio: 'ignore' });
}

async function waitForServer(maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`Server on port ${PORT} did not start within ${maxMs}ms`);
}

// ── DOM query helpers (all run inside the page) ──────────────────────────────

const sceneTitle    = page => page.evaluate(() =>
  document.getElementById('scene-title')?.textContent ?? '');

const subtitle      = page => page.evaluate(() =>
  document.getElementById('subtitle')?.innerHTML ?? '');

const isDisabled    = (page, id) => page.evaluate(
  id => document.getElementById(id)?.disabled ?? true, id);

const isDisabledSel = (page, sel) => page.evaluate(
  sel => document.querySelector(sel)?.disabled ?? true, sel);

const count         = (page, sel) => page.evaluate(
  sel => document.querySelectorAll(sel).length, sel);

const textOf        = (page, sel) => page.evaluate(
  sel => document.querySelector(sel)?.textContent ?? '', sel);

const hasClass      = (page, sel, cls) => page.evaluate(
  ([s, c]) => document.querySelector(s)?.classList.contains(c) ?? null, [sel, cls]);

/** Last <text> child of .node-<id> is the role badge: follower / candidate / leader */
const nodeRole      = (page, id) => page.evaluate(id => {
  const g = document.querySelector(`.node-${id}`);
  if (!g) return null;
  const ts = g.querySelectorAll('text');
  return ts[ts.length - 1]?.textContent ?? null;
}, id);

const pseudoLabel   = page => page.evaluate(() =>
  document.querySelector('.pseudo-slide-label')?.textContent ?? '');

const hlCount       = page => page.evaluate(() =>
  document.querySelectorAll('.pseudo-hl').length);

// ── Utilities ────────────────────────────────────────────────────────────────

const sleep   = ms => new Promise(r => setTimeout(r, ms));

const waitFor = (page, fn, timeout = 12_000) =>
  page.waitForFunction(fn, { timeout });

/**
 * True when the timeline is at a real pause point (button visible AND enabled).
 *
 * Between pauses the player calls setResumePending() which keeps the button
 * visible but sets disabled=true, so checking !hidden alone is insufficient.
 */
const AT_PAUSE = () => {
  const btn = document.getElementById('btn-resume');
  return !!(btn && !btn.classList.contains('hidden') && !btn.disabled);
};

/**
 * Click the Continue button and wait for the NEXT real pause to appear.
 * After the click setResumePending() disables the button (but keeps it
 * visible), so we poll for visible+enabled which only fires at the next
 * waitForResume point in the timeline.
 */
async function advancePause(page) {
  await page.click('#btn-resume');
  await waitFor(page, AT_PAUSE, 15_000);
}

// ── Tests ────────────────────────────────────────────────────────────────────

let server, browser;

try {
  server = startServer();
  await waitForServer();

  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(`  [JS] ${e.message}`));

  // ── 1. Title scene ──────────────────────────────────────────────────────────
  suite('Scene 1 — Title');

  await page.goto(BASE);
  await page.waitForSelector('#chart svg', { timeout: 10_000 });
  await sleep(800);

  const t1 = await sceneTitle(page);
  assert(t1.includes('1 / 14'),  `scene counter "1 / 14" (got "${t1}")`);
  assert(t1.includes('Welcome'), `title includes "Welcome"`);
  assert(await isDisabled(page, 'btn-prev'),    'prev button disabled on first scene');
  assert(!(await isDisabled(page, 'btn-next')), 'next button enabled');
  assert(await hasClass(page, '#code-pane', 'pane-collapsed'), 'pseudocode pane collapsed');
  assert((await textOf(page, '.pseudo-fold-label')).includes('Pseudocode'),
    'collapsed shell shows the vertical "Pseudocode" label on initial load');
  assert(!(await page.evaluate(() => !!document.querySelector('.pseudo-panel'))),
    'no expanded .pseudo-panel content on initial load');
  assert(!(await page.evaluate(() => !!document.querySelector('.code-pane-placeholder'))),
    'stale "(Phase 3)" placeholder text is gone');
  assert((await nodeRole(page, 'A')) === null, 'no cluster nodes in title scene');

  // ── 1b. Initialisation scene ────────────────────────────────────────────────
  suite('Scene 4 — Initialisation (three followers in term 0)');

  await page.evaluate(() => { window.location.hash = 'raft-init'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('4 / 14'));
  await waitFor(page, AT_PAUSE);

  const t4 = await sceneTitle(page);
  assert(t4.includes('4 / 14'), `scene counter "4 / 14" (got "${t4}")`);

  const roles4 = await Promise.all(['A', 'B', 'C'].map(id => nodeRole(page, id)));
  assert(roles4.every(r => r === 'follower'),
    `all three nodes start as followers (roles: ${roles4.join(', ')})`);
  assert((await count(page, '.log-block')) === 0, 'stable storage starts empty (no log blocks)');

  // Every inspector should report currentTerm = 0 on a fresh cluster.
  const terms4 = await page.evaluate(() =>
    [...document.querySelectorAll('.inspector')].map(insp => {
      const row = [...insp.querySelectorAll('.insp-row')]
        .find(r => r.textContent.includes('currentTerm'));
      return row?.querySelectorAll('text')[1]?.textContent ?? null;
    }));
  assert(terms4.length === 3 && terms4.every(v => v === '0'),
    `all inspectors show currentTerm = 0 (got ${JSON.stringify(terms4)})`);

  assert(!(await hasClass(page, '#code-pane', 'pane-collapsed')), 'pseudocode pane is open');
  const sl4a = await pseudoLabel(page);
  assert(sl4a.includes('1 / 9'), `pseudocode slide "1 / 9" (got "${sl4a}")`);
  // Pause 1 is the intro beat added in cdacde8 — it precedes any highlight.
  assert((await hlCount(page)) === 0, 'no pseudocode lines highlighted at the intro pause');

  await advancePause(page);  // pause 1 → pause 2 (HL.INIT)
  assert((await hlCount(page)) > 0, 'init pseudocode lines highlighted at pause 2');
  const sub4b = await subtitle(page);
  assert(sub4b.includes('currentTerm'), `subtitle explains currentTerm (got "${sub4b}")`);

  await advancePause(page);  // pause 2 → pause 3 (election timers start)
  const sub4c = await subtitle(page);
  assert(sub4c.includes('election timer'),
    `subtitle explains the randomised election timer (got "${sub4c}")`);

  // ── 2. Election timeout scene ───────────────────────────────────────────────
  suite('Scene 5 — Election Timeout (first pause: A becomes candidate)');

  await page.evaluate(() => { window.location.hash = 'raft-election'; });
  // First pause fires once A has become a candidate (~2.5 s into the scene)
  await waitFor(page, AT_PAUSE);

  const t5 = await sceneTitle(page);
  assert(t5.includes('5 / 14'),     `scene counter "5 / 14" (got "${t5}")`);
  assert((await nodeRole(page, 'A')) === 'candidate', 'Node A is candidate');
  assert((await nodeRole(page, 'B')) === 'follower',  'Node B is follower');
  assert((await nodeRole(page, 'C')) === 'follower',  'Node C is follower');
  assert(!(await hasClass(page, '#code-pane', 'pane-collapsed')), 'pseudocode pane is open');

  const sl5 = await pseudoLabel(page);
  assert(sl5.includes('1 / 9'), `pseudocode slide "1 / 9" (got "${sl5}")`);
  assert((await hlCount(page)) > 0, 'at least one pseudocode line highlighted');

  const sub5 = await subtitle(page);
  assert(sub5.includes('candidate'), `subtitle mentions "candidate"`);

  // ── 3. Voting scene ─────────────────────────────────────────────────────────
  suite('Scene 6 — Voting (pseudocode advances to slide 2)');

  await page.evaluate(() => { window.location.hash = 'raft-voting'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('6 / 14'));
  await waitFor(page, AT_PAUSE);

  const t6 = await sceneTitle(page);
  assert(t6.includes('6 / 14'), `scene counter "6 / 14" (got "${t6}")`);

  // Pause 1 shows the candidate's *send* side (slide 1, lines 16–19).
  const sl6a = await pseudoLabel(page);
  assert(sl6a.includes('1 / 9'),
    `pause 1 highlights the VoteRequest broadcast on slide 1/9 (got "${sl6a}")`);

  // Pause 2 = VoteRequest dots in flight; pause 3 = B evaluates the request,
  // which is the first `on receiving VoteRequest` highlight (slide 2).
  await advancePause(page);  // pause 1 → pause 2
  await advancePause(page);  // pause 2 → pause 3

  const sl6b = await pseudoLabel(page);
  assert(sl6b.includes('2 / 9'), `pseudocode advances to slide 2/9 (got "${sl6b}")`);

  // ── 4. Becoming leader scene ────────────────────────────────────────────────
  suite('Scene 7 — Becoming Leader (A wins quorum after two Continue clicks)');

  await page.evaluate(() => { window.location.hash = 'raft-leader'; });
  // Pause 1: scene just loaded, A is still a candidate
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('7 / 14'));
  await waitFor(page, AT_PAUSE);

  const t7a = await sceneTitle(page);
  assert(t7a.includes('7 / 14'), `scene 7 loaded (got "${t7a}")`);
  assert((await nodeRole(page, 'A')) === 'candidate', 'Node A starts as candidate');

  // Advance to pause 2 (VoteResponses in flight), then pause 3 (A is leader)
  await advancePause(page);  // pause 1 → pause 2
  await advancePause(page);  // pause 2 → pause 3 (A transitions to leader here)

  const roles7 = await Promise.all(['A', 'B', 'C'].map(id => nodeRole(page, id)));
  assert(roles7.includes('leader'),
    `one node is leader after quorum (roles: ${roles7.join(', ')})`);
  assert(roles7.filter(r => r === 'follower').length === 2,
    `two nodes remain followers (roles: ${roles7.join(', ')})`);

  const sl7 = await pseudoLabel(page);
  assert(sl7.includes('3 / 9'), `pseudocode advances to slide 3/9 (got "${sl7}")`);

  // ── 5. Replication scene ────────────────────────────────────────────────────
  suite('Scene 8 — Replication (log entry block appears after first pause)');

  await page.evaluate(() => { window.location.hash = 'raft-replication'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('8 / 14'));
  // Scene 8 timeline: pause1=leader shown, pause2=heartbeat, pause3=client appears,
  // pause4=log entry appended. Advance to pause 4 to verify the log block.
  await waitFor(page, AT_PAUSE);
  await advancePause(page);  // pause 1 → 2
  await advancePause(page);  // pause 2 → 3
  await advancePause(page);  // pause 3 → 4 (log entry now in A's log)

  const t8 = await sceneTitle(page);
  assert(t8.includes('8 / 14'), `scene counter "8 / 14" (got "${t8}")`);

  const hasLogBlock = await page.evaluate(() =>
    document.querySelectorAll('.log-block').length > 0);
  assert(hasLogBlock, 'at least one .log-block rendered in leader log after broadcast');

  // ── 6. Live cluster scene ───────────────────────────────────────────────────
  suite('Scene 13 — Live Cluster (autonomous simulation)');

  await page.evaluate(() => { window.location.hash = 'live-cluster'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('13 / 14'));
  // Simulation auto-runs; wait for a leader to be elected
  await waitFor(page, () => {
    const ts = [...document.querySelectorAll('.node text:last-child')];
    return ts.some(t => t.textContent === 'leader');
  }, 15_000);

  const t13 = await sceneTitle(page);
  assert(t13.includes('13 / 14'), `scene counter "13 / 14" (got "${t13}")`);
  assert(!(await isDisabled(page, 'btn-next')), 'next button enabled (quiz follows live cluster)');
  assert(!(await hasClass(page, '#code-pane', 'pane-collapsed')), 'pseudocode pane is open');

  // Only assert a leader exists — elections can fire at any moment, so a node
  // may momentarily be a candidate when we sample.
  const roles13 = await Promise.all(['A', 'B', 'C'].map(id => nodeRole(page, id)));
  assert(roles13.includes('leader'),
    `cluster has a leader (roles: ${roles13.join(', ')})`);

  // Playground controls
  assert(await page.evaluate(() => !!document.getElementById('pg-speed')),
    'speed slider (#pg-speed) present');
  assert(await page.evaluate(() => !!document.querySelector('.pg-btn')),
    'send-request button (.pg-btn) present');

  // ── 6b. Regression: jump directly from Live Cluster into a scripted scene ────
  //
  // raftviz:framechange fires AFTER the destination frame's setup() has already
  // run. 02_live_cluster.js used to tear down its own PseudocodePanel from that
  // listener, which — since both point at the same #code-pane element — wiped
  // out the destination frame's freshly-built panel when jumping straight from
  // Live Cluster to a scripted scene (only reachable via the dropdown/hash, not
  // sequential Next/Prev, which is why the original smoke suite missed it).
  suite('Live Cluster → Election (direct jump): pseudocode panel must survive');

  await page.evaluate(() => { window.location.hash = 'raft-election'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('5 / 14'));
  await sleep(300);

  assert(!(await hasClass(page, '#code-pane', 'pane-collapsed')),
    'pseudocode pane is expanded after the direct jump');
  assert(await page.evaluate(() => !!document.querySelector('.pseudo-panel')),
    'pseudocode panel actually rendered (not wiped back to placeholder)');
  const slAfterJump = await pseudoLabel(page);
  assert(slAfterJump.includes('1 / 9'),
    `pseudocode slide "1 / 9" after direct jump (got "${slAfterJump}")`);

  assert(await page.evaluate(() => !document.getElementById('playground-bar')),
    'playground bar removed after navigating away from Live Cluster');

  // ── 6c. Stale pseudocode content must not leak into a panel-less scene ──────
  //
  // Leaving a scripted scene used to only collapse #code-pane (a CSS class),
  // never clear its content — the fold-strip toggle stayed clickable and could
  // re-reveal the previous scene's dormant slide/highlights underneath an
  // unrelated frame.
  suite('Crash & re-election (11) → Playground Intro (12): no stale pseudocode leaks through');

  await page.evaluate(() => { window.location.hash = 'raft-crash-reelection'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('11 / 14'));
  await waitFor(page, AT_PAUSE);
  // Pause 1 (fade-in) and pause 2 (A crashes) precede any highlight; pause 3
  // fires after B's election timeout, which is the scene's first _panel.highlight() call.
  await advancePause(page);  // pause 1 → pause 2
  await advancePause(page);  // pause 2 → pause 3 (ELECTION_TIMEOUT highlighted)
  assert((await hlCount(page)) > 0, 'scene 11 has highlighted pseudocode lines before leaving');

  await page.evaluate(() => { window.location.hash = 'playground-intro'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('12 / 14'));
  await sleep(300);

  assert(await hasClass(page, '#code-pane', 'pane-collapsed'),
    'code-pane collapsed on the panel-less scene');
  assert(!(await page.evaluate(() => !!document.querySelector('.pseudo-panel'))),
    'no leftover .pseudo-panel content once the panel-less scene loads');
  assert((await hlCount(page)) === 0, 'no stale highlighted lines survive into the panel-less scene');
  assert((await textOf(page, '.pseudo-fold-label')).includes('Pseudocode'),
    'collapsed shell restored in #code-pane');

  // ── 7. Keyboard navigation ──────────────────────────────────────────────────
  suite('Keyboard navigation');

  await page.evaluate(() => { window.location.hash = 'title'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('1 / 14'));

  await page.keyboard.press('ArrowRight');
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('2 / 14'));
  const navFwd = await sceneTitle(page);
  assert(navFwd.includes('2 / 14'), `ArrowRight advances to scene 2 (got "${navFwd}")`);

  await page.keyboard.press('ArrowLeft');
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('1 / 14'));
  const navBack = await sceneTitle(page);
  assert(navBack.includes('1 / 14'), `ArrowLeft returns to scene 1 (got "${navBack}")`);

  // ── 8. URL hash deep-link ───────────────────────────────────────────────────
  suite('Hash deep-link');

  await page.goto(`${BASE}#raft-log-request`);
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('9 / 14'));
  const deepTitle = await sceneTitle(page);
  assert(deepTitle.includes('9 / 14'),
    `#raft-log-request deep-links to scene 9 (got "${deepTitle}")`);
  assert(deepTitle.toLowerCase().includes('log'),
    `scene title mentions "log" (got "${deepTitle}")`);

  // ── 9. Quiz scene ─────────────────────────────────────────────────────────
  suite('Scene 14 — Quiz (interactive multiple-choice)');

  // Correct option index per question — must match QUESTIONS in 13_quiz.js.
  const KEY = [2, 2, 1, 3, 3, 2];

  await page.goto(`${BASE}#quiz`);
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('14 / 14'));
  await page.waitForSelector('.quiz-overlay', { timeout: 5_000 });

  const tQuiz = await sceneTitle(page);
  assert(tQuiz.includes('14 / 14'), `quiz is scene 14 of 14 (got "${tQuiz}")`);
  assert(tQuiz.includes('Quiz'),    'scene title includes "Quiz"');
  assert(await isDisabled(page, 'btn-next'), 'next button disabled on last scene (quiz)');

  // First question renders with four options and a disabled Submit.
  assert(await page.evaluate(() => !!document.querySelector('.quiz-prompt')),
    'first question prompt rendered');
  assert((await count(page, '.quiz-option')) === 4, 'first question has four options');
  assert(await isDisabledSel(page, '.quiz-btn'),
    'submit disabled until an option is chosen');

  // Selecting an option enables Submit.
  await page.locator('.quiz-option input').first().check();
  assert(!(await isDisabledSel(page, '.quiz-btn')),
    'submit enabled after selecting an option');

  // Answer every question correctly. The final two questions (the shared
  // log-snapshot pair) additionally render a .quiz-figure with three log rows
  // above the options; the earlier questions must not.
  let sawFigure = false;
  for (let i = 0; i < KEY.length; i++) {
    await page.waitForSelector('.quiz-option input');
    assert((await textOf(page, '.quiz-progress')).includes(`${i + 1} of ${KEY.length}`),
      `question ${i + 1} of ${KEY.length} shown`);
    const figRows = await count(page, '.quiz-figure .quiz-log-row');
    if (i >= 4) {
      assert(figRows === 3, `snapshot figure with three log rows on question ${i + 1}`);
      sawFigure = true;
    } else {
      assert(figRows === 0, `no snapshot figure on question ${i + 1}`);
    }
    await page.locator('.quiz-option input').nth(KEY[i]).check();
    await page.click('.quiz-btn');
  }
  assert(sawFigure, 'the snapshot questions rendered a log figure');

  // Results screen: perfect score + full review.
  await page.waitForSelector('.quiz-score', { timeout: 5_000 });
  const score = await textOf(page, '.quiz-score');
  assert(score.includes('6 / 6'), `perfect score shown (got "${score}")`);
  assert((await count(page, '.quiz-review-item')) === 6, 'review lists all six questions');
  assert((await count(page, '.quiz-explanation')) === 6,
    'each reviewed question shows an explanation');
  assert((await count(page, '.quiz-review-option.correct')) === 6,
    'the correct option is marked in each question');
  assert((await count(page, '.quiz-review-option.chosen-wrong')) === 0,
    'no wrong picks marked after a perfect run');
  assert((await count(page, '.quiz-review-item .quiz-figure')) === 2,
    'the two snapshot questions show the log figure in the review');

  // Retry returns to question 1.
  await page.click('.quiz-btn');  // the lone Retry button on the results screen
  await page.waitForSelector('.quiz-prompt', { timeout: 5_000 });
  assert((await textOf(page, '.quiz-progress')).includes('1 of 6'),
    'Retry returns to question 1');

  // Teardown: navigating away removes the overlay.
  await page.evaluate(() => { window.location.hash = 'title'; });
  await waitFor(page, () =>
    document.getElementById('scene-title')?.textContent.includes('1 / 14'));
  assert(await page.evaluate(() => !document.querySelector('.quiz-overlay')),
    'quiz overlay removed after navigating away');

} finally {
  await browser?.close();
  server?.kill();
}

// ── Results ──────────────────────────────────────────────────────────────────

const total = _passed + _failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${_passed}/${total} passed${_failed > 0 ? `, ${_failed} FAILED` : ''}`);
if (_failed > 0) process.exit(1);
