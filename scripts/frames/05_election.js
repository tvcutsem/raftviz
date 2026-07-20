/**
 * 05_election.js — "Raft 1/9 · Election Timeout" scene.
 *
 * Node A's election timer fires: it increments its term, transitions to
 * candidate, votes for itself, and broadcasts VoteRequest to all peers.
 * Manually drives the simulation — no Scheduler involved.
 */

import { PseudocodePanel }     from '../pseudocode/pseudocode_layout.js';
import { HL }                  from '../pseudocode/pseudocode.js';
import { buildClusterScene,
         fadeInNodes }         from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

// Duration of A's "about to fire" timer animation (ms)
const TIMER_MS = 2200;
// Latency for the VoteRequest animation dots (ms)
const LATENCY  = 750;

// ── Frame descriptor ─────────────────────────────────────────────────────────
export const frame05Election = {
  id:    'raft-election',
  title: 'Raft 1/9 · Election Timeout',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, logViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    let _sends = null;   // populated when election fires

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Nodes appear; A's timer is close to zero, others have longer timers
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').startElectionTimer(TIMER_MS);
        nodeViews.get('B').startElectionTimer(TIMER_MS + 3500);
        nodeViews.get('C').startElectionTimer(TIMER_MS + 4800);
        layout.setSubtitle(
          'Election timers are counting down — Node A\'s timer is nearest to expiry'
        );
      })

      // A's timer fires
      .after(TIMER_MS + 200, () => {
        nodeViews.get('A').stopElectionTimer();

        // Drive the simulation
        const aNode = cluster.getNode('A');
        const { sends } = aNode.onElectionTimeout();
        _sends = sends;

        // Visual update
        nodeViews.get('A').transitionRole('candidate');
        inspViews.get('A').update(aNode);

        _panel.highlight(...HL.ELECTION_TIMEOUT);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Node A\'s timer fired — <em>currentTerm → 1</em>, ' +
          '<em>role → candidate</em>, votes for itself'
        );
      })

      // Send VoteRequests to B and C
      .after(400, () => {
        _panel.highlight(...HL.VOTE_REQ_SEND);
        // sends contains one entry per node (including self); skip A→A
        for (const { msg, toId } of _sends) {
          if (toId !== 'A') {
            msgLayer.send(
              msg,
              nodeViews.get('A'),
              nodeViews.get(toId),
              LATENCY,
            );
          }
        }
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'A broadcasts <em>VoteRequest(term=1, cLogLength=0)</em> to B and C — ' +
          'the message carries A\'s term and log state'
        );
      })

      .after(0, () => player.next());
  },
};
