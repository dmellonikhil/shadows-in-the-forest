// js/raycaster.js
// First-person DDA raycaster renderer.
// Draws into a provided canvas context.
// No Firebase dependency — pure rendering.

import { TILE, computeShadow } from './mapgen.js';

const FOV        = Math.PI * 75 / 180;  // 75 degrees
const HALF_FOV   = FOV / 2;
const MAX_DIST   = 20;                  // tiles before wall is invisible

// Tree wall colours (distance-shaded)
const WALL_LIGHT  = [22, 58, 24];       // close wall RGB
const WALL_DARK   = [6,  16,  7];       // far wall RGB
const FLOOR_COLOR = '#0a1209';
const CEIL_COLOR  = '#030806';

// ── MAIN RENDER ──────────────────────────────────────────
// state: current Firebase game state snapshot
// myRole: 'warden' | 'shadow_X'
// myId: player id
// canvas: the rc-canvas element
export function renderFrame(state, myRole, myId, canvas) {
  if (!state?.mapData) return;
  const ctx   = canvas.getContext('2d');
  const W     = canvas.width;
  const H     = canvas.height;
  const { map, cols, rows } = state.mapData;

  // resolve camera position
  let camX, camY, camAngle;
  if (myRole === 'warden') {
    camX     = state.wardenPos.x + 0.5;
    camY     = state.wardenPos.y + 0.5;
    camAngle = state.wardenPos.angle ?? 0;
  } else {
    const pos = state.shadowPositions?.[myId];
    if (!pos || pos.x == null) return;
    camX     = pos.x + 0.5;
    camY     = pos.y + 0.5;
    camAngle = pos.angle ?? 0;
  }

  ctx.clearRect(0, 0, W, H);

  // floor & ceiling
  ctx.fillStyle = CEIL_COLOR;
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, H / 2, W, H / 2);

  // precompute shadow set for visibility
  // computeShadow imported directly from mapgen.js
  const wx = state.wardenPos.x, wy = state.wardenPos.y;
  const shadowSet = computeShadow(map, cols, rows, wx, wy);

  // zBuffer: tracks perpendicular distance per column for sprite clipping
  const zBuf = new Float32Array(W);

  // ── WALLS ──
  for (let col = 0; col < W; col++) {
    const rayAngle = camAngle - HALF_FOV + (col / W) * FOV;
    const { dist, side } = castRay(map, cols, rows, camX, camY, rayAngle);
    zBuf[col] = dist;

    const wallH = Math.min(H, Math.floor(H / (dist || 0.001)));
    const wallTop    = Math.floor((H - wallH) / 2);
    const wallBottom = wallTop + wallH;

    // shade wall by distance
    const t = Math.min(dist / MAX_DIST, 1);
    const shade = side === 1 ? 0.6 : 1.0; // east/west faces slightly darker
    const r = Math.round(lerp(WALL_LIGHT[0], WALL_DARK[0], t) * shade);
    const g = Math.round(lerp(WALL_LIGHT[1], WALL_DARK[1], t) * shade);
    const b = Math.round(lerp(WALL_LIGHT[2], WALL_DARK[2], t) * shade);

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(col, wallTop, 1, wallH);

    // lantern warm tint on near walls (warden only)
    if (myRole === 'warden' && dist < 4) {
      const warmAlpha = (1 - dist / 4) * 0.25;
      ctx.fillStyle = `rgba(255,200,80,${warmAlpha.toFixed(2)})`;
      ctx.fillRect(col, wallTop, 1, wallH);
    }
  }

  // ── DISTANT LANTERN GLOW (shadowlings see orange bloom) ──
  if (myRole !== 'warden') {
    drawWardenGlow(ctx, W, H, camX, camY, camAngle, state.wardenPos, map, cols, rows);
  }

  // ── SPRITES ──
  drawSprites(ctx, W, H, zBuf, camX, camY, camAngle, state, myRole, myId, shadowSet, map, cols, rows);

  // ── WARDEN LANTERN HAND (first person overlay) ──
  if (myRole === 'warden') {
    drawLanternHand(ctx, W, H);
  }

  // ── VIGNETTE (darken edges for atmosphere) ──
  drawVignette(ctx, W, H, myRole);
}

