/**
 * Frame 13 — Quiz
 *
 * A capstone self-check, modelled on the Brown University Rust Book quiz
 * (mdbook-quiz). Five multiple-choice questions, authored in increasing order
 * of difficulty, are shown one at a time; the student picks an option and
 * clicks Submit to advance, with NO correctness feedback during the quiz.
 * After the last
 * question a score is shown plus a per-question review revealing the correct
 * answer, the student's own choice, and an explanation.
 *
 * Rendered as a plain-HTML overlay (like the pseudocode panel and playground
 * bar) — not SVG. Because layout.clear() only wipes the SVG <g>, the overlay
 * is torn down explicitly on re-entry and whenever the user navigates away.
 */

// ── Question bank ───────────────────────────────────────────────────────────
//
// Each question: { prompt, options: [string], answer: <index into options>,
//                  explanation: <HTML string> }
// `explanation` is author-written trusted HTML (rendered via innerHTML) so it
// can use <code>/<em>; prompts and options are plain text (textContent).
// The correct answer deliberately sits at a different position in each
// question so there is no "always pick the first option" shortcut.

const QUESTIONS = [
  {
    prompt:
      'In a healthy Raft cluster during normal operation, which server do ' +
      'clients send their requests to (e.g. to append a new command to the log)?',
    options: [
      'Any follower, whichever is closest',
      'The leader',
      'A randomly selected candidate',
      'All servers at once, which then vote on the request',
    ],
    answer: 1,
    explanation:
      'Raft uses <em>strong leadership</em> — at any time there is at most one ' +
      'leader, and all client requests flow through it. The leader appends the ' +
      'command to its own log and replicates it to the followers. Followers ' +
      'redirect clients to the leader; candidates exist only transiently during ' +
      'an election and never serve requests. See slide 4 ' +
      '(<em>Broadcasting messages</em>) in the pseudocode panel: only when ' +
      '<code>currentRole = leader</code> is the command appended — otherwise the ' +
      'request is <em>forwarded to <code>currentLeader</code></em>.',
  },
  {
    prompt:
      'A follower has been receiving regular heartbeats from the current ' +
      'leader. What would cause it to give up on that leader, become a ' +
      'candidate, and start a new election?',
    options: [
      'A majority of the other servers vote for it',
      'The current leader hands power over to it',
      'Its election timeout elapses without hearing from a leader',
      'It receives a client request it cannot handle',
    ],
    answer: 2,
    explanation:
      'Followers expect periodic heartbeats from the leader. Each runs an ' +
      'election timer; if it fires before a heartbeat arrives, the follower ' +
      'assumes the leader failed, increments its term, votes for itself, and ' +
      'becomes a candidate. Winning a majority is the <em>result</em> of an ' +
      'election, not the trigger for one. In the pseudocode panel this is the ' +
      '<code>on … election timeout</code> handler on slide 1 ' +
      '(<em>Initialisation</em>).',
  },
  {
    prompt:
      'A leader in a 5-server cluster appends a new command; so far it is ' +
      'stored on the leader and one follower (2 of 5). Is the entry committed ' +
      '— safe to apply and acknowledge to the client?',
    options: [
      'Yes — once the leader has written it locally, it is committed',
      "Yes — a single follower's acknowledgement is enough",
      'No — it must be stored on a majority (at least 3 of 5) first',
      'No — all 5 servers must store it before it can commit',
    ],
    answer: 2,
    explanation:
      'An entry is committed once replicated to a <em>majority</em> (3 of 5 ' +
      'here) — only then is it durable against any minority failure and safe to ' +
      'apply. One copy risks loss if the leader crashes; requiring all 5 would ' +
      'sacrifice availability, since one slow server would block progress. ' +
      'Majority quorums are the balance Raft relies on. See slide 9 ' +
      '(<em>Committing log entries</em>): the commit test uses ' +
      '<code>minAcks := ⌈(|nodes| + 1) / 2⌉</code>.',
  },
  {
    prompt:
      'Two followers time out at almost the same moment, both become ' +
      'candidates in the same term, and the votes split so neither reaches a ' +
      'majority. What lets Raft escape this and eventually elect a leader?',
    options: [
      'The candidate with the lowest server ID automatically wins the tie',
      'Randomized election timeouts, so one server usually times out first next round',
      'The old leader returns to break the tie',
      'The tied candidates keep re-voting within the same term until one wins',
    ],
    answer: 1,
    explanation:
      'A split vote means no majority, so the term ends leaderless and a new ' +
      'election happens. Raft randomizes each server’s election timeout ' +
      '(e.g. 150–300&nbsp;ms), so servers rarely time out together twice — ' +
      'usually one starts first and wins. Re-voting within the same term ' +
      "can’t help: each server already spent its single vote for that term, " +
      'and Raft has no ID-based or old-leader tie-breaker. The one-vote-per-term ' +
      'rule is the <code>votedFor ∈ {cId, null}</code> guard on slide 2 ' +
      '(<em>Voting on a new leader</em>).',
  },
  {
    prompt:
      'Candidate D sends node C a VoteRequest for a higher term than C has ' +
      "seen, and C hasn't voted yet this term. But C's log has a committed " +
      "entry from a later term that D lacks — C's log is strictly more " +
      'up-to-date. What does C do, and why does it matter?',
    options: [
      'C grants the vote, since D’s term number is higher',
      'C grants the vote, then streams its extra entries to D so D catches up',
      'C ignores the message, since the terms don’t match exactly',
      'C denies the vote — a server must not elect a leader whose log is less up-to-date than its own',
    ],
    answer: 3,
    explanation:
      'This is Raft’s <em>election restriction</em>, the heart of its safety. ' +
      'You can see exactly where it is enforced in the pseudocode panel on ' +
      '<strong>slide 2 (<em>Voting on a new leader</em>)</strong>: the ' +
      '<code>logOk</code> line computes ' +
      '<code>logOk := (cLogTerm &gt; lastTerm) ∨ (cLogTerm = lastTerm ∧ ' +
      'cLogLength ≥ log.length)</code>, and the vote is granted only in the ' +
      'branch guarded by ' +
      '<code>if cTerm = currentTerm ∧ logOk ∧ votedFor ∈ {cId, null}</code>. ' +
      'When <code>logOk</code> is false the code falls through to the ' +
      '<code>else</code> branch and sends a <code>VoteResponse … false</code> — a ' +
      'denial. So a candidate whose log is less up-to-date (lower last-entry ' +
      'term, or a shorter log at the same term) is refused. Because a candidate ' +
      'needs a majority, and any majority overlaps the majority that stored a ' +
      'committed entry, this guarantees the winner’s log already holds every ' +
      'committed entry (<em>Leader Completeness</em>). A higher term earns the ' +
      'right to be <em>considered</em>, never the right to erase committed ' +
      'history — so C correctly refuses.',
  },
];

