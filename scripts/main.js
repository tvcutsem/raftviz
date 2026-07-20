/**
 * main.js — RaftViz entry point
 *
 * Responsibilities:
 *   - Instantiate Layout and Player
 *   - Register all frame descriptors
 *   - Wire up nav buttons, keyboard shortcuts, scene menu, and hash navigation
 */

import { Layout } from './layout/layout.js';
import { Player } from './player/player.js';
import { initTheme, setTheme } from './theme.js';
import { frame00Title      } from './frames/00_title.js';
import { frame01Overview   } from './frames/01_overview.js';
import { frame03StateDiagram  } from './frames/03_state_diagram.js';
import { frame04RaftInit      } from './frames/04_raft_init.js';
import { frame05Election      } from './frames/05_election.js';
import { frame06Voting        } from './frames/06_voting.js';
import { frame07Leader        } from './frames/07_leader.js';
import { frame08Replication      } from './frames/08_replication.js';
import { frame09LogRequest       } from './frames/09_log_request.js';
import { frame10LogResponse      } from './frames/10_log_response.js';
import { frame11CrashReelection  } from './frames/11_crash_reelection.js';
import { frame12PlaygroundIntro  } from './frames/12_playground_intro.js';
import { frame02LiveCluster } from './frames/02_live_cluster.js';
import { frame13Quiz        } from './frames/13_quiz.js';

// ---------------------------------------------------------------------------
// Frame registry — add new frames here in order
// ---------------------------------------------------------------------------
const FRAMES = [
  frame00Title,
  frame01Overview,
  frame03StateDiagram,
  frame04RaftInit,
  frame05Election,
  frame06Voting,
  frame07Leader,
  frame08Replication,
  frame09LogRequest,
  frame10LogResponse,
  frame11CrashReelection,
  frame12PlaygroundIntro,
  frame02LiveCluster,  // free-play sandbox
  frame13Quiz,         // capstone quiz — stays last
];

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
initTheme();

const layout = new Layout('#chart', '#subtitle');
layout.initialize();

const player = new Player(FRAMES, layout);

// ---------------------------------------------------------------------------
// DOM element references
// ---------------------------------------------------------------------------
const btnPrev   = document.getElementById('btn-prev');
const btnReplay = document.getElementById('btn-replay');
const btnNext   = document.getElementById('btn-next');
const btnResume = document.getElementById('btn-resume');
const btnMenu   = document.getElementById('btn-menu');
const btnTheme  = document.getElementById('btn-theme');
const sceneMenu = document.getElementById('scene-menu');
const sceneTitle = document.getElementById('scene-title');

// Sync button icon to current theme (set by initTheme above)
btnTheme.textContent = document.documentElement.dataset.theme === 'light' ? '☽' : '☀';

// ---------------------------------------------------------------------------
// Build the scene dropdown menu
// ---------------------------------------------------------------------------
FRAMES.forEach((frame, idx) => {
  const li = document.createElement('li');
  const a  = document.createElement('a');
  a.href = '#' + frame.id;

  const idxSpan = document.createElement('span');
  idxSpan.className   = 'menu-idx';
  idxSpan.textContent = String(idx + 1).padStart(2, '0');

  a.appendChild(idxSpan);
  a.appendChild(document.createTextNode(frame.title));

  a.addEventListener('click', (e) => {
    e.preventDefault();
    sceneMenu.classList.add('hidden');
    player.goTo(frame.id);
  });

  li.appendChild(a);
  sceneMenu.appendChild(li);
});

// ---------------------------------------------------------------------------
// Update nav state after each frame change
// ---------------------------------------------------------------------------
function onFrameChange({ detail: { idx, total, frame } }) {
  // Scene title in nav
  sceneTitle.textContent = `${idx + 1} / ${total}  ·  ${frame.title}`;

  // Prev / next button disabled state
  btnPrev.disabled = (idx === 0);
  btnNext.disabled = (idx === total - 1);

  // Highlight active item in dropdown
  sceneMenu.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
  });
}

window.addEventListener('raftviz:framechange', onFrameChange);

// ---------------------------------------------------------------------------
// Button click handlers
// ---------------------------------------------------------------------------
btnPrev.addEventListener('click',   () => player.prev());
btnNext.addEventListener('click',   () => player.next());
btnReplay.addEventListener('click', () => player.replay());
btnResume.addEventListener('click', () => player.resume());

btnTheme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  setTheme(next);
  btnTheme.textContent = next === 'light' ? '☽' : '☀';
  player.replay();
});

// Scene dropdown toggle
btnMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  sceneMenu.classList.toggle('hidden');
});

// Close dropdown when clicking elsewhere
document.addEventListener('click', () => sceneMenu.classList.add('hidden'));

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  // Ignore keypresses inside input elements
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      // If paused, "→" resumes; otherwise advance to next scene
      if (player._timeline && player._timeline.isPaused) {
        player.resume();
      } else {
        player.next();
      }
      break;

    case 'ArrowLeft':
      e.preventDefault();
      player.prev();
      break;

    case 'r':
    case 'R':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        player.replay();
      }
      break;

    case 'Escape':
      sceneMenu.classList.add('hidden');
      break;
  }
});

// ---------------------------------------------------------------------------
// Hash navigation (e.g. browser back/forward)
// ---------------------------------------------------------------------------
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace(/^#/, '');
  const frame = FRAMES.find(f => f.id === hash);
  if (frame && frame.id !== player.currentFrame().id) {
    player.goTo(frame.id);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
player.start();