// ── RAY CAST (DDA) ────────────────────────────────────────
function castRay(map, cols, rows, ox, oy, angle) {
  const rdx = Math.cos(angle), rdy = Math.sin(angle);
  let mapX = Math.floor(ox), mapY = Math.floor(oy);

  const deltaX = Math.abs(1 / (rdx || 0.00001));
  const deltaY = Math.abs(1 / (rdy || 0.00001));

  let stepX, stepY, sideDistX, sideDistY;

  if (rdx < 0) { stepX = -1; sideDistX = (ox - mapX) * deltaX; }
  else         { stepX =  1; sideDistX = (mapX + 1 - ox) * deltaX; }
  if (rdy < 0) { stepY = -1; sideDistY = (oy - mapY) * deltaY; }
  else         { stepY =  1; sideDistY = (mapY + 1 - oy) * deltaY; }

  let side = 0;
  for (let i = 0; i < MAX_DIST * 4; i++) {
    if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
    else                       { sideDistY += deltaY; mapY += stepY; side = 1; }
    if (mapX < 0 || mapX >= cols || mapY < 0 || mapY >= rows) break;
    if (map[mapY][mapX] === TILE.TREE) {
      const dist = side === 0
        ? (mapX - ox + (1 - stepX) / 2) / rdx
        : (mapY - oy + (1 - stepY) / 2) / rdy;
      return { dist: Math.max(0.01, dist), side };
    }
  }
  return { dist: MAX_DIST, side: 0 };
}

// ── SPRITES ──────────────────────────────────────────────
function drawSprites(ctx, W, H, zBuf, camX, camY, camAngle, state, myRole, myId, shadowSet, map, cols, rows) {
  const players = state.players || {};

  // collect visible sprites
  const sprites = [];

  Object.entries(state.shadowPositions || {}).forEach(([id, pos]) => {
    if (!pos || pos.x == null) return;
    const p = players[id]; if (!p) return;
    const frozen = state.shadowFrozen?.[id];
    const inShadow = shadowSet.has(pos.y * cols + pos.x);
    const isMe = id === myId;

    // visibility:
    // warden sees: only lit (not in shadow) shadowlings, plus all frozen ones
    // shadowlings see: only themselves (isMe), frozen ones always visible
    if (myRole === 'warden' && inShadow && !frozen) return;
    if (myRole !== 'warden' && !isMe && !frozen) return;

    const sx = pos.x + 0.5 - camX, sy = pos.y + 0.5 - camY;
    const dist = Math.sqrt(sx*sx + sy*sy);
    sprites.push({ id, pos, p, frozen, isMe, sx, sy, dist });
  });

  // sort far to near
  sprites.sort((a, b) => b.dist - a.dist);

  sprites.forEach(({ pos, p, frozen, isMe, sx, sy, dist }) => {
    // transform sprite into camera space
    const invDet = 1 / (Math.cos(camAngle) * Math.sin(camAngle + Math.PI/2) - Math.sin(camAngle) * Math.cos(camAngle + Math.PI/2));
    const tx_ = invDet * (Math.sin(camAngle + Math.PI/2) * sx - Math.cos(camAngle + Math.PI/2) * sy);
    const tz_ = invDet * (-Math.sin(camAngle) * sx + Math.cos(camAngle) * sy);
    if (tz_ <= 0.1) return; // behind camera

    const sprScreenX = Math.floor((W / 2) * (1 + tx_ / tz_));
    const sprH = Math.abs(Math.floor(H / tz_));
    const drawStartY = Math.max(0, Math.floor((H - sprH) / 2));
    const drawEndY   = Math.min(H - 1, Math.floor((H + sprH) / 2));
    const sprW = sprH;
    const drawStartX = Math.floor(sprScreenX - sprW / 2);
    const drawEndX   = Math.floor(sprScreenX + sprW / 2);

    // draw sprite column by column
    for (let stripe = drawStartX; stripe < drawEndX; stripe++) {
      if (stripe < 0 || stripe >= W) continue;
      if (tz_ >= zBuf[stripe]) continue; // wall in front

      const texX = Math.floor((stripe - drawStartX) / sprW * 16); // 16-segment sprite
      const midX = 8;
      const isEdge = texX < 2 || texX > 13;
      const isBody = texX >= 2 && texX <= 13 && !isEdge;
      const isHead = texX >= 5 && texX <= 10;
      const relY_body = (drawStartY + (drawEndY - drawStartY) * 0.15);
      const relY_head = (drawStartY + (drawEndY - drawStartY) * 0.05);

      for (let y = drawStartY; y < drawEndY; y++) {
        const relT = (y - drawStartY) / (drawEndY - drawStartY);
        let color = null;

        if (frozen) {
          // frozen = grey figure
          if (relT > 0.15 && relT < 0.85 && isBody) color = `rgb(80,95,80)`;
          if (relT > 0.05 && relT < 0.25 && isHead) color = `rgb(55,70,55)`;
          // icy ring outline
          if ((relT < 0.08 || relT > 0.9) && isBody) color = `rgba(140,200,255,0.7)`;
        } else {
          // normal coloured figure
          if (relT > 0.15 && relT < 0.85 && isBody) {
            const [r,g,b] = hexToRGB(p.color);
            const dim = isMe ? 1.0 : 0.85;
            color = `rgb(${Math.round(r*dim)},${Math.round(g*dim)},${Math.round(b*dim)})`;
          }
          if (relT > 0.05 && relT < 0.25 && isHead) color = `rgba(20,30,20,0.85)`;
          // eyes
          if (relT > 0.10 && relT < 0.18 && (texX === 6 || texX === 9)) color = `rgba(255,255,255,0.85)`;
        }
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(stripe, y, 1, 1);
        }
      }
    }
  });
}

