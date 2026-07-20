/**
 * node.js — Raft node state machine
 *
 * Implements all nine Kleppmann handlers exactly as written in the lecture
 * notes (Cambridge ConcDisSys, Lecture 6), with the variable names and
 * logic preserved verbatim.
 *
 * Each public handler mutates `this` and returns an effects object:
 *
 *   {
 *     sends:    [{ msg, toId }]   // messages the node wants to send
 *     delivers: [{ msg, term }]   // log entries ready for the application
 *   }
 *
 * The caller (Scheduler) is responsible for routing the sends and notifying
 * the application layer about deliveries.
 *
 * Internal helpers (_replicateLog, _appendEntries, _commitLogEntries) are
 * prefixed with _ and should not be called from outside.
 */

import {
  makeVoteRequest,
  makeVoteResponse,
  makeLogRequest,
  makeLogResponse,
} from './message.js';

// ── Role constants ──────────────────────────────────────────────────────────

export const FOLLOWER  = 'follower';
export const CANDIDATE = 'candidate';
export const LEADER    = 'leader';

// ── Node class ──────────────────────────────────────────────────────────────

export class Node {
  /**
   * @param {string}   nodeId      This node's identifier
   * @param {string[]} allNodeIds  IDs of ALL nodes in the cluster (including this one)
   */
  constructor(nodeId, allNodeIds) {
    this.nodeId      = nodeId;
    this._allNodeIds = allNodeIds;   // cluster membership (immutable for Phase 1–4)

    // ── Slide 1: on initialisation ─────────────────────────────────────────
    // Stable storage: persists across crashes
    this.currentTerm  = 0;
    this.votedFor     = null;
    this.log          = [];          // Array of { msg, term }; 0-based indexing
    this.commitLength = 0;

    // Volatile: reset on crash-recovery
    this.currentRole   = FOLLOWER;
    this.currentLeader = null;
    this.votesReceived = new Set();
    this.sentLength    = new Map();  // followerId → integer (leader only)
    this.ackedLength   = new Map();  // followerId → integer (leader only)
  }

  // ── Crash / recovery ───────────────────────────────────────────────────────

  /** Simulate a crash followed by recovery (Raft 1/9: on recovery from crash). */
  recoverFromCrash() {
    // Slide 1: on recovery from crash
    this.currentRole   = FOLLOWER;
    this.currentLeader = null;
    this.votesReceived = new Set();
    this.sentLength    = new Map();
    this.ackedLength   = new Map();
  }

  // ── Slide 1: on election timeout ──────────────────────────────────────────

  /**
   * Triggered when the election timer fires and no heartbeat has been received.
   * Increments the term, transitions to candidate, votes for itself, and sends
   * a VoteRequest to every node (including itself, per the pseudocode).
   *
   * @returns {{ sends, delivers }}
   */
  onElectionTimeout() {
    // Slide 1: on node nodeId suspects leader has failed, or on election timeout
    this.currentTerm += 1;
    this.currentRole  = CANDIDATE;
    this.votedFor     = this.nodeId;
    this.votesReceived = new Set([this.nodeId]);

    const lastTerm = this.log.length > 0
      ? this.log[this.log.length - 1].term
      : 0;

    const msg = makeVoteRequest(
      this.nodeId,
      this.currentTerm,
      this.log.length,
      lastTerm,
    );

    // "for each node ∈ nodes: send msg to node"
    const sends = this._allNodeIds.map(toId => ({ msg, toId }));
    return { sends, delivers: [] };
  }

  // ── Slide 2: on receiving VoteRequest ────────────────────────────────────

  /**
   * @param {{ cId, cTerm, cLogLength, cLogTerm }} msg
   * @returns {{ sends, delivers }}
   */
  onReceiveVoteRequest({ cId, cTerm, cLogLength, cLogTerm }) {
    // If candidate's term is higher, update ours and step down
    if (cTerm > this.currentTerm) {
      this.currentTerm = cTerm;
      this.currentRole = FOLLOWER;
      this.votedFor    = null;
    }

    const lastTerm = this.log.length > 0
      ? this.log[this.log.length - 1].term
      : 0;

    // logOk: candidate's log is at least as up-to-date as ours
    const logOk = (cLogTerm > lastTerm) ||
                  (cLogTerm === lastTerm && cLogLength >= this.log.length);

    const grant = (cTerm === this.currentTerm) &&
                  logOk &&
                  (this.votedFor === cId || this.votedFor === null);

    if (grant) {
      this.votedFor = cId;
    }

    const response = makeVoteResponse(this.nodeId, this.currentTerm, grant);
    return { sends: [{ msg: response, toId: cId }], delivers: [] };
  }

