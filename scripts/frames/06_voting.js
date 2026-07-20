/**
 * 06_voting.js — "Raft 2/9 · Voting" scene.
 *
 * Node A is already a candidate in term 1.  VoteRequest messages fly to B
 * and C; both nodes evaluate the request and grant their votes.
 * Manually drives node.onReceiveVoteRequest() for each follower.
 */

import { PseudocodePanel }     from '../pseudocode/pseudocode_layout.js';
import { HL }                  from '../pseudocode/pseudocode.js';
import { makeVoteRequest }     from '../simulation/message.js';
import { buildClusterScene,
         fadeInNodes }         from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

const LATENCY = 800;   // ms for message dot travel

// ── Frame descriptor ─────────────────────────────────────────────────────────
export const frame06Voting = {
  id:    'raft-voting',
  title: 'Raft 2/9 · Voting',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    // Pre-set A to candidate state (election already fired)
    const aNode = cluster.getNode('A');
    aNode.currentTerm    = 1;
    aNode.currentRole    = 'candidate';
    aNode.votedFor       = 'A';
    aNode.votesReceived  = new Set(['A']);

    // Construct the VoteRequest A would have sent
    const voteReq = makeVoteRequest('A', 1, aNode.log.length, 0);

    // Stored responses for delivery step
    let _bResp = null;
    let _cResp = null;

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Scene appears: A is already candidate
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').setRole('candidate');
        inspViews.get('A').update(aNode);
        layout.setSubtitle(
          'Node A is now a <em>candidate</em> in term 1 — it sends a ' +
          'VoteRequest to every peer'
        );
      })

      // VoteRequest dots fly from A to B and C
      .after(700, () => {
        _panel.highlight(...HL.VOTE_REQ_SEND);
        msgLayer.send(voteReq, nodeViews.get('A'), nodeViews.get('B'), LATENCY);
        msgLayer.send(voteReq, nodeViews.get('A'), nodeViews.get('C'), LATENCY);
        layout.setSubtitle(
          '<em>VoteRequest(cTerm=1, cLogLength=0)</em> is in flight to B and C'
        );
      })

      // B receives VoteRequest → highlight check logic; pause here so the
      // student can read the evaluation before seeing the outcome
      .after(LATENCY + 100, () => {
        _panel.highlight(...HL.RECV_VOTE_REQUEST);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B receives VoteRequest — checks <em>cTerm = currentTerm</em> ' +
          'and log freshness (logOk)'
        );
      })

      // B grants vote, sends VoteResponse; pause so the student can see the
      // response dot in flight and read what B decided
      .after(700, () => {
        const bNode  = cluster.getNode('B');
        const result = bNode.onReceiveVoteRequest(voteReq);
        _bResp = result.sends[0]?.msg;   // VoteResponse back to A
        inspViews.get('B').update(bNode);

        _panel.highlight(...HL.GRANT_VOTE);
        if (_bResp) {
          msgLayer.send(_bResp, nodeViews.get('B'), nodeViews.get('A'), LATENCY);
        }
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B grants the vote — <em>votedFor ← A</em>, sends VoteResponse(granted=true)'
        );
      })

      // C receives and also grants; pause with a subtitle that captures
      // both C's evaluation and the overall outcome
      .after(500, () => {
        const cNode  = cluster.getNode('C');
        const result = cNode.onReceiveVoteRequest(voteReq);
        _cResp = result.sends[0]?.msg;
        inspViews.get('C').update(cNode);

        _panel.highlight(...HL.GRANT_VOTE);
        if (_cResp) {
          msgLayer.send(_cResp, nodeViews.get('C'), nodeViews.get('A'), LATENCY);
        }
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'C evaluates the same request — <em>logOk</em> passes, C also grants. ' +
          'Both VoteResponses are now in flight toward A'
        );
      })

      .after(0, () => player.next());
  },
};
