import { select, scaleLinear } from '../lib/d3.js';

/**
 * Layout — manages the SVG canvas, coordinate scales, and shared UI chrome.
 *
 * Virtual coordinate space: x ∈ [0, 100], y ∈ [0, 100].
 * scaleX / scaleY map this to actual pixel dimensions, updated on resize.
 *
 * Provides SVG creation, resize handling, subtitle, and resume button. The
 * sub-layouts (nodes, log entries, messages, etc.) are separate modules that
 * receive a reference to this Layout instance.
 */
export class Layout {
  /**
   * @param {string} chartSelector    CSS selector for the SVG container <div>
   * @param {string} subtitleSelector CSS selector for the subtitle <span>
   */
  constructor(chartSelector, subtitleSelector) {
    this._chartEl     = document.querySelector(chartSelector);
    this._subtitleEl  = document.querySelector(subtitleSelector);
    this._resumeBtn   = document.getElementById('btn-resume');
    this._svg         = null;  // d3 selection of <svg>
    this._g           = null;  // d3 selection of root <g>
    this._width       = 0;
    this._height      = 0;
    this._resizeObs   = null;
    this._codePaneHTML = null; // pristine #code-pane placeholder, captured in initialize()

    /**
     * Virtual coordinate system: x ∈ [0, 100] maps to SVG user units [0, 1000].
     * Because the SVG uses viewBox="0 0 1000 600", these are always consistent
     * regardless of the container's pixel size.
     */
    this.scaleX = scaleLinear().domain([0, 100]).range([0, 1000]);

    /**
     * Virtual coordinate system: y ∈ [0, 100] maps to SVG user units [0, 600].
     */
    this.scaleY = scaleLinear().domain([0, 100]).range([0, 600]);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create the SVG element and start watching for container size changes.
   * Call once at startup, before creating the Player.
   */
  initialize() {
    this._svg = select(this._chartEl)
      .append('svg')
      .attr('width',  '100%')
      .attr('height', '100%')
      .attr('viewBox', '0 0 1000 600')
      .attr('preserveAspectRatio', 'xMidYMid meet');

    this._g = this._svg.append('g').attr('class', 'root');

    // Snapshot #code-pane's pristine placeholder before any frame ever runs,
    // so onFrameStart() can restore it centrally on every transition.
    this._codePaneHTML = document.getElementById('code-pane')?.innerHTML ?? null;

    // Keep pixel dimensions for callers that need them (e.g. radius clamping).
    this._updateSize();
    this._resizeObs = new ResizeObserver(() => this._updateSize());
    this._resizeObs.observe(this._chartEl);

    return this;
  }

  // ---------------------------------------------------------------------------
  // Player hooks
  // ---------------------------------------------------------------------------

  /**
   * Called by the Player each time a new frame becomes active.
   * Clears SVG content, clears subtitle, and hides the resume button.
   *
   * @param {object} frame  Frame descriptor {id, title}
   * @param {number} idx    0-based index of the current frame
   * @param {number} total  Total number of frames
   */
  onFrameStart(frame, idx, total) {
    this.clear();
    this.setSubtitle('');
    this.hideResumeButton();
    // Reset #code-pane to its pristine placeholder and collapse it on every
    // transition — this runs before frame.setup(), so a frame that owns a
    // PseudocodePanel simply overwrites it again a moment later; a frame that
    // doesn't is left with no stale, revealable pseudocode content.
    const codePane = document.getElementById('code-pane');
    if (codePane) {
      if (this._codePaneHTML !== null) codePane.innerHTML = this._codePaneHTML;
      codePane.classList.add('pane-collapsed');
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove all SVG child elements from the root group.
   * Interrupts any active D3 transitions before removal, preventing
   * callbacks from firing on elements that no longer exist.
   */
  clear() {
    if (this._g) {
      this._g.selectAll('*').interrupt().remove();
    }
  }

  /**
   * Set the subtitle bar HTML.
   * @param {string} html  Raw HTML string (or plain text)
   */
  setSubtitle(html) {
    if (this._subtitleEl) this._subtitleEl.innerHTML = html;
  }

  /** Show an enabled Continue button (at a timeline pause). */
  showResumeButton() {
    const btn = this._resumeBtn;
    if (!btn) return;
    btn.classList.remove('hidden');
    btn.disabled = false;
  }

  /** Hide Continue between scenes / when the timeline finishes. */
  hideResumeButton() {
    const btn = this._resumeBtn;
    if (!btn) return;
    btn.classList.add('hidden');
    btn.disabled = true;
  }

  /** Dim Continue while the timeline runs between pauses (keeps layout stable). */
  setResumePending() {
    const btn = this._resumeBtn;
    if (!btn) return;
    btn.classList.remove('hidden');
    btn.disabled = true;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** D3 selection of the root <g> element.  Draw all content into this. */
  get g()       { return this._g; }

  /** D3 selection of the <svg> element. */
  get svg()     { return this._svg; }

  /** Current pixel width of the chart container. */
  get width()   { return this._width; }

  /** Current pixel height of the chart container. */
  get height()  { return this._height; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _updateSize() {
    const rect = this._chartEl.getBoundingClientRect();
    // Pixel dimensions for callers that need them.
    // scaleX/scaleY are NOT updated here — they always map to the fixed viewBox.
    this._width  = rect.width  || this._chartEl.clientWidth  || 1000;
    this._height = rect.height || this._chartEl.clientHeight || 600;
  }
}
