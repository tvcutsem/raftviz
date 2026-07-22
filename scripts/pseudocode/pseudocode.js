/**
 * pseudocode.js — Kleppmann Raft pseudocode, slides 1–9.
 *
 * NOTE ON LICENSING: The pseudocode content in this file is derived from Martin
 * Kleppmann's "Concurrent and Distributed Systems" lecture notes and is shared
 * under the Creative Commons Attribution-ShareAlike 4.0 International license
 * (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/), the same terms
 * as the source material. This differs from the rest of the repository, which is
 * MIT-licensed. See the README "License & credits" section.
 *
 * Each slide is:
 *   { num: Number, title: String, lines: Array<[indent, text] | null> }
 *
 * A null entry is a blank spacer line.  Line indices (0-based within each
 * slide's `lines` array, counting blank lines) are used by the HL constants
 * below to identify which lines to highlight for a given simulation event.
 *
 * Variable names match node.js exactly (Kleppmann's pseudocode).
 */

// ── Slide data ────────────────────────────────────────────────────────────────

export const SLIDES = [

  // ── Slide 1/9: Initialisation ───────────────────────────────────────────────
  {
    num: 1,
    title: 'Initialisation',
    lines: [
      // idx  0
      [0, 'on initialisation'],
      // idx  1
      [1, 'currentTerm := 0;  votedFor := null'],
      // idx  2
      [1, 'log := \u27E8\u27E9;  commitLength := 0'],
      // idx  3
      [1, 'currentRole := follower;  currentLeader := null'],
      // idx  4
      [1, 'votesReceived := {};  sentLength := \u27E8\u27E9;  ackedLength := \u27E8\u27E9'],
      // idx  5  (blank)
      null,
      // idx  6
      [0, 'on recovery from crash'],
      // idx  7
      [1, 'currentRole := follower;  currentLeader := null'],
      // idx  8
      [1, 'votesReceived := {};  sentLength := \u27E8\u27E9;  ackedLength := \u27E8\u27E9'],
      // idx  9  (blank)
      null,
      // idx 10
      [0, 'on node nodeId suspects leader failed, or on election timeout'],
      // idx 11
      [1, 'currentTerm := currentTerm + 1;  currentRole := candidate'],
      // idx 12
      [1, 'votedFor := nodeId;  votesReceived := {nodeId};  lastTerm := 0'],
      // idx 13
      [1, 'if log.length > 0 then'],
      // idx 14
      [2, 'lastTerm := log[log.length\u22121].term'],
      // idx 15
      [1, 'end if'],
      // idx 16
      [1, 'msg := (VoteRequest, nodeId, currentTerm, log.length, lastTerm)'],
      // idx 17
      [1, 'for each node \u2208 nodes:'],
      // idx 18
      [2, 'send msg to node'],
      // idx 19
      [1, 'end for'],
      // idx 20
      [1, 'start election timer'],
    ],
  },

  // ── Slide 2/9: Voting on a new leader ──────────────────────────────────────
  {
    num: 2,
    title: 'Voting on a new leader',
    lines: [
      // idx  0
      [0, 'on receiving (VoteRequest, cId, cTerm,'],
      // idx  1
      [1, 'cLogLength, cLogTerm) at node nodeId'],
      // idx  2  (blank)
      null,
      // idx  3
      [1, 'if cTerm > currentTerm then'],
      // idx  4
      [2, 'currentTerm := cTerm;  currentRole := follower'],
      // idx  5
      [2, 'votedFor := null'],
      // idx  6
      [1, 'end if'],
      // idx  7
      [1, 'lastTerm := 0'],
      // idx  8
      [1, 'if log.length > 0 then'],
      // idx  9
      [2, 'lastTerm := log[log.length\u22121].term'],
      // idx 10
      [1, 'end if'],
      // idx 11
      [1, 'logOk := (cLogTerm > lastTerm)  \u2228'],
      // idx 12
      [3, '(cLogTerm = lastTerm  \u2227  cLogLength \u2265 log.length)'],
      // idx 13  (blank)
      null,
      // idx 14
      [1, 'if cTerm = currentTerm  \u2227  logOk  \u2227  votedFor \u2208 {cId, null} then'],
      // idx 15
      [2, 'votedFor := cId'],
      // idx 16
      [2, 'send (VoteResponse, nodeId, currentTerm, true) to node cId'],
      // idx 17
      [2, 'reset election timer // (not on Kleppmann slide)'],
      // idx 18
      [1, 'else'],
      // idx 19
      [2, 'send (VoteResponse, nodeId, currentTerm, false) to node cId'],
      // idx 20
      [1, 'end if'],
    ],
  },

  // ── Slide 3/9: Collecting votes ─────────────────────────────────────────────
  {
    num: 3,
    title: 'Collecting votes',
    lines: [
      // idx  0
      [0, 'on receiving (VoteResponse, voterId, term, granted) at nodeId'],
      // idx  1  (blank)
      null,
      // idx  2
      [1, 'if currentRole = candidate  \u2227  term = currentTerm  \u2227  granted then'],
      // idx  3
      [2, 'votesReceived := votesReceived \u222A {voterId}'],
      // idx  4
      [2, 'if |votesReceived| \u2265 \u2308(|nodes| + 1) / 2\u2309 then'],
      // idx  5
      [3, 'currentRole := leader;  currentLeader := nodeId'],
      // idx  6
      [3, 'cancel election timer'],
      // idx  7
      [3, 'for each follower \u2208 nodes \\ {nodeId}'],
      // idx  8
      [4, 'sentLength[follower] := log.length'],
      // idx  9
      [4, 'ackedLength[follower] := 0'],
      // idx 10
      [4, 'ReplicateLog(nodeId, follower)'],
      // idx 11
      [3, 'end for'],
      // idx 12
      [2, 'end if'],
      // idx 13
      [1, 'else if term > currentTerm then'],
      // idx 14
      [2, 'currentTerm := term'],
      // idx 15
      [2, 'currentRole := follower'],
      // idx 16
      [2, 'votedFor := null'],
      // idx 17
      [2, 'cancel election timer'],
      // idx 18
      [1, 'end if'],
    ],
  },

  // ── Slide 4/9: Broadcasting messages ───────────────────────────────────────
  {
    num: 4,
    title: 'Broadcasting messages',
    lines: [
      // idx  0
      [0, 'on request to broadcast msg at node nodeId'],
      // idx  1
      [1, 'if currentRole = leader then'],
      // idx  2
      [2, 'append (msg: msg, term: currentTerm) to log'],
      // idx  3
      [2, 'ackedLength[nodeId] := log.length'],
      // idx  4
      [2, 'for each follower \u2208 nodes \\ {nodeId}'],
      // idx  5
      [3, 'ReplicateLog(nodeId, follower)'],
      // idx  6
      [2, 'end for'],
      // idx  7
      [1, 'else'],
      // idx  8
      [2, 'forward request to currentLeader via a FIFO link'],
      // idx  9
      [1, 'end if'],
      // idx 10  (blank)
      null,
      // idx 11
      [0, 'periodically at node nodeId'],
      // idx 12
      [1, 'if currentRole = leader then'],
      // idx 13
      [2, 'for each follower \u2208 nodes \\ {nodeId}'],
      // idx 14
      [3, 'ReplicateLog(nodeId, follower)'],
      // idx 15
      [2, 'end for'],
      // idx 16
      [1, 'end if'],
    ],
  },

  // ── Slide 5/9: Replicating from leader to followers ─────────────────────────
  {
    num: 5,
    title: 'Replicating to followers',
    lines: [
      // idx  0
      [0, 'function ReplicateLog(leaderId, followerId)'],
      // idx  1
      [1, 'prefixLen := sentLength[followerId]'],
      // idx  2
      [1, 'suffix := \u27E8log[prefixLen], \u2026, log[log.length\u22121]\u27E9'],
      // idx  3
      [1, 'prefixTerm := 0'],
      // idx  4
      [1, 'if prefixLen > 0 then'],
      // idx  5
      [2, 'prefixTerm := log[prefixLen \u2212 1].term'],
      // idx  6
      [1, 'end if'],
      // idx  7
      [1, 'send (LogRequest, leaderId, currentTerm, prefixLen,'],
      // idx  8
      [2, 'prefixTerm, commitLength, suffix) to followerId'],
      // idx  9
      [0, 'end function'],
    ],
  },

  // ── Slide 6/9: Followers receiving messages ─────────────────────────────────
  {
    num: 6,
    title: 'Followers receiving messages',
    lines: [
      // idx  0
      [0, 'on receiving (LogRequest, leaderId, term, prefixLen,'],
      // idx  1
      [1, 'prefixTerm, leaderCommit, suffix) at node nodeId'],
      // idx  2
      [1, 'if term > currentTerm then'],
      // idx  3
      [2, 'currentTerm := term;  votedFor := null'],
      // idx  4
      [2, 'cancel election timer'],
      // idx  5
      [1, 'end if'],
      // idx  6
      [1, 'if term = currentTerm then'],
      // idx  7
      [2, 'currentRole := follower;  currentLeader := leaderId'],
      // idx  8
      [1, 'end if'],
      // idx  9
      [1, 'logOk := (log.length \u2265 prefixLen)  \u2227'],
      // idx 10
      [3, '(prefixLen = 0  \u2228  log[prefixLen\u22121].term = prefixTerm)'],
      // idx 11
      [1, 'if term = currentTerm  \u2227  logOk then'],
      // idx 12
      [2, 'AppendEntries(prefixLen, leaderCommit, suffix)'],
      // idx 13
      [2, 'ack := prefixLen + suffix.length'],
      // idx 14
      [2, 'send (LogResponse, nodeId, currentTerm, ack, true) to leaderId'],
      // idx 15
      [1, 'else'],
      // idx 16
      [2, 'send (LogResponse, nodeId, currentTerm, 0, false) to leaderId'],
      // idx 17
      [1, 'end if'],
    ],
  },

  // ── Slide 7/9: Updating followers' logs ────────────────────────────────────
  {
    num: 7,
    title: "Updating followers' logs",
    lines: [
      // idx  0
      [0, 'function AppendEntries(prefixLen, leaderCommit, suffix)'],
      // idx  1
      [1, 'if suffix.length > 0  \u2227  log.length > prefixLen then'],
      // idx  2
      [2, 'index := min(log.length, prefixLen + suffix.length) \u2212 1'],
      // idx  3
      [2, 'if log[index].term \u2260 suffix[index \u2212 prefixLen].term then'],
      // idx  4
      [3, 'log := \u27E8log[0], \u2026, log[prefixLen \u2212 1]\u27E9'],
      // idx  5
      [2, 'end if'],
      // idx  6
      [1, 'end if'],
      // idx  7
      [1, 'if prefixLen + suffix.length > log.length then'],
      // idx  8
      [2, 'for i := log.length \u2212 prefixLen to suffix.length \u2212 1'],
      // idx  9
      [3, 'append suffix[i] to log'],
      // idx 10
      [2, 'end for'],
      // idx 11
      [1, 'end if'],
      // idx 12
      [1, 'if leaderCommit > commitLength then'],
      // idx 13
      [2, 'for i := commitLength to leaderCommit \u2212 1'],
      // idx 14
      [3, 'deliver log[i].msg to the application'],
      // idx 15
      [2, 'end for'],
      // idx 16
      [2, 'commitLength := leaderCommit'],
      // idx 17
      [1, 'end if'],
      // idx 18
      [0, 'end function'],
    ],
  },

  // ── Slide 8/9: Leader receiving log acknowledgements ───────────────────────
  {
    num: 8,
    title: 'Leader receiving log acks',
    lines: [
      // idx  0
      [0, 'on receiving (LogResponse, follower, term, ack, success) at nodeId'],
      // idx  1
      [1, 'if term = currentTerm  \u2227  currentRole = leader then'],
      // idx  2
      [2, 'if success = true  \u2227  ack \u2265 ackedLength[follower] then'],
      // idx  3
      [3, 'sentLength[follower] := ack'],
      // idx  4
      [3, 'ackedLength[follower] := ack'],
      // idx  5
      [3, 'CommitLogEntries()'],
      // idx  6
      [2, 'else if sentLength[follower] > 0 then'],
      // idx  7
      [3, 'sentLength[follower] := sentLength[follower] \u2212 1'],
      // idx  8
      [3, 'ReplicateLog(nodeId, follower)'],
      // idx  9
      [2, 'end if'],
      // idx 10
      [1, 'else if term > currentTerm then'],
      // idx 11
      [2, 'currentTerm := term'],
      // idx 12
      [2, 'currentRole := follower'],
      // idx 13
      [2, 'votedFor := null'],
      // idx 14
      [2, 'cancel election timer'],
      // idx 15
      [1, 'end if'],
    ],
  },

  // ── Slide 9/9: Leader committing log entries ────────────────────────────────
  {
    num: 9,
    title: 'Committing log entries',
    lines: [
      // idx  0
      [0, 'define acks(length) = |{n \u2208 nodes  |  ackedLength[n] \u2265 length}|'],
      // idx  1  (blank)
      null,
      // idx  2
      [0, 'function CommitLogEntries()'],
      // idx  3
      [1, 'minAcks := \u2308(|nodes| + 1) / 2\u2309'],
      // idx  4
      [1, 'ready := {len \u2208 {1,\u2026,log.length}  |  acks(len) \u2265 minAcks}'],
      // idx  5
      [1, 'if ready \u2260 {}  \u2227  max(ready) > commitLength  \u2227'],
      // idx  6
      [2, 'log[max(ready) \u2212 1].term = currentTerm then'],
      // idx  7
      [2, 'for i := commitLength to max(ready) \u2212 1'],
      // idx  8
      [3, 'deliver log[i].msg to the application'],
      // idx  9
      [2, 'end for'],
      // idx 10
      [2, 'commitLength := max(ready)'],
      // idx 11
      [1, 'end if'],
      // idx 12
      [0, 'end function'],
    ],
  },
];