  // ── Slide 3: on receiving VoteResponse ───────────────────────────────────

  /**
   * @param {{ voterId, term, granted }} msg
   * @returns {{ sends, delivers }}
   */
  onReceiveVoteResponse({ voterId, term, granted }) {
    const sends = [];

    if (this.currentRole === CANDIDATE &&
        term === this.currentTerm &&
        granted) {

      this.votesReceived.add(voterId);
      const quorum = Math.ceil((this._allNodeIds.length + 1) / 2);

      if (this.votesReceived.size >= quorum) {
        // Won the election — become leader
        this.currentRole   = LEADER;
        this.currentLeader = this.nodeId;

        // Initialise sentLength / ackedLength for all followers, then replicate
        for (const follower of this._allNodeIds) {
          if (follower === this.nodeId) continue;
          this.sentLength.set(follower, this.log.length);
          this.ackedLength.set(follower, 0);
          sends.push(...this._replicateLog(follower));
        }
      }

    } else if (term > this.currentTerm) {
      // A later term means someone else has moved on; step down
      this.currentTerm = term;
      this.currentRole = FOLLOWER;
      this.votedFor    = null;
      // Caller (Scheduler) cancels the election timer on role change
    }

    return { sends, delivers: [] };
  }

  // ── Slide 4: on broadcast request ────────────────────────────────────────

  /**
   * Application layer wants to broadcast a message through total order broadcast.
   * If leader: appends to log and replicates. If follower: returns a forward effect.
   *
   * @param {string} msg  Human-readable command string, e.g. "SET x=1"
   * @returns {{ sends, delivers, forward?: { msg, toId } }}
   */
  onBroadcastRequest(msg) {
    if (this.currentRole === LEADER) {
      this.log.push({ msg, term: this.currentTerm });
      this.ackedLength.set(this.nodeId, this.log.length);

      const sends = [];
      for (const follower of this._allNodeIds) {
        if (follower === this.nodeId) continue;
        sends.push(...this._replicateLog(follower));
      }
      return { sends, delivers: [] };

    } else {
      // "forward the request to currentLeader via a FIFO link"
      // Represented as a special forward effect for the Scheduler to route.
      return {
        sends:   [],
        delivers: [],
        forward: this.currentLeader !== null
          ? { msg, toId: this.currentLeader }
          : null,
      };
    }
  }

  // ── Slide 4: periodically (heartbeat tick) ────────────────────────────────

  /**
   * Called by the Scheduler on each heartbeat period (leader only).
   * Sends a LogRequest to every follower; an empty suffix serves as heartbeat.
   *
   * @returns {{ sends, delivers }}
   */
  onHeartbeatTick() {
    if (this.currentRole !== LEADER) return { sends: [], delivers: [] };

    const sends = [];
    for (const follower of this._allNodeIds) {
      if (follower === this.nodeId) continue;
      sends.push(...this._replicateLog(follower));
    }
    return { sends, delivers: [] };
  }

  // ── Slide 6: on receiving LogRequest ─────────────────────────────────────

  /**
   * @param {{ leaderId, term, prefixLen, prefixTerm, leaderCommit, suffix }} msg
   * @returns {{ sends, delivers, resetElectionTimer: boolean }}
   */
  onReceiveLogRequest({ leaderId, term, prefixLen, prefixTerm, leaderCommit, suffix }) {
    let resetTimer = false;

    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor    = null;
      // Caller cancels election timer (handled via role-change detection)
    }

    if (term === this.currentTerm) {
      this.currentRole   = FOLLOWER;
      this.currentLeader = leaderId;
      resetTimer = true;  // Valid heartbeat from current leader
    }

    // logOk: our log is consistent with the leader's prefix
    const logOk = (this.log.length >= prefixLen) &&
                  (prefixLen === 0 ||
                   this.log[prefixLen - 1].term === prefixTerm);

