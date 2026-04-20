// js/gamestate.js
// Firebase listeners, phase transitions, win condition checks.
// Imported by game.html only.

import { getDB, loadSession, clearSession }
  from './firebase.js';
import { computeShadow, connectedShadow, TILE }
  from './mapgen.js';
import { TURN_SPEED, MOVE_SPEED }
  from './controls.js';

import {
  ref, get, set, update, onValue, off, remove, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── STATE ────────────────────────────────────────────────
let db, dbRef;
let gameCode, myId, myRole, myColor;
let localState  = null;
let prevPhase   = '';
let idleIv      = null;
let shadowIv    = null;
let shadowEnd   = 0;

const IDLE_MS        = 20 * 60 * 1000;
const SHADOW_TURN_MS = 60 * 1000;

// Callbacks set by game.html
let _onStateChange  = null;  // (state) => void
let _onPhaseChange  = null;  // (phase, state) => void
let _onTimerTick    = null;  // (secondsLeft) => void
let _onModal        = null;  // (title, body, btnTxt, onOk) => void

// ── INIT ─────────────────────────────────────────────────
export function initGameState({ onStateChange, onPhaseChange, onTimerTick, onModal }) {
  _onStateChange = onStateChange;
  _onPhaseChange = onPhaseChange;
  _onTimerTick   = onTimerTick;
  _onModal       = onModal;

  db = getDB();
  const sess = loadSession();
  gameCode = sess.code;
  myId     = sess.myId;
  myRole   = sess.myRole;
  myColor  = sess.myColor;

  if (!gameCode || !myId) {
    window.location.href = 'index.html';
    return;
  }

  dbRef = ref(db, 'games/' + gameCode);
  onDisconnect(ref(db, 'games/' + gameCode + '/players/' + myId)).remove();

  onValue(dbRef, snap => {
    if (!snap.exists()) { leaveTo('index.html'); return; }
    localState = snap.val();

    // check if kicked mid-game
    if (localState.players && !localState.players[myId]) {
      leaveTo('index.html', 'You were removed from the game.');
      return;
    }

    _onStateChange?.(localState);
    checkWin(localState);

    if (localState.phase !== prevPhase) {
      prevPhase = localState.phase;
      _onPhaseChange?.(localState.phase, localState);
      handlePhaseStart(localState.phase, localState);
    }
  });

  startIdleInterval();
}

// ── PHASE HANDLER ────────────────────────────────────────
function handlePhaseStart(phase, st) {
  stopShadowTimer();

  if (phase === 'shadow_move') {
    shadowEnd = Date.now() + SHADOW_TURN_MS;
    startShadowTimer(st);
  }
}

// ── SHADOW TIMER ─────────────────────────────────────────
function startShadowTimer(st) {
  stopShadowTimer();
  shadowIv = setInterval(async () => {
    const rem = Math.max(0, shadowEnd - Date.now());
    _onTimerTick?.(Math.ceil(rem / 1000));
    if (rem <= 0) {
      stopShadowTimer();
      // warden auto-advances turn when timer expires
      if (myRole === 'warden') await advanceRound();
    }
  }, 500);
}

export function stopShadowTimer() {
  if (shadowIv) { clearInterval(shadowIv); shadowIv = null; }
  _onTimerTick?.(0);
}

// ── WARDEN MOVEMENT ──────────────────────────────────────
export async function wardenMove(deltaSteps) {
  if (!localState || localState.phase !== 'warden_move' || myRole !== 'warden') return;
  if (localState.movesLeft <= 0) return;

  const { x, y, angle } = localState.wardenPos;
  const { map, cols, rows } = localState.mapData;

  const nx = x + Math.round(Math.cos(angle) * deltaSteps);
  const ny = y + Math.round(Math.sin(angle) * deltaSteps);

  if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return;
  if (map[ny][nx] === TILE.TREE) return;

  const newShadow = computeShadow(map, cols, rows, nx, ny);
  const frozen = { ...localState.shadowFrozen };

  // freeze any shadowling now in light
  Object.entries(localState.shadowPositions || {}).forEach(([id, pos]) => {
    if (!pos || pos.x == null) return;
    if (!newShadow.has(pos.y * cols + pos.x)) frozen[id] = true;
  });

  const newMoves = localState.movesLeft - 1;
  const upd = {
    wardenPos:    { x: nx, y: ny, angle },
    movesLeft:    newMoves,
    shadowFrozen: frozen,
    lastActionAt: Date.now(),
  };
  if (newMoves <= 0) upd.phase = 'shadow_move';
  await update(dbRef, upd);
}

export async function wardenTurn(deltaAngle) {
  if (!localState || myRole !== 'warden') return;
  if (localState.phase !== 'warden_move' && localState.phase !== 'warden_roll') return;
  const pos = localState.wardenPos;
  await update(dbRef, {
    wardenPos: { ...pos, angle: (pos.angle ?? 0) + deltaAngle },
    lastActionAt: Date.now(),
  });
}

// ── DICE ROLL ────────────────────────────────────────────
export async function rollDice(value) {
  if (!localState || localState.phase !== 'warden_roll' || myRole !== 'warden') return;
  await update(dbRef, {
    movesLeft:    value,
    phase:        'warden_move',
    lastActionAt: Date.now(),
  });
}

// ── SHADOWLING MOVEMENT ──────────────────────────────────
export async function shadowMove(deltaSteps) {
  if (!localState || localState.phase !== 'shadow_move' || myRole === 'warden') return;
  if (localState.shadowFrozen?.[myId]) return;
  if (localState.shadowTimerFrozen?.[myId]) return; // shouldn't happen but guard

  const pos = localState.shadowPositions?.[myId];
  if (!pos || pos.x == null) return;

  const { map, cols, rows } = localState.mapData;
  const angle = pos.angle ?? 0;
  const nx = pos.x + Math.round(Math.cos(angle) * deltaSteps);
  const ny = pos.y + Math.round(Math.sin(angle) * deltaSteps);

  if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return;
  if (map[ny][nx] === TILE.TREE) return;

  const { x: wx, y: wy } = localState.wardenPos;
  const shadowSet = computeShadow(map, cols, rows, wx, wy);

  // must stay in shadow
  if (!shadowSet.has(ny * cols + nx)) return;

  // must be reachable via connected shadow
  const reach = connectedShadow(shadowSet, cols, pos.x, pos.y);
  if (!reach.has(ny * cols + nx)) return;

  const upd = {
    [`shadowPositions/${myId}`]: { x: nx, y: ny, angle },
    lastActionAt: Date.now(),
  };

  // check if rescuing a frozen shadowling on that tile
  const snap = await get(dbRef);
  const st = snap.val();
  Object.entries(st.shadowFrozen || {}).forEach(([fid, frozen]) => {
    if (!frozen || fid === myId) return;
    const fp = st.shadowPositions?.[fid];
    if (fp && fp.x === nx && fp.y === ny) upd[`shadowFrozen/${fid}`] = false;
  });

  await update(dbRef, upd);
}

export async function shadowTurn(deltaAngle) {
  if (!localState || myRole === 'warden') return;
  if (localState.phase !== 'shadow_move') return;
  const pos = localState.shadowPositions?.[myId];
  if (!pos) return;
  await update(dbRef, {
    [`shadowPositions/${myId}`]: { ...pos, angle: (pos.angle ?? 0) + deltaAngle },
    lastActionAt: Date.now(),
  });
}

export async function shadowEndTurn() {
  if (!localState || localState.phase !== 'shadow_move' || myRole === 'warden') return;
  await update(dbRef, {
    [`shadowDone/${myId}`]: true,
    lastActionAt: Date.now(),
  });
  // check if all active shadows done
  const snap = await get(dbRef);
  const st = snap.val();
  const players = st.players || {};
  const active = Object.keys(players).filter(id =>
    players[id].role !== 'warden' && !st.shadowFrozen?.[id]
  );
  if (active.every(id => st.shadowDone?.[id])) await advanceRound();
}

export async function wardenEndTurn() {
  if (!localState || localState.phase !== 'warden_move' || myRole !== 'warden') return;
  await update(dbRef, { phase: 'shadow_move', lastActionAt: Date.now() });
}

// ── ROUND ADVANCE ────────────────────────────────────────
async function advanceRound() {
  const snap = await get(dbRef);
  const st = snap.val();
  if (st.phase === 'ended') return;
  if (evalWin(st)) return;

  // clear per-round fields, freeze all shadowlings by timer
  const players = st.players || {};
  const shadowIds = Object.keys(players).filter(id => players[id].role !== 'warden');
  const timerFrozen = {};
  shadowIds.forEach(id => { timerFrozen[id] = true; });

  await update(dbRef, {
    phase:             'warden_roll',
    round:             (st.round || 1) + 1,
    movesLeft:         0,
    shadowDone:        {},
    shadowTimerFrozen: timerFrozen,
    lastActionAt:      Date.now(),
  });
}

// ── WIN CONDITIONS ───────────────────────────────────────
function evalWin(st) {
  const players = st.players || {};
  const sids = Object.keys(players).filter(id => players[id].role !== 'warden');

  // warden wins: all shadowlings warden-frozen
  if (sids.length > 0 && sids.every(id => st.shadowFrozen?.[id])) {
    update(dbRef, { phase: 'ended', status: 'ended', winner: 'warden' });
    return true;
  }

  // shadowlings win: all non-warden-frozen on same tile in same shadow region
  const active = sids.filter(id => !st.shadowFrozen?.[id]);
  if (active.length >= 2) {
    const { map, cols, rows } = st.mapData;
    const shadow = computeShadow(map, cols, rows, st.wardenPos.x, st.wardenPos.y);
    const poss = active.map(id => st.shadowPositions?.[id]).filter(p => p && p.x != null);
    if (poss.length === active.length) {
      // all on same tile?
      const allSameTile = poss.every(p => p.x === poss[0].x && p.y === poss[0].y);
      if (allSameTile) {
        const region = connectedShadow(shadow, cols, poss[0].x, poss[0].y);
        if (region.has(poss[0].y * cols + poss[0].x)) {
          update(dbRef, { phase: 'ended', status: 'ended', winner: 'shadows' });
          return true;
        }
      }
    }
  }
  return false;
}

function checkWin(st) {
  if (st.phase !== 'ended') return;
  stopShadowTimer();
  if (st.winner === 'warden')
    _onModal?.('Warden wins!', 'All shadowlings are frozen in the light!', 'Back to menu', () => leaveTo('index.html'));
  else if (st.winner === 'shadows')
    _onModal?.('Shadowlings win!', 'All shadowlings united in the same shadow!', 'Back to menu', () => leaveTo('index.html'));
  else if (st.winner === 'timeout')
    _onModal?.('Game closed', 'No activity for 20 minutes.', 'Back to menu', () => leaveTo('index.html'));
}

// ── IDLE TIMEOUT ─────────────────────────────────────────
function startIdleInterval() {
  if (idleIv) clearInterval(idleIv);
  idleIv = setInterval(() => {
    if (!localState || localState.status === 'ended') return;
    const rem = Math.max(0, IDLE_MS - (Date.now() - (localState.lastActionAt || Date.now())));
    const el = document.getElementById('idle-timer');
    if (el) {
      const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
      el.textContent = 'idle: ' + m + ':' + s.toString().padStart(2, '0');
    }
    if (rem === 0) update(dbRef, { phase: 'ended', status: 'ended', winner: 'timeout' });
  }, 1000);
}

// ── LEAVE ────────────────────────────────────────────────
export async function leaveGame() {
  if (idleIv) clearInterval(idleIv);
  stopShadowTimer();
  if (dbRef) off(dbRef);
  if (myId && gameCode) {
    try {
      const snap = await get(ref(db, 'games/' + gameCode));
      if (snap.exists()) {
        const st = snap.val();
        const rem = Object.keys(st.players || {}).filter(id => id !== myId);
        if (rem.length === 0) {
          await remove(ref(db, 'games/' + gameCode));
        } else {
          await remove(ref(db, 'games/' + gameCode + '/players/' + myId));
          if (myRole === 'warden')
            await update(ref(db, 'games/' + gameCode), { phase: 'ended', status: 'ended', winner: 'timeout' });
          else if (st.phase === 'shadow_move')
            await update(ref(db, 'games/' + gameCode), { [`shadowDone/${myId}`]: true });
        }
      }
    } catch(e) { console.error(e); }
  }
  clearSession();
  window.location.href = 'index.html';
}

function leaveTo(url, msg) {
  if (idleIv) clearInterval(idleIv);
  stopShadowTimer();
  if (dbRef) off(dbRef);
  clearSession();
  if (msg) sessionStorage.setItem('sitf_msg', msg);
  window.location.href = url;
}

export function getLocalState() { return localState; }
export function getMyRole()     { return myRole; }
export function getMyId()       { return myId; }
