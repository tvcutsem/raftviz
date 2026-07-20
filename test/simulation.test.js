/**
 * simulation.test.js — Unit tests for the Raft simulation core
 *
 * Run with Node.js:
 *   node test/simulation.test.js
 *
 * Tests cover all nine Kleppmann handlers against concrete scenarios, plus
 * crash-recovery behaviour and the quorum commit logic.
 *
 * No external test framework is used: the harness is a ~30-line assertion
 * runner that prints results to stdout.
 */

// Node.js ESM: resolve imports relative to this file
import { Node, FOLLOWER, CANDIDATE, LEADER } from '../scripts/simulation/node.js';
import { Cluster }   from '../scripts/simulation/cluster.js';
import {
  makeVoteRequest, makeVoteResponse,
  makeLogRequest, makeLogResponse,
} from '../scripts/simulation/message.js';

// ── Minimal test harness ──────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;
let _currentSuite = '';

function suite(name) {
  _currentSuite = name;
  console.log(`\n── ${name} ──`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    _passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    _failed++;
  }
}

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ? label + ': ' : ''}expected ${e}, got ${a}`);
  }
}

function assertDeepEqual(actual, expected, label = '') {
  assertEqual(actual, expected, label);
}

// ── Helper: make a fresh 3-node cluster ──────────────────────────────────

function makeCluster(ids = ['A', 'B', 'C']) {
  return new Cluster(ids);
}

// ── Tests ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────
suite('Slide 1 — Initialisation');
// ─────────────────────────────────────────────

test('all nodes start as followers with term 0 and empty log', () => {
  const c = makeCluster();
  for (const id of c.nodeIds) {
    const n = c.getNode(id);
    assertEqual(n.currentTerm,   0,          `${id}.currentTerm`);
    assertEqual(n.currentRole,   FOLLOWER,   `${id}.currentRole`);
    assertEqual(n.votedFor,      null,       `${id}.votedFor`);
    assertEqual(n.log.length,    0,          `${id}.log.length`);
    assertEqual(n.commitLength,  0,          `${id}.commitLength`);
    assertEqual(n.currentLeader, null,       `${id}.currentLeader`);
    assert(n.votesReceived instanceof Set,   `${id}.votesReceived is Set`);
    assertEqual(n.votesReceived.size, 0,     `${id}.votesReceived.size`);
  }
});

// ─────────────────────────────────────────────
suite('Slide 1 — Election timeout');
// ─────────────────────────────────────────────

test('onElectionTimeout increments term and becomes candidate', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  a.onElectionTimeout();
  assertEqual(a.currentTerm,  1,          'term');
  assertEqual(a.currentRole,  CANDIDATE,  'role');
  assertEqual(a.votedFor,     'A',        'votedFor (self)');
  assert(a.votesReceived.has('A'),        'voted for self in votesReceived');
  assertEqual(a.votesReceived.size, 1,    'only one vote so far');
});

test('onElectionTimeout sends VoteRequest to all nodes (including self)', () => {
  const c = makeCluster();
  const { sends } = c.getNode('A').onElectionTimeout();
  assertEqual(sends.length, 3, '3 sends for 3-node cluster');
  const targets = sends.map(s => s.toId).sort();
  assertDeepEqual(targets, ['A', 'B', 'C'], 'sent to all nodes');
  for (const { msg } of sends) {
    assertEqual(msg.type,       'VoteRequest', 'message type');
    assertEqual(msg.cId,        'A',           'cId');
    assertEqual(msg.cTerm,      1,             'cTerm');
    assertEqual(msg.cLogLength, 0,             'empty log');
    assertEqual(msg.cLogTerm,   0,             'no last term');
  }
});

test('VoteRequest includes correct lastTerm for non-empty log', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  // Manually stuff a log entry (term 1)
  a.currentTerm = 1;
  a.log = [{ msg: 'SET x=1', term: 1 }];
  const { sends } = a.onElectionTimeout();
  const msg = sends[0].msg;
  assertEqual(msg.cLogLength, 1, 'log length');
  assertEqual(msg.cLogTerm,   1, 'last entry term');
  assertEqual(msg.cTerm,      2, 'term incremented');
});

// ─────────────────────────────────────────────
suite('Slide 2 — VoteRequest handling');
// ─────────────────────────────────────────────

test('follower grants vote when all conditions met', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  const req = makeVoteRequest('A', 1, 0, 0);  // term 1, empty log
  const { sends, delivers } = b.onReceiveVoteRequest(req);
  assertEqual(delivers.length, 0, 'no deliveries');
  assertEqual(sends.length, 1, 'one response');
  const res = sends[0].msg;
  assertEqual(res.type,    'VoteResponse', 'type');
  assertEqual(res.voterId, 'B',            'voterId');
  assertEqual(res.term,    1,              'term');
  assertEqual(res.granted, true,           'granted');
  assertEqual(sends[0].toId, 'A',         'response goes to candidate');
  assertEqual(b.votedFor, 'A',            'votedFor set');
});

test('follower denies vote for lower term', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 2;
  const req = makeVoteRequest('A', 1, 0, 0);
  const { sends } = b.onReceiveVoteRequest(req);
  assertEqual(sends[0].msg.granted, false, 'denied');
  assertEqual(b.votedFor, null, 'votedFor unchanged');
});

test('follower denies vote if already voted for someone else', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 1;
  b.votedFor    = 'C';
  const req = makeVoteRequest('A', 1, 0, 0);
  const { sends } = b.onReceiveVoteRequest(req);
  assertEqual(sends[0].msg.granted, false, 'denied (already voted for C)');
  assertEqual(b.votedFor, 'C', 'votedFor unchanged');
});

test('follower grants vote again for same candidate (idempotent)', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 1;
  b.votedFor    = 'A';
  const req = makeVoteRequest('A', 1, 0, 0);
  const { sends } = b.onReceiveVoteRequest(req);
  assertEqual(sends[0].msg.granted, true, 'granted (same candidate)');
});

test('follower updates term and steps down when seeing higher term in VoteRequest', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 2;
  b.currentRole = CANDIDATE;
  b.votedFor    = 'B';
  const req = makeVoteRequest('A', 3, 0, 0);
  b.onReceiveVoteRequest(req);
  assertEqual(b.currentTerm, 3,        'term updated');
  assertEqual(b.currentRole, FOLLOWER, 'stepped down');
  assertEqual(b.votedFor,    'A',      'voted for requester after step-down');
});

test('logOk: candidate with higher lastTerm wins, regardless of log length', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  // B has 2 entries in term 1
  b.currentTerm = 1;
  b.log = [{ msg: 'm1', term: 1 }, { msg: 'm2', term: 1 }];
  // Candidate has 1 entry but in term 2 — more up-to-date
  const req = makeVoteRequest('A', 2, 1, 2);
  const { sends } = b.onReceiveVoteRequest(req);
  assertEqual(sends[0].msg.granted, true, 'higher lastTerm wins');
});

test('logOk: equal lastTerm, shorter candidate log loses', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 1;
  b.log = [{ msg: 'm1', term: 1 }, { msg: 'm2', term: 1 }];
  const req = makeVoteRequest('A', 2, 1, 1);  // cLogLength=1 < b.log.length=2
  const { sends } = b.onReceiveVoteRequest(req);
  assertEqual(sends[0].msg.granted, false, 'shorter log loses');
});

// ─────────────────────────────────────────────
suite('Slide 3 — VoteResponse handling');
// ─────────────────────────────────────────────

test('candidate wins election on reaching quorum', () => {
  const c = makeCluster();  // 3 nodes: quorum = 2
  const a = c.getNode('A');
  a.onElectionTimeout();    // term=1, candidate, votesReceived={A}

  // Receive vote from B
  const res = makeVoteResponse('B', 1, true);
  const { sends } = a.onReceiveVoteResponse(res);

  assertEqual(a.currentRole,   LEADER, 'A became leader');
  assertEqual(a.currentLeader, 'A',    'currentLeader set to self');
  // Should send LogRequest to B and C
  const sentToB = sends.some(s => s.toId === 'B' && s.msg.type === 'LogRequest');
  const sentToC = sends.some(s => s.toId === 'C' && s.msg.type === 'LogRequest');
  assert(sentToB, 'sent LogRequest to B');
  assert(sentToC, 'sent LogRequest to C');
});

test('sentLength and ackedLength initialised on becoming leader', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  a.onElectionTimeout();
  a.onReceiveVoteResponse(makeVoteResponse('B', 1, true));
  assertEqual(a.sentLength.get('B'),  0, 'sentLength[B] = 0 (empty log)');
  assertEqual(a.sentLength.get('C'),  0, 'sentLength[C] = 0');
  assertEqual(a.ackedLength.get('B'), 0, 'ackedLength[B] = 0');
  assertEqual(a.ackedLength.get('C'), 0, 'ackedLength[C] = 0');
});

test('candidate steps down on receiving VoteResponse with higher term', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  a.onElectionTimeout();  // term=1, candidate
  const res = makeVoteResponse('B', 2, false);  // higher term
  a.onReceiveVoteResponse(res);
  assertEqual(a.currentTerm, 2,        'term updated');
  assertEqual(a.currentRole, FOLLOWER, 'stepped down');
  assertEqual(a.votedFor,    null,     'votedFor cleared');
});

test('ignored: VoteResponse for wrong term', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  a.onElectionTimeout();   // term=1
  const res = makeVoteResponse('B', 0, true);  // old term
  a.onReceiveVoteResponse(res);
  assertEqual(a.currentRole, CANDIDATE, 'still candidate');
  assertEqual(a.votesReceived.size, 1,  'only self-vote counted');
});

// ─────────────────────────────────────────────
suite('Slide 4 — Broadcast request');
// ─────────────────────────────────────────────

test('leader appends entry and sends LogRequest to followers', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);

  const { sends } = a.onBroadcastRequest('SET x=1');
  assertEqual(a.log.length, 1, 'log has one entry');
  assertEqual(a.log[0].msg,  'SET x=1', 'correct msg');
  assertEqual(a.log[0].term, 1,         'correct term');
  assertEqual(a.ackedLength.get('A'), 1, 'leader self-ack');

  const logReqs = sends.filter(s => s.msg.type === 'LogRequest');
  assertEqual(logReqs.length, 2, 'sends to B and C');
});

test('non-leader broadcast returns forward effect', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);    // A becomes leader; B and C know A is their leader
  // Receive the leadership heartbeat so B knows who the leader is
  const { sends } = a.onHeartbeatTick();
  const lrToB = sends.find(s => s.toId === 'B').msg;
  c.getNode('B').onReceiveLogRequest(lrToB);  // B now knows leader = A

  const result = c.getNode('B').onBroadcastRequest('SET y=2');
  assert(result.forward !== null, 'forward is set');
  assertEqual(result.forward.toId, 'A', 'forward to leader A');
  assertEqual(result.forward.msg, 'SET y=2', 'forward message');
});

// ─────────────────────────────────────────────
suite('Slides 5 & 6 — ReplicateLog / LogRequest handling');
// ─────────────────────────────────────────────

test('leader sends correct LogRequest fields', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);
  a.onBroadcastRequest('SET x=1');

  // sentLength[B] was initialised to 0 (log was empty when elected)
  // After broadcast, leader calls _replicateLog for B → suffix=[{msg,term}]
  const { sends } = a.onBroadcastRequest('SET x=1');
  const lrToB = sends.find(s => s.toId === 'B').msg;

  assertEqual(lrToB.type,         'LogRequest', 'type');
  assertEqual(lrToB.leaderId,     'A',          'leaderId');
  assertEqual(lrToB.term,         1,            'term');
  assertEqual(lrToB.prefixLen,    0,            'prefixLen=0 (nothing sent yet)');
  assertEqual(lrToB.prefixTerm,   0,            'no prefix');
  assertEqual(lrToB.leaderCommit, 0,            'nothing committed yet');
  assert(Array.isArray(lrToB.suffix),           'suffix is array');
});

test('follower accepts LogRequest and appends entries', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  const b = c.getNode('B');
  _electLeader(a, c);
  a.onBroadcastRequest('SET x=1');

  // Build the LogRequest A would send to B
  const lr = makeLogRequest('A', 1, 0, 0, 0, [{ msg: 'SET x=1', term: 1 }]);
  const { sends, delivers } = b.onReceiveLogRequest(lr);

  assertEqual(b.log.length,    1,         'entry appended');
  assertEqual(b.log[0].msg,   'SET x=1', 'correct msg');
  assertEqual(delivers.length, 0,         'not yet committed (leaderCommit=0)');
  assertEqual(sends.length,    1,         'sends one LogResponse');
  const resp = sends[0].msg;
  assertEqual(resp.type,    'LogResponse', 'type');
  assertEqual(resp.follower, 'B',          'follower');
  assertEqual(resp.ack,      1,            'ack=1');
  assertEqual(resp.success,  true,         'success');
});

test('follower rejects LogRequest with mismatched prefix term', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  // B has one entry from term 1
  b.currentTerm = 1;
  b.log = [{ msg: 'x', term: 1 }];

  // Leader sends prefixLen=1, prefixTerm=2 (mismatch: B has term 1 at index 0)
  const lr = makeLogRequest('A', 2, 1, 2, 0, [{ msg: 'y', term: 2 }]);
  const { sends } = b.onReceiveLogRequest(lr);
  assertEqual(sends[0].msg.success, false, 'rejected (prefix mismatch)');
});

test('follower rejects LogRequest from stale leader', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 3;  // B has seen a higher term
  const lr = makeLogRequest('A', 2, 0, 0, 0, []);
  const { sends } = b.onReceiveLogRequest(lr);
  assertEqual(sends[0].msg.success, false, 'rejected (stale term)');
});

test('follower updates currentLeader and resets to follower on valid LogRequest', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 1;
  b.currentRole = CANDIDATE;
  const lr = makeLogRequest('A', 1, 0, 0, 0, []);
  b.onReceiveLogRequest(lr);
  assertEqual(b.currentRole,   FOLLOWER, 'stepped down to follower');
  assertEqual(b.currentLeader, 'A',      'currentLeader set');
});

// ─────────────────────────────────────────────
suite('Slide 7 — AppendEntries');
// ─────────────────────────────────────────────

test('AppendEntries: empty suffix is idempotent (heartbeat)', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 1;
  b.log = [{ msg: 'x', term: 1 }];
  b.commitLength = 1;
  const lr = makeLogRequest('A', 1, 1, 1, 1, []);
  const { delivers } = b.onReceiveLogRequest(lr);
  assertEqual(b.log.length,    1, 'log unchanged');
  assertEqual(b.commitLength,  1, 'commitLength unchanged');
  assertEqual(delivers.length, 0, 'no new deliveries');
});

test('AppendEntries: truncates inconsistent tail', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  // B has an extra entry from a stale leader (term 1), leader wants term 2 at index 1
  b.currentTerm = 2;
  b.log = [{ msg: 'x', term: 1 }, { msg: 'stale', term: 1 }];
  const suffix = [{ msg: 'new', term: 2 }];
  const lr = makeLogRequest('A', 2, 1, 1, 0, suffix);
  b.onReceiveLogRequest(lr);
  assertEqual(b.log.length,   2,     'log length preserved (1 prefix + 1 new entry)');
  assertEqual(b.log[1].msg,  'new',  'stale entry replaced');
  assertEqual(b.log[1].term,  2,     'correct term');
});

test('AppendEntries: commits entries when leaderCommit advances', () => {
  const c = makeCluster();
  const b = c.getNode('B');
  b.currentTerm = 1;
  b.log = [{ msg: 'SET x=1', term: 1 }];
  b.commitLength = 0;
  const lr = makeLogRequest('A', 1, 1, 1, 1, []);  // heartbeat with leaderCommit=1
  const { delivers } = b.onReceiveLogRequest(lr);
  assertEqual(delivers.length,   1,         'one delivery');
  assertEqual(delivers[0].msg,  'SET x=1', 'correct message');
  assertEqual(b.commitLength,    1,         'commitLength advanced');
});

// ─────────────────────────────────────────────
suite('Slides 8 & 9 — LogResponse and CommitLogEntries');
// ─────────────────────────────────────────────

test('leader commits after quorum acknowledgement (3-node cluster)', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);
  a.onBroadcastRequest('SET x=1');  // log[0], leader self-acks (ackedLength[A]=1)

  // Receive success response from B (ack=1)
  const resp = makeLogResponse('B', 1, 1, true);
  const { sends, delivers } = a.onReceiveLogResponse(resp);

  // 2 acks (A + B) out of 3 → quorum met (⌈4/2⌉=2)
  assertEqual(a.commitLength,   1,         'leader committed');
  assertEqual(delivers.length,  1,         'one delivery');
  assertEqual(delivers[0].msg, 'SET x=1', 'correct message');
});

test('leader does NOT commit without quorum (only self-ack)', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);
  a.onBroadcastRequest('SET x=1');

  // Only leader has self-acked; no follower response yet
  // CommitLogEntries is only called on LogResponse, so invoke it explicitly
  // by delivering a "late" response from B but with ack=0 (failure)
  const resp = makeLogResponse('B', 1, 0, false);
  a.onReceiveLogResponse(resp);   // triggers sentLength backoff, not commit

  assertEqual(a.commitLength, 0, 'not committed yet (only 1/3 acks)');
});

test('leader backs off sentLength on failure and retries', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);
  // Put 2 entries in log; B is at sentLength=2 (optimistic assumption on elect)
  a.onBroadcastRequest('m1');
  a.onBroadcastRequest('m2');
  // sentLength[B] was 0 at election, then set by _replicateLog calls...
  // Manually set it to simulate having sent 2 entries
  a.sentLength.set('B', 2);

  const failResp = makeLogResponse('B', 1, 0, false);
  const { sends } = a.onReceiveLogResponse(failResp);
  assertEqual(a.sentLength.get('B'), 1, 'backed off by 1');
  const retryReq = sends.find(s => s.toId === 'B' && s.msg.type === 'LogRequest');
  assert(retryReq !== undefined, 'retry LogRequest sent to B');
  assertEqual(retryReq.msg.prefixLen, 1, 'retry starts from prefixLen=1');
});

test('leader ignores LogResponse for wrong term', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);
  a.onBroadcastRequest('SET x=1');
  const staleResp = makeLogResponse('B', 0, 1, true);  // old term
  a.onReceiveLogResponse(staleResp);
  assertEqual(a.commitLength, 0, 'not committed (stale response)');
});

test('leader steps down on LogResponse with higher term', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  _electLeader(a, c);
  const laterTermResp = makeLogResponse('B', 3, 0, false);
  a.onReceiveLogResponse(laterTermResp);
  assertEqual(a.currentRole,  FOLLOWER, 'stepped down');
  assertEqual(a.currentTerm,  3,        'term updated');
  assertEqual(a.votedFor,     null,     'votedFor cleared');
});

// ─────────────────────────────────────────────
suite('Crash / recovery');
// ─────────────────────────────────────────────

test('recoverFromCrash resets volatile state only (default)', () => {
  const c = makeCluster();
  const a = c.getNode('A');
  a.currentTerm  = 3;
  a.votedFor     = 'B';
  a.log          = [{ msg: 'x', term: 1 }];
  a.commitLength = 1;
  a.currentRole  = LEADER;
  a.currentLeader = 'A';
  a.votesReceived.add('A');
  a.sentLength.set('B', 1);
  a.ackedLength.set('B', 1);

  a.recoverFromCrash();

  // Stable storage preserved
  assertEqual(a.currentTerm,  3,         'currentTerm preserved');
  assertEqual(a.votedFor,     'B',       'votedFor preserved');
  assertEqual(a.log.length,   1,         'log preserved');
  assertEqual(a.commitLength, 1,         'commitLength preserved');
  // Volatile reset
  assertEqual(a.currentRole,   FOLLOWER, 'role reset');
  assertEqual(a.currentLeader, null,     'currentLeader reset');
  assertEqual(a.votesReceived.size, 0,   'votesReceived cleared');
  assertEqual(a.sentLength.size,    0,   'sentLength cleared');
  assertEqual(a.ackedLength.size,   0,   'ackedLength cleared');
});

// ─────────────────────────────────────────────
suite('Full scenario — happy-path election + replication');
// ─────────────────────────────────────────────

test('end-to-end: 3-node cluster elects leader and commits one entry', () => {
  const c = makeCluster();
  const [a, b, bNode, bId] = [c.getNode('A'), c.getNode('B'), c.getNode('B'), 'B'];
  const cNode = c.getNode('C');

  // Step 1: A times out and starts election
  const { sends: voteReqs } = a.onElectionTimeout();
  assertEqual(a.currentRole,  CANDIDATE, 'A is candidate');
  assertEqual(a.currentTerm,  1,         'term=1');

  // Step 2: B and C receive and grant the VoteRequest
  const voteReqToB = voteReqs.find(s => s.toId === 'B').msg;
  const voteReqToC = voteReqs.find(s => s.toId === 'C').msg;

  const { sends: bResp } = b.onReceiveVoteRequest(voteReqToB);
  const { sends: cResp } = cNode.onReceiveVoteRequest(voteReqToC);
  assertEqual(b.votedFor,    'A',  'B voted for A');
  assertEqual(cNode.votedFor,'A',  'C voted for A');

  // Step 3: A receives B's vote → quorum (A + B = 2/3)
  const { sends: afterElect } = a.onReceiveVoteResponse(bResp[0].msg);
  assertEqual(a.currentRole,   LEADER, 'A became leader');
  assertEqual(a.currentLeader, 'A',    'A knows it is leader');

  // Step 4: A broadcasts a client request
  const { sends: broadcastSends } = a.onBroadcastRequest('SET x=42');
  assertEqual(a.log.length, 1, 'entry in A log');

  // Step 5: B receives LogRequest and appends
  const lrToB = broadcastSends.find(s => s.toId === 'B').msg;
  const { sends: bLogResp, delivers: bDel } = b.onReceiveLogRequest(lrToB);
  assertEqual(b.log.length,    1,          'B appended entry');
  assertEqual(bDel.length,     0,          'B has not committed yet');
  assertEqual(bLogResp[0].msg.success, true, 'B accepted');

  // Step 6: A receives B's LogResponse → quorum → commits
  const { delivers: aCommit } = a.onReceiveLogResponse(bLogResp[0].msg);
  assertEqual(a.commitLength,      1,          'A committed');
  assertEqual(aCommit.length,      1,          'one delivery');
  assertEqual(aCommit[0].msg,     'SET x=42', 'correct message delivered');

  // Step 7: A's next heartbeat carries leaderCommit=1 → B commits too
  const { sends: hb } = a.onHeartbeatTick();
  const hbToB = hb.find(s => s.toId === 'B').msg;
  assertEqual(hbToB.leaderCommit, 1, 'heartbeat carries commit index');
  const { delivers: bCommit } = b.onReceiveLogRequest(hbToB);
  assertEqual(b.commitLength,   1,          'B committed');
  assertEqual(bCommit.length,   1,          'B delivered');
  assertEqual(bCommit[0].msg,  'SET x=42', 'B delivered correct message');
});

// ─────────────────────────────────────────────
// Results summary
// ─────────────────────────────────────────────

const total = _passed + _failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${_passed}/${total} passed${_failed > 0 ? `, ${_failed} FAILED` : ''}`);
if (_failed > 0) process.exit(1);

// ── Internal helper ───────────────────────────────────────────────────────

/**
 * Minimal helper: elect `leaderNode` in a cluster by going through the
 * election protocol just far enough to reach quorum (self + one other vote).
 * After this call leaderNode.currentRole === LEADER.
 */
function _electLeader(leaderNode, cluster) {
  leaderNode.onElectionTimeout();  // term++ → candidate
  // Receive one vote from the second node (quorum = 2 for 3-node cluster)
  const otherVoterId = cluster.nodeIds.find(id => id !== leaderNode.nodeId);
  const vote = makeVoteResponse(otherVoterId, leaderNode.currentTerm, true);
  leaderNode.onReceiveVoteResponse(vote);
  assert(leaderNode.currentRole === LEADER,
    `Expected ${leaderNode.nodeId} to become leader`);
}
