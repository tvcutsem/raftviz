/**
 * pseudocode_layout.js — renders the Kleppmann pseudocode panel into #code-pane.
 *
 * API:
 *   const panel = new PseudocodePanel('#code-pane');
 *   panel.highlight(slideNum, lineIndices);  // switch slide + highlight lines
 *   panel.showSlide(n);                      // switch slide without changing highlights
 *   panel.clear();                           // remove all highlights
 *   panel.remove();                          // tear down and restore placeholder
 *
 * Use with the HL spread pattern from pseudocode.js:
 *   panel.highlight(...HL.ELECTION_TIMEOUT);
 */

import { SLIDES } from './pseudocode.js';

// Indentation step in em units per indent level
const INDENT_EM = 1.2;

// Module-level: the TRUE original HTML of the container, captured once the
// very first time a PseudocodePanel is constructed (when the container still
// holds only the placeholder).  Re-used on every remove() so the placeholder
// is always restored correctly, even when a new panel is created without first
// removing the previous one.
let _savedContainerHTML = null;

// Keywords rendered in bold — ordered longest-first to avoid partial matches
const _KW_RE = /\b(end function|end for|end if|else if|for each|periodically|function|define|forward|cancel|deliver|append|send|else|then|for|if|on)\b/g;

function _boldKeywords(text) {
  // Escape HTML special characters (defensive — pseudocode data has none)
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Wrap every keyword match in <b> … </b>
  return esc.replace(_KW_RE, '<b>$&</b>');
}

export class PseudocodePanel {
  /**
   * @param {string} containerSelector  CSS selector for the pane element
   */
  constructor(containerSelector) {
    this._el       = document.querySelector(containerSelector);
    this._slide    = 1;
    this._lineEls  = [];   // array of <div> refs, one per line in current slide

    // Capture the original placeholder HTML the first time (clean container).
    // Subsequent constructions reuse the saved value so remove() always
    // restores the correct placeholder regardless of navigation order.
    if (_savedContainerHTML === null) {
      _savedContainerHTML = this._el.innerHTML;
    }
    this._origHTML = _savedContainerHTML;

    this._build();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Switch to slideNum and highlight the given line indices.
   * Calling highlight() again clears previous highlights first. Highlights
   * stay visible until the next highlight(), clear(), slide navigation, or
   * remove() — they are not auto-cleared on a timer.
   * @param {number}   slideNum     1-9
   * @param {number[]} lineIndices  0-based indices into the slide's lines array
   */
  highlight(slideNum, lineIndices) {
    this.showSlide(slideNum);
    this._clearHighlights();

    const toHL = new Set(lineIndices);
    this._lineEls.forEach((el, idx) => {
      if (el && toHL.has(idx)) el.classList.add('pseudo-hl');
    });

    // Scroll the first highlighted line into view
    const first = this._lineEls[lineIndices[0]];
    if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * Switch to a slide without changing any highlights.
   * @param {number} n  1-9
   */
  showSlide(n) {
    if (n < 1 || n > SLIDES.length) return;
    if (n === this._slide) return;
    this._slide = n;
    this._renderBody();
    this._updateHeader();
  }

  /** Remove all line highlights. */
  clear() {
    this._clearHighlights();
  }

  /** Destroy the panel and restore the original placeholder content. */
  remove() {
    this._el.innerHTML = this._origHTML;
    this._el.classList.add('pane-collapsed');
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _build() {
    this._el.innerHTML = `
      <div class="pseudo-wrapper">
        <div class="pseudo-fold-strip">
          <button class="pseudo-fold-btn" title="Collapse pseudocode panel">&#9656;</button>
          <span class="pseudo-fold-label">Pseudocode</span>
        </div>
        <div class="pseudo-panel">
          <div class="pseudo-header">
            <button class="pseudo-nav-btn" data-dir="-1" title="Previous slide">&#8249;</button>
            <span class="pseudo-slide-label"></span>
            <button class="pseudo-nav-btn" data-dir="1"  title="Next slide">&#8250;</button>
          </div>
          <div class="pseudo-body"></div>
        </div>
      </div>`;

    this._panelEl  = this._el.querySelector('.pseudo-panel');
    this._labelEl  = this._el.querySelector('.pseudo-slide-label');
    this._bodyEl   = this._el.querySelector('.pseudo-body');

    // Fold / unfold toggle
    const foldBtn = this._el.querySelector('.pseudo-fold-btn');
    foldBtn.addEventListener('click', () => {
      const isNowCollapsed = this._el.classList.toggle('pane-collapsed');
      foldBtn.innerHTML    = isNowCollapsed ? '&#9666;' : '&#9656;';
      foldBtn.title        = isNowCollapsed
        ? 'Expand pseudocode panel'
        : 'Collapse pseudocode panel';
    });

    // Prev / next slide navigation
    this._el.querySelectorAll('.pseudo-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir  = parseInt(btn.dataset.dir, 10);
        const next = Math.min(Math.max(this._slide + dir, 1), SLIDES.length);
        this._slide = next;
        this._clearHighlights();
        this._renderBody();
        this._updateHeader();
      });
    });

    // Expand the pane — it starts (and rests between scenes) collapsed
    this._el.classList.remove('pane-collapsed');

    this._renderBody();
    this._updateHeader();
  }

  _updateHeader() {
    const slide = SLIDES[this._slide - 1];
    this._labelEl.textContent = `${slide.num} / ${SLIDES.length} \u00B7 ${slide.title}`;

    // Disable prev/next at boundaries
    const [prev, next] = this._el.querySelectorAll('.pseudo-nav-btn');
    prev.disabled = (this._slide === 1);
    next.disabled = (this._slide === SLIDES.length);
  }

  _renderBody() {
    const slide = SLIDES[this._slide - 1];
    this._lineEls = [];
    this._bodyEl.innerHTML = '';

    slide.lines.forEach((line, idx) => {
      const div = document.createElement('div');
      if (line === null) {
        div.className = 'pseudo-line pseudo-blank';
        this._lineEls.push(div);   // blank lines are still index-addressable
      } else {
        const [indent, text] = line;
        div.style.paddingLeft = `${indent * INDENT_EM}em`;
        if (text.startsWith('//')) {
          // Annotation/footnote line — rendered dimmed, no keyword bolding
          div.className = 'pseudo-line pseudo-comment';
          div.textContent = text;
        } else {
          div.className = 'pseudo-line';
          div.innerHTML = _boldKeywords(text);
        }
        this._lineEls.push(div);
      }
      this._bodyEl.appendChild(div);
    });
  }

  _clearHighlights() {
    this._lineEls.forEach(el => el && el.classList.remove('pseudo-hl'));
  }
}
