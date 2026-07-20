import { Timeline } from './timeline.js';

/**
 * Player — manages the ordered sequence of scenes (frames).
 *
 * Each frame is a plain object:
 *   {
 *     id:    string,            // used as URL hash anchor
 *     title: string,            // shown in nav and scene menu
 *     setup: (layout, timeline, player) => void
 *   }
 *
 * setup() receives the shared Layout, a fresh Timeline, and this Player.
 * It schedules animation steps on the timeline and draws SVG content via
 * the layout.  setup() must NOT call timeline.start() — the Player does that.
 */
export class Player {
  /**
   * @param {object[]}                              frames  Ordered frame descriptors
   * @param {import('../layout/layout.js').Layout}  layout
   */
  constructor(frames, layout) {
    this._frames   = frames;
    this._layout   = layout;
    this._idx      = 0;
    this._timeline = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Activate the first frame, or the frame matching window.location.hash.
   */
  start() {
    const hash    = window.location.hash.replace(/^#/, '');
    const hashIdx = this._frames.findIndex(f => f.id === hash);
    this._activateFrame(hashIdx >= 0 ? hashIdx : 0);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  next() {
    if (this._idx < this._frames.length - 1) {
      this._activateFrame(this._idx + 1);
    }
  }

  prev() {
    if (this._idx > 0) {
      this._activateFrame(this._idx - 1);
    }
  }

  replay() {
    this._activateFrame(this._idx);
  }

  /**
   * Resume the current frame's timeline from a waitForResume pause.
   * The Player wires the "Continue" button to this method.
   */
  resume() {
    if (!this._timeline?.isPaused) return;
    this._layout.setResumePending();
    this._timeline.resume();
  }

  /**
   * Navigate directly to the frame with the given id.
   * @param {string} id
   */
  goTo(id) {
    const idx = this._frames.findIndex(f => f.id === id);
    if (idx >= 0) this._activateFrame(idx);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  currentFrame()  { return this._frames[this._idx]; }
  currentIndex()  { return this._idx; }
  frames()        { return this._frames; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _activateFrame(idx) {
    // Stop the outgoing timeline (cancels pending timers and D3 transitions
    // are cleaned up in layout.onFrameStart via clear()).
    if (this._timeline) this._timeline.stop();

    this._idx = idx;
    const frame = this._frames[idx];

    // Update URL hash without adding a browser history entry.
    history.replaceState(null, '', '#' + frame.id);

    // Prepare the layout: clear SVG, reset subtitle, hide resume button.
    this._layout.onFrameStart(frame, idx, this._frames.length);

    // Wire up a fresh timeline.
    const timeline = new Timeline();
    this._timeline = timeline;

    timeline.onPause = () => this._layout.showResumeButton();
    timeline.onDone  = () => this._layout.hideResumeButton();

    // Run the frame's setup function; it populates the timeline.
    frame.setup(this._layout, timeline, this);

    // Begin executing the timeline.
    timeline.start();

    // Notify the rest of the app (main.js updates nav UI).
    window.dispatchEvent(new CustomEvent('raftviz:framechange', {
      detail: { frame, idx, total: this._frames.length }
    }));
  }
}
