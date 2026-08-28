/**
 * 03_state_diagram.js — "Role Transitions" scene.
 *
 * Draws the Raft role state-machine diagram (Follower / Candidate / Leader)
 * with animated reveal of each transition arrow, synchronised with pseudocode
 * highlights.
 *
 * The diagram mirrors the lecture's state-machine slide one-to-one: the two
 * ways a node enters the follower state (fresh start-up and crash recovery,
 * which are separate `on …` blocks on slide 1), the three role changes, and
 * the candidate's election-timeout self-loop. Each arrow highlights the
 * pseudocode that actually implements it — note that a *leader* steps down via
 * slide 8, not slide 3.
 *
 * No cluster simulation runs here — this is a pure annotated diagram.
 */

import { PseudocodePanel } from '../pseudocode/pseudocode_layout.js';
import { HL }              from '../pseudocode/pseudocode.js';
import { getTheme }        from '../theme.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

// ── Circle geometry (SVG viewBox 0 0 1000 600) ───────────────────────────────
const R   = 58;   // circle radius
const CY  = 300;  // circle centre y
const FX  = 235;  // Follower  cx
const CX  = 515;  // Candidate cx
const LX  = 795;  // Leader    cx

const LINE_DY = 16;   // label line height — 1.15em at font-size 14

