/**
 * Frame 02 — Live Cluster / Playground
 *
 * A free-running three-node Raft cluster with full interactive controls:
 *
 *   • Click a node          — crash it (turns grey); click again to recover
 *   • Drag node → node      — add a network partition; drag again to remove
 *   • Send Request button   — inject a client command into the cluster
 *   • Speed slider          — scale simulation speed (0.5× – 6×)
 * The Scheduler drives the simulation autonomously; callbacks update all five
 * visual layers (NodeView, LogView, MessageLayer, InspectorView,
 * StateMachineView) and the pseudocode panel in real time.
 */

import { Cluster }          from '../simulation/cluster.js';
import { Scheduler }        from '../simulation/scheduler.js';
import { NodeView }         from '../layout/node_layout.js';
import { LogView }          from '../layout/log_layout.js';
import { MessageLayer }     from '../layout/message_layout.js';
import { InspectorView }    from '../layout/inspector_layout.js';
import { StateMachineView } from '../layout/statemachine_layout.js';
import { PseudocodePanel }  from '../pseudocode/pseudocode_layout.js';
import { HL }               from '../pseudocode/pseudocode.js';
import { drag as d3Drag, pointer as d3Pointer } from '../lib/d3.js';
import { getTheme } from '../theme.js';

// ── Module-level teardown handles ────────────────────────────────────────────

let _activeScheduler  = null;
let _playgroundBar    = null;

// layout.clear() only wipes the SVG <g>; the running scheduler and the
// playground bar both live outside it and must be torn down by hand. (The
// pseudocode panel doesn't need frame-local tracking — layout.onFrameStart()
// resets #code-pane centrally before every frame's setup() runs.) On
// re-entry, setup() removes any leftover; navigating away (forward or back)
// is handled by the framechange listener below.

window.addEventListener('raftviz:framechange', (e) => {
  const id = e.detail && e.detail.frame && e.detail.frame.id;
  if (id === 'live-cluster') return;
  if (_activeScheduler) { _activeScheduler.stop(); _activeScheduler = null; }
  if (_playgroundBar)   { _playgroundBar.remove();   _playgroundBar   = null; }
});

// ── Node layout geometry ──────────────────────────────────────────────────────
//
//  Virtual coords [0,100] mapped to SVG user units via scaleX/scaleY.
//
//   A  — top centre  : virtual (50, 18)
//   B  — bottom-left : virtual (22, 52)
//   C  — bottom-right: virtual (78, 52)
//
const NODE_DEFS = [
  { id: 'A', vx: 50, vy: 18 },
  { id: 'B', vx: 22, vy: 52 },
  { id: 'C', vx: 78, vy: 52 },
];

// ── Election-timer tuning ──────────────────────────────────────────────────────
//
// Shared by the Scheduler config and the visual election-timer arcs so the two
// can never drift. The wide randomization range (min .. min+range) is what
// breaks the symmetry that otherwise causes two survivors to duel indefinitely.
//
const ELECTION_MIN_MS   = 3000;
const ELECTION_RANGE_MS = 3000; // max = MIN + RANGE = 6000

// ── Frame descriptor ──────────────────────────────────────────────────────────

