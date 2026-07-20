/**
 * message.js — Raft message types
 *
 * Exactly the four message types defined in Kleppmann's pseudocode.
 * Factory functions guarantee the correct shape and presence of every field.
 */

// ── Type tag constants ──────────────────────────────────────────────────────

export const VOTE_REQUEST  = 'VoteRequest';
export const VOTE_RESPONSE = 'VoteResponse';
export const LOG_REQUEST   = 'LogRequest';
export const LOG_RESPONSE  = 'LogResponse';

// ── Factory functions ───────────────────────────────────────────────────────

/**
 * VoteRequest — sent by a candidate to all nodes when starting an election.
 *
 * @param {string} cId         Candidate's node ID
 * @param {number} cTerm       Candidate's current term (after incrementing)
 * @param {number} cLogLength  Length of the candidate's log
 * @param {number} cLogTerm    Term of the last entry in the candidate's log (0 if empty)
 */
export function makeVoteRequest(cId, cTerm, cLogLength, cLogTerm) {
  return { type: VOTE_REQUEST, cId, cTerm, cLogLength, cLogTerm };
}

/**
 * VoteResponse — sent by a node back to the candidate after processing a VoteRequest.
 *
 * @param {string}  voterId  Node ID of the voter
 * @param {number}  term     Voter's current term at the time of response
 * @param {boolean} granted  Whether the vote was granted
 */
export function makeVoteResponse(voterId, term, granted) {
  return { type: VOTE_RESPONSE, voterId, term, granted };
}

/**
 * LogRequest — sent by the leader to a follower to replicate log entries
 * (and as a periodic heartbeat when suffix is empty).
 *
 * @param {string}   leaderId      Leader's node ID
 * @param {number}   term          Leader's current term
 * @param {number}   prefixLen     Number of log entries preceding the suffix
 * @param {number}   prefixTerm    Term of the last entry in the prefix (0 if prefixLen=0)
 * @param {number}   leaderCommit  Leader's current commitLength
 * @param {object[]} suffix        Array of {msg, term} log entries to append
 */
export function makeLogRequest(leaderId, term, prefixLen, prefixTerm, leaderCommit, suffix) {
  return { type: LOG_REQUEST, leaderId, term, prefixLen, prefixTerm, leaderCommit, suffix };
}

/**
 * LogResponse — sent by a follower back to the leader after processing a LogRequest.
 *
 * @param {string}  follower  Follower's node ID
 * @param {number}  term      Follower's current term at the time of response
 * @param {number}  ack       Number of log entries acknowledged (prefixLen + suffix.length)
 * @param {boolean} success   Whether the LogRequest was accepted
 */
export function makeLogResponse(follower, term, ack, success) {
  return { type: LOG_RESPONSE, follower, term, ack, success };
}
