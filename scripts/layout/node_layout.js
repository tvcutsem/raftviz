/**
 * node_layout.js — Visual representation of a single Raft node.
 *
 * Each NodeView manages one SVG group containing:
 *   • A filled circle (colour encodes currentRole)
 *   • A dashed outer ring for candidates
 *   • A solid outer ring for leaders
 *   • A shrinking arc around the circle for the election timer
 *   • A centred label (nodeId)
 *   • A role badge below the circle (follower / candidate / leader)
 *
 * Coordinate system: virtual x/y ∈ [0,100], mapped to SVG user units via
 * layout.scaleX / layout.scaleY (viewBox 0 0 1000 600, so scaleX(1) = 10,
 * scaleY(1) = 6).  All radii and offsets below are in SVG user units.
 *
 * Usage:
 *   const view = new NodeView(layout, nodeId, cx, cy);
 *   view.setRole('candidate');         // immediate colour switch
 *   view.startElectionTimer(duration); // starts the shrinking arc
 *   view.resetElectionTimer();         // fills the arc back to full
 *   view.stopElectionTimer();          // removes the arc
 *   view.flashMessage(colour);         // brief ring flash for received msg
 *   view.remove();                     // removes the group from the SVG
 */

import { arc as d3Arc } from '../lib/d3.js';
import { getTheme } from '../theme.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Outer radius of the node circle, in SVG user units. Shared with other layers
 *  (e.g. message_layout) so dot start/end offsets stay in sync with the circle. */
export const NODE_R = 36;
const R = NODE_R;   // short local alias used throughout this module

/** Outer radius of the election-timer arc (slightly outside the circle). */
const ARC_R = 44;

/** Width of the timer arc stroke. */
const ARC_WIDTH = 5;

/** Outer ring (leader / candidate) thickness. */
const RING_W = 5;


// ── NodeView class ─────────────────────────────────────────────────────────────

