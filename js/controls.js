// js/controls.js
// Keyboard + touch input.
// Dispatches movement/rotation to gamestate.js via callbacks.

const TURN_SPEED = Math.PI / 12;  // radians per key press / button tap
const MOVE_SPEED = 1;             // tiles per step

let _onTurn  = null; // (delta: number) => void   — negative = left
let _onMove  = null; // (delta: number) => void   — positive = forward
let _onRoll  = null; // () => void
let _onEnd   = null; // () => void

const keys = new Set();

export function initControls({ onTurn, onMove, onRoll, onEnd }) {
  _onTurn = onTurn;
  _onMove = onMove;
  _onRoll = onRoll;
  _onEnd  = onEnd;

  window.addEventListener('keydown', handleKey);
  bindTouchButtons();
}

export function destroyControls() {
  window.removeEventListener('keydown', handleKey);
}

function handleKey(e) {
  switch (e.key) {
    case 'ArrowLeft':  case 'a': case 'A': _onTurn?.(-TURN_SPEED); break;
    case 'ArrowRight': case 'd': case 'D': _onTurn?.( TURN_SPEED); break;
    case 'ArrowUp':    case 'w': case 'W': _onMove?.( MOVE_SPEED); break;
    case 'ArrowDown':  case 's': case 'S': _onMove?.(-MOVE_SPEED); break;
    case ' ':                              _onRoll?.();             break;
    case 'Enter':                          _onEnd?.();              break;
  }
}

function bindTouchButtons() {
  const map = {
    'btn-turn-left':  () => _onTurn?.(-TURN_SPEED),
    'btn-turn-right': () => _onTurn?.( TURN_SPEED),
    'btn-fwd':        () => _onMove?.( MOVE_SPEED),
    'btn-back':       () => _onMove?.(-MOVE_SPEED),
  };
  Object.entries(map).forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', fn);
      el.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    }
  });
}

export { TURN_SPEED, MOVE_SPEED };