export const frame02LiveCluster = {
  id:    'live-cluster',
  title: 'Live Cluster',

  setup(layout, timeline, player) {
    // ── Teardown leftovers from a previous visit ──────────────────────────
    if (_activeScheduler) { _activeScheduler.stop(); _activeScheduler = null; }
    if (_playgroundBar)   { _playgroundBar.remove();   _playgroundBar   = null; }

    // ── Pseudocode panel ──────────────────────────────────────────────────
    const codePanel = new PseudocodePanel('#code-pane');
    codePanel.showSlide(1);

    const { scaleX: sx, scaleY: sy } = layout;

    // ── Simulation ────────────────────────────────────────────────────────

    const nodeIds = NODE_DEFS.map(d => d.id);
    const cluster = new Cluster(nodeIds);
    const scheduler = new Scheduler(cluster, {
      latencyMs:          500,
      latencyJitter:      100,
      electionTimeoutMin: ELECTION_MIN_MS,
      electionTimeoutMax: ELECTION_MIN_MS + ELECTION_RANGE_MS,
      heartbeatPeriod:    1000,
      speedFactor:        1,
    });
    _activeScheduler = scheduler;

    // ── Visual layers ─────────────────────────────────────────────────────

    const nodeViews = new Map();
    const logViews  = new Map();
    const inspViews = new Map();
    const smViews   = new Map();
    const msgLayer  = new MessageLayer(layout);

    // SVG pixel positions of each node (viewBox units)
    const nodePos = new Map();

    NODE_DEFS.forEach(({ id, vx, vy }) => {
      const px = sx(vx);
      const py = sy(vy);
      nodePos.set(id, { x: px, y: py });

      const NODE_R   = 36;
      const BADGE_H  = 16;
      const LOG_TOPY = py + NODE_R + BADGE_H + 14;

      nodeViews.set(id, new NodeView(layout, id, vx, vy));
      logViews.set(id,  new LogView(layout, px, LOG_TOPY));

      const ipos = _inspectorPosition(id, px, py);
      inspViews.set(id, new InspectorView(layout, ipos.x, ipos.y));
      inspViews.get(id).update(cluster.getNode(id));

      if (id === 'A') {
        const SM_TOPY = LOG_TOPY + 4 * (32 + 4) + 10;
        smViews.set(id, new StateMachineView(layout, px, SM_TOPY));
      }

      nodeViews.get(id).group.attr('opacity', 0)
        .transition().delay(100).duration(500).attr('opacity', 1);
    });

    // ── Scheduler callbacks ───────────────────────────────────────────────

    scheduler.onElectionTimeout = (nodeId) => {
      nodeViews.get(nodeId)?.stopElectionTimer();
      codePanel.highlight(...HL.ELECTION_TIMEOUT);
    };

    scheduler.onRoleChange = (nodeId, newRole) => {
      const node = cluster.getNode(nodeId);
      nodeViews.get(nodeId)?.transitionRole(newRole);
      inspViews.get(nodeId)?.update(node);

      if (newRole === 'leader') {
        for (const id of nodeIds) inspViews.get(id)?.update(cluster.getNode(id));
        logViews.get(nodeId)?.setEntries(node.log, node.commitLength);
        codePanel.highlight(...HL.BECOME_LEADER);
        // Restart follower election timer arcs
        for (const id of nodeIds) {
          if (id !== nodeId) {
            nodeViews.get(id)?.startElectionTimer(ELECTION_MIN_MS + Math.random() * ELECTION_RANGE_MS);
          }
        }
      } else if (newRole === 'candidate') {
        codePanel.highlight(...HL.ELECTION_TIMEOUT);
      }
    };

    scheduler.onMessageScheduled = (msg, fromId, toId, delayMs) => {
      const fv = nodeViews.get(fromId), tv = nodeViews.get(toId);
      if (fv && tv) {
        msgLayer.send(msg, fv, tv, delayMs, null, fromId, toId,
          () => scheduler.isPartitioned(fromId, toId));
      }

      if      (msg.type === 'VoteRequest')  codePanel.highlight(...HL.VOTE_REQ_SEND);
      else if (msg.type === 'VoteResponse') codePanel.highlight(...(msg.granted ? HL.GRANT_VOTE   : HL.DENY_VOTE));
      else if (msg.type === 'LogRequest')   codePanel.highlight(...HL.REPLICATE_SEND);
      else if (msg.type === 'LogResponse')  codePanel.highlight(...(msg.success ? HL.LOG_REQUEST_OK : HL.LOG_REQUEST_FAIL));
    };

    scheduler.onMessageDelivered = (msg, fromId, toId) => {
      const toNode = cluster.getNode(toId);
      const nv     = nodeViews.get(toId);

      if (nv) {
        nv.flashMessage(_msgColour(msg));
        if (msg.type === 'LogRequest' && toNode.currentRole === 'follower') {
          nv.resetElectionTimer();
        }
      }

      // Highlight the receive-side handler (the send site was highlighted in
      // onMessageScheduled). Fires before the node processes the message; if
      // quorum/commit results, onRoleChange/onDeliver deepen the highlight to
      // BECOME_LEADER / COMMIT_DELIVER respectively.
      if      (msg.type === 'VoteResponse') codePanel.highlight(...HL.RECV_VOTE_RESPONSE);
      else if (msg.type === 'LogResponse')  codePanel.highlight(...(msg.success ? HL.LOG_RESPONSE_OK
                                                                                : HL.LOG_RESPONSE_BACKOFF));

      for (const id of nodeIds) inspViews.get(id)?.update(cluster.getNode(id));

      const node = cluster.getNode(toId);
      logViews.get(toId)?.setEntries(node.log, node.commitLength);
    };

    scheduler.onDeliver = (nodeId, entry) => {
      const node = cluster.getNode(nodeId);
      logViews.get(nodeId)?.setCommitLength(node.commitLength);
      smViews.get(nodeId)?.deliver(entry.msg);
      inspViews.get(nodeId)?.update(node);

      if (node.currentRole === 'leader') codePanel.highlight(...HL.COMMIT_DELIVER);
      else                               codePanel.highlight(...HL.APPEND_DELIVER);
    };

    scheduler.onNodeEvent = (nodeId, event) => {
      const nv   = nodeViews.get(nodeId);
      const node = cluster.getNode(nodeId);
      if (!nv) return;
      if (event === 'crash') {
        nv.transitionRole('stopped');
        nv.stopElectionTimer();
        inspViews.get(nodeId)?.update(node);
      } else if (event === 'recover') {
        nv.transitionRole('follower');
        nv.startElectionTimer(ELECTION_MIN_MS + Math.random() * ELECTION_RANGE_MS);
        inspViews.get(nodeId)?.update(node);
      }
    };

    // ── Partition overlay (SVG) ───────────────────────────────────────────

    const partitionGroup = layout.g.append('g').attr('class', 'partition-layer');
    const partitionLines = new Map(); // key "A↔B" → { line, label }

    function syncPartitionLine(aId, bId) {
      const key  = [aId, bId].sort().join('↔');
      const ap   = nodePos.get(aId);
      const bp   = nodePos.get(bId);
      const live = scheduler.isPartitioned(aId, bId);

      if (live && !partitionLines.has(key)) {
        const mx  = (ap.x + bp.x) / 2;
        const my  = (ap.y + bp.y) / 2;
        const col = getTheme().msgVoteKo;
        const g   = partitionGroup.append('g').attr('class', 'partition-line');
        g.append('line')
          .attr('x1', ap.x).attr('y1', ap.y)
          .attr('x2', bp.x).attr('y2', bp.y)
          .attr('stroke', col)
          .attr('stroke-width', 3)
          .attr('stroke-dasharray', '12 6')
          .attr('opacity', 0.75);
        g.append('text')
          .attr('x', mx).attr('y', my - 10)
          .attr('text-anchor', 'middle')
          .attr('font-size', 18)
          .attr('fill', col)
          .text('⚡');
        partitionLines.set(key, g);
      } else if (!live && partitionLines.has(key)) {
        partitionLines.get(key).remove();
        partitionLines.delete(key);
      }
    }

    // ── Node interaction: click = crash/recover, drag = partition ─────────

    const DRAG_THRESHOLD = 14; // SVG user units of movement before drag starts
    const SNAP_RADIUS    = 64; // SVG user units — snap-to-node on drag release

    nodeViews.forEach((nv, id) => {
      nv.group.classed('pg-node-interactive', true);

      let _dragStartX = 0, _dragStartY = 0, _dragDist = 0, _ghostLine = null;

      nv.group.call(d3Drag()
        .on('start', (event) => {
          const [mx, my] = d3Pointer(event.sourceEvent, layout.svg.node());
          _dragStartX = mx;
          _dragStartY = my;
          _dragDist   = 0;
          _ghostLine  = null;
        })
        .on('drag', (event) => {
          const [mx, my] = d3Pointer(event.sourceEvent, layout.svg.node());
          const dx = mx - _dragStartX;
          const dy = my - _dragStartY;
          _dragDist = Math.sqrt(dx * dx + dy * dy);

          if (_dragDist > DRAG_THRESHOLD) {
            if (!_ghostLine) {
              _ghostLine = partitionGroup.append('line')
                .attr('class', 'drag-partition-line')
                .attr('stroke', getTheme().msgVoteKo)
                .attr('stroke-width', 2)
                .attr('stroke-dasharray', '6 4')
                .attr('opacity', 0.65);
            }
            const np = nodePos.get(id);
            _ghostLine
              .attr('x1', np.x).attr('y1', np.y)
              .attr('x2', mx).attr('y2', my);
          }
        })
        .on('end', (event) => {
          if (_ghostLine) { _ghostLine.remove(); _ghostLine = null; }

          const [mx, my] = d3Pointer(event.sourceEvent, layout.svg.node());

          if (_dragDist < DRAG_THRESHOLD) {
            // ── Click: crash / recover ──────────────────────────────────
            if (scheduler.isCrashed(id)) {
              scheduler.recover(id);
            } else {
              scheduler.crash(id);
            }
          } else {
            // ── Drag end: find closest other node and toggle partition ──
            let targetId = null;
            let minDist  = Infinity;
            nodePos.forEach((pos, tid) => {
              if (tid === id) return;
              const d = Math.sqrt((pos.x - mx) ** 2 + (pos.y - my) ** 2);
              if (d < SNAP_RADIUS && d < minDist) { minDist = d; targetId = tid; }
            });

            if (targetId) {
              if (scheduler.isPartitioned(id, targetId)) {
                scheduler.removePartition(id, targetId);
              } else {
                scheduler.addPartition(id, targetId);
                // Fade out any messages already past their midpoint on the newly partitioned link
                msgLayer.fadeOutLink(id, targetId);
                msgLayer.fadeOutLink(targetId, id);
              }
              syncPartitionLine(id, targetId);
            }
          }
        })
      );
    });

    // ── Control bar ───────────────────────────────────────────────────────

    const { bar } = _buildControlBar(scheduler, cluster);
    _playgroundBar = bar;

    // ── Start election timer arcs ─────────────────────────────────────────

    NODE_DEFS.forEach(({ id }) => {
      nodeViews.get(id)?.startElectionTimer(ELECTION_MIN_MS + Math.random() * ELECTION_RANGE_MS);
    });

    // ── Timeline: start simulation, show hint, then free-play ─────────────

    timeline
      .after(400, () => {
        scheduler.start();
        layout.setSubtitle(
          'Simulation running — use the control bar below and interact with the cluster'
        );
      })
      .after(7000, () => layout.setSubtitle(''));
    // No waitForResume() — playground runs freely until the user navigates away
  },
};

