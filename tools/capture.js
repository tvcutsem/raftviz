/**
 * capture.js — Generate README / blog-post media for RaftViz
 *
 * Drives a headless Chromium browser through chosen scenes and captures:
 *   - PNG stills at 2x device scale (crisp on retina displays)
 *   - WebM screen recordings, transcoded by ffmpeg into
 *       * .mp4  (h264, small + high quality — best for blog posts)
 *       * .gif  (palette-optimised — needed for GitHub READMEs, which do
 *                not render <video> tags from relative repository paths)
 *
 * Usage (from raftviz/):
 *   npm install
 *   npx playwright install chromium
 *   node tools/capture.js                 # everything
 *   node tools/capture.js --only hero     # one asset (substring match)
 *   node tools/capture.js --list          # show asset names and exit
 *   node tools/capture.js --keep-webm     # keep the intermediate WebM files
 *
 * Requires ffmpeg on PATH for the video assets (stills work without it).
 * Output lands in docs/media/.
 *
 * ── Two things worth knowing before editing this file ──────────────────────
 *
 * 1. The chart SVG is viewBox="0 0 1000 600" with preserveAspectRatio
 *    "xMidYMid meet", so the artwork always keeps a 5:3 aspect ratio and
 *    letterboxes inside #chart. A viewport picked by hand almost always
 *    leaves a dead band of background above/below the drawing. fitViewport()
 *    measures the real #chart box and adjusts the viewport height until the
 *    letterboxing is gone, so every asset is tightly framed.
 *
 * 2. The theme is read from localStorage by initTheme() (defaulting to
 *    light) — NOT from prefers-color-scheme. Playwright's `colorScheme`
 *    option therefore has no effect; we seed localStorage with addInitScript
 *    before the app boots instead.
 */

import { chromium }      from 'playwright';
import { spawn }         from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, rm, rename } from 'fs/promises';

const PORT = 8743;                         // distinct from dev (8741) and smoke (8742)
const BASE = `http://localhost:${PORT}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'docs', 'media');
const TMP  = join(OUT, '.tmp');

/** Stills: this width, height auto-fitted, then doubled via deviceScaleFactor. */
const SHOT_WIDTH  = 1400;
/** Clips: rendered 1:1 at this width (no 2x — keeps GIF weight sane). */
const VIDEO_WIDTH = 1280;
/** Generous starting height; fitViewport() trims it down to the real content. */
const PROBE_HEIGHT = 900;

/** Final GIF width. GitHub renders README content ~880px wide, so this is 1:1. */
const GIF_WIDTH = 880;
const GIF_FPS   = 10;

/**
 * Aspect-ratio bounds for the framed artwork.
 *
 * Tightening onto the content bbox alone can yield extreme ratios — a scene
 * with no logs yet is a wide, shallow strip — which both looks odd in a README
 * and starves the pseudocode panel of height. Clamping into this range pads
 * the viewBox symmetrically instead, so the artwork keeps balanced margins.
 */
const MIN_ASPECT = 1.15;
const MAX_ASPECT = 2.30;

// ── CLI args ────────────────────────────────────────────────────────────────

const argv     = process.argv.slice(2);
const only     = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const keepWebm = argv.includes('--keep-webm');
const listOnly = argv.includes('--list');

// ── Small utilities ─────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`)));
  });
}

async function hasFfmpeg() {
  try { await run('ffmpeg', ['-version']); return true; } catch { return false; }
}

// ── Page-driving helpers (mirrors test/smoke.js) ────────────────────────────

/** True when the timeline sits at a real pause point (visible AND enabled). */
const AT_PAUSE = () => {
  const btn = document.getElementById('btn-resume');
  return !!(btn && !btn.classList.contains('hidden') && !btn.disabled);
};

const waitFor = (page, fn, timeout = 20_000) =>
  page.waitForFunction(fn, { timeout });

