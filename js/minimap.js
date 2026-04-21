// js/minimap.js
// Minimap overlay renderer.
// Draws into the #minimap-canvas element.
//
// Warden minimap:   shows all lit (non-shadow) walkable tiles + warden pos/facing.
//                   Shadow regions are blacked out.
//                   Frozen shadowlings NOT shown.
//
// Shadowling minimap: shows only the connected shadow region reachable from
//                   the shadowling's current position. Everything else is black.
//                   Their own pos + facing shown. Other players NOT shown.

import { TILE, computeShadow, connectedShadow } from './mapgen.js';

const T = 6; // px per tile

export function renderMinimap(state, myRole, myId, canvas) {
  if (!state?.mapData) return;
  const { map, cols, rows } = state.mapData;

  canvas.width  = cols * T;
  canvas.height = rows * T;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { x: wx, y: wy } = state.wardenPos;
  const shadowSet = computeShadow(map, cols, rows, wx, wy);

  // ── determine revealed tile set ──────────────────────────
  let revealedSet;
  if (myRole === 'warden') {
    // warden sees all lit (non-shadow) empty tiles
    revealedSet = new Set();
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const k = ty * cols + tx;
        if (map[ty][tx] === TILE.EMPTY && !shadowSet.has(k)) revealedSet.add(k);
      }
    }
  } else {
    // shadowling sees only their connected shadow region
    const pos = state.shadowPositions?.[myId];
    revealedSet = (pos && pos.x != null)
      ? connectedShadow(shadowSet, cols, pos.x, pos.y)
      : new Set();
  }

  // ── draw tiles ───────────────────────────────────────────
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const k  = ty * cols + tx;
      const px = tx * T, py = ty * T;

      if (map[ty][tx] === TILE.TREE) {
        ctx.fillStyle = '#0a140a';
      } else if (revealedSet.has(k)) {
        ctx.fillStyle = myRole === 'warden' ? '#2a4a28' : '#1a3a28';
      } else {
        ctx.fillStyle = '#040804';
      }
      ctx.fillRect(px, py, T, T);
    }
  }

  // ── player dot + facing arrow ─────────────────────────────
  let dotX, dotY, angle, dotColor;

  if (myRole === 'warden') {
    dotX = wx; dotY = wy;
    angle = state.wardenPos.angle ?? 0;
    dotColor = '#ffe082';
  } else {
    const pos = state.shadowPositions?.[myId];
    if (!pos || pos.x == null) return;
    dotX = pos.x; dotY = pos.y;
    angle = pos.angle ?? 0;
    dotColor = state.players?.[myId]?.color || '#a0c8a0';
  }

  const cx = dotX * T + T / 2;
  const cy = dotY * T + T / 2;

  // dot
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(cx, cy, T * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // facing arrow
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * T * 1.0, cy + Math.sin(angle) * T * 1.0);
  ctx.stroke();
}
