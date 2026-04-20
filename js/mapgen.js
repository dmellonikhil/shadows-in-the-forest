// js/mapgen.js
// Map generation + shadow/light engine.
// No Firebase dependency — pure data functions.

export const TILE = { EMPTY: 0, TREE: 1 };

// ── MAP GENERATION ────────────────────────────────────────
// Returns a number[][] grid.
// density: 1–5 controls tree probability.
// Guarantees all EMPTY tiles are reachable from (1,1).
// Warden start area (1,1) and its direct neighbours always clear.
export function generateMap(cols, rows, density) {
  const prob = 0.10 + density * 0.065; // 0.165 → 0.435
  for (let attempt = 0; attempt < 80; attempt++) {
    const m = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) =>
        (x === 0 || x === cols - 1 || y === 0 || y === rows - 1) ? TILE.TREE : TILE.EMPTY
      )
    );
    // clear warden start zone
    [[1,1],[2,1],[1,2]].forEach(([x, y]) => { m[y][x] = TILE.EMPTY; });
    // place trees
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (x === 1 && y <= 2) continue;
        if (x === 2 && y === 1) continue;
        if (Math.random() < prob) m[y][x] = TILE.TREE;
      }
    }
    if (allEmptyConnected(m, cols, rows)) return m;
  }
  // fallback: sparse grid
  const m = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) =>
      (x === 0 || x === cols-1 || y === 0 || y === rows-1) ? TILE.TREE : TILE.EMPTY
    )
  );
  for (let y = 2; y < rows-1; y += 3)
    for (let x = 3; x < cols-1; x += 3) m[y][x] = TILE.TREE;
  return m;
}

function allEmptyConnected(m, cols, rows) {
  const empties = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (m[y][x] === TILE.EMPTY) empties.push(y * cols + x);
  if (!empties.length) return false;
  const vis = new Set([1 * cols + 1]);
  const q = [{ x: 1, y: 1 }];
  while (q.length) {
    const { x, y } = q.shift();
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x+dx, ny = y+dy, k = ny*cols+nx;
      if (nx>=0 && nx<cols && ny>=0 && ny<rows && m[ny][nx]===TILE.EMPTY && !vis.has(k)) {
        vis.add(k); q.push({ x: nx, y: ny });
      }
    }
  }
  return empties.every(k => vis.has(k));
}

// ── SHADOW / LIGHT ENGINE ─────────────────────────────────
// Ray-cast from warden tile centre.
// A tile is IN SHADOW if any tree tile intercepts the ray before it arrives.
// Returns Set<number> of tile keys (y*cols+x) that are in shadow.
export function computeShadow(map, cols, rows, wx, wy) {
  const shadow = new Set();
  const lx = wx + 0.5, ly = wy + 0.5;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (map[ty][tx] === TILE.TREE) continue;
      if (tx === wx && ty === wy) continue;
      const dx = tx + 0.5 - lx, dy = ty + 0.5 - ly;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const steps = Math.ceil(dist * 3);
      let blocked = false;
      for (let s = 1; s < steps && !blocked; s++) {
        const t = s / steps;
        const gx = Math.floor(lx + dx*t), gy = Math.floor(ly + dy*t);
        if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
        if (gx === tx && gy === ty) continue;
        if (gx === wx && gy === wy) continue;
        if (map[gy][gx] === TILE.TREE) blocked = true;
      }
      if (blocked) shadow.add(ty * cols + tx);
    }
  }
  return shadow;
}

// BFS flood-fill connected shadow region from (sx, sy).
// Returns Set<number> of reachable shadow tile keys.
export function connectedShadow(shadowSet, cols, sx, sy) {
  const k0 = sy * cols + sx;
  if (!shadowSet.has(k0)) return new Set();
  const vis = new Set([k0]);
  const q = [{ x: sx, y: sy }];
  while (q.length) {
    const { x, y } = q.shift();
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = x+dx, ny = y+dy, k = ny*cols+nx;
      if (shadowSet.has(k) && !vis.has(k)) { vis.add(k); q.push({ x: nx, y: ny }); }
    }
  }
  return vis;
}

// Find all shadow tile keys and pick random ones that are walkable (EMPTY).
// Used for random shadowling placement at game start.
export function randomShadowTiles(map, cols, rows, shadowSet, count) {
  const candidates = [];
  shadowSet.forEach(k => {
    const x = k % cols, y = Math.floor(k / cols);
    if (map[y][x] === TILE.EMPTY) candidates.push({ x, y });
  });
  // shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}
