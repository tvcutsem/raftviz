/**
 * 04_raft_init.js — "Raft 1/9 · Initialisation" scene.
 *
 * Shows the three-node cluster in its initial state: all nodes are followers
 * in term 0 with empty stable storage.  Walks through the initialisation
 * pseudocode, then shows the election timers starting.
 */

import { PseudocodePanel }     from '../pseudocode/pseudocode_layout.js';
import { HL }                  from '../pseudocode/pseudocode.js';
import { buildClusterScene,
         fadeInNodes }         from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

// ── Frame descriptor ─────────────────────────────────────────────────────────
export const frame04RaftInit = {
  id:    'raft-init',
  title: 'Raft 1/9 · Initialisation',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, inspViews } =
      buildClusterScene(layout);

    layout.setSubtitle('');

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Nodes appear
      .after(300, () => {
        fadeInNodes(nodeViews);
        layout.setSubtitle(
          'Three nodes start as <em>followers</em> in term 0 — stable storage is empty'
        );
      })

      // Highlight init pseudocode
      .after(700, () => {
        _panel.highlight(...HL.INIT);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 1 — each node initialises <em>currentTerm = 0</em>, ' +
          '<em>votedFor = null</em>, and an empty log'
        );
      })

      // Show election timers starting
      .after(400, () => {
        nodeViews.get('A').startElectionTimer(5500);
        nodeViews.get('B').startElectionTimer(7000);
        nodeViews.get('C').startElectionTimer(6200);
        _panel.highlight(...HL.TIMER_RESET);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Each node starts a randomised <em>election timer</em> — ' +
          'if no heartbeat arrives before it fires, an election begins'
        );
      })

      .after(0, () => player.next());
  },
};
