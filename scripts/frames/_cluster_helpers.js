/**
 * _cluster_helpers.js — shared utilities for Phase 4 scripted cluster frames.
 *
 * All cluster-scene frames (04–08) use the same three-node layout and the same
 * supporting imports.  Extract common code here to avoid repetition.
 */

import { Cluster }       from '../simulation/cluster.js';
import { NodeView }      from '../layout/node_layout.js';
import { LogView }       from '../layout/log_layout.js';
import { MessageLayer }  from '../layout/message_layout.js';
import { InspectorView } from '../layout/inspector_layout.js';
import { getTheme }      from '../theme.js';

// ── Node geometry — matches 02_live_cluster.js ───────────────────────────────

export const NODE_DEFS = [
  { id: 'A', vx: 50, vy: 18 },
  { id: 'B', vx: 22, vy: 52 },
  { id: 'C', vx: 78, vy: 52 },
];

export const NODE_R   = 36;
export const BADGE_H  = 16;
export const BLOCK_H  = 32;   // log-entry block height
export const LOG_GAP  = 4;    // gap between log-entry blocks

// ── Visual component factory ──────────────────────────────────────────────────

/**
 * Create all visual components for a three-node cluster scene.
 * All node groups start at opacity 0 — call fadeInNodes() to show them.
 *
 * @param {import('../layout/layout.js').Layout} layout
 * @returns {{ cluster, nodeViews, logViews, inspViews, msgLayer }}
 */
export function buildClusterScene(layout) {
  const { scaleX: sx, scaleY: sy } = layout;
  const cluster  = new Cluster(NODE_DEFS.map(d => d.id));
  const nodeViews = new Map();
  const logViews  = new Map();
  const inspViews = new Map();
  const msgLayer  = new MessageLayer(layout);

  NODE_DEFS.forEach(({ id, vx, vy }) => {
    const px      = sx(vx);
    const py      = sy(vy);
    const logTopY = py + NODE_R + BADGE_H + 14;

    nodeViews.set(id, new NodeView(layout, id, vx, vy));
    logViews.set(id,  new LogView(layout, px, logTopY));

    const pos = _inspPos(id, px, py);
    inspViews.set(id, new InspectorView(layout, pos.x, pos.y));
    inspViews.get(id).update(cluster.getNode(id));

    // Start invisible; caller fades in when ready
    nodeViews.get(id).group.attr('opacity', 0);
  });

  return { cluster, nodeViews, logViews, inspViews, msgLayer };
}

/**
 * Animate all node groups from opacity 0 → 1.
 * @param {Map<string, import('../layout/node_layout.js').NodeView>} nodeViews
 * @param {number} [delay=0]   Milliseconds to wait before starting
 * @param {number} [dur=500]   Transition duration in milliseconds
 */
export function fadeInNodes(nodeViews, delay = 0, dur = 500) {
  nodeViews.forEach(nv =>
    nv.group.transition().delay(delay).duration(dur).attr('opacity', 1));
}

// ── Message colour ────────────────────────────────────────────────────────────

/**
 * Return a CSS colour string for the given Raft message (mirrors the helper
 * in 02_live_cluster.js so scripted scenes stay visually consistent).
 * @param {object} msg
 * @returns {string}
 */
export function msgColour(msg) {
  const t = getTheme();
  if (msg.type === 'VoteRequest')  return t.msgVoteReq;
  if (msg.type === 'VoteResponse') return msg.granted ? t.msgVoteOk : t.msgVoteKo;
  if (msg.type === 'LogRequest')   return t.msgLogReq;
  if (msg.type === 'LogResponse')  return msg.success ? t.msgLogOk : t.msgLogKo;
  return '#aaa';
}

// ── Private: inspector panel position ────────────────────────────────────────

function _inspPos(id, px, py) {
  if (id === 'A') return { x: px + 58, y: py - 45 };
  if (id === 'B') return { x: 50,      y: py - 52 };
  if (id === 'C') return { x: 830,     y: py - 52 };
  return { x: px + 58, y: py - 45 };
}