/** Click Continue and wait for the next real pause. */
async function advancePause(page) {
  await page.click('#btn-resume');
  await waitFor(page, AT_PAUSE, 20_000);
}

/**
 * Navigate to a scene by URL hash and wait until it is ready.
 *
 * Scripted scenes (4–11) settle at their first `waitForResume()` pause; the
 * title, diagram, sandbox and quiz scenes never pause, so pass `pause: false`
 * and let the caller sleep for as long as the animation needs.
 */
async function gotoScene(page, hash, { pause = true } = {}) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  await page.waitForFunction(
    h => window.location.hash === '#' + h &&
         document.getElementById('scene-title')?.textContent !== '—',
    hash, { timeout: 10_000 });
  if (pause) await waitFor(page, AT_PAUSE);
}

/** Wait until some node reports the `leader` role badge. */
const waitForLeader = page => waitFor(page, () => {
  const ts = [...document.querySelectorAll('.node text:last-child')];
  return ts.some(t => t.textContent === 'leader');
}, 25_000);

/**
 * Set the sandbox speed slider.
 *
 * The sandbox runs on 1s message latency and a 2s heartbeat, so a full
 * election-to-commit arc takes ~30s at 1x — far too long for a README GIF.
 * Nudging the slider compresses it while staying readable, and the slider
 * itself is in frame showing the multiplier, so the clip stays self-evident.
 */