export class NodeView {
  /**
   * @param {import('./layout.js').Layout} layout
   * @param {string} nodeId
   * @param {number} cx  Virtual x ∈ [0,100]
   * @param {number} cy  Virtual y ∈ [0,100]
   */
  constructor(layout, nodeId, cx, cy) {
    this._layout  = layout;
    this._nodeId  = nodeId;
    this._role    = 'follower';

    // SVG coordinates
    this._px = layout.scaleX(cx);
    this._py = layout.scaleY(cy);

    // Timers
    this._timerInterval  = null;
    this._timerRemaining = 0;
    this._timerDuration  = 0;
    this._timerStart     = 0;

    this._build();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Immediately set the role and update fill + ring. */
  setRole(role) {
    this._role = role;
    const t = getTheme();
    const colour = t[role] ?? t.follower;

    this._circle.attr('fill', colour);
    this._badgeText.text(role);

    // Leader ring: solid
    if (role === 'leader') {
      this._ring
        .attr('stroke', colour)
        .attr('stroke-width', RING_W)
        .attr('stroke-dasharray', null)
        .attr('opacity', 1);
    } else if (role === 'candidate') {
      // Candidate ring: dashed
      this._ring
        .attr('stroke', colour)
        .attr('stroke-width', RING_W)
        .attr('stroke-dasharray', '12 8')
        .attr('opacity', 1);
    } else {
      this._ring.attr('opacity', 0);
    }
  }

  /**
   * Animate role transition: briefly scale up the circle then settle.
   * The colour changes immediately.
   * @param {string} role
   * @param {number} [duration=400]  ms
   */
  transitionRole(role, duration = 400) {
    this.setRole(role);
    this._circle
      .transition().duration(duration / 2)
        .attr('r', R * 1.18)
      .transition().duration(duration / 2)
        .attr('r', R);
  }

  /**
   * Start a shrinking election-timer arc.
   * The arc starts full (360°) and shrinks to 0 over `durationMs`.
   * @param {number} durationMs
   */
  startElectionTimer(durationMs) {
    this._stopTimerInterval();
    this._timerDuration  = durationMs;
    this._timerRemaining = durationMs;
    this._timerStart     = performance.now();
    this._timerArc.attr('opacity', 1);
    this._updateArc(1.0);
    this._timerInterval = setInterval(() => this._tickTimer(), 30);
  }

  /** Reset arc to full without restarting the countdown. */
  resetElectionTimer() {
    this._timerStart     = performance.now();
    this._timerRemaining = this._timerDuration;
    this._updateArc(1.0);
  }

  /** Hide and stop the election timer arc. */
  stopElectionTimer() {
    this._stopTimerInterval();
    this._timerArc.attr('opacity', 0);
  }

  /**
   * Flash a brief coloured ring to indicate a message was sent or received.
   * @param {string} colour  CSS colour
   * @param {number} [duration=600]  ms
   */
  flashMessage(colour, duration = 600) {
    this._flash
      .attr('stroke', colour)
      .attr('opacity', 0.85)
      .transition().duration(duration)
        .attr('opacity', 0);
  }

  /** Fade out and remove the group entirely. */
  remove() {
    this._stopTimerInterval();
    this._group.transition().duration(300).attr('opacity', 0).remove();
  }

  /** The D3 selection for the root group (for positioning / fade-in by callers). */
  get group() { return this._group; }

  /** Current SVG x coordinate. */
  get x() { return this._px; }
  /** Current SVG y coordinate. */
  get y() { return this._py; }

  // ---------------------------------------------------------------------------
  // Private — build
  // ---------------------------------------------------------------------------

  _build() {
    const { g } = this._layout;
    const px = this._px;
    const py = this._py;

    this._group = g.append('g')
      .attr('class', `node node-${this._nodeId}`)
      .attr('transform', `translate(${px},${py})`);

    const t = getTheme();

    // Election timer arc (behind circle)
    this._timerArc = this._group.append('path')
      .attr('fill', 'none')
      .attr('stroke', t.electionArc)
      .attr('stroke-width', ARC_WIDTH)
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0);

    // Outer ring (leader solid / candidate dashed)
    this._ring = this._group.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', R + RING_W + 2)
      .attr('fill', 'none')
      .attr('stroke', 'none')
      .attr('opacity', 0);

    // Flash ring (message received indicator)
    this._flash = this._group.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', R + 10)
      .attr('fill', 'none')
      .attr('stroke', t.flashRing)
      .attr('stroke-width', 4)
      .attr('opacity', 0);

    // Main circle
    this._circle = this._group.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', R)
      .attr('fill', t.follower)
      .attr('stroke', 'none');

    // Node ID label (centred in circle)
    this._group.append('text')
      .attr('x', 0).attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 22)
      .attr('font-weight', '700')
      .attr('fill', t.nodeLabel)
      .attr('pointer-events', 'none')
      .text(this._nodeId);

    // Role badge below circle
    this._badgeText = this._group.append('text')
      .attr('x', 0)
      .attr('y', R + 18)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'hanging')
      .attr('font-size', 13)
      .attr('fill', t.nodeBadge)
      .attr('pointer-events', 'none')
      .text('follower');
  }

  // ---------------------------------------------------------------------------
  // Private — timer
  // ---------------------------------------------------------------------------

  _tickTimer() {
    const elapsed = performance.now() - this._timerStart;
    const fraction = Math.max(0, 1 - elapsed / this._timerDuration);
    this._updateArc(fraction);
    if (fraction <= 0) {
      this._stopTimerInterval();
      this._timerArc.attr('opacity', 0);
    }
  }

  _updateArc(fraction) {
    const endAngle  = -Math.PI / 2 + fraction * 2 * Math.PI;
    const startAngle = -Math.PI / 2;
    const arcGen = d3Arc()
      .innerRadius(ARC_R - ARC_WIDTH / 2)
      .outerRadius(ARC_R + ARC_WIDTH / 2)
      .startAngle(startAngle)
      .endAngle(endAngle);
    this._timerArc.attr('d', arcGen());
  }

  _stopTimerInterval() {
    if (this._timerInterval !== null) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }
}