// ── Frame descriptor ─────────────────────────────────────────────────────────
export const frame03StateDiagram = {
  id:    'state-diagram',
  title: 'Role Transitions',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    const th = getTheme();
    const COL_FOLLOWER  = th.follower;
    const COL_CANDIDATE = th.candidate;
    const COL_LEADER    = th.leader;

    // ── SVG defs: arrowhead markers ───────────────────────────────────────────
    // The defs live on layout.svg, *outside* the root <g>, so layout.clear()
    // never removes them — hence the explicit remove before re-creating. A
    // theme toggle replays the frame, and stale markers would keep the old
    // colours because url(#id) resolves to the first match in the document.
    const svgSel = layout.svg;
    const defsId = 'state-diagram-defs';
    svgSel.select(`#${defsId}`).remove();   // clean up if replaying
    const defs = svgSel.insert('defs', ':first-child').attr('id', defsId);

    // Each edge is coloured by the role it leads *to*; the crash-recovery edge
    // uses the same grey node_layout.js paints a crashed node with.
    const ARROW_COLORS = {
      blue:   th.follower,
      orange: th.candidate,
      green:  th.leader,
      crash:  th.stopped,
      gray:   th.arrowGray,   // fallback only
    };
    Object.entries(ARROW_COLORS).forEach(([key, fill]) => {
      defs.append('marker')
        .attr('id',          `arr-${key}`)
        .attr('markerWidth',  9)
        .attr('markerHeight', 9)
        .attr('refX',         7)
        .attr('refY',         3)
        .attr('orient',       'auto')
        .append('polygon')
          .attr('points', '0 0, 8 3, 0 6')
          .attr('fill', fill);
    });

    const g = layout.g;

    // ── Heading ───────────────────────────────────────────────────────────────
    g.append('text')
      .attr('x', 500).attr('y', 48)
      .attr('text-anchor', 'middle')
      .attr('font-size', 26).attr('font-weight', 700)
      .attr('fill', 'var(--text)')
      .attr('opacity', 0)
      .text('Raft role state machine')
      .transition().duration(600).attr('opacity', 1);

    // ── Helper: draw a circle+label (starts invisible) ────────────────────────
    function makeCircle(cx, cy, color, label) {
      const grp = g.append('g').attr('opacity', 0);
      grp.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', R)
        .attr('fill', color).attr('fill-opacity', 0.18)
        .attr('stroke', color).attr('stroke-width', 3);
      grp.append('text')
        .attr('x', cx).attr('y', cy + 6)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('font-size', 20).attr('font-weight', 700)
        .attr('fill', color)
        .text(label);
      return grp;
    }

    const circleF = makeCircle(FX, CY, COL_FOLLOWER,  'Follower');
    const circleC = makeCircle(CX, CY, COL_CANDIDATE, 'Candidate');
    const circleL = makeCircle(LX, CY, COL_LEADER,    'Leader');

    // ── Helper: multi-line SVG label ──────────────────────────────────────────
    // The lecture slide wraps its edge labels; ours have to as well or they
    // collide with the circles. `lines` may be a string or an array of lines.
    function makeLabel(parent, lines, x, y, color, anchor = 'middle') {
      const arr = Array.isArray(lines) ? lines : [lines];
      const t = parent.append('text')
        .attr('x', x).attr('y', y)
        .attr('text-anchor', anchor)
        .attr('font-size', 14)
        .attr('fill', color);
      t.selectAll('tspan')
        .data(arr)
        .join('tspan')
          .attr('x', x)                                   // must repeat per line
          .attr('dy', (_, i) => (i === 0 ? 0 : LINE_DY))  // first line: no shift
          .text(d => d);
      return t;
    }

    // ── Helper: draw a labelled arrow (starts invisible) ──────────────────────
    // Path endpoints sit ~R+6 from the target centre: the markers inherit
    // markerUnits="strokeWidth" (2.5), so the arrowhead tip renders 2.5 user
    // units *past* the path endpoint.
    function makeArrow(d, key, lines, labelX, labelY, anchor = 'middle') {
      const col = ARROW_COLORS[key] ?? th.arrowGray;
      const grp = g.append('g').attr('class', 'transition-arrow').attr('opacity', 0);
      grp.append('path')
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', col)
        .attr('stroke-width', 2.5)
        .attr('marker-end', `url(#arr-${key})`);
      makeLabel(grp, lines, labelX, labelY, col, anchor);
      return grp;
    }

    // → F  (fresh start-up, entering from the upper left)
    const arrowInit = makeArrow(
      'M 95,175  L 187,257',
      'blue',
      ['starts up'],
      90, 160,
    );
    // → F  (crash recovery, entering from the lower left)
    const arrowRecover = makeArrow(
      'M 95,425  L 187,343',
      'crash',
      ['recovers from', 'crash'],
      90, 448,
    );
    // F → C  (above, going right)
    const arrowFC = makeArrow(
      'M 294,288  L 452,288',
      'orange',
      ['suspects leader', 'failure'],
      373, 250,
    );
    // C → L  (above, going right)
    const arrowCL = makeArrow(
      'M 574,288  L 732,288',
      'green',
      ['receives votes', 'from quorum'],
      653, 250,
    );
    // C → F  (below, going left)
    const arrowCF = makeArrow(
      'M 456,312  L 298,312',
      'blue',
      ['discovers', 'new term'],
      377, 332,
    );
    // C → C  (self-loop above the candidate; a cubic so the head lands radially)
    const arrowCC = makeArrow(
      'M 487,249  C 430,150 600,150 545,244',
      'orange',
      ['election', 'times out'],
      515, 144,
    );
    // L → F  (large arc below all circles, into the follower's lower right)
    const arrowLF = makeArrow(
      'M 795,362  C 800,480 340,470 272,352',
      'blue',
      ['discovers', 'new term'],
      515, 466,
    );

    // ── Subtitle on load ──────────────────────────────────────────────────────
    layout.setSubtitle('Every Raft node is always in exactly one of three roles');

    /** Fade one arrow in. */
    const reveal = (arrow, delay = 0) =>
      arrow.transition().duration(500).delay(delay).attr('opacity', 1);

    // ── Timeline steps ────────────────────────────────────────────────────────
    timeline
      // Step 1: fade in all three circles
      .after(400, () => {
        circleF.transition().duration(600).attr('opacity', 1);
        circleC.transition().duration(600).delay(150).attr('opacity', 1);
        circleL.transition().duration(600).delay(300).attr('opacity', 1);
        _panel.clear();
      })
      .waitForResume(() => {
        layout.setSubtitle('Every Raft node is always in exactly one of three roles');
      })

      // Step 2: entering the state machine — fresh start-up
      .after(300, () => {
        reveal(arrowInit);
        _panel.highlight(...HL.INIT);
      })
      .waitForResume(() => {
        layout.setSubtitle('A node that <em>starts up</em> begins as a follower — slide 1 initialises all of its state');
      })

      // Step 3: entering the state machine — crash recovery
      .after(300, () => {
        reveal(arrowRecover);
        _panel.highlight(...HL.RECOVERY);
      })
      .waitForResume(() => {
        layout.setSubtitle('After a <em>crash</em> it comes back as a follower again — currentTerm, votedFor, log and commitLength survive; the role and the volatile state do not');
      })

      // Step 4: election timeout — follower becomes candidate
      .after(300, () => {
        reveal(arrowFC);
        _panel.highlight(...HL.ELECTION_TIMEOUT);
      })
      .waitForResume(() => {
        layout.setSubtitle('A follower that <em>suspects the leader failed</em> bumps its term and becomes a candidate');
      })

      // Step 5: quorum of votes — candidate becomes leader
      .after(300, () => {
        reveal(arrowCL);
        _panel.highlight(...HL.BECOME_LEADER);
      })
      .waitForResume(() => {
        layout.setSubtitle('A candidate with <em>votes from a quorum</em> becomes the leader — slide 3');
      })

      // Step 6: candidate step-down
      .after(300, () => {
        reveal(arrowCF);
        _panel.highlight(...HL.STEP_DOWN_3);
      })
      .waitForResume(() => {
        layout.setSubtitle('A candidate that <em>discovers a new term</em> abandons its election and steps back down — slide 3 (slide 2 does the same on a VoteRequest)');
      })

      // Step 7: split vote — candidate retries in a higher term
      .after(300, () => {
        reveal(arrowCC);
        _panel.highlight(...HL.ELECTION_RETRY);
      })
      .waitForResume(() => {
        layout.setSubtitle('If the <em>election times out</em> with no winner, the candidate simply retries in a higher term — the very same handler as the follower’s timeout');
      })

      // Step 8: leader step-down — slide 8, not slide 3
      .after(300, () => {
        reveal(arrowLF);
        _panel.highlight(...HL.STEP_DOWN_8);
      })
      .waitForResume(() => {
        layout.setSubtitle('Even a <em>leader</em> steps down the moment it discovers a new term — here from a LogResponse (slide 8); a LogRequest from the new leader (slide 6) has the same effect');
      })

      .after(0, () => player.next());
  },
};
