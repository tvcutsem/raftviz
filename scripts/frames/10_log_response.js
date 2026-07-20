/**
 * 10_log_response.js — "Raft 8–9/9 · Leader Commits" scene.
 *
 * B and C have replicated the entry; their LogResponses are in flight.  Shows:
 *   1. LogResponse dots arrive at the leader (Slide 8).
 *   2. ackedLength is updated; CommitLogEntries() is called (Slide 9).
 *   3. The leader's log entry turns committed (dark green).
 *   4. The leader sends a heartbeat with leaderCommit=1 → followers commit.
 *   5. State machine output "x=1" appears at every node.
 */

import { PseudocodePanel }     from '../pseudocode/pseudocode_layout.js';
import { HL }                  from '../pseudocode/pseudocode.js';
import { makeLogRequest,
         makeLogResponse }     from '../simulation/message.js';
import { StateMachineView }    from '../layout/statemachine_layout.js';
import { buildClusterScene,
         fadeInNodes,
         NODE_R, BADGE_H, BLOCK_H, LOG_GAP } from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

const LATENCY = 750;
const ENTRY   = { msg: 'SET x=1', term: 1 };

// ── Frame descriptor ──────────────────────────────────────────────────────────
export const frame10LogResponse = {
  id:    'raft-log-response',
  title: 'Raft 8–9/9 · Leader Commits',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, logViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    // Pre-set state: A is leader with one uncommitted entry; B and C have the
    // same entry (replication succeeded in previous scene) but not yet committed.
    const aNode = cluster.getNode('A');
    aNode.currentTerm   = 1;
    aNode.currentRole   = 'leader';
    aNode.currentLeader = 'A';
    aNode.votedFor      = 'A';
    aNode.log           = [ENTRY];
    aNode.commitLength  = 0;
    aNode.sentLength.set('B', 1);
    aNode.sentLength.set('C', 1);
    aNode.ackedLength.set('A', 1);
    aNode.ackedLength.set('B', 0);
    aNode.ackedLength.set('C', 0);

    const bNode = cluster.getNode('B');
    bNode.currentTerm   = 1;
    bNode.votedFor      = 'A';
    bNode.currentLeader = 'A';
    bNode.log           = [ENTRY];
    bNode.commitLength  = 0;

    const cNode = cluster.getNode('C');
    cNode.currentTerm   = 1;
    cNode.votedFor      = 'A';
    cNode.currentLeader = 'A';
    cNode.log           = [ENTRY];
    cNode.commitLength  = 0;

    // LogResponse messages that B and C would have sent back
    const bResp = makeLogResponse('B', 1, 1, true);
    const cResp = makeLogResponse('C', 1, 1, true);

    // ── State machine views (below log entries) ───────────────────────────────
    const { scaleX: sx, scaleY: sy } = layout;
    const smViews = new Map();
    [['A', 50, 18], ['B', 22, 52], ['C', 78, 52]].forEach(([id, vx, vy]) => {
      const px      = sx(vx);
      const py      = sy(vy);
      const logTopY = py + NODE_R + BADGE_H + 14;
      const smTopY  = logTopY + BLOCK_H + LOG_GAP + 8;
      smViews.set(id, new StateMachineView(layout, px, smTopY));
    });

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Scene appears: all nodes with their uncommitted log entries
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').setRole('leader');
        logViews.get('A').setEntries(aNode.log, aNode.commitLength);
        logViews.get('B').setEntries(bNode.log, bNode.commitLength);
        logViews.get('C').setEntries(cNode.log, cNode.commitLength);
        inspViews.get('A').update(aNode);
        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B and C have replicated the entry — all three logs show the command, ' +
          'but nothing is <em>committed</em> yet at the leader'
        );
      })

      // LogResponse dots travel from B and C to A
      .after(400, () => {
        _panel.highlight(...HL.RECV_LOG_RESPONSE);
        msgLayer.send(bResp, nodeViews.get('B'), nodeViews.get('A'), LATENCY);
        msgLayer.send(cResp, nodeViews.get('C'), nodeViews.get('A'), LATENCY + 150);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          '<em>LogResponse(ack=1, success=true)</em> is in flight from B and C toward the leader'
        );
      })

      // B's response arrives: quorum reached → leader commits locally
      .after(LATENCY + 200, () => {
        const effB = aNode.onReceiveLogResponse(bResp);

        inspViews.get('A').update(aNode);
        logViews.get('A').setCommitLength(aNode.commitLength);

        if (effB.delivers.length > 0) {
          smViews.get('A').deliverMany(effB.delivers.map(e => e.msg));
        }

        _panel.highlight(...HL.LOG_RESPONSE_OK);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 8: B\'s ack arrives — <em>ackedLength[B] := 1</em>, ' +
          '<em>acks(1) = |{A, B}| = 2 ≥ ⌈(3+1)/2⌉ = 2</em> → CommitLogEntries() runs on the leader'
        );
      })

      // C's response (leader already committed; updates ackedLength only)
      .after(400, () => {
        aNode.onReceiveLogResponse(cResp);
        inspViews.get('A').update(aNode);
        _panel.highlight(...HL.COMMIT_LOG);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 9: <em>commitLength := 1</em> — the leader delivers "SET x=1" ' +
          'to its application.  Next heartbeat will carry <em>leaderCommit=1</em> to followers'
        );
      })

      // Heartbeat with leaderCommit=1 flies to B and C
      .after(400, () => {
        _panel.highlight(...HL.HEARTBEAT);
        const hbB = makeLogRequest('A', 1, 1, 1, aNode.commitLength, []);
        const hbC = makeLogRequest('A', 1, 1, 1, aNode.commitLength, []);
        msgLayer.send(hbB, nodeViews.get('A'), nodeViews.get('B'), LATENCY);
        msgLayer.send(hbC, nodeViews.get('A'), nodeViews.get('C'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'The leader sends a heartbeat carrying <em>leaderCommit=1</em> — ' +
          'followers will advance their own commitLength'
        );
      })

      // Heartbeat arrives — followers commit and deliver
      .after(LATENCY + 100, () => {
        const hb = makeLogRequest('A', 1, 1, 1, aNode.commitLength, []);
        const effB = bNode.onReceiveLogRequest(hb);
        const effC = cNode.onReceiveLogRequest(hb);

        logViews.get('B').setCommitLength(bNode.commitLength);
        logViews.get('C').setCommitLength(cNode.commitLength);

        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);

        if (effB.delivers.length > 0) {
          smViews.get('B').deliverMany(effB.delivers.map(e => e.msg));
        }
        if (effC.delivers.length > 0) {
          smViews.get('C').deliverMany(effC.delivers.map(e => e.msg));
        }

        _panel.highlight(...HL.APPEND_DELIVER);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 7: <em>leaderCommit &gt; commitLength</em> — followers deliver ' +
          '"SET x=1" to their application.  All three nodes now have <em>x=1</em>'
        );
      })

      .after(0, () => { player.next(); });
  },
};
