/**
 * Timeline — a chainable sequence of timed steps with pause/resume support.
 *
 * API:
 *   const t = new Timeline();
 *   t.after(0,    () => showTitle())
 *    .after(1000, () => showSubtitle())
 *    .waitForResume(() => …)   // optional onEnter runs when pause starts (e.g. set subtitle)
 *    .after(500,  () => nextStep())
 *    .start();
 *
 * The Timeline runs on wall-clock time (setTimeout) and drives the scripted
 * scenes. The free-play sandbox instead uses the simulation Scheduler
 * (scripts/simulation/scheduler.js) to drive Raft events on its own clock.
 */
export class Timeline {
  constructor() {
    this._steps            = [];
    this._idx              = 0;
    this._running          = false;
    this._waitingForResume = false;
    this._timer            = null;

    /**
     * Called when a waitForResume step is reached.
     * Typically used by the Player to show the "Continue" button.
     * @type {Function|null}
     */
    this.onPause = null;

    /**
     * Called when all steps have executed (end of frame reached naturally).
     * @type {Function|null}
     */
    this.onDone = null;
  }

  // ---------------------------------------------------------------------------
  // Builder API (returns `this` for chaining)
  // ---------------------------------------------------------------------------

  /**
   * Schedule `fn` to run `delay` ms after the previous step completes.
   * @param {number}   delay  Milliseconds to wait (0 = next event loop tick)
   * @param {Function} fn
   */
  after(delay, fn) {
    this._steps.push({ type: 'timed', delay, fn });
    return this;
  }

  /**
   * Insert a pause point.  Execution halts here until resume() is called.
   * @param {Function} [onEnter]  Optional callback when the pause begins
   *                              (e.g. update the subtitle bar).
   */
  waitForResume(onEnter) {
    this._steps.push({ type: 'pause', onEnter: onEnter ?? null });
    return this;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start (or restart from the beginning). */
  start() {
    this._idx              = 0;
    this._running          = true;
    this._waitingForResume = false;
    this._advance();
    return this;
  }

  /** Stop and cancel any pending timer.  The timeline cannot be resumed after this. */
  stop() {
    this._running          = false;
    this._waitingForResume = false;
    clearTimeout(this._timer);
    this._timer = null;
  }

  /**
   * Resume from a waitForResume pause point.
   * No-op if not currently paused.
   */
  resume() {
    if (!this._waitingForResume) return;
    this._waitingForResume = false;
    this._idx++;
    this._advance();
  }

  /** True while paused at a waitForResume step. */
  get isPaused() { return this._waitingForResume; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _advance() {
    if (!this._running) return;

    if (this._idx >= this._steps.length) {
      if (this.onDone) this.onDone();
      return;
    }

    const step = this._steps[this._idx];

    if (step.type === 'pause') {
      this._waitingForResume = true;
      if (step.onEnter) {
        try {
          step.onEnter();
        } catch (err) {
          console.error('[Timeline] onEnter error at index', this._idx, err);
        }
      }
      if (this.onPause) this.onPause();
      return;
    }

    // step.type === 'timed'
    this._timer = setTimeout(() => {
      if (!this._running) return;
      try {
        step.fn();
      } catch (err) {
        console.error('[Timeline] step error at index', this._idx, err);
      }
      this._idx++;
      this._advance();
    }, step.delay);
  }
}