    if (term === this.currentTerm && logOk) {
      const delivers = this._appendEntries(prefixLen, leaderCommit, suffix);
      const ack = prefixLen + suffix.length;
      const response = makeLogResponse(this.nodeId, this.currentTerm, ack, true);
      return {
        sends:      [{ msg: response, toId: leaderId }],
        delivers,
        resetElectionTimer: resetTimer,
      };
    } else {
      const response = makeLogResponse(this.nodeId, this.currentTerm, 0, false);
      return {
        sends:      [{ msg: response, toId: leaderId }],
        delivers:   [],
        resetElectionTimer: false,
      };
    }
  }

  // ── Slide 8: on receiving LogResponse ────────────────────────────────────

  /**
   * @param {{ follower, term, ack, success }} msg
   * @returns {{ sends, delivers }}
   */
  onReceiveLogResponse({ follower, term, ack, success }) {
    const sends    = [];
    let   delivers = [];

    if (term === this.currentTerm && this.currentRole === LEADER) {

      if (success && ack >= (this.ackedLength.get(follower) ?? 0)) {
        // Follower has successfully replicated up to index `ack`
        this.sentLength.set(follower, ack);
        this.ackedLength.set(follower, ack);
        delivers = this._commitLogEntries();

      } else if ((this.sentLength.get(follower) ?? 0) > 0) {
        // Follower rejected — back up one entry and retry
        this.sentLength.set(follower, this.sentLength.get(follower) - 1);
        sends.push(...this._replicateLog(follower));
      }

    } else if (term > this.currentTerm) {
      // Later term — step down
      this.currentTerm = term;
      this.currentRole = FOLLOWER;
      this.votedFor    = null;
      // Caller stops heartbeat and restarts election timer
    }

    return { sends, delivers };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Slide 5: ReplicateLog(leaderId, followerId)
   * Constructs the LogRequest for a specific follower and returns it as a send.
   *
   * @param {string} followerId
   * @returns {{ msg, toId }[]}  Array of one send effect
   */
  _replicateLog(followerId) {
    const prefixLen  = this.sentLength.get(followerId) ?? 0;
    const suffix     = this.log.slice(prefixLen);
    const prefixTerm = prefixLen > 0 ? this.log[prefixLen - 1].term : 0;

    const msg = makeLogRequest(
      this.nodeId,
      this.currentTerm,
      prefixLen,
      prefixTerm,
      this.commitLength,
      suffix,
    );
    return [{ msg, toId: followerId }];
  }

  /**
   * Slide 7: AppendEntries(prefixLen, leaderCommit, suffix)
   * Truncates inconsistent log entries, appends new ones, and advances
   * commitLength if the leader has committed further than we have.
   *
   * @returns {{ msg, term }[]}  Log entries delivered to the application
   */
  _appendEntries(prefixLen, leaderCommit, suffix) {
    // Detect and truncate a conflicting entry at the overlap point
    if (suffix.length > 0 && this.log.length > prefixLen) {
      const index = Math.min(this.log.length, prefixLen + suffix.length) - 1;
      if (this.log[index].term !== suffix[index - prefixLen].term) {
        this.log = this.log.slice(0, prefixLen);
      }
    }

    // Append any new entries that are not already in our log
    if (prefixLen + suffix.length > this.log.length) {
      const start = this.log.length - prefixLen;
      for (let i = start; i < suffix.length; i++) {
        this.log.push(suffix[i]);
      }
    }

    // Commit newly-received entries that the leader has committed
    const delivers = [];
    if (leaderCommit > this.commitLength) {
      for (let i = this.commitLength; i < leaderCommit; i++) {
        delivers.push(this.log[i]);
      }
      this.commitLength = leaderCommit;
    }

    return delivers;
  }

  /**
   * Slide 9: CommitLogEntries()
   * Determines the highest log index acknowledged by a quorum and commits
   * all entries up to that index (if they are from the current term).
   *
   * @returns {{ msg, term }[]}  Log entries delivered to the application
   */
  _commitLogEntries() {
    const minAcks = Math.ceil((this._allNodeIds.length + 1) / 2);

    // acks(len) = |{n ∈ nodes | ackedLength[n] ≥ len}|
    const acks = len => {
      let count = 0;
      for (const id of this._allNodeIds) {
        if ((this.ackedLength.get(id) ?? 0) >= len) count++;
      }
      return count;
    };

    // Find max(ready) where ready = {len ∈ {1…log.length} | acks(len) ≥ minAcks}
    let maxReady = 0;
    for (let len = 1; len <= this.log.length; len++) {
      if (acks(len) >= minAcks) maxReady = len;
    }

    const delivers = [];
    if (maxReady > this.commitLength &&
        this.log[maxReady - 1].term === this.currentTerm) {
      for (let i = this.commitLength; i < maxReady; i++) {
        delivers.push(this.log[i]);
      }
      this.commitLength = maxReady;
    }

    return delivers;
  }
}
