/**
 * inspector_layout.js — Per-node variable inspector panel.
 *
 * Renders a compact table of Kleppmann variable values for a single node,
 * positioned to the side of (or below) the node circle.  Values that have
 * just changed are briefly highlighted in amber.
 *
 * Variables shown (always):
 *   currentTerm   votedFor   currentRole   currentLeader   commitLength
 *
 * Variables shown only when node is leader:
 *   sentLength[peer]   ackedLength[peer]   (one row per peer)
 *
 * Coordinate system: SVG user units (viewBox 0 0 1000 600).
 *
 * Usage:
 *   const insp = new InspectorView(layout, cx, cy);
 *   insp.update(node);        // re-renders with current node state; flashes changed cells
 *   insp.remove();
 */

import { getTheme } from '../theme.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Width of the inspector panel in SVG user units. */
const PANEL_W = 130;

/** Height of one row. */
const ROW_H   = 18;

/** Padding inside the panel. */
const PAD     = 6;

/** Background rect opacity. */
const BG_ALPHA = 0.55;

// ── InspectorView class ───────────────────────────────────────────────────────

export class InspectorView {
  /**
   * @param {import('./layout.js').Layout} layout
   * @param {number} x  SVG x of the panel's left edge
   * @param {number} y  SVG y of the panel's top edge
   */
  constructor(layout, x, y) {
    this._layout = layout;
    this._x      = x;
    this._y      = y;
    this._prev   = {};   // previous values for change detection

    this._group  = layout.g.append('g').attr('class', 'inspector');

    // Background rect (sized dynamically on first update)
    this._bg = this._group.append('rect')
      .attr('x', x).attr('y', y)
      .attr('rx', 4)
      .attr('fill', getTheme().inspectorBg)
      .attr('opacity', BG_ALPHA);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Re-render the inspector to reflect `node`'s current state.
   * Cells whose value changed since the last call flash amber briefly.
   *
   * @param {import('../simulation/node.js').Node} node
   */
  update(node) {
    this._group.selectAll('.insp-row').remove();

    const rows = _buildRows(node);
    const panelH = PAD * 2 + rows.length * ROW_H;

    this._bg
      .attr('width',  PANEL_W)
      .attr('height', panelH);

    rows.forEach((row, i) => {
      const rowY = this._y + PAD + i * ROW_H;
      const changed = this._prev[row.key] !== undefined &&
                      this._prev[row.key] !== row.value;

      const g = this._group.append('g')
        .attr('class', 'insp-row');

      const th = getTheme();

      // Key label
      g.append('text')
        .attr('x', this._x + PAD)
        .attr('y', rowY + ROW_H / 2)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 10)
        .attr('font-family', 'monospace')
        .attr('fill', th.inspectorKey)
        .text(row.key);

      // Value
      const valEl = g.append('text')
        .attr('x', this._x + PANEL_W - PAD)
        .attr('y', rowY + ROW_H / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 10)
        .attr('font-family', 'monospace')
        .attr('font-weight', '600')
        .attr('fill', changed ? th.inspectorChanged : th.inspectorValue)
        .text(row.value);

      // Flash if changed
      if (changed) {
        valEl.transition().delay(700).duration(400).attr('fill', th.inspectorValue);
      }

      this._prev[row.key] = row.value;
    });
  }

  /** Remove the panel from the SVG. */
  remove() {
    this._group.remove();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the ordered list of { key, value } rows from a Node instance.
 * Leader-specific rows (sentLength/ackedLength per peer) are appended at end.
 *
 * @param {import('../simulation/node.js').Node} node
 * @returns {Array<{key: string, value: string}>}
 */
function _buildRows(node) {
  const rows = [
    { key: 'currentTerm',   value: String(node.currentTerm) },
    { key: 'currentRole',   value: node.currentRole },
    { key: 'votedFor',      value: node.votedFor ?? '—' },
    { key: 'currentLeader', value: node.currentLeader ?? '—' },
    { key: 'commitLength',  value: String(node.commitLength) },
    { key: 'log.length',    value: String(node.log.length) },
  ];

  // Leader-only: sentLength / ackedLength per follower
  if (node.currentRole === 'leader') {
    for (const [peerId, sent] of node.sentLength.entries()) {
      rows.push({ key: `sent[${peerId}]`,  value: String(sent) });
    }
    for (const [peerId, acked] of node.ackedLength.entries()) {
      if (peerId === node.nodeId) continue;  // skip self-ack row
      rows.push({ key: `acked[${peerId}]`, value: String(acked) });
    }
  }

  return rows;
}
