/**
 * 12_playground_intro.js — Transition from guided walkthrough to live sandbox.
 *
 * Brief stepped intro to playground controls before #live-cluster starts.
 */

import { getTheme } from '../theme.js';

export const frame12PlaygroundIntro = {
  id:    'playground-intro',
  title: 'Live Playground',

  setup(layout, timeline, player) {
    const { scaleX: sx, scaleY: sy, g } = layout;
    const t = getTheme();

    const addLine = (yVirt, text, { size = 17, color = t.textMuted, weight = '400' } = {}) =>
      g.append('text')
        .attr('x', sx(50))
        .attr('y', sy(yVirt))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', size)
        .attr('font-weight', weight)
        .attr('fill', color)
        .attr('opacity', 0)
        .text(text);

    const heading = addLine(28, 'Live playground', { size: 32, weight: '700', color: t.text });
    const intro   = addLine(38, 'The guided walkthrough is complete — the cluster now runs on its own', { size: 18, color: t.textMuted });
    const line1   = addLine(48, 'Click a node to crash it (grey) · click again to recover as a follower', { size: 16 });
    const line2   = addLine(56, 'Drag from one node to another to add or remove a network partition', { size: 16 });
    const line3   = addLine(64, '↗ Send Request — inject SET x=N (replicated by the leader when one exists)', { size: 16 });
    const line4   = addLine(72, 'Speed slider — slow down (0.5×) or fast-forward (6×) the simulation', { size: 16 });
    const line5   = addLine(80, 'Wipe stable storage on crash — optional erase of term, vote, and log on crash', { size: 16 });
    const line6   = addLine(88, 'Pseudocode on the right still highlights in real time as events occur', { size: 16 });

    timeline
      .after(300, () => {
        heading.transition().duration(500).attr('opacity', 1);
        intro.transition().duration(500).delay(150).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'You are leaving the preset scenarios — next is a <em>free-running</em> three-node cluster'
        );
      })

      .after(400, () => {
        line1.transition().duration(400).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          '<strong>Click a node</strong> to crash or recover it — crashed nodes stop voting and replicating'
        );
      })

      .after(400, () => {
        line2.transition().duration(400).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          '<strong>Drag</strong> from one node to another to toggle a partition (dashed orange line) — ' +
          'messages between that pair are dropped'
        );
      })

      .after(400, () => {
        line3.transition().duration(400).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Use <strong>↗ Send Request</strong> in the control bar to append client commands to the log'
        );
      })

      .after(400, () => {
        line4.transition().duration(400).attr('opacity', 1);
        line5.transition().duration(400).delay(100).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Adjust <strong>Speed</strong> to study slowly, or enable <strong>Wipe stable storage on crash</strong> ' +
          'to simulate total disk loss'
        );
      })

      .after(400, () => {
        line6.transition().duration(400).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Press <strong>→</strong> or <strong>Continue</strong> to open the live cluster — experiment freely'
        );
      })

      .after(0, () => player.next());
  },
};