// ── Highlight constants ───────────────────────────────────────────────────────
//
// Each entry is [slideNumber, lineIndices[]] — pass directly to
// PseudocodePanel.highlight() via spread:
//
//   panel.highlight(...HL.ELECTION_TIMEOUT);
//

export const HL = {

  // — Slide 1 —
  INIT:               [1, [0, 1, 2, 3, 4]],
  RECOVERY:           [1, [6, 7, 8]],
  TIMER_RESET:        [1, [20]],              // "start election timer" line only
  ELECTION_TIMEOUT:   [1, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
  VOTE_REQ_SEND:      [1, [16, 17, 18, 19]],

  // — Slide 2 —
  RECV_VOTE_REQUEST:  [2, [0, 1]],
  STEP_DOWN_2:        [2, [3, 4, 5, 6]],
  GRANT_VOTE:         [2, [14, 15, 16, 17]],
  DENY_VOTE:          [2, [18, 19]],

  // — Slide 3 —
  RECV_VOTE_RESPONSE: [3, [0]],
  BECOME_LEADER:      [3, [4, 5, 6, 7, 8, 9, 10, 11, 12]],
  STEP_DOWN_3:        [3, [13, 14, 15, 16, 17]],

  // — Slide 4 —
  BROADCAST_LEADER:   [4, [1, 2, 3, 4, 5]],
  BROADCAST_FORWARD:  [4, [7, 8]],
  HEARTBEAT:          [4, [11, 12, 13, 14]],

  // — Slide 5 —
  REPLICATE_LOG:      [5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  REPLICATE_SEND:     [5, [7, 8]],

  // — Slide 6 —
  RECV_LOG_REQUEST:   [6, [0, 1]],
  LOG_REQUEST_OK:     [6, [11, 12, 13, 14]],
  LOG_REQUEST_FAIL:   [6, [15, 16]],

  // — Slide 7 —
  APPEND_ENTRIES:     [7, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  APPEND_DELIVER:     [7, [12, 13, 14, 15, 16]],

  // — Slide 8 —
  RECV_LOG_RESPONSE:  [8, [0]],
  LOG_RESPONSE_OK:    [8, [2, 3, 4, 5]],
  LOG_RESPONSE_BACKOFF: [8, [6, 7, 8]],
  STEP_DOWN_8:        [8, [10, 11, 12, 13, 14]],

  // — Slide 9 —
  COMMIT_LOG:         [9, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  COMMIT_DELIVER:     [9, [7, 8, 9, 10]],
};