const setSpeed = (page, v) => page.evaluate(v => {
  const s = document.getElementById('pg-speed');
  if (!s) return;
  s.value = String(v);
  s.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

/** Id ('A' | 'B' | 'C') of the current leader, or null. */
const leaderId = page => page.evaluate(() =>
  ['A', 'B', 'C'].find(id => {
    const ts = document.querySelector(`.node-${id}`)?.querySelectorAll('text');
    return ts && ts[ts.length - 1]?.textContent === 'leader';
  }) ?? null);

/**
 * Retarget the chart SVG's viewBox onto the bounding box of what is actually
 * drawn, so the artwork fills the frame.
 *
 * Scenes place their nodes inside a fixed 1000x600 virtual space but rarely
 * fill it — most use the upper two thirds, leaving a wide band of empty
 * background that looks like sloppy cropping in a README. Because the SVG is
 * driven by viewBox + preserveAspectRatio, pointing the viewBox at the
 * content bbox is all it takes; nothing about the scene's own coordinate maths
 * changes. Setting it from the bbox (rather than relative to the current
 * viewBox) keeps this idempotent across repeated calls.
 *
 * @returns {number|null} the tightened aspect ratio, or null when the scene
 *   draws HTML instead of SVG (the quiz).
 */
const tightenViewBox = (page, pad = 26, viewBox = null) => page.evaluate(
  ({ pad, viewBox, minAspect, maxAspect }) => {
    const svg  = document.querySelector('#chart svg');
    const root = svg?.querySelector('g.root');
    if (!svg || !root) return null;

    if (viewBox) {                       // replay a box measured in a dry run
      svg.setAttribute('viewBox', viewBox);
      const [, , w, h] = viewBox.split(/\s+/).map(Number);
      return w / h;
    }

    let b;
    try { b = root.getBBox(); } catch { return null; }
    if (!(b.width > 4 && b.height > 4)) return null;   // nothing drawn yet

    let [x, y, w, h] = [b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad];

    // Pad the short axis until the ratio is back inside the allowed band.
    if (w / h > maxAspect) { const t = w / maxAspect; y -= (t - h) / 2; h = t; }
    if (w / h < minAspect) { const t = h * minAspect; x -= (t - w) / 2; w = t; }

    svg.setAttribute('viewBox', [x, y, w, h].map(n => Math.round(n)).join(' '));
    return w / h;
  }, { pad, viewBox, minAspect: MIN_ASPECT, maxAspect: MAX_ASPECT });

/** The viewBox currently on the chart SVG. */
const currentViewBox = page => page.evaluate(() =>
  document.querySelector('#chart svg')?.getAttribute('viewBox') ?? null);

/**
 * Resize the viewport so the chart area matches the artwork's aspect ratio —
 * i.e. so `preserveAspectRatio="xMidYMid meet"` has no slack left to
 * letterbox with.
 *
 * Both dimensions move. Height follows from the chart's width and the target
 * aspect; width grows when the pseudocode listing is taller than that height
 * would allow, since a wider chart implies a taller one and shrinking to fit
 * the code panel would only reintroduce letterboxing. Two passes converge:
 * #code-pane is sized at 35% of the viewport up to a 520px cap, so the first
 * resize can still shift the split.
 */
async function fitViewport(page, { aspect = null, pad = 0 } = {}) {
  for (let pass = 0; pass < 2; pass++) {
    const m = await page.evaluate(() => {
      const chart = document.getElementById('chart');
      const box   = chart.getBoundingClientRect();

      // Intrinsic height of the pseudocode listing (0 when no panel is up).
      // .pseudo-panel and .pseudo-body both stretch to fill the flex column,
      // so their scrollHeight tracks the viewport rather than the content —
      // measure the last rendered line instead.
      let need = 0;
      const wrap = document.querySelector('.pseudo-wrapper');
      const body = document.querySelector('.pseudo-body');
      if (wrap && body && body.children.length) {
        need = body.children[body.children.length - 1].getBoundingClientRect().bottom
             - wrap.getBoundingClientRect().top + 24;
      }

      // Scenes that render HTML into #chart (the quiz) have no aspect ratio to
      // honour, so fall back to the height their markup actually occupies.
      // Measure leaves only: .quiz-overlay is a full-height flex container, so
      // its own rect just echoes the viewport and could never shrink.
      let htmlH = 0;
      for (const el of chart.querySelectorAll('*')) {
        if (el.closest('svg') || el.children.length) continue;
        const r = el.getBoundingClientRect();
        if (r.height) htmlH = Math.max(htmlH, r.bottom - box.top);
      }

      return { w: innerWidth, h: innerHeight,
               chartW: box.width, chartH: box.height, need, htmlH };
    });

    const chromeH = m.h - m.chartH;          // header + subtitle / playground bars
    const paneW   = m.w - m.chartW;

    let wantW = m.chartW, wantH;
    if (aspect) {
      wantW = Math.max(m.chartW, m.need * aspect);
      wantH = wantW / aspect;
    } else {
      wantH = Math.max(m.htmlH + 28, m.need);
    }

    const newW = Math.min(1700, Math.max(900, Math.round(wantW + paneW)));
    const newH = Math.min(1500, Math.max(420, Math.round(wantH + chromeH + pad)));

    if (Math.abs(newW - m.w) < 3 && Math.abs(newH - m.h) < 3) break;
    await page.setViewportSize({ width: newW, height: newH });
    await sleep(400);
  }
  return page.viewportSize();
}

/**
 * Inject a visible pointer, since headless recordings show no OS cursor.
 * Without this, clicks in the sandbox recordings look like magic.
 */
async function injectCursor(page) {
  await page.addStyleTag({ content: `
    #capture-cursor {
      position: fixed; left: -50px; top: -50px; width: 18px; height: 18px;
      margin: -9px 0 0 -9px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.95);
      background: rgba(255,255,255,.25);
      box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.5);
      pointer-events: none; z-index: 99999; opacity: 0;
      transition: opacity .2s ease, transform .12s ease;
    }
    :root[data-theme="light"] #capture-cursor {
      border-color: rgba(20,20,30,.9); background: rgba(20,20,30,.2);
      box-shadow: 0 0 0 1px rgba(255,255,255,.7), 0 2px 8px rgba(0,0,0,.3);
    }
    #capture-cursor.visible { opacity: 1; }
    #capture-cursor.down    { transform: scale(.6); }
  `});
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = 'capture-cursor';
    document.body.appendChild(c);
    addEventListener('mousemove', e => {
      c.classList.add('visible');
      c.style.left = e.clientX + 'px';
      c.style.top  = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', () => c.classList.add('down'),    true);
    addEventListener('mouseup',   () => c.classList.remove('down'), true);
  });
}

/**
 * Move the (synthetic) pointer to an element and click it.
 *
 * Playwright's own `.click()` teleports the pointer, so we interpolate the
 * move ourselves — the injected cursor overlay then glides in the recording
 * instead of snapping between targets.
 */
async function humanClick(page, selector, steps = 25) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await sleep(240);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

/** Park the pointer off-canvas so it never sits over the artwork in a still. */
const parkPointer = page => page.mouse.move(1, 1);

/**
 * Collapse the subtitle bar when the scene leaves it empty.
 *
 * The sandbox scenes carry no narration, so the bar renders as an empty strip
 * between the artwork and the playground controls. Scenes that do narrate (or
 * that are showing the Continue button) keep it.
 */
const hideEmptySubtitleBar = page => page.evaluate(() => {
  const bar    = document.getElementById('subtitle-bar');
  const text   = document.getElementById('subtitle')?.textContent.trim() ?? '';
  const resume = document.getElementById('btn-resume');
  const shown  = resume && !resume.classList.contains('hidden');
  if (bar && !text && !shown) bar.style.display = 'none';
});

// ── Asset manifest ──────────────────────────────────────────────────────────
//
// Stills: { name, kind: 'shot', theme?, fit?, caption, run(page) }
// Clips:  { name, kind: 'clip', hash, gif?, cursor?, caption, run(page, mark) }
//
// `hash` on a clip is the scene used for the pre-recording size measurement
// (a recording context's video size is fixed when the context is created, so
// unlike a still it cannot be fitted on the fly).
//
// In a clip, mark.begin()/mark.end() record wall-clock offsets from the moment
// the recorded page opened; ffmpeg trims to exactly that window, dropping the
// page-load flash and any scene setup from the delivered file.
//
// The scripted scenes (4-11) replay identically every run, but the sandbox
// scenes race real election timers — which node wins, and therefore which one
// gets crashed, changes from run to run. Keep prose about those assets
// node-agnostic ("one node crashed", not "node A crashed") so a regeneration
// does not silently invalidate the surrounding captions.

const ASSETS = [
  // ── Stills ───────────────────────────────────────────────────────────────
  {
    name: 'shot-state-diagram',
    kind: 'shot',
    caption: 'Scene 3 — follower / candidate / leader role transitions',
    async run(page) {
      await gotoScene(page, 'state-diagram');
      // The scene reveals one transition arrow per step, so capture at the
      // last of its four pauses to get the complete diagram. Resuming past
      // that one advances to the next scene, so stop there.
      for (let i = 0; i < 3; i++) await advancePause(page);
      await sleep(1000);
    },
  },
  {
    name: 'shot-voting',
    kind: 'shot',
    caption: 'Scene 6 — a follower evaluates a VoteRequest, pseudocode slide 2/9',
    async run(page) {
      await gotoScene(page, 'raft-voting');
      await advancePause(page);   // VoteRequests in flight
      await advancePause(page);   // B evaluates the request (slide 2 highlight)
      await sleep(700);
    },
  },
  {
    name: 'shot-replication',
    kind: 'shot',
    caption: 'Scene 8 — client request appended to the leader log and broadcast',
    async run(page) {
      await gotoScene(page, 'raft-replication');
      await advancePause(page);
      await advancePause(page);
      await advancePause(page);   // log entry now in A's log
      await sleep(700);
    },
  },
  {
    name: 'shot-commit',
    kind: 'shot',
    caption: 'Scene 10 — leader commits once a quorum has acknowledged',
    async run(page) {
      await gotoScene(page, 'raft-log-response');
      await advancePause(page);
      await advancePause(page);
      await sleep(900);
    },
  },
  {
    name: 'shot-live-cluster',
    kind: 'shot',
    caption: 'Scene 13 — the free-play sandbox, with one node crashed',
    async run(page) {
      await gotoScene(page, 'live-cluster', { pause: false });
      await waitForLeader(page);
      await sleep(1000);
      // Commit a few commands first, so the still shows populated logs and
      // state machines rather than three empty nodes.
      for (let i = 0; i < 3; i++) {
        await page.click('.pg-btn');
        await sleep(1700);
      }
      // Then crash whichever node is *not* the leader, so the frame shows a
      // live leader alongside a grey crashed peer.
      const ldr   = await leaderId(page);
      const other = ['A', 'B', 'C'].find(id => id !== ldr);
      await page.locator(`.node-${other}`).click();
      await sleep(1800);
    },
  },
  {
    name: 'shot-quiz',
    kind: 'shot',
    caption: 'Scene 14 — the capstone quiz (question 5 carries a log-snapshot figure)',
    async run(page) {
      await gotoScene(page, 'quiz', { pause: false });
      await sleep(1200);
      // Questions 5 and 6 render an inline log-snapshot figure, which makes a
      // far more interesting still than a plain text question. Answering is
      // the only way forward, so click through the first four.
      for (let i = 0; i < 4; i++) {
        await page.locator('.quiz-option input').first().check();
        await page.locator('.quiz-btn').click();
        await sleep(350);
      }
      await page.locator('.quiz-option input').nth(1).check();
      await sleep(700);
    },
  },
  {
    name: 'shot-light-theme',
    kind: 'shot',
    theme: 'light',
    caption: 'Light theme — scene 8, replication',
    async run(page) {
      await gotoScene(page, 'raft-replication');
      await advancePause(page);
      await advancePause(page);
      await advancePause(page);
      await sleep(700);
    },
  },

  // ── Clips ────────────────────────────────────────────────────────────────
  {
    name: 'hero',
    kind: 'clip',
    hash: 'live-cluster',
    gif: true,
    caption: 'Cold start in the sandbox: election, leadership, replication, commit',
    async run(page, mark) {
      // Enter the sandbox first, *then* start the clip, so the recording opens
      // on a settled cluster rather than on a page load.
      await gotoScene(page, 'live-cluster', { pause: false });
      await sleep(700);
      await page.click('#btn-replay');          // deterministic cold start
      await sleep(250);
      await setSpeed(page, 2);

      mark.begin();
      await waitForLeader(page);                // the election plays out
      await sleep(1400);                        // heartbeats settle
      for (let i = 0; i < 3; i++) {             // inject client commands
        await page.click('.pg-btn');
        await sleep(1500);
      }
      await sleep(1400);
      mark.end();
    },
  },
  {
    name: 'crash-reelection',
    kind: 'clip',
    hash: 'live-cluster',
    gif: true,
    cursor: true,
    caption: 'Crash the leader in the sandbox; the survivors elect a new one',
    async run(page, mark) {
      await gotoScene(page, 'live-cluster', { pause: false });
      await setSpeed(page, 2);
      await waitForLeader(page);
      await sleep(1600);

      mark.begin();
      await sleep(900);
      const old = await leaderId(page);
      await humanClick(page, `.node-${old}`);   // crash the leader
      await sleep(1000);
      await parkPointer(page);
      // Survivors time out and elect a new leader.
      await waitFor(page, prev => {
        const now = ['A', 'B', 'C'].find(id => {
          const ts = document.querySelector(`.node-${id}`)?.querySelectorAll('text');
          return ts && ts[ts.length - 1]?.textContent === 'leader';
        });
        return !!now && now !== prev;
      }, 25_000).catch(() => {});
      await sleep(2400);
      await humanClick(page, `.node-${old}`);   // recover the old leader
      await sleep(1000);
      await parkPointer(page);
      await sleep(2600);                        // it rejoins as a follower
      mark.end();
    },
  },
  {
    name: 'guided-tour',
    kind: 'clip',
    hash: 'raft-leader',
    gif: true,
    caption: 'Guided scene 7: a candidate collects a quorum and becomes leader',
    async run(page, mark) {
      await gotoScene(page, 'raft-leader');
      await sleep(500);

      mark.begin();
      await sleep(2600);          // let the reader take in the subtitle
      await advancePause(page);   // VoteResponses in flight
      await sleep(2800);
      await advancePause(page);   // A becomes leader
      await sleep(3600);
      mark.end();
    },
  },
];

if (listOnly) {
  for (const a of ASSETS) console.log(`${a.kind === 'shot' ? 'still' : 'clip '}  ${a.name}`);
  process.exit(0);
}

// ── Capture drivers ─────────────────────────────────────────────────────────

/** A context with the theme seeded before the app's initTheme() runs. */
async function newCtx(browser, { theme = 'dark', ...opts }) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(t => {
    try { localStorage.setItem('raft-theme', t); } catch {}
  }, theme);
  return ctx;
}

async function openApp(browser, opts) {
  const ctx  = await newCtx(browser, opts);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(`    [JS] ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('#chart svg', { timeout: 15_000 });
  await sleep(500);
  return { ctx, page };
}

async function captureShot(browser, asset) {
  const { ctx, page } = await openApp(browser, {
    viewport: { width: SHOT_WIDTH, height: PROBE_HEIGHT },
    deviceScaleFactor: 2,
    theme: asset.theme ?? 'dark',
  });

  await asset.run(page);
  await hideEmptySubtitleBar(page);

  if (asset.fit !== false) {
    const aspect = await tightenViewBox(page);
    await fitViewport(page, { aspect });
    // The resize re-runs the scene's ResizeObserver; re-tighten so the final
    // frame is fitted to whatever is on screen now.
    if (aspect) {
      const a2 = await tightenViewBox(page);
      await fitViewport(page, { aspect: a2 });
    }
  }
  await parkPointer(page);
  await sleep(300);

  await page.screenshot({ path: join(OUT, `${asset.name}.png`) });
  await ctx.close();
  return [`${asset.name}.png`];
}

/**
 * Dry-run a clip to work out its framing.
 *
 * A recording context bakes its video size in when the context is created, so
 * — unlike a still — a clip cannot be fitted after the fact. Play the whole
 * scene once in a throwaway context and measure at the *end*, when the scene
 * has grown to its full extent (logs get longer as commands are committed).
 * Framing the real take with that final box means nothing is ever clipped:
 * early frames simply sit inside their eventual bounds.
 */
async function rehearseClip(browser, asset) {
  const { ctx, page } = await openApp(browser, {
    viewport: { width: VIDEO_WIDTH, height: PROBE_HEIGHT },
    theme: asset.theme ?? 'dark',
  });

  const noop = { begin() {}, end() {} };
  await asset.run(page, noop);

  const aspect = await tightenViewBox(page);
  const size   = await fitViewport(page, { aspect });
  const viewBox = aspect ? await currentViewBox(page) : null;
  await ctx.close();

  return {
    // Video dimensions must be even for h264 / yuv420p.
    size: { width: size.width - (size.width % 2), height: size.height - (size.height % 2) },
    viewBox,
  };
}

async function captureClip(browser, asset, ffmpegOk) {
  const { size, viewBox } = await rehearseClip(browser, asset);

  const ctx = await newCtx(browser, {
    viewport: size,
    deviceScaleFactor: 1,
    theme: asset.theme ?? 'dark',
    recordVideo: { dir: TMP, size },
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error(`    [JS] ${e.message}`));

  // Recording starts the moment the page opens, so time everything from here.
  const t0 = Date.now();
  const mark = {
    from: null, to: null,
    begin() { this.from = (Date.now() - t0) / 1000; },
    end()   { this.to   = (Date.now() - t0) / 1000; },
  };

  await page.goto(BASE);
  await page.waitForSelector('#chart svg', { timeout: 15_000 });
  if (viewBox) await tightenViewBox(page, 0, viewBox);
  if (asset.cursor) await injectCursor(page);
  await sleep(400);

  await asset.run(page, mark);
  if (mark.from === null) mark.from = 0;
  if (mark.to   === null) mark.to   = (Date.now() - t0) / 1000;

  const video = page.video();
  await ctx.close();                     // flushes the WebM to disk
  const webm = await video.path();

  const written = [];
  if (!ffmpegOk) {
    await rename(webm, join(OUT, `${asset.name}.webm`));
    written.push(`${asset.name}.webm (no ffmpeg — mp4/gif skipped)`);
    return written;
  }

  const from = Math.max(0, mark.from - 0.15);
  const dur  = Math.max(0.5, mark.to - from);

  // MP4 — for the blog post. yuv420p + faststart for broad compatibility.
  await run('ffmpeg', [
    '-y', '-ss', from.toFixed(2), '-t', dur.toFixed(2), '-i', webm,
    '-vf', `fps=30,scale=${size.width}:-2:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    join(OUT, `${asset.name}.mp4`),
  ]);
  written.push(`${asset.name}.mp4`);

  // GIF — for the README. Two-pass palette: stats_mode=diff weights colours
  // toward the parts of the frame that actually move rather than the large
  // flat background, and paletteuse's rectangle diff mode shrinks the file by
  // only redrawing changed regions. Dithering is off deliberately: the UI is
  // flat fills with no gradients to band, and turning it off cuts ~25% of the
  // file size that dither noise would otherwise add to every frame.
  if (asset.gif) {
    await run('ffmpeg', [
      '-y', '-ss', from.toFixed(2), '-t', dur.toFixed(2), '-i', webm,
      '-filter_complex',
      `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=128:stats_mode=diff[p];` +
      `[b][p]paletteuse=dither=none:diff_mode=rectangle`,
      '-loop', '0',
      join(OUT, `${asset.name}.gif`),
    ]);
    written.push(`${asset.name}.gif`);
  }

  return written;
}

