/**
 * 07_leader.js — "Raft 3/9 · Becoming Leader" scene.
 *
 * A is a candidate with one vote (self).  VoteResponse messages from B and C
 * arrive; the first response gives A a quorum → it becomes leader and
 * immediately sends heartbeat LogRequests to all peers.
 */

import { PseudocodePanel }              from '../pseudocode/pseudocode_layout.js';
import { HL }                           from '../pseudocode/pseudocode.js';
import { makeVoteResponse,
         makeLogRequest }               from '../simulation/message.js';
import { buildClusterScene,
         fadeInNodes }                  from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

const LATENCY = 800;   // ms for message dot travel

// ── Frame descriptor ─────────────────────────────────────────────────────────
export const frame07Leader = {
  id:    'raft-leader',
  title: 'Raft 3/9 · Becoming Leader',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    // Pre-set A as candidate, B and C having already granted their votes
    const aNode = cluster.getNode('A');
    aNode.currentTerm   = 1;
    aNode.currentRole   = 'candidate';
    aNode.votedFor      = 'A';
    aNode.votesReceived = new Set(['A']);

    const bNode = cluster.getNode('B');
    bNode.currentTerm = 1;
    bNode.votedFor    = 'A';

    const cNode = cluster.getNode('C');
    cNode.currentTerm = 1;
    cNode.votedFor    = 'A';

    // Construct the VoteResponse messages B and C would have sent
    const bResp = makeVoteResponse('B', 1, true);
    const cResp = makeVoteResponse('C', 1, true);

    let _heartbeatSends = null;

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Scene appears: A is candidate, B/C are followers
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').setRole('candidate');
        inspViews.get('A').update(aNode);
        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'A is a <em>candidate</em> in term 1 — it has cast its own vote and is waiting for peers'
        );
      })

      // VoteResponse dots fly from B and C toward A
      .after(400, () => {
        _panel.highlight(...HL.RECV_VOTE_RESPONSE);
        msgLayer.send(bResp, nodeViews.get('B'), nodeViews.get('A'), LATENCY);
        msgLayer.send(cResp, nodeViews.get('C'), nodeViews.get('A'), LATENCY + 200);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          '<em>VoteResponse(granted=true)</em> is in flight from B and C toward A'
        );
      })

      // B's VoteResponse arrives first → A reaches quorum and becomes leader
      .after(LATENCY + 200, () => {
        const { sends } = aNode.onReceiveVoteResponse(bResp);
        _heartbeatSends = sends;

        nodeViews.get('A').transitionRole('leader');
        inspViews.get('A').update(aNode);

        _panel.highlight(...HL.BECOME_LEADER);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B\'s vote arrives — A has {self, B} = 2 votes, quorum reached! ' +
          '<em>role → leader</em>; sentLength and ackedLength are initialised'
        );
      })

      // Leader sends initial heartbeat LogRequests
      .after(400, () => {
        _panel.highlight(...HL.HEARTBEAT);
        for (const { msg, toId } of _heartbeatSends) {
          if (toId !== 'A') {
            msgLayer.send(msg, nodeViews.get('A'), nodeViews.get(toId), LATENCY);
          }
        }
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 4 — the new leader immediately sends <em>LogRequest</em> heartbeats ' +
          '(empty suffix) to every follower'
        );
      })

      // Heartbeats arrive; followers reset election timers
      .after(LATENCY + 100, () => {
        const heartbeat = makeLogRequest('A', 1, 0, 0, 0, []);
        bNode.onReceiveLogRequest(heartbeat);
        cNode.onReceiveLogRequest(heartbeat);
        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);

        nodeViews.get('B').resetElectionTimer();
        nodeViews.get('C').resetElectionTimer();

        _panel.highlight(...HL.HEARTBEAT);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Heartbeats arrive at B and C — election timers reset, ' +
          '<em>currentLeader ← A</em>'
        );
      })

      .after(0, () => player.next());
  },
};
