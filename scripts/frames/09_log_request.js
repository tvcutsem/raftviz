/**
 * 09_log_request.js — "Raft 6–7/9 · Followers Receive LogRequest" scene.
 *
 * A is leader in term 1 with one log entry.  Shows:
 *   1. A sends a LogRequest carrying the suffix to B and C.
 *   2. The logOk check on each follower (Slide 6).
 *   3. AppendEntries is called — entries slide into B and C's logs (Slide 7).
 *   4. Followers send LogResponse(success=true) back to the leader.
 */

import { PseudocodePanel }  from '../pseudocode/pseudocode_layout.js';
import { HL }               from '../pseudocode/pseudocode.js';
import { makeLogRequest,
         makeLogResponse }  from '../simulation/message.js';
import { buildClusterScene,
         fadeInNodes }      from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

const LATENCY = 750;   // ms for message dot travel

// ── The log entry being replicated ────────────────────────────────────────────
const ENTRY = { msg: 'SET x=1', term: 1 };

// ── Frame descriptor ──────────────────────────────────────────────────────────
export const frame09LogRequest = {
  id:    'raft-log-request',
  title: 'Raft 6–7/9 · Followers Receive LogRequest',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, logViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    // Pre-set cluster state: A is leader with one uncommitted log entry
    const aNode = cluster.getNode('A');
    aNode.currentTerm   = 1;
    aNode.currentRole   = 'leader';
    aNode.currentLeader = 'A';
    aNode.votedFor      = 'A';
    aNode.log           = [ENTRY];
    aNode.commitLength  = 0;
    aNode.sentLength.set('B', 0);
    aNode.sentLength.set('C', 0);
    aNode.ackedLength.set('A', 1);
    aNode.ackedLength.set('B', 0);
    aNode.ackedLength.set('C', 0);

    const bNode = cluster.getNode('B');
    bNode.currentTerm   = 1;
    bNode.votedFor      = 'A';
    bNode.currentLeader = 'A';

    const cNode = cluster.getNode('C');
    cNode.currentTerm   = 1;
    cNode.votedFor      = 'A';
    cNode.currentLeader = 'A';

    // The LogRequest A will send: prefixLen=0, suffix=[ENTRY], leaderCommit=0
    const logReq = makeLogRequest('A', 1, 0, 0, 0, [ENTRY]);

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Scene appears: A is leader with one log entry; B and C have empty logs
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').setRole('leader');
        logViews.get('A').setEntries(aNode.log, aNode.commitLength);
        inspViews.get('A').update(aNode);
        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'A is the <em>leader</em> — it has appended "SET x=1" to its log ' +
          'and now calls <em>ReplicateLog</em> for each follower'
        );
      })

      // LogRequest dots fly from A to B and C
      .after(400, () => {
        _panel.highlight(...HL.REPLICATE_SEND);
        msgLayer.send(logReq, nodeViews.get('A'), nodeViews.get('B'), LATENCY);
        msgLayer.send(logReq, nodeViews.get('A'), nodeViews.get('C'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 5: send LogRequest(prefixLen=0, suffix=[{msg:"SET x=1", term:1}], ' +
          'leaderCommit=0) to B and C'
        );
      })

      // LogRequest arrives — check logOk, call AppendEntries
      .after(LATENCY + 100, () => {
        _panel.highlight(...HL.LOG_REQUEST_OK);

        bNode.onReceiveLogRequest(logReq);
        cNode.onReceiveLogRequest(logReq);

        logViews.get('B').animateAppend(ENTRY);
        logViews.get('C').animateAppend(ENTRY);

        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 6: <em>logOk</em> = (log.length ≥ prefixLen=0) ∧ (prefixLen = 0) = true — ' +
          'AppendEntries is called, the entry is appended to each follower\'s log'
        );
      })

      // LogResponse dots fly back to leader
      .after(400, () => {
        _panel.highlight(...HL.LOG_REQUEST_OK);
        const bResp = makeLogResponse('B', 1, 1, true);
        const cResp = makeLogResponse('C', 1, 1, true);
        msgLayer.send(bResp, nodeViews.get('B'), nodeViews.get('A'), LATENCY);
        msgLayer.send(cResp, nodeViews.get('C'), nodeViews.get('A'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 6: <em>ack := prefixLen + suffix.length = 1</em> — ' +
          'LogResponse(ack=1, success=true) sent to the leader'
        );
      })

      .after(0, () => { player.next(); });
  },
};
