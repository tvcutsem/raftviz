/**
 * log_layout.js — Visual log display for a single Raft node.
 *
 * Renders a column of rectangular entry blocks directly below a node circle.
 * Each block shows the entry's `msg` and `term`.  Committed entries are
 * displayed with a dark-green fill; uncommitted entries are pale yellow.
 * A dashed horizontal "commit marker" separates the two regions and is
 * labelled with the Kleppmann variable name `commitLength`.
 *
 * Coordinate system: SVG user units (viewBox 0 0 1000 600).
 *
 * Usage:
 *   const logView = new LogView(layout, cx, topY);
 *   logView.setEntries(node.log, node.commitLength);  // re-renders from scratch
 *   logView.animateAppend(entry);                     // slide-in one new entry
 *   logView.setCommitLength(n);                       // update commit marker
 *   logView.remove();
 */

import { getTheme } from '../theme.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Width of a single log entry block, in SVG user units. */
const BLOCK_W = 100;

/** Height of a single log entry block. */
const BLOCK_H = 32;

/** Horizontal gap between adjacent entries (log grows downwards). */
const GAP = 4;

// ── LogView class ─────────────────────────────────────────────────────────────

export class LogView {
  /**
   * @param {import('./layout.js').Layout} layout
   * @param {number} cx       SVG x centre of the owning node circle
   * @param {number} topY     SVG y where the first log block should start
   */
  constructor(layout, cx, topY) {
    this._layout       = layout;
    this._cx           = cx;
    this._topY         = topY;
    this._entries      = [];   // mirror of node.log
    this._commitLength = 0;

    this._group = layout.g.append('g').attr('class', 'log-view');
    this._markerGroup = this._group.append('g').attr('class', 'commit-marker');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Fully re-render the log from `entries` and `commitLength`.
   * Safe to call any time (e.g. on frame start or after a crash wipe).
   *
   * @param {Array<{msg: string, term: number}>} entries
   * @param {number} commitLength
   */
  setEntries(entries, commitLength) {
    this._entries      = entries.slice();
    this._commitLength = commitLength;

    // Remove all existing blocks
    this._group.selectAll('.log-block').remove();

    entries.forEach((entry, i) => {
      this._appendBlock(entry, i, /* animate */ false);
    });

    this._renderCommitMarker();
  }

  /**
   * Slide a new entry in from the top and append it to the end.
   * Also re-renders the commit marker.
   * @param {{msg: string, term: number}} entry
   */
  animateAppend(entry) {
    const i = this._entries.length;
    this._entries.push(entry);
    this._appendBlock(entry, i, /* animate */ true);
    this._renderCommitMarker();
  }

  /**
   * Update the commit length and re-render the marker plus entry colours.
   * @param {number} commitLength
   */
  setCommitLength(commitLength) {
    this._commitLength = commitLength;

    const th = getTheme();
    // Re-colour all blocks, re-using the index stamped on each block at render
    this._group.selectAll('.log-block')
      .each((d, i, nodes) => {
        const g    = nodes[i];
        const idx  = +g.dataset.idx;
        const committed = idx < commitLength;
        const fill = committed ? th.logCommitted : th.logUncommitted;
        const textFill = committed ? th.logCommittedText : th.logUncommittedText;

        g.querySelector('rect').setAttribute('fill', fill);
        g.querySelectorAll('text').forEach(t => {
          // Keep term label slightly dimmer
          if (t.dataset.role === 'term') {
            t.setAttribute('fill', committed ? th.logTermCommitted : th.logTermUncommitted);
          } else {
            t.setAttribute('fill', textFill);
          }
        });
      });

    this._renderCommitMarker();
  }

  /** Remove the entire log display from the SVG. */
  remove() {
    this._group.remove();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Y coordinate (top edge) of the block at index i. */
  _blockY(i) {
    return this._topY + i * (BLOCK_H + GAP);
  }

  _appendBlock(entry, i, animate) {
    const th = getTheme();
    const x    = this._cx - BLOCK_W / 2;
    const y    = this._blockY(i);
    const committed = i < this._commitLength;

    const blockGroup = this._group.append('g')
      .attr('class', 'log-block')
      .attr('data-idx', i);

    // Stamp the index so setCommitLength can find it later
    blockGroup.node().dataset.idx = i;

    const rect = blockGroup.append('rect')
      .attr('x',      x)
      .attr('y',      animate ? y - BLOCK_H : y)
      .attr('width',  BLOCK_W)
      .attr('height', BLOCK_H)
      .attr('rx', 3)
      .attr('fill', committed ? th.logCommitted : th.logUncommitted)
      .attr('opacity', animate ? 0 : 1);

    // msg label (left side)
    const msgEl = blockGroup.append('text')
      .attr('x', x + 8)
      .attr('y', (animate ? y - BLOCK_H : y) + BLOCK_H / 2)
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 11)
      .attr('font-weight', '600')
      .attr('fill', committed ? th.logCommittedText : th.logUncommittedText)
      .text(_truncate(entry.msg, 9));

    // term badge (right side)
    const termEl = blockGroup.append('text')
      .attr('x', x + BLOCK_W - 6)
      .attr('y', (animate ? y - BLOCK_H : y) + BLOCK_H / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 10)
      .attr('fill', committed ? th.logTermCommitted : th.logTermUncommitted)
      .attr('data-role', 'term')
      .text(`t${entry.term}`);

    termEl.node().dataset.role = 'term';

    if (animate) {
      rect.transition().duration(300)
        .attr('y', y)
        .attr('opacity', 1);
      msgEl.transition().duration(300).attr('y', y + BLOCK_H / 2);
      termEl.transition().duration(300).attr('y', y + BLOCK_H / 2);
    }
  }

  _renderCommitMarker() {
    this._markerGroup.selectAll('*').remove();

    const n = this._commitLength;
    // Position marker at the boundary between committed and uncommitted
    const markerY = this._blockY(n) - GAP / 2 - 1;

    if (n > 0 || this._entries.length > 0) {
      const th = getTheme();
      // Dashed line
      this._markerGroup.append('line')
        .attr('x1', this._cx - BLOCK_W / 2 - 8)
        .attr('y1', markerY)
        .attr('x2', this._cx + BLOCK_W / 2 + 8)
        .attr('y2', markerY)
        .attr('stroke', th.commitMarker)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '5 3')
        .attr('opacity', 0.8);

      // Label
      this._markerGroup.append('text')
        .attr('x', this._cx + BLOCK_W / 2 + 12)
        .attr('y', markerY)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 10)
        .attr('fill', th.commitMarker)
        .attr('opacity', 0.8)
        .text(`commitLength=${n}`);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}
