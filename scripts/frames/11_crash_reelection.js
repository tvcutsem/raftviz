/**
 * 11_crash_reelection.js — "Leader Crash & Re-election" scene.
 *
 * A is leader mid-replication: it has replicated the entry to B but not yet
 * to C.  A crashes before committing.  Shows:
 *   1. A grays out — the election timer on B and C begins to run down.
 *   2. B's timer fires first → B calls onElectionTimeout() (term 2).
 *   3. VoteRequest(B, term=2, logLength=1, logTerm=1) flies to A and C.
 *      A is down — only C responds.
 *   4. C evaluates logOk: cLogTerm=1 > lastTerm=0 (C's log is empty)
 *      → C grants the vote.  Narration highlights WHY B wins: its log is
 *      more up-to-date than C's.
 *   5. B receives C's VoteResponse → quorum (self + C) → becomes new leader.
 *   6. B sends a heartbeat LogRequest to A and C in term 2.
 */

import { PseudocodePanel }     from '../pseudocode/pseudocode_layout.js';
import { HL }                  from '../pseudocode/pseudocode.js';
import { makeVoteRequest,
         makeVoteResponse,
         makeLogRequest }      from '../simulation/message.js';
import { buildClusterScene,
         fadeInNodes }         from './_cluster_helpers.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

const LATENCY       = 750;
const TIMER_B_MS    = 2000;   // B's election timer (fires first)
const TIMER_C_MS    = 2600;   // C's election timer

// ── Frame descriptor ──────────────────────────────────────────────────────────
export const frame11CrashReelection = {
  id:    'raft-crash-reelection',
  title: 'Leader Crash & Re-election',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, logViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    const ENTRY = { msg: 'SET x=1', term: 1 };

    const aNode = cluster.getNode('A');
    aNode.currentTerm   = 1;
    aNode.currentRole   = 'leader';
    aNode.currentLeader = 'A';
    aNode.votedFor      = 'A';
    aNode.log           = [ENTRY];
    aNode.commitLength  = 0;
    aNode.sentLength.set('B', 1);
    aNode.sentLength.set('C', 0);
    aNode.ackedLength.set('A', 1);
    aNode.ackedLength.set('B', 1);
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

    const voteReq = () => {
      const lastTerm = bNode.log.length > 0 ? bNode.log[bNode.log.length - 1].term : 0;
      return makeVoteRequest('B', 2, bNode.log.length, lastTerm);
    };

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Scene appears: A is leader, B has the entry, C has an empty log
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').setRole('leader');
        logViews.get('A').setEntries(aNode.log, aNode.commitLength);
        logViews.get('B').setEntries(bNode.log, bNode.commitLength);
        inspViews.get('A').update(aNode);
        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'A is <em>leader</em> mid-replication — B has the entry, C does not yet. ' +
          'The entry is <em>uncommitted</em> (no quorum ack)'
        );
      })

      // A crashes; B and C start election timers
      .after(400, () => {
        nodeViews.get('A').stopElectionTimer();
        nodeViews.get('A').transitionRole('stopped');
        aNode.recoverFromCrash();
        inspViews.get('A').update(aNode);

        nodeViews.get('B').startElectionTimer(TIMER_B_MS);
        nodeViews.get('C').startElectionTimer(TIMER_C_MS);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          '<em>A crashes</em> — the entry was never committed. ' +
          'With no heartbeats, B and C\'s election timers are counting down'
        );
      })

      // B's timer fires first → new election in term 2
      .after(TIMER_B_MS + 200, () => {
        nodeViews.get('B').stopElectionTimer();
        nodeViews.get('C').stopElectionTimer();

        bNode.onElectionTimeout();

        nodeViews.get('B').transitionRole('candidate');
        inspViews.get('B').update(bNode);

        _panel.highlight(...HL.ELECTION_TIMEOUT);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B\'s timer fires first — B increments to <em>term 2</em> and becomes a ' +
          '<em>candidate</em> (log length 1, last term 1)'
        );
      })

      // VoteRequest dots fly from B to A (crashed) and C
      .after(400, () => {
        _panel.highlight(...HL.VOTE_REQ_SEND);
        const req = voteReq();
        msgLayer.send(req, nodeViews.get('B'), nodeViews.get('A'), LATENCY);
        msgLayer.send(req, nodeViews.get('B'), nodeViews.get('C'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          '<em>VoteRequest(term=2, cLogLength=1, cLogTerm=1)</em> sent to A (no reply) and C'
        );
      })

      // C receives VoteRequest → show the evaluation step before the decision
      .after(LATENCY + 100, () => {
        _panel.highlight(...HL.RECV_VOTE_REQUEST);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'C receives <em>VoteRequest(term=2, cLogLength=1, cLogTerm=1)</em> — ' +
          'checking <em>logOk</em>: is B\'s log at least as up-to-date as C\'s?'
        );
      })

      // C grants the vote; inspector updates to show votedFor ← B
      .after(600, () => {
        cNode.onReceiveVoteRequest(voteReq());
        inspViews.get('C').update(cNode);

        _panel.highlight(...HL.GRANT_VOTE);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'C grants the vote — B\'s <em>cLogTerm=1</em> beats C\'s empty log (<em>lastTerm=0</em>), ' +
          'so <em>logOk = true</em>. <em>votedFor ← B</em>'
        );
      })

      // VoteResponse flies from C to B
      .after(400, () => {
        const voteResp = makeVoteResponse('C', 2, true);
        msgLayer.send(voteResp, nodeViews.get('C'), nodeViews.get('B'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'C sends <em>VoteResponse(granted=true)</em> to B'
        );
      })

      // B receives C's vote → quorum → becomes leader
      .after(LATENCY + 100, () => {
        const voteResp = makeVoteResponse('C', 2, true);
        bNode.onReceiveVoteResponse(voteResp);
        nodeViews.get('B').transitionRole('leader');
        inspViews.get('B').update(bNode);

        _panel.highlight(...HL.BECOME_LEADER);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B receives C\'s vote — <em>|votesReceived| = 2 ≥ ⌈(3+1)/2⌉ = 2</em>. ' +
          'B becomes the new <em>leader</em> in term 2'
        );
      })

      // B sends heartbeat / replication LogRequests
      .after(400, () => {
        _panel.highlight(...HL.HEARTBEAT);
        const hbC = makeLogRequest('B', 2, 0, 0, 0, [ENTRY]);
        const hbA = makeLogRequest('B', 2, 1, 1, 0, []);
        msgLayer.send(hbC, nodeViews.get('B'), nodeViews.get('C'), LATENCY);
        msgLayer.send(hbA, nodeViews.get('B'), nodeViews.get('A'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'B (new leader) sends LogRequests to all peers — replicating the entry to C ' +
          'so the cluster can eventually commit it'
        );
      })

      .after(0, () => { player.next(); });
  },
};
