/**
 * scheduler.js — Discrete-event scheduler for the Raft simulation
 *
 * Drives the simulation in wall-clock time using setTimeout/setInterval.
 * All simulated delays are scaled by `speedFactor` (default 1 = real time).
 *
 * Responsibilities:
 *   - Route messages between nodes with configurable latency + jitter
 *   - Manage per-node election timers (random in [min, max])
 *   - Manage per-leader heartbeat intervals
 *   - Support crash/recover and network partition
 *   - Expose observable callbacks used by the visualization layer
 *
 * Usage:
 *   const cluster   = new Cluster(['A','B','C']);
 *   const scheduler = new Scheduler(cluster, { latencyMs: 80 });
 *   scheduler.onMessageDelivered = (msg, fromId, toId) => { ... };
 *   scheduler.onDeliver          = (nodeId, entry)      => { ... };
 *   scheduler.start();
 */

import { LEADER, FOLLOWER, CANDIDATE } from './node.js';
import { VOTE_REQUEST, VOTE_RESPONSE, LOG_REQUEST, LOG_RESPONSE } from './message.js';

export class Scheduler {
  /**
   * @param {import('./cluster.js').Cluster} cluster
   * @param {object}  [opts]
   * @param {number}  [opts.latencyMs=80]              Base message delivery latency (wall-clock ms)
   * @param {number}  [opts.latencyJitter=30]           ± jitter on delivery latency
   * @param {number}  [opts.electionTimeoutMin=150]     Min election timeout (wall-clock ms)
   * @param {number}  [opts.electionTimeoutMax=300]     Max election timeout (wall-clock ms)
   * @param {number}  [opts.heartbeatPeriod=50]         Leader heartbeat interval (wall-clock ms)
   * @param {number}  [opts.speedFactor=1]              Scale: sim-ms per wall-clock ms
   */
  constructor(cluster, opts = {}) {
    this._cluster = cluster;

    // Timing parameters (all in wall-clock ms at speedFactor=1)
    this._latencyMs          = opts.latencyMs          ?? 80;
    this._latencyJitter      = opts.latencyJitter      ?? 30;
    this._electionTimeoutMin = opts.electionTimeoutMin ?? 150;
    this._electionTimeoutMax = opts.electionTimeoutMax ?? 300;
    this._heartbeatPeriod    = opts.heartbeatPeriod    ?? 50;
    this._speedFactor        = opts.speedFactor        ?? 1;

    // State
    this._crashed    = new Set();    // nodeIds that are currently crashed
    this._partitions = new Set();    // "A→B" strings: messages from A to B are dropped

    this._electionTimers  = new Map();  // nodeId → timeoutId
    this._heartbeatTimers = new Map();  // nodeId → intervalId
    this._pendingMessages = new Set();  // timeoutIds for in-flight messages (for stop())

    this._running = false;

    // ── Observable callbacks (set by the visualization layer) ──────────────

    /**
     * Called when a message is scheduled for delivery.
     * @type {((msg: object, fromId: string, toId: string, delayMs: number) => void) | null}
     */
    this.onMessageScheduled = null;

    /**
     * Called just before a message is delivered to a node.
     * @type {((msg: object, fromId: string, toId: string) => void) | null}
     */
    this.onMessageDelivered = null;

    /**
     * Called when a message is dropped (crashed node or partition).
     * @type {((msg: object, fromId: string, toId: string, reason: string) => void) | null}
     */
    this.onMessageDropped = null;

    /**
     * Called when a node's election timer fires.
     * @type {((nodeId: string) => void) | null}
     */
    this.onElectionTimeout = null;

    /**
     * Called when the leader sends a heartbeat tick.
     * @type {((nodeId: string) => void) | null}
     */
    this.onHeartbeat = null;

    /**
     * Called when a node's role changes.
     * @type {((nodeId: string, newRole: string, oldRole: string) => void) | null}
     */
    this.onRoleChange = null;

    /**
     * Called when a log entry is delivered to a node's application state machine.
     * @type {((nodeId: string, entry: {msg: string, term: number}) => void) | null}
     */
    this.onDeliver = null;

    /**
     * Called when a node crashes or recovers.
     * @type {((nodeId: string, event: 'crash'|'recover') => void) | null}
     */
    this.onNodeEvent = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the simulation: kick off election timers for all non-leader nodes.
   */
  start() {
    this._running = true;
    for (const nodeId of this._cluster.nodeIds) {
      this._scheduleElectionTimeout(nodeId);
    }
  }

  /**
   * Stop all timers and in-flight messages. Safe to call multiple times.
   */
  stop() {
    this._running = false;
    for (const tid of this._electionTimers.values())  clearTimeout(tid);
    for (const tid of this._heartbeatTimers.values()) clearInterval(tid);
    for (const tid of this._pendingMessages)           clearTimeout(tid);
    this._electionTimers.clear();
    this._heartbeatTimers.clear();
    this._pendingMessages.clear();
  }

  // ── Public control API ────────────────────────────────────────────────────

  /**
   * Crash a node. Volatile state is reset immediately; stable storage is preserved.
   * @param {string} nodeId
   */
  crash(nodeId) {
    if (this._crashed.has(nodeId)) return;
    this._crashed.add(nodeId);
    this._cancelElectionTimer(nodeId);
    this._stopHeartbeat(nodeId);
    this._cluster.getNode(nodeId).recoverFromCrash();  // sets volatile to initial
    this.onNodeEvent?.(nodeId, 'crash');
  }

  /**
   * Recover a previously-crashed node. Stable storage is restored as-is.
   * @param {string} nodeId
   */
  recover(nodeId) {
    if (!this._crashed.has(nodeId)) return;
    this._crashed.delete(nodeId);
    // recoverFromCrash() was called at crash time, so volatile is already reset.
    this._scheduleElectionTimeout(nodeId);
    this.onNodeEvent?.(nodeId, 'recover');
  }

  /**
   * Add a one-way or two-way network partition between two nodes.
   * Messages in both directions are silently dropped.
   *
   * @param {string} nodeA
   * @param {string} nodeB
   */
  addPartition(nodeA, nodeB) {
    this._partitions.add(`${nodeA}→${nodeB}`);
    this._partitions.add(`${nodeB}→${nodeA}`);
  }

  /**
   * Remove a partition between two nodes.
   * @param {string} nodeA
   * @param {string} nodeB
   */
  removePartition(nodeA, nodeB) {
    this._partitions.delete(`${nodeA}→${nodeB}`);
    this._partitions.delete(`${nodeB}→${nodeA}`);
  }

  /**
   * Inject a broadcast request at a specific node (on behalf of the client).
   * If the node is not the leader, the request is forwarded to the leader.
   *
   * @param {string} nodeId
   * @param {string} msg     Human-readable command, e.g. "SET x=1"
   */
  broadcast(nodeId, msg) {
    if (this._crashed.has(nodeId)) return;
    const node   = this._cluster.getNode(nodeId);
    const result = node.onBroadcastRequest(msg);
    this._processEffects(nodeId, result);

    // If the node is a follower with a known leader, forward the request
    if (result.forward) {
      const { msg: fwdMsg, toId } = result.forward;
      const delay = this._messageDelay();
      const tid = setTimeout(() => {
        this._pendingMessages.delete(tid);
        if (!this._crashed.has(toId) && !this._isPartitioned(nodeId, toId)) {
          this.broadcast(toId, fwdMsg);
        }
      }, delay);
      this._pendingMessages.add(tid);
    }
  }

  /** Adjust the speed factor at runtime (e.g. from a speed slider). */
  setSpeedFactor(factor) {
    this._speedFactor = Math.max(0.1, factor);
  }

  /** Return true if the node is currently crashed. */
  isCrashed(nodeId) {
    return this._crashed.has(nodeId);
  }

  /** Return true if messages between the two nodes are currently dropped. */
  isPartitioned(nodeA, nodeB) {
    return this._partitions.has(`${nodeA}→${nodeB}`);
  }

  // ── Internal: message delivery ────────────────────────────────────────────

  /**
   * Schedule a message for delivery after a randomised latency.
   */
  _scheduleMessage(msg, fromId, toId) {
    const delay = this._messageDelay();
    this.onMessageScheduled?.(msg, fromId, toId, delay);

    const tid = setTimeout(() => {
      this._pendingMessages.delete(tid);
      this._deliver(msg, fromId, toId);
    }, delay);
    this._pendingMessages.add(tid);
  }

  /**
   * Deliver a message to a node, calling the appropriate handler.
   */
  _deliver(msg, fromId, toId) {
    if (this._crashed.has(toId)) {
      this.onMessageDropped?.(msg, fromId, toId, 'crashed');
      return;
    }
    if (this._isPartitioned(fromId, toId)) {
      this.onMessageDropped?.(msg, fromId, toId, 'partitioned');
      return;
    }

    this.onMessageDelivered?.(msg, fromId, toId);

    const node    = this._cluster.getNode(toId);
    const oldRole = node.currentRole;
    let   result;
    let   grantedVote = false;

    switch (msg.type) {
      case VOTE_REQUEST:
        result = node.onReceiveVoteRequest(msg);
        grantedVote = result.sends[0]?.msg.granted === true;
        break;

      case VOTE_RESPONSE:
        result = node.onReceiveVoteResponse(msg);
        break;

      case LOG_REQUEST:
        result = node.onReceiveLogRequest(msg);
        if (result.resetElectionTimer) this._resetElectionTimer(toId);
        break;

      case LOG_RESPONSE:
        result = node.onReceiveLogResponse(msg);
        break;

      default:
        console.warn('[Scheduler] Unknown message type:', msg.type);
        return;
    }

    // Synchronise timers with any role change that just occurred
    this._syncTimers(toId, oldRole);

    // Standard Raft: granting a vote resets the follower's election timer, so a
    // node that just voted does not immediately time out and depose the
    // candidate it voted for. Done after _syncTimers (which may have scheduled
    // its own timer on a step-down) so _resetElectionTimer cleanly cancels and
    // reschedules a single timer.
    if (grantedVote && node.currentRole !== LEADER) {
      this._resetElectionTimer(toId);
    }

    this._processEffects(toId, result);
  }

  /**
   * Schedule all sends from an effects object and invoke deliver callbacks.
   */
  _processEffects(nodeId, result) {
    if (!result) return;
    const { sends = [], delivers = [] } = result;

    for (const { msg, toId } of sends) {
      this._scheduleMessage(msg, nodeId, toId);
    }
    for (const entry of delivers) {
      this.onDeliver?.(nodeId, entry);
    }
  }

  // ── Internal: election timers ─────────────────────────────────────────────

  _scheduleElectionTimeout(nodeId) {
    if (!this._running) return;
    if (this._crashed.has(nodeId)) return;
    if (this._cluster.getNode(nodeId).currentRole === LEADER) return;

    const raw   = this._electionTimeoutMin +
                  Math.random() * (this._electionTimeoutMax - this._electionTimeoutMin);
    const delay = raw / this._speedFactor;

    const tid = setTimeout(() => {
      this._electionTimers.delete(nodeId);
      if (!this._running || this._crashed.has(nodeId)) return;

      const node    = this._cluster.getNode(nodeId);
      const oldRole = node.currentRole;

      this.onElectionTimeout?.(nodeId);
      const result = node.onElectionTimeout();

      this._syncTimers(nodeId, oldRole);
      this._processEffects(nodeId, result);

      // Restart timer so the candidate re-elections if no quorum arrives
      this._scheduleElectionTimeout(nodeId);
    }, delay);

    this._electionTimers.set(nodeId, tid);
  }

  _resetElectionTimer(nodeId) {
    this._cancelElectionTimer(nodeId);
    this._scheduleElectionTimeout(nodeId);
  }

  _cancelElectionTimer(nodeId) {
    const tid = this._electionTimers.get(nodeId);
    if (tid !== undefined) {
      clearTimeout(tid);
      this._electionTimers.delete(nodeId);
    }
  }

  // ── Internal: heartbeat timers ────────────────────────────────────────────

  _startHeartbeat(nodeId) {
    if (this._heartbeatTimers.has(nodeId)) return;  // already running
    const period = this._heartbeatPeriod / this._speedFactor;

    const tid = setInterval(() => {
      if (!this._running || this._crashed.has(nodeId)) {
        this._stopHeartbeat(nodeId);
        return;
      }
      const node = this._cluster.getNode(nodeId);
      if (node.currentRole !== LEADER) {
        this._stopHeartbeat(nodeId);
        return;
      }
      this.onHeartbeat?.(nodeId);
      const result = node.onHeartbeatTick();
      this._processEffects(nodeId, result);
    }, period);

    this._heartbeatTimers.set(nodeId, tid);
  }

  _stopHeartbeat(nodeId) {
    const tid = this._heartbeatTimers.get(nodeId);
    if (tid !== undefined) {
      clearInterval(tid);
      this._heartbeatTimers.delete(nodeId);
    }
  }

  // ── Internal: role-transition timer sync ─────────────────────────────────

  /**
   * After a handler runs, check whether the node's role changed and
   * adjust its timers accordingly.
   *
   * @param {string} nodeId
   * @param {string} oldRole  Role before the handler was called
   */
  _syncTimers(nodeId, oldRole) {
    const node    = this._cluster.getNode(nodeId);
    const newRole = node.currentRole;
    if (newRole === oldRole) return;

    this.onRoleChange?.(nodeId, newRole, oldRole);

    if (newRole === LEADER) {
      this._cancelElectionTimer(nodeId);
      this._startHeartbeat(nodeId);

    } else if (oldRole === LEADER) {
      // Stepped down from leader → stop heartbeat, start election timer
      this._stopHeartbeat(nodeId);
      this._scheduleElectionTimeout(nodeId);
    }
    // FOLLOWER → CANDIDATE: election timer was already running; it's rescheduled
    // after onElectionTimeout fires (see _scheduleElectionTimeout call above).
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  _messageDelay() {
    const jitter = (Math.random() * 2 - 1) * this._latencyJitter;
    return Math.max(1, (this._latencyMs + jitter) / this._speedFactor);
  }

  _isPartitioned(fromId, toId) {
    return this._partitions.has(`${fromId}→${toId}`);
  }
}