// ── Private helpers ───────────────────────────────────────────────────────────

/** Build and mount the playground control bar below the viz pane. */
function _buildControlBar(scheduler, cluster) {
  const bar = document.createElement('div');
  bar.id = 'playground-bar';

  // ── Send Request button ───────────────────────────────────────────────
  let _reqN = 0;
  const sendBtn = document.createElement('button');
  sendBtn.className = 'pg-btn';
  sendBtn.textContent = '↗ Send Request';
  sendBtn.title = 'Inject a client command (the leader replicates it to all followers)';
  sendBtn.addEventListener('click', () => {
    _reqN++;
    const nodeIds = cluster.nodeIds;
    const leaderId = nodeIds.find(
      id => cluster.getNode(id).currentRole === 'leader' && !scheduler.isCrashed(id)
    );
    const targetId = leaderId ?? nodeIds.find(id => !scheduler.isCrashed(id));
    if (targetId) scheduler.broadcast(targetId, `SET x=${_reqN}`);
  });
  bar.appendChild(sendBtn);

  // ── Separator ─────────────────────────────────────────────────────────
  bar.appendChild(_sep());

  // ── Speed slider ──────────────────────────────────────────────────────
  const speedLabel = document.createElement('label');
  speedLabel.className = 'pg-label';
  speedLabel.appendChild(document.createTextNode('Speed'));

  const speedInput = document.createElement('input');
  speedInput.type  = 'range';
  speedInput.id    = 'pg-speed';
  speedInput.min   = '0.5';
  speedInput.max   = '6';
  speedInput.step  = '0.5';
  speedInput.value = '1';

  const speedVal = document.createElement('span');
  speedVal.id = 'pg-speed-val';
  speedVal.textContent = '1×';

  speedInput.addEventListener('input', () => {
    const v = parseFloat(speedInput.value);
    speedVal.textContent = `${v}×`;
    scheduler.setSpeedFactor(v);
  });
  speedLabel.appendChild(speedInput);
  speedLabel.appendChild(speedVal);
  bar.appendChild(speedLabel);

  // ── Mount ──────────────────────────────────────────────────────────────
  document.getElementById('viz-pane').appendChild(bar);

  return { bar };
}

function _sep() {
  const s = document.createElement('span');
  s.className = 'pg-sep';
  return s;
}

/** Colour for the receiving-node flash based on message type. */
function _msgColour(msg) {
  const t = getTheme();
  if (msg.type === 'VoteRequest')  return t.msgVoteReq;
  if (msg.type === 'VoteResponse') return msg.granted ? t.msgVoteOk : t.msgVoteKo;
  if (msg.type === 'LogRequest')   return t.msgLogReq;
  if (msg.type === 'LogResponse')  return msg.success ? t.msgLogOk : t.msgLogKo;
  return '#aaa';
}

/**
 * Return the top-left {x, y} for a node's inspector panel,
 * positioned to avoid overlapping the circle and log.
 *
 *   A (top centre ~500,108) → right of circle
 *   B (bottom-left ~220,312) → left of circle
 *   C (bottom-right ~780,312) → right of circle
 */
function _inspectorPosition(nodeId, px, py) {
  if (nodeId === 'A') return { x: px + 58, y: py - 45 };
  if (nodeId === 'B') return { x: 50,      y: py - 52 };
  if (nodeId === 'C') return { x: 830,     y: py - 52 };
  return { x: px + 58, y: py - 45 };
}
