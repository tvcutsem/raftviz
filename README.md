# RaftViz

An interactive, step-by-step visualisation of the Raft consensus algorithm.

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

The visualization runs as a zero-build, 100% Javascript/HTML/CSS static site.

```bash
# From the raftviz/ directory:
python3 -m http.server 8741
```

Then open **http://localhost:8741** in your browser.

ES modules are used throughout — opening `index.html` via `file://` will not work.

---

## Navigating the scenes

| Action | How |
|--------|-----|
| Next scene / resume pause | `→` or the **→** button |
| Previous scene | `←` or the **←** button |
| Replay current scene | `R` or the **↻** button |
| Jump to any scene | **▼** scene menu (top right) |
| Deep-link to a scene | `#scene-id` in the URL (e.g. `#raft-leader`) |

When a scene pauses mid-way (a blue **▸ Resume** button appears), press `→` or
click **▸ Resume** to continue.

---

## Scene index

| # | Scene | URL hash |
|---|-------|----------|
| 1 | Welcome | `#title` |
| 2 | Overview — Consensus in One Minute | `#overview` |
| 3 | Node Role Transitions (state diagram) | `#state-diagram` |
| 4 | Raft 1/9 · Initialisation | `#raft-init` |
| 5 | Raft 1/9 · Election Timeout | `#raft-election` |
| 6 | Raft 2/9 · Voting on a New Leader | `#raft-voting` |
| 7 | Raft 3/9 · Becoming Leader | `#raft-leader` |
| 8 | Raft 4–5/9 · Broadcasting & Replication | `#raft-replication` |
| 9 | Raft 6–7/9 · Followers Receive LogRequest | `#raft-log-request` |
| 10 | Raft 8–9/9 · Leader Commits | `#raft-log-response` |
| 11 | Leader Crash & Re-election | `#raft-crash-reelection` |
| 12 | Live Playground (intro) | `#playground-intro` |
| 13 | Live Cluster (free-play sandbox) | `#live-cluster` |

---

## Live Cluster playground

Scene 13 is a fully interactive sandbox (scene 12 introduces the controls). The simulation runs autonomously, but
you control what happens to it.

### Controls

| Interaction | What it does |
|-------------|--------------|
| **Click a node** | Crash it (turns grey, stops responding). Click again to recover it as a follower. |
| **Drag from one node to another** | Add a network partition — messages between those two nodes are silently dropped. Drag between the same pair again to remove it. A dashed orange line with ⚡ marks active partitions. |
| **↗ Send Request** | Inject a `SET x=N` command into the cluster. It is sent to the current leader if one exists, otherwise to any live node. |
| **Speed slider** | Scale simulation speed from 0.5× (slow motion) to 3× (fast-forward). Default is 1×. |

### Suggested scenarios

Work through these roughly in order; each one builds on the intuition from the
last.

**1. Watch a cold start**  
Do nothing. Observe which node's election timer expires first, how it collects
votes, and how the leader begins sending heartbeats. Match what you see with
the pseudocode panel on the right.

**2. Crash the leader**  
Click the green (leader) node to crash it. Observe the remaining two followers
waiting for a heartbeat that never arrives, their election timers expiring, and
a new leader being elected from the surviving quorum. This shows *liveness*:
the cluster recovers without any human intervention.

**3. Crash a follower**  
Crash one follower while the leader is running. Inject a few requests with
**↗ Send Request**. The leader can still reach a quorum of two (itself + the
remaining follower), so commands are committed normally. Recover the crashed
node and watch it catch up: the leader replays the missing entries until the
follower's log matches.

**4. Isolate the leader (asymmetric partition)**  
Drag from the leader to each of the other two nodes in turn, creating two
partition links. The leader can no longer reach a quorum, so it stops
committing. The two followers elect a new leader among themselves. You now have
a *split-brain moment*: the old leader still thinks it is leader but is making
no progress. Recover the partitions and watch the old leader step down (its
term is stale) and rejoin as a follower.

**5. Test the quorum boundary**  
Crash two of the three nodes. The sole survivor cannot reach a quorum of two,
so no elections succeed and no commands are committed — the cluster is
*unavailable* but not incorrect. This illustrates the CAP trade-off: Raft
chooses consistency over availability when too many nodes fail.

---

## Visual language

### Node colours

| Colour | Role |
|--------|------|
| Steel blue | Follower |
| Orange | Candidate |
| Green | Leader |
| Grey | Stopped / crashed |

The arc around a node shows its election timer draining; when it reaches zero,
the node starts a new election.

### Message dot colours

| Colour | Message |
|--------|---------|
| Orange | VoteRequest |
| Bluish-green | VoteResponse (granted) |
| Vermilion | VoteResponse (denied) |
| Steel blue | LogRequest (replication / heartbeat) |
| Bluish-green | LogResponse (success) |
| Vermilion | LogResponse (failure) |

Success/failure colours use the [Okabe & Ito (2008)](https://jfly.uni-koeln.de/color/)
colorblind-safe palette and are distinguishable under all common types of
colour vision deficiency.

### Log entry colours

| Colour | State |
|--------|-------|
| Cream | Uncommitted (not yet replicated to a quorum) |
| Dark green | Committed (delivered to the application) |

### Pseudocode panel

The panel on the right shows the relevant slide of Kleppmann's Raft pseudocode
(Slides 1–9). Lines highlighted in yellow correspond to the algorithm step
currently being animated. Use the **‹** / **›** buttons to browse other slides.

---

## Project structure

```
raftviz/
├── index.html                  Main HTML shell
├── styles/
│   └── raft.css                All styles (dark theme, CSS custom properties)
├── vendor/
│   └── d3.v7.min.js            D3 v7 UMD bundle (no network dependency)
└── scripts/
    ├── main.js                 Entry point — registers frames, wires controls
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
        └── 12_playground_intro.js  Scene 12 — Playground transition
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
