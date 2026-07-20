/**
 * statemachine_layout.js — Per-node key-value state machine output display.
 *
 * Each Raft node acts as a replicated state machine.  When a log entry is
 * committed and delivered (`delivers` array from a handler), its `msg` field
 * (e.g. "SET x=1") is parsed and applied to a local key-value store.  This
 * component renders that KV store as a small text block positioned below the
 * log entries for a node.
 *
 * Supported command format (case-insensitive):
 *   SET <key>=<value>    — sets key to value (value is treated as a string)
 *   DEL <key>            — removes key
 *   (anything else)      — stored verbatim as a "raw" entry in the log
 *
 * Coordinate system: SVG user units (viewBox 0 0 1000 600).
 *
 * Usage:
 *   const smView = new StateMachineView(layout, cx, topY);
 *   smView.deliver('SET x=1');     // apply one committed entry
 *   smView.deliverMany(['SET x=1', 'SET y=7']);  // apply several
 *   smView.reset();                // wipe KV store (used after crash+wipe)
 *   smView.remove();
 */

import { getTheme } from '../theme.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Width of the KV panel in SVG user units. */
const PANEL_W = 110;

/** Height of one KV row. */
const ROW_H = 16;

/** Padding inside panel. */
const PAD = 6;


// ── StateMachineView class ────────────────────────────────────────────────────

export class StateMachineView {
  /**
   * @param {import('./layout.js').Layout} layout
   * @param {number} cx    SVG x centre (panel will be centred here)
   * @param {number} topY  SVG y of the panel top edge
   */
  constructor(layout, cx, topY) {
    this._layout = layout;
    this._cx     = cx;
    this._topY   = topY;
    this._kv     = new Map();   // string → string

    this._group = layout.g.append('g').attr('class', 'state-machine');

    const t = getTheme();

    // Static heading
    this._group.append('text')
      .attr('x', cx)
      .attr('y', topY - 4)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'auto')
      .attr('font-size', 9)
      .attr('fill', t.statemachineHead)
      .text('state machine');

    this._bg = this._group.append('rect')
      .attr('rx', 3)
      .attr('fill', t.statemachineBg)
      .attr('opacity', 0.7);

    this._rowsGroup = this._group.append('g').attr('class', 'sm-rows');

    this._render();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Apply one committed log entry message and update the display.
   * @param {string} msg  e.g. "SET x=1"
   */
  deliver(msg) {
    _applyCommand(this._kv, msg);
    this._render();
  }

  /**
   * Apply an array of committed messages in order.
   * @param {string[]} msgs
   */
  deliverMany(msgs) {
    for (const m of msgs) _applyCommand(this._kv, m);
    this._render();
  }

  /**
   * Clear the KV store (e.g. after a crash with stable storage wipe).
   */
  reset() {
    this._kv.clear();
    this._render();
  }

  /** Remove from SVG. */
  remove() {
    this._group.remove();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _render() {
    this._rowsGroup.selectAll('*').remove();

    const entries = [...this._kv.entries()];

    // Panel dimensions
    const rows   = entries.length > 0 ? entries.length : 1;
    const panelH = PAD * 2 + rows * ROW_H;
    const panelX = this._cx - PANEL_W / 2;

    this._bg
      .attr('x', panelX)
      .attr('y', this._topY)
      .attr('width', PANEL_W)
      .attr('height', panelH);

    const th = getTheme();

    if (entries.length === 0) {
      this._rowsGroup.append('text')
        .attr('x', this._cx)
        .attr('y', this._topY + PAD + ROW_H / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 9)
        .attr('fill', th.statemachineEmpty)
        .text('(empty)');
      return;
    }

    entries.forEach(([key, value], i) => {
      const rowY = this._topY + PAD + i * ROW_H;
      const g = this._rowsGroup.append('g');

      g.append('text')
        .attr('x', panelX + PAD)
        .attr('y', rowY + ROW_H / 2)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 9)
        .attr('font-family', 'monospace')
        .attr('fill', th.statemachineKey)
        .text(key);

      g.append('text')
        .attr('x', this._cx)
        .attr('y', rowY + ROW_H / 2)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 9)
        .attr('font-family', 'monospace')
        .attr('fill', th.statemachineEq)
        .text('=');

      g.append('text')
        .attr('x', panelX + PANEL_W - PAD)
        .attr('y', rowY + ROW_H / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 9)
        .attr('font-family', 'monospace')
        .attr('font-weight', '700')
        .attr('fill', th.statemachineVal)
        .text(value);
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse and apply one command to the KV map.
 *
 * @param {Map<string,string>} kv
 * @param {string} msg
 */
function _applyCommand(kv, msg) {
  if (!msg) return;
  const setMatch = msg.match(/^set\s+(\S+)\s*=\s*(.+)$/i);
  if (setMatch) {
    kv.set(setMatch[1], setMatch[2].trim());
    return;
  }
  const delMatch = msg.match(/^del\s+(\S+)$/i);
  if (delMatch) {
    kv.delete(delMatch[1]);
    return;
  }
  // Raw command — record it as key=msg, value=✓ (indicates it ran)
  kv.set(msg.slice(0, 12), '✓');
}