// ── Module-level teardown handle ─────────────────────────────────────────────
//
// layout.clear() only wipes the SVG <g>; the injected HTML overlay must be
// removed by hand. On re-entry, setup() removes any leftover; navigating away
// (forward or back) is handled by the framechange listener registered below.

let _quizPanel = null;

window.addEventListener('raftviz:framechange', (e) => {
  const id = e.detail && e.detail.frame && e.detail.frame.id;
  if (_quizPanel && id !== 'quiz') {
    _quizPanel.remove();
    _quizPanel = null;
  }
});

// ── Frame descriptor ─────────────────────────────────────────────────────────

export const frame13Quiz = {
  id:    'quiz',
  title: 'Quiz',

  setup(layout, timeline, player) {
    // Tear down a leftover panel from a previous visit / replay.
    if (_quizPanel) { _quizPanel.remove(); _quizPanel = null; }

    const panel = document.createElement('div');
    panel.className = 'quiz-overlay';
    document.getElementById('chart').appendChild(panel);
    _quizPanel = panel;

    layout.setSubtitle('Check your understanding — answer all five questions, then reveal your score');

    // Fresh state on every entry: the quiz restarts from Q1.
    const state = { idx: 0, answers: new Array(QUESTIONS.length).fill(null) };

    // ── Render one question ──────────────────────────────────────────────
    function renderQuestion(i) {
      state.idx = i;
      const q = QUESTIONS[i];
      panel.innerHTML = '';

      const inner = el('div', 'quiz-inner');

      inner.appendChild(el('div', 'quiz-heading', 'Check your understanding'));

      const meta = el('div', 'quiz-meta');
      meta.appendChild(el('span', 'quiz-progress', `Question ${i + 1} of ${QUESTIONS.length}`));
      inner.appendChild(meta);

      const prompt = el('p', 'quiz-prompt');
      prompt.textContent = q.prompt;
      inner.appendChild(prompt);

      const form = el('form', 'quiz-options');
      q.options.forEach((opt, j) => {
        const label = el('label', 'quiz-option');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'quiz-opt';
        radio.value = String(j);
        if (state.answers[i] === j) radio.checked = true;
        radio.addEventListener('change', () => { submit.disabled = false; });
        const text = el('span', 'quiz-option-text');
        text.textContent = opt;
        label.appendChild(radio);
        label.appendChild(text);
        form.appendChild(label);
      });
      inner.appendChild(form);

      const submit = el('button', 'quiz-btn');
      submit.type = 'button';
      submit.textContent = (i === QUESTIONS.length - 1) ? 'Submit & see results' : 'Submit';
      submit.disabled = state.answers[i] === null;
      submit.addEventListener('click', () => {
        const chosen = form.querySelector('input[name="quiz-opt"]:checked');
        if (!chosen) return;
        state.answers[i] = Number(chosen.value);
        if (i + 1 < QUESTIONS.length) renderQuestion(i + 1);
        else renderResults();
      });
      inner.appendChild(submit);

      panel.appendChild(inner);
      panel.scrollTop = 0;
    }

    // ── Render the results / review screen ───────────────────────────────
    function renderResults() {
      const score = QUESTIONS.reduce(
        (n, q, i) => n + (state.answers[i] === q.answer ? 1 : 0), 0
      );
      panel.innerHTML = '';

      const inner = el('div', 'quiz-inner');
      inner.appendChild(el('div', 'quiz-heading', 'Your results'));
      inner.appendChild(el('div', 'quiz-score', `You scored ${score} / ${QUESTIONS.length}`));

      const remark =
        score === QUESTIONS.length ? 'Perfect — you have Raft down cold.' :
        score >= 3                 ? 'Nice work — review the ones you missed below.' :
                                     'Worth another pass — the explanations below will help.';
      inner.appendChild(el('div', 'quiz-remark', remark));

      QUESTIONS.forEach((q, i) => {
        const item = el('div', 'quiz-review-item');
        const correct = state.answers[i] === q.answer;
        item.appendChild(el('div', `quiz-review-status ${correct ? 'is-correct' : 'is-wrong'}`,
          `${correct ? '✓' : '✗'}  Question ${i + 1}`));

        const rp = el('p', 'quiz-review-prompt');
        rp.textContent = q.prompt;
        item.appendChild(rp);

        q.options.forEach((opt, j) => {
          const isCorrect = j === q.answer;
          const isChosen  = j === state.answers[i];
          let cls = 'quiz-review-option';
          if (isCorrect) cls += ' correct';
          else if (isChosen) cls += ' chosen-wrong';

          const marker = isCorrect ? '✓' : (isChosen ? '✗' : '·');
          let tag = '';
          if (isCorrect && isChosen) tag = '  (your answer — correct)';
          else if (isCorrect)        tag = '  (correct answer)';
          else if (isChosen)         tag = '  (your answer)';

          const row = el('div', cls);
          row.appendChild(el('span', 'quiz-review-marker', marker));
          const t = el('span', 'quiz-review-text');
          t.textContent = opt;
          row.appendChild(t);
          if (tag) row.appendChild(el('span', 'quiz-review-tag', tag));
          item.appendChild(row);
        });

        const exp = el('div', 'quiz-explanation');
        exp.innerHTML = q.explanation;   // trusted, author-written HTML
        item.appendChild(exp);

        inner.appendChild(item);
      });

      const retry = el('button', 'quiz-btn');
      retry.type = 'button';
      retry.textContent = '↺ Retry quiz';
      retry.addEventListener('click', () => {
        state.answers = new Array(QUESTIONS.length).fill(null);
        renderQuestion(0);
      });
      inner.appendChild(retry);

      panel.appendChild(inner);
      panel.scrollTop = 0;
    }

    renderQuestion(0);

    // No timeline steps: the quiz drives its own navigation and the
    // "Continue" button stays hidden.
  },
};

// ── Small DOM helper ──────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