// ── WARDEN GLOW (seen by shadowlings) ────────────────────
function drawWardenGlow(ctx, W, H, camX, camY, camAngle, wardenPos, map, cols, rows) {
  const wx = wardenPos.x + 0.5, wy = wardenPos.y + 0.5;
  const dx = wx - camX, dy = wy - camY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > 15) return;

  // check if warden is roughly in front of camera
  const angleToWarden = Math.atan2(dy, dx);
  let diff = angleToWarden - camAngle;
  while (diff > Math.PI)  diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  // cast a ray toward warden to check occlusion
  const { dist: wallDist } = castRay(map, cols, rows, camX, camY, angleToWarden);
  if (wallDist < dist - 0.5) return; // wall blocks

  if (Math.abs(diff) < Math.PI * 0.7) {
    const screenX = W / 2 + (diff / HALF_FOV) * (W / 2);
    const intensity = Math.max(0, 1 - dist / 12);
    const radius = Math.max(20, (1 - dist / 15) * W * 0.25);
    const grd = ctx.createRadialGradient(screenX, H/2, 0, screenX, H/2, radius);
    grd.addColorStop(0, `rgba(255,200,80,${(intensity * 0.35).toFixed(2)})`);
    grd.addColorStop(1, 'rgba(255,150,30,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(screenX, H/2, radius, 0, Math.PI*2);
    ctx.fill();
  }
}

// ── LANTERN HAND ─────────────────────────────────────────
function drawLanternHand(ctx, W, H) {
  // Simple geometric lantern held in bottom-right
  const bx = W * 0.72, by = H * 0.62;
  // handle
  ctx.fillStyle = '#5a3a10';
  ctx.fillRect(bx + 18, by + 30, 6, 35);
  // lantern body
  ctx.fillStyle = '#8a6020';
  ctx.fillRect(bx, by + 10, 42, 50);
  // glass panes (warm glow)
  ctx.fillStyle = 'rgba(255,220,80,0.85)';
  ctx.fillRect(bx + 4, by + 14, 34, 42);
  // inner flame
  ctx.fillStyle = 'rgba(255,255,160,0.95)';
  ctx.fillRect(bx + 14, by + 20, 14, 20);
  // glow spill on screen (ambient warm tint bottom-right)
  const grd = ctx.createRadialGradient(bx+21, by+34, 0, bx+21, by+34, 120);
  grd.addColorStop(0, 'rgba(255,200,60,0.18)');
  grd.addColorStop(1, 'rgba(255,160,20,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(W * 0.4, H * 0.3, W * 0.6, H * 0.7);
}

// ── VIGNETTE ─────────────────────────────────────────────
function drawVignette(ctx, W, H, myRole) {
  const grd = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, myRole === 'warden' ? 'rgba(0,0,0,0.55)' : 'rgba(0,8,2,0.70)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}

// ── UTILS ────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRGB(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}

// Minimap rendering has been moved to js/minimap.js
