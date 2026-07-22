/**
 * Frame 13 — Quiz
 *
 * A capstone self-check, modelled on the Brown University Rust Book quiz
 * (mdbook-quiz). Six multiple-choice questions, authored in increasing order
 * of difficulty, are shown one at a time; the student picks an option and
 * clicks Submit to advance, with NO correctness feedback during the quiz.
 * The last two questions share a three-node log snapshot (see SNAPSHOT_HTML)
 * and ask, in the style of Kleppmann's supervision exercise, what events could
 * have produced it and what values commitLength could take.
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
//                  explanation: <HTML string>, figureHtml?: <HTML string> }
// `explanation` (and the optional `figureHtml`, shown between prompt and
// options) are author-written trusted HTML (rendered via innerHTML) so they
// can use <code>/<em> and small diagram markup; prompts and options are plain
// text (textContent). The correct answer deliberately sits at a different
// position in each question so there is no "always pick the first option"
// shortcut.

// Shared log snapshot for the final two questions. Entries are drawn
// uniformly — committed vs. uncommitted is deliberately NOT indicated, since
// that is exactly what the commitLength question asks the student to work out.
const SNAPSHOT_HTML = (() => {
  const logs = [
    ['X', [['m1', 1], ['m2', 1], ['m3', 1]]],
    ['Y', [['m1', 1], ['m2', 1], ['m4', 2], ['m5', 2]]],
    ['Z', [['m1', 1], ['m2', 1], ['m4', 2], ['m6', 3]]],
  ];
  const rows = logs.map(([id, entries]) => {
    const boxes = entries.map(([msg, term]) =>
      `<span class="quiz-log-entry">` +
      `<span class="quiz-log-msg">${msg}</span>` +
      `<span class="quiz-log-term">${term}</span>` +
      `</span>`
    ).join('');
    return `<div class="quiz-log-row">` +
      `<span class="quiz-log-label">log @ ${id}</span>${boxes}</div>`;
  }).join('');
  return `<div class="quiz-figure">${rows}</div>`;
})();

const QUESTIONS = [
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
  {
    prompt:
      'Three nodes are running Raft and currently hold the logs shown below ' +
      '(each entry is labelled with its message and its term). Which sequence ' +
      'of events is consistent with how they reached this state?',
    figureHtml: SNAPSHOT_HTML,
    options: [
      'A single leader in term 3 replicated every entry; the logs differ only because some messages are still in flight',
      'Node X crashed and recovered, losing committed entries — which is why Y and Z hold entries X does not',
      'm4 was committed under the term-1 leader, before m3 was appended',
      'X led in term 1 and replicated m1–m2 to all nodes; Y was elected in term 2, appended m4 (copied to Z) and then m5; Z was elected in term 3 and appended m6 — the later entries have not been replicated yet',
    ],
    answer: 3,
    explanation:
      'The three logs share the committed prefix <code>m1, m2</code> (term 1) ' +
      'and then diverge — and divergence like this can only arise across ' +
      '<em>several</em> leaders in <em>different</em> terms, since a single ' +
      'leader produces identical logs on everyone it reaches. A consistent ' +
      'history: X was leader in term 1, replicated m1–m2 to a majority ' +
      '(committing them) and appended m3 locally before it stopped; Y was ' +
      'elected in term 2, appended m4 and copied it to Z, then appended m5 ' +
      'that was never replicated; Z was elected in term 3 (with X’s vote — Z’s ' +
      'last-entry term 2 beats X’s term 1, while Y refuses because its log is ' +
      'longer at the same term) and appended m6, still in flight. Committed ' +
      'entries such as m1/m2 live in stable storage and survive a crash, so ' +
      'they cannot simply be “lost”; and m4 carries term 2, so it cannot ' +
      'predate the term-1 leader.',
  },
  {
    prompt:
      'For the same three logs shown below, which statement about the ' +
      'commitLength variable is correct?',
    figureHtml: SNAPSHOT_HTML,
    options: [
      'commitLength equals each node’s log length: 3 at X, 4 at Y, 4 at Z',
      'commitLength at X can reach 3, since a leader commits every entry it appends to its log',
      'commitLength can be at most 2 at X (m3 is not committed) and at most 3 at Y and Z (m4 is committed, but m5 and m6 are not) — and may be lower anywhere if acknowledgements have not yet propagated',
      'All three nodes must have the same commitLength, since they agree on the committed prefix',
    ],
    answer: 2,
    explanation:
      '<code>commitLength</code> counts the majority-replicated prefix of the ' +
      'log — the entries known to be committed — and it is a <em>local</em> ' +
      'variable that can lag behind reality. m1 and m2 reached all three ' +
      'nodes, so they are committed; m4 reached a majority (Y and Z) while Y ' +
      'led in term 2, so it too is committed — even though X never received ' +
      'it. But m3 (only on X), m5 (only on Y) and m6 (only on Z) each sit on a ' +
      'single node, so none of them is committed. Hence <code>commitLength' +
      '</code> is at most 2 at X and at most 3 at Y and Z. It could also be ' +
      '<em>lower</em> at any node — even 0 — if the acknowledgements, or the ' +
      'leader’s <code>leaderCommit</code>, have not yet propagated. See ' +
      'slide 9 (<em>Committing log entries</em>) and slide 7 ' +
      '(<em>Updating followers’ logs</em>).',
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

    layout.setSubtitle(`Check your understanding — answer all ${QUESTIONS.length} questions, then reveal your score`);

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

      if (q.figureHtml) {
        const fig = el('div', 'quiz-figure-wrap');
        fig.innerHTML = q.figureHtml;   // trusted, author-written HTML
        inner.appendChild(fig);
      }

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
        score === QUESTIONS.length              ? 'Perfect — you have Raft down cold.' :
        score >= Math.ceil(QUESTIONS.length * 2 / 3) ? 'Nice work — review the ones you missed below.' :
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

        if (q.figureHtml) {
          const fig = el('div', 'quiz-figure-wrap');
          fig.innerHTML = q.figureHtml;   // trusted, author-written HTML
          item.appendChild(fig);
        }

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