// ── Main ────────────────────────────────────────────────────────────────────

let server, browser;
const summary = [];

try {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await mkdir(TMP, { recursive: true });

  const ffmpegOk = await hasFfmpeg();
  if (!ffmpegOk) console.warn('! ffmpeg not found — clips will be left as .webm\n');

  server = startServer();
  await waitForServer();

  browser = await chromium.launch({
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
  });

  const todo = ASSETS.filter(a => !only || a.name.includes(only));
  if (todo.length === 0) {
    console.error(`No asset matches --only "${only}". Try --list.`);
    process.exitCode = 1;
  }

  for (const asset of todo) {
    process.stdout.write(`> ${asset.name} ... `);
    const started = Date.now();
    try {
      const files = asset.kind === 'shot'
        ? await captureShot(browser, asset)
        : await captureClip(browser, asset, ffmpegOk);
      console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s) -> ${files.join(', ')}`);
      summary.push(...files.map(f => ({ file: f, caption: asset.caption })));
    } catch (e) {
      console.log('FAILED');
      console.error(`    ${e.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  if (browser) await browser.close();
  if (server)  server.kill();
  if (!keepWebm) await rm(TMP, { recursive: true, force: true });
}

if (summary.length) {
  console.log('\n-- Captured ------------------------------------');
  for (const { file, caption } of summary) {
    console.log(`  ${file.padEnd(30)} ${caption ?? ''}`);
  }
  console.log('\nOutput directory: docs/media/');
}
