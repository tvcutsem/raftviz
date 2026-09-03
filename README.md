# RaftViz

An interactive, step-by-step visualisation of the Raft consensus algorithm.

![A three-node Raft cluster with a leader, replicated log entries, per-node variable inspectors, and the matching pseudocode highlighted alongside](docs/media/shot-commit.png)

<sup>Above: a leader commits an entry once a quorum has acknowledged it. Each
node shows its live Raft variables and its log; the panel on the right
highlights the algorithm pseudocode being executed.</sup>

**→ [Live version](https://tvcutsem.github.io/raftviz)** - this repo hosted via Github pages.

**→ [Guided tour of the visualisation](docs/GUIDE.md)** — what each scene shows,
the interactive sandbox, keyboard controls, and the colour language.

**→ [Blog post](https://tvcutsem.github.io/raftviz-post)** — write-up of the pedagogy behind the project, and my experiences building it with agents.

This material is used as part of my Distributed Systems class at KU Leuven university.

It was inspired by, and draws material from, three primary sources:

  * The main inspiration came from Ben Johnson's wonderful [visualization of Raft](https://thesecretlivesofdata.com/raft/).

  * The algorithm pseudocode is taken from Martin Kleppmann's excellent [*Concurrent and Distributed Systems*](https://www.cl.cam.ac.uk/teaching/2526/ConcDisSys/dist-sys-notes.pdf)
Lecture notes.

  * The interactive quiz at the end is inspired by Will Crichton's fork of the [Rust Book](https://rust-book.cs.brown.edu/), which includes similar interactive quizzes to get students to engage with the material.

## GenAI disclaimer

This codebase was ["agentic engineered"](https://simonwillison.net/guides/agentic-engineering-patterns/what-is-agentic-engineering/) (as in ["not vibe coded"](https://simonwillison.net/guides/agentic-engineering-patterns/what-is-agentic-engineering/#isnt-this-just-vibe-coding)) with assistance from a variety of language models and coding harnesses, with Claude Opus 4.x doing most of the heavy lifting. Artifacts related to agentic development (such as SPEC.md and CLAUDE.md) are deliberately excluded from this repo.

---

## Quick start

The visualization runs as a zero-build, 100% Javascript/HTML/CSS static site. To serve locally:

```bash
python3 -m http.server 8741
```

Then open **http://localhost:8741** in your browser. The
[guided tour](docs/GUIDE.md) explains what you are looking at and how to drive
it.

ES modules are used throughout — opening `index.html` via `file://` will not work.

---

## Project structure

```
raftviz/
├── index.html                  Main HTML shell
├── styles/
│   └── raft.css                All styles (light + dark, CSS custom properties)
├── vendor/
│   └── d3.v7.min.js            D3 v7 UMD bundle (no network dependency)
├── tools/
│   └── capture.js              Regenerates the docs media
├── docs/
│   ├── GUIDE.md                Guided tour of the visualisation
│   └── media/                  Generated screenshots and recordings
└── scripts/
    ├── main.js                 Entry point — registers frames, wires controls
    ├── theme.js                Light / dark palettes + theme persistence
    ├── lib/
    │   └── d3.js               Re-exports D3 as an ES module
    ├── player/
    │   └── player.js           Frame sequencer (prev / next / replay / goTo)
    ├── layout/
    │   ├── layout.js           SVG canvas, subtitle bar, resume button
    │   ├── node_layout.js      Node circles, role colours, election arc
    │   ├── log_layout.js       Log entry blocks, commit marker
    │   ├── message_layout.js   Animated message dots
    │   ├── inspector_layout.js Per-node variable inspector table
    │   └── statemachine_layout.js  Key-value state machine output
    ├── simulation/
    │   ├── node.js             Raft node — all 9 Kleppmann handler functions
    │   ├── message.js          Message constructors + type constants
    │   ├── cluster.js          Node registry
    │   └── scheduler.js        Event queue, latency, crash/recover, partition
    ├── pseudocode/
    │   ├── pseudocode.js       Slides 1–9 text + HL highlight-constant map
    │   └── pseudocode_layout.js  PseudocodePanel render + highlight API
    └── frames/
        ├── _cluster_helpers.js Shared scene-building utilities
        ├── 00_title.js         Scene 1 — Welcome
        ├── 01_overview.js      Scene 2 — Overview
        ├── 02_live_cluster.js  Scene 13 — Live sandbox
        ├── 03_state_diagram.js Scene 3 — Role transitions
        ├── 04_raft_init.js     Scene 4 — Initialisation
        ├── 05_election.js      Scene 5 — Election timeout
        ├── 06_voting.js        Scene 6 — Voting
        ├── 07_leader.js        Scene 7 — Becoming leader
        ├── 08_replication.js   Scene 8 — Broadcasting & replication
        ├── 09_log_request.js   Scene 9 — Followers receive LogRequest
        ├── 10_log_response.js  Scene 10 — Leader commits
        ├── 11_crash_reelection.js  Scene 11 — Leader crash & re-election
        ├── 12_playground_intro.js  Scene 12 — Playground transition
        └── 13_quiz.js              Scene 14 — Capstone quiz
```

---

## Tests

```bash
npm run test:unit
```

These test the functional correctness of the Raft pseudocode handler functions (pseudocode translated to executable JS).

```bash
npm run test:smoke
```

This runs a smoke test by stepping through all the scenes in a headless browser and inspecting the rendered output (requires `playwright` as a dev dependency).

---

## Regenerating the media

Every screenshot and recording in this README and in the
[guided tour](docs/GUIDE.md) is generated, not hand-captured:

```bash
npm run media                       # all assets, into docs/media/
node tools/capture.js --list        # list asset names
node tools/capture.js --only hero   # rebuild just one
```

`tools/capture.js` drives the same headless Chromium the smoke test uses,
scripting each scene to the exact moment worth capturing. Stills are written as
2× PNGs; recordings are captured as WebM and transcoded by **ffmpeg** (required
for the clips, optional for the stills) into both an `.mp4` — better quality per
byte, for blog posts and slides — and a `.gif`, for inclusion in GitHub markdown files.

The `.gif` and `.png` assets are committed, since the docs embed them. The
`.mp4` files are gitignored — nothing in the docs links to them, so they stay
out of git history; rerun the command whenever you need them.

Add a new asset by appending an entry to the `ASSETS` array; each one is a name,
a caption, and an `async run(page)` that navigates and advances the timeline.

---

## License & credits

- **Code.** All source code in this repository is licensed under the **MIT
  License** — see [`LICENSE`](LICENSE).
- **Pseudocode content.** The Raft pseudocode shown in the panel (in
  `scripts/pseudocode/`) is derived from **Martin Kleppmann's *Concurrent and
  Distributed Systems* lecture notes** and is shared under the same terms as the
  source material: the **Creative Commons Attribution-ShareAlike 4.0 International
  ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/))** license.
  Any further reuse of that content must remain under CC BY-SA 4.0 with attribution.
- **Visual style.** The visual design adapts
  [thesecretlivesofdata.com](https://thesecretlivesofdata.com) (MIT-licensed).
- **D3.** [D3](https://d3js.org) v7 is bundled in `vendor/d3.v7.min.js` under its
  ISC license.
