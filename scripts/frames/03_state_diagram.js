/**
 * 03_state_diagram.js — "Role Transitions" scene.
 *
 * Draws the Raft role state-machine diagram (Follower / Candidate / Leader)
 * with animated reveal of each transition arrow, synchronised with pseudocode
 * highlights.
 *
 * No cluster simulation runs here — this is a pure annotated diagram.
 */

import d3                  from '../lib/d3.js';
import { PseudocodePanel } from '../pseudocode/pseudocode_layout.js';
import { HL }              from '../pseudocode/pseudocode.js';
import { getTheme }        from '../theme.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

// ── Circle geometry (SVG viewBox 0 0 1000 600) ───────────────────────────────
const R   = 62;   // circle radius
const CY  = 270;  // circle centre y
const FX  = 175;  // Follower  cx
const CX  = 500;  // Candidate cx
const LX  = 825;  // Leader    cx

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
    const svgSel = layout.svg;
    const defsId = 'state-diagram-defs';
    svgSel.select(`#${defsId}`).remove();   // clean up if replaying
    const defs = svgSel.insert('defs', ':first-child').attr('id', defsId);

    const ARROW_COLORS = {
      gray:   th.arrowGray,
      orange: th.candidate,
      green:  th.leader,
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

    // ── Helper: draw a labelled arrow (starts invisible) ──────────────────────
    function makeArrow(d, color, key, labelTxt, labelX, labelY, anchor = 'middle') {
      const grp = g.append('g').attr('opacity', 0);
      grp.append('path')
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', ARROW_COLORS[key] ?? '#8892a4')
        .attr('stroke-width', 2.5)
        .attr('marker-end', `url(#arr-${key})`);
      grp.append('text')
        .attr('x', labelX).attr('y', labelY)
        .attr('text-anchor', anchor)
        .attr('font-size', 14)
        .attr('fill', ARROW_COLORS[key] ?? '#8892a4')
        .text(labelTxt);
      return grp;
    }

    // F → C  (above, going right)
    const arrowFC = makeArrow(
      `M ${FX + R},${CY - 12}  L ${CX - R - 8},${CY - 12}`,
      COL_CANDIDATE, 'orange',
      'election timeout',
      (FX + CX) / 2, CY - 20,
    );
    // C → F  (below, going left)
    const arrowCF = makeArrow(
      `M ${CX - R},${CY + 12}  L ${FX + R + 8},${CY + 12}`,
      'gray', 'gray',
      'higher term seen',
      (FX + CX) / 2, CY + 30,
    );
    // C → L  (above, going right)
    const arrowCL = makeArrow(
      `M ${CX + R},${CY - 12}  L ${LX - R - 8},${CY - 12}`,
      COL_LEADER, 'green',
      'majority of votes',
      (CX + LX) / 2, CY - 20,
    );
    // L → F  (large arc below all circles)
    const arrowLF = makeArrow(
      `M ${LX},${CY + R + 2}  Q 500,430 ${FX},${CY + R + 2}`,
      'gray', 'gray',
      'higher term seen',
      500, 435,
    );

    // ── Subtitle on load ──────────────────────────────────────────────────────
    layout.setSubtitle('Every Raft node is always in exactly one of three roles');

    // ── Timeline steps ────────────────────────────────────────────────────────
    timeline
      // Step 1: fade in all three circles
      .after(400, () => {
        circleF.transition().duration(600).attr('opacity', 1);
        circleC.transition().duration(600).delay(150).attr('opacity', 1);
        circleL.transition().duration(600).delay(300).attr('opacity', 1);
        _panel.highlight(...HL.INIT);
      })
      .waitForResume(() => {
        layout.setSubtitle('On startup every node is a <em>follower</em> — slide 1 shows how it initialises');
      })

      // Step 2: election timeout arrow + candidate highlight
      .after(300, () => {
        arrowFC.transition().duration(500).attr('opacity', 1);
        _panel.highlight(...HL.ELECTION_TIMEOUT);
      })
      .waitForResume(() => {
        layout.setSubtitle('If no heartbeat arrives the election timer fires — the follower becomes a <em>candidate</em>');
      })

      // Step 3: quorum arrow + become-leader highlight
      .after(300, () => {
        arrowCL.transition().duration(500).attr('opacity', 1);
        _panel.highlight(...HL.BECOME_LEADER);
      })
      .waitForResume(() => {
        layout.setSubtitle('A candidate that receives a majority of votes becomes the <em>leader</em> — slide 3');
      })

      // Step 4: step-down arrows
      .after(300, () => {
        arrowCF.transition().duration(500).attr('opacity', 1);
        arrowLF.transition().duration(500).delay(200).attr('opacity', 1);
        _panel.highlight(...HL.STEP_DOWN_3);
      })
      .waitForResume(() => {
        layout.setSubtitle('Any node that sees a higher term immediately steps back down to <em>follower</em>');
      })

      .after(0, () => player.next());
  },
};
