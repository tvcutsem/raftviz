/**
 * Frame 01 — Overview / smoke-test
 *
 * Demonstrates three core mechanics used throughout the scenes:
 *   1. Timed sequential steps
 *   2. waitForResume pause + resume
 *   3. SVG drawing and D3 transitions
 *
 * This frame also previews the visual vocabulary (a cluster of nodes) used by
 * the later scenes.
 */

import { getTheme } from '../theme.js';

export const frame01Overview = {
  id:    'overview',
  title: 'Overview',

  setup(layout, timeline, player) {
    const { scaleX: sx, scaleY: sy, g } = layout;
    const t = getTheme();

    // ---- Helper: append a labelled text block ---------------------------
    const addLine = (yVirt, text, { size = 20, color = t.text, weight = '400' } = {}) => {
      return g.append('text')
        .attr('x', sx(50))
        .attr('y', sy(yVirt))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', size)            // viewBox user units
        .attr('font-weight', weight)
        .attr('fill', color)
        .attr('opacity', 0)
        .text(text);
    };

    // ---- Draw a small placeholder cluster of 3 circles ------------------
    const nodePositions = [
      { x: 50, y: 25, label: 'A' },
      { x: 39, y: 43, label: 'B' },
      { x: 61, y: 43, label: 'C' },
    ];

    const nodeGroup = g.append('g').attr('class', 'preview-nodes').attr('opacity', 0);

    nodePositions.forEach(({ x, y, label }) => {
      nodeGroup.append('circle')
        .attr('cx', sx(x))
        .attr('cy', sy(y))
        .attr('r', 38)             // viewBox user units (~38/1000 of viewBox width)
        .attr('fill', t.follower)
        .attr('stroke', 'none');

      nodeGroup.append('text')
        .attr('x', sx(x))
        .attr('y', sy(y))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 20)
        .attr('font-weight', '700')
        .attr('fill', t.nodeLabel)
        .text(label);
    });

    // ---- Static text lines ---------------------------------------------
    const heading = addLine(60, 'What you will see', { size: 30, weight: '700', color: t.text });
    const line1   = addLine(70, 'Each node runs the exact Raft pseudocode from the lecture slides', { size: 17, color: t.textMuted });
    const line2   = addLine(77, 'The active pseudocode lines highlight in real time as the algorithm runs', { size: 17, color: t.textMuted });
    const line3   = addLine(84, 'A live playground lets you crash nodes, add partitions, and send requests', { size: 17, color: t.textMuted });

    // ---- Timeline -------------------------------------------------------
    timeline
      // Step 1 — show heading
      .after(200, () => {
        layout.setSubtitle('Here is a preview of the three-node cluster you\'ll work with');
        heading.transition().duration(500).attr('opacity', 1);
      })

      // Step 2 — animate the cluster in
      .after(600, () => {
        nodeGroup.transition().duration(700).attr('opacity', 1);
      })

      // Step 3 — lines of text appear one by one
      .after(700, () => {
        line1.transition().duration(400).attr('opacity', 1);
      })
      .after(350, () => {
        line2.transition().duration(400).attr('opacity', 1);
      })
      .after(350, () => {
        line3.transition().duration(400).attr('opacity', 1);
      })

      // Step 4 — pause and wait for user
      .after(500, () => {})
      .waitForResume(() => {
        layout.setSubtitle('Ready?  Press <strong>→</strong> or click <strong>Continue</strong> to enter the walkthrough');
      })
      .after(0, () => player.next());
  },
};
