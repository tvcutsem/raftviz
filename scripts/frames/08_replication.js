/**
 * 08_replication.js — "Raft 4–5/9 · Broadcasting & Replication" scene.
 *
 * A is already leader in term 1.  Shows:
 *   1. Heartbeat LogRequests (empty suffix) keeping followers in sync.
 *   2. A client command arriving — A appends to its log and replicates.
 */

import { PseudocodePanel }     from '../pseudocode/pseudocode_layout.js';
import { HL }                  from '../pseudocode/pseudocode.js';
import { makeLogRequest }      from '../simulation/message.js';
import { buildClusterScene,
         fadeInNodes }         from './_cluster_helpers.js';
import { getTheme }            from '../theme.js';

// ── Panel cleanup ─────────────────────────────────────────────────────────────
let _panel = null;

const LATENCY = 750;   // ms for message dot travel

// ── Frame descriptor ─────────────────────────────────────────────────────────
export const frame08Replication = {
  id:    'raft-replication',
  title: 'Raft 4–5/9 · Broadcasting & Replication',

  setup(layout, timeline, player) {
    // ── Teardown ──────────────────────────────────────────────────────────────
    if (_panel) { _panel.remove(); _panel = null; }
    _panel = new PseudocodePanel('#code-pane');

    // ── Build scene ───────────────────────────────────────────────────────────
    const { cluster, nodeViews, logViews, inspViews, msgLayer } =
      buildClusterScene(layout);

    // Pre-set cluster: A is leader in term 1, B and C are followers
    const aNode = cluster.getNode('A');
    aNode.currentTerm   = 1;
    aNode.currentRole   = 'leader';
    aNode.currentLeader = 'A';
    aNode.votedFor      = 'A';
    aNode.sentLength.set('B', 0);
    aNode.sentLength.set('C', 0);
    aNode.ackedLength.set('A', 0);
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

    // ── Client label (hidden initially) ──────────────────────────────────────
    const { scaleX: sx, scaleY: sy } = layout;
    const ax = sx(50), ay = sy(18);

    const clientLabel = layout.g.append('text')
      .attr('x', ax - 80).attr('y', ay - 55)
      .attr('text-anchor', 'middle')
      .attr('font-size', 13).attr('font-weight', 600)
      .attr('fill', getTheme().text)
      .attr('opacity', 0)
      .text('Client: SET x=1');

    // ── Closure state ─────────────────────────────────────────────────────────
    let _replicateSends = null;

    // ── Timeline ──────────────────────────────────────────────────────────────
    timeline
      // Scene appears; A shown as leader
      .after(300, () => {
        fadeInNodes(nodeViews);
        nodeViews.get('A').setRole('leader');
        inspViews.get('A').update(aNode);
        inspViews.get('B').update(bNode);
        inspViews.get('C').update(cNode);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'A is the established <em>leader</em> — it periodically sends ' +
          'heartbeat LogRequests to keep followers in sync'
        );
      })

      // First heartbeat
      .after(400, () => {
        _panel.highlight(...HL.HEARTBEAT);
        const hb = makeLogRequest('A', 1, 0, 0, 0, []);
        msgLayer.send(hb, nodeViews.get('A'), nodeViews.get('B'), LATENCY);
        msgLayer.send(hb, nodeViews.get('A'), nodeViews.get('C'), LATENCY);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 4 — <em>periodically</em>: the leader calls replicateLog for ' +
          'each follower (suffix is empty → pure heartbeat)'
        );
      })

      // Client request arrives
      .after(400, () => {
        clientLabel.transition().duration(400).attr('opacity', 1);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'A client sends a broadcast request — A will append the command to its log'
        );
      })

      // A appends to its log and prepares replication
      .after(400, () => {
        const { sends } = aNode.onBroadcastRequest('SET x=1');
        _replicateSends = sends;

        logViews.get('A').setEntries(aNode.log, aNode.commitLength);
        inspViews.get('A').update(aNode);

        _panel.highlight(...HL.BROADCAST_LEADER);
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 4 — A appends <em>{msg:"SET x=1", term:1}</em> and calls replicateLog'
        );
      })

      // LogRequest with suffix flies to B and C
      .after(400, () => {
        _panel.highlight(...HL.REPLICATE_SEND);
        for (const { msg, toId } of _replicateSends) {
          if (toId !== 'A') {
            msgLayer.send(msg, nodeViews.get('A'), nodeViews.get(toId), LATENCY);
          }
        }
      })
      .waitForResume(() => {
        layout.setSubtitle(
          'Slide 5 — <em>send LogRequest(…, suffix=[{msg,term}])</em> to B and C'
        );
      })

      .after(0, () => player.next());
  },
};
