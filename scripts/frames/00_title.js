/**
 * Frame 00 — Title
 *
 * A splash screen showing the project name and subtitle.
 * Fades in, then waits for the user to continue.
 */

import { getTheme } from '../theme.js';

export const frame00Title = {
  id:    'title',
  title: 'Welcome',

  setup(layout, timeline, player) {
    const t  = getTheme();
    const cx = layout.scaleX(50);
    const cy = layout.scaleY(50);

    // ---- Draw title text ------------------------------------------------
    const titleText = layout.g.append('text')
      .attr('x', cx)
      .attr('y', layout.scaleY(40))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 72)           // viewBox user units (out of 1000×600)
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.04em')
      .attr('fill', t.text)
      .attr('opacity', 0)
      .text('RaftViz');

    const sub1 = layout.g.append('text')
      .attr('x', cx)
      .attr('y', layout.scaleY(53))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 22)
      .attr('fill', t.textMuted)
      .attr('opacity', 0)
      .text('A simulation of the Raft consensus algorithm');

    const sub2 = layout.g.append('text')
      .attr('x', cx)
      .attr('y', layout.scaleY(60))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 19)
      .attr('fill', t.textMuted)
      .attr('opacity', 0)
      .text("Based on M. Kleppmann's lecture notes on Concurrent and Distributed Systems (U Cambridge)");

    const hint = layout.g.append('text')
      .attr('x', cx)
      .attr('y', layout.scaleY(75))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 17)
      .attr('fill', t.textMuted)
      .attr('opacity', 0)
      .text('Use  ←  →  to navigate  ·  R to replay');

    // ---- Timeline -------------------------------------------------------
    timeline
      // Fade in main title
      .after(100, () => {
        titleText.transition().duration(700).attr('opacity', 1);
      })
      // Fade in first subtitle line
      .after(400, () => {
        sub1.transition().duration(600).attr('opacity', 1);
      })
      // Fade in second subtitle line
      .after(300, () => {
        sub2.transition().duration(600).attr('opacity', 1);
      })
      // Show keyboard hint + subtitle bar text, then pause
      .after(500, () => {
        hint.transition().duration(800).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle('Press <strong>→</strong> or click <strong>Continue</strong> to begin the walkthrough');
      })
      // Auto-advance: clicking Continue / pressing → brings the user to
      // the next scene immediately rather than leaving them on the title.
      .after(0, () => player.next());
  },
};
