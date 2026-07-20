/**
 * message_layout.js — Animated message dots that fly between nodes.
 *
 * Each in-flight message is a small circle that travels in a straight line
 * from the sender's position to the receiver's position over a configurable
 * duration.  The circle colour encodes message type (matching the CSS palette).
 * A brief label (e.g. "VoteRequest") appears alongside the dot.
 *
 * Coordinate system: SVG user units (viewBox 0 0 1000 600).
 *
 * Usage:
 *   const msgLayer = new MessageLayer(layout);
 *   msgLayer.send(msg, fromNodeView, toNodeView, durationMs);
 *   msgLayer.dropAll();   // immediately remove all in-flight dots
 *   msgLayer.remove();    // tear down
 *
 * MessageLayer does NOT own a D3 timer — it uses CSS/D3 transitions driven by
 * a requestAnimationFrame loop.  Each message fires an optional callback when
 * it arrives.
 */

import {
  VOTE_REQUEST, VOTE_RESPONSE, LOG_REQUEST, LOG_RESPONSE,
} from '../simulation/message.js';
import { NODE_R } from './node_layout.js';
import { getTheme } from '../theme.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Radius of the message dot, in SVG user units. */
const DOT_R = 7;

// ── MessageLayer class ────────────────────────────────────────────────────────

export class MessageLayer {
  /**
   * @param {import('./layout.js').Layout} layout
   */
  constructor(layout) {
    this._layout   = layout;
    this._group    = layout.g.append('g').attr('class', 'message-layer');
    this._inFlight = new Map(); // id → { dot, lbl, fromId, toId }
    this._nextId   = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Animate a message dot from one node to another.
   *
   * The animation is split into two equal halves. At the midpoint, if
   * `isPartitionedFn` is provided and returns true, the dot and label fade out
   * in place instead of continuing to the destination. This makes partitioned
   * messages visually disappear mid-way rather than ghosting through to arrival.
   *
   * @param {object}   msg              Simulation message object (with .type field)
   * @param {import('./node_layout.js').NodeView} fromView
   * @param {import('./node_layout.js').NodeView} toView
   * @param {number}   durationMs       Travel time in ms
   * @param {Function} [onArrive]       Optional callback invoked when the dot reaches its target
   * @param {string}   [fromId]         Sender node id (enables fadeOutLink tracking)
   * @param {string}   [toId]           Receiver node id (enables fadeOutLink tracking)
   * @param {Function} [isPartitionedFn] Called at the midpoint; if it returns true the dot fades out
   */
  send(msg, fromView, toView, durationMs, onArrive, fromId, toId, isPartitionedFn) {
    const colour = _msgColour(msg);
    const label  = _msgLabel(msg);

    const fx = fromView.x, fy = fromView.y;
    const tx = toView.x,   ty = toView.y;

    // Offset start/end by the node radius so dots appear to leave/arrive at edge
    const dist = Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2);
    const nodeR = NODE_R + 2;  // node radius + small gap
    const frac  = dist > 0 ? nodeR / dist : 0;

    const sx = fx + (tx - fx) * frac;
    const sy = fy + (ty - fy) * frac;
    const ex = tx - (tx - fx) * frac;
    const ey = ty - (ty - fy) * frac;

    // Midpoint of the travel path
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;

    // Dot
    const dot = this._group.append('circle')
      .attr('cx', sx).attr('cy', sy)
      .attr('r',  DOT_R)
      .attr('fill', colour)
      .attr('opacity', 0.9);

    // Label (offset perpendicular to travel direction)
    const [lox, loy] = _perpOffset(fx, fy, tx, ty, 14);

    const lbl = this._group.append('text')
      .attr('x', sx + lox)
      .attr('y', sy + loy)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 10)
      .attr('fill', colour)
      .attr('opacity', 0.9)
      .text(label);

    // Track this message so fadeOutLink() can interrupt it later
    const key = this._nextId++;
    if (fromId !== undefined && toId !== undefined) {
      this._inFlight.set(key, { dot, lbl, fromId, toId });
    }

    const halfMs = durationMs / 2;

    const _cleanup = () => {
      this._inFlight.delete(key);
      dot.remove();
      lbl.remove();
    };

    // Phase 1: travel to midpoint
    dot.transition()
      .duration(halfMs)
      .ease(t => t)
      .attr('cx', mx)
      .attr('cy', my)
      .on('end', () => {
        if (isPartitionedFn?.()) {
          // Fade out at the midpoint — link is partitioned
          this._inFlight.delete(key);
          dot.transition().duration(300).attr('opacity', 0).on('end', () => dot.remove());
          lbl.transition().duration(300).attr('opacity', 0).on('end', () => lbl.remove());
        } else {
          // Phase 2: continue to destination
          dot.transition()
            .duration(halfMs)
            .ease(t => t)
            .attr('cx', ex)
            .attr('cy', ey)
            .on('end', () => {
              _cleanup();
              if (onArrive) onArrive();
            });
          lbl.transition()
            .duration(halfMs)
            .ease(t => t)
            .attr('x', ex + lox)
            .attr('y', ey + loy);
        }
      });

    lbl.transition()
      .duration(halfMs)
      .ease(t => t)
      .attr('x', mx + lox)
      .attr('y', my + loy);
  }

  /**
   * Fade out and remove all in-flight messages traveling from `fromId` to `toId`.
   * Called when a partition is added mid-flight so messages already past the midpoint
   * still visually disappear rather than arriving.
   *
   * @param {string} fromId
   * @param {string} toId
   */
  fadeOutLink(fromId, toId) {
    for (const [key, rec] of this._inFlight) {
      if (rec.fromId === fromId && rec.toId === toId) {
        this._inFlight.delete(key);
        rec.dot.interrupt().transition().duration(300).attr('opacity', 0).on('end', () => rec.dot.remove());
        rec.lbl.interrupt().transition().duration(300).attr('opacity', 0).on('end', () => rec.lbl.remove());
      }
    }
  }

  /**
   * Immediately remove all in-flight dots (e.g. on frame clear).
   * D3 transitions are interrupted so `onArrive` callbacks are NOT called.
   */
  dropAll() {
    this._group.selectAll('*').interrupt().remove();
    this._inFlight.clear();
  }

  /** Remove the layer entirely. */
  remove() {
    this._group.remove();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _msgColour(msg) {
  const t = getTheme();
  if (msg.type === VOTE_REQUEST)  return t.msgVoteReq;
  if (msg.type === VOTE_RESPONSE) return msg.granted ? t.msgVoteOk : t.msgVoteKo;
  if (msg.type === LOG_REQUEST)   return t.msgLogReq;
  if (msg.type === LOG_RESPONSE)  return msg.success ? t.msgLogOk : t.msgLogKo;
  return '#aaa';
}

function _msgLabel(msg) {
  switch (msg.type) {
    case VOTE_REQUEST:  return `VoteReq(t=${msg.cTerm})`;
    case VOTE_RESPONSE: return msg.granted ? 'Vote✓' : 'Vote✗';
    case LOG_REQUEST:   return `LogReq(t=${msg.term},pre=${msg.prefixLen})`;
    case LOG_RESPONSE:  return msg.success ? `LogOk(${msg.ack})` : `LogFail`;
    default:            return msg.type ?? '?';
  }
}

/**
 * Compute a perpendicular offset vector of length `d` from the line (fx,fy)→(tx,ty).
 * Used to position the label slightly to the side of the dot's travel path.
 */
function _perpOffset(fx, fy, tx, ty, d) {
  const dx = tx - fx, dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [-dy / len * d, dx / len * d];
}
