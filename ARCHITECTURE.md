# Shadows in the Forest — Architecture Reference

> This file is a living reference. Update it when game logic, file structure,
> or Firebase schema changes. Read this first before editing any file.

---

## File Structure

```
/
├── index.html        Home, Create Game, Join Game screens
├── lobby.html        Lobby screen (waiting room)
├── game.html         Game screen (first-person raycaster)
├── 404.html          GitHub Pages SPA redirect fix
├── css/
│   └── style.css     Shared styles (dark forest theme)
├── js/
│   ├── firebase.js   Firebase init, config, shared db reference
│   ├── mapgen.js     Map generation + shadow/light engine
│   ├── raycaster.js  First-person 3D renderer, sprite billboarding
│   ├── minimap.js    Minimap overlay renderer
│   ├── gamestate.js  Firebase listeners, phase transitions, win conditions
│   └── controls.js   Keyboard + touch input, turn action dispatch
└── ARCHITECTURE.md   This file
```

---

## Page Navigation Flow

```
index.html  →  (sessionStorage written)  →  lobby.html
lobby.html  →  (game starts)             →  game.html
game.html   →  (leave/end)               →  index.html
```

### sessionStorage keys
| Key            | Type   | Set by       | Read by               |
|----------------|--------|--------------|-----------------------|
| sitf_code      | string | index.html   | lobby.html, game.html |
| sitf_myId      | string | index.html   | lobby.html, game.html |
| sitf_myRole    | string | index.html   | lobby.html, game.html |
| sitf_myName    | string | index.html   | lobby.html, game.html |
| sitf_myColor   | string | index.html   | lobby.html, game.html |

---

## Roles
- **warden** — the lantern holder. One per game. Rolls dice, moves in first person.
- **shadow_0 … shadow_4** — shadowlings. Up to 5. Hide from the warden.

---

## Game Phases (stored in Firebase as `phase`)

| Phase          | Who acts          | Description |
|----------------|-------------------|-------------|
| `lobby`        | host (warden)     | Waiting for players to join |
| `shadow_move`  | all shadowlings   | 60-second free movement window |
| `warden_roll`  | warden            | Warden rolls dice to get move count |
| `warden_move`  | warden            | Warden moves step by step |
| `ended`        | —                 | Game over |

### Phase transition sequence
```
lobby → shadow_move (host starts game, server places shadowlings randomly)
shadow_move → warden_roll (60s timer expires OR all shadowlings end turn)
warden_roll → warden_move (dice rolled)
warden_move → shadow_move (warden ends turn OR moves exhausted)
warden_move / shadow_move → ended (win condition met)
```

---

## Firebase Data Schema

```
games/{code}/
  code              string    — 6-char invite code
  status            string    — 'lobby' | 'playing' | 'ended'
  phase             string    — see phases above
  maxShadows        number    — set by host (2–5)
  round             number    — increments each full cycle
  lastActionAt      number    — timestamp ms, used for 20-min idle timeout
  winner            string    — 'warden' | 'shadows' | 'timeout' | null

  mapData/
    cols            number
    rows            number
    map             number[][] — 0=empty, 1=tree

  players/{playerId}/
    name            string
    role            string    — 'warden' | 'shadow_0' … 'shadow_4'
    color           string    — hex color
    connected       bool

  kicked/{playerId}   bool    — set true when host kicks a player

  wardenPos/
    x               number    — tile x
    y               number    — tile y
    angle           number    — facing angle in radians (0 = east)

  shadowPositions/{playerId}/
    x               number
    y               number
    angle           number    — facing direction in radians

  shadowFrozen/{playerId}
    bool            — true = warden-frozen (caught in light)
                    — only cleared by rescue or game reset

  shadowTimerFrozen/{playerId}
    bool            — true = timer-frozen (60s expired)
                    — cleared at start of each shadow_move phase

  shadowDone/{playerId}
    bool            — true = this shadowling ended their turn early
                    — cleared at start of each shadow_move phase
```

---

## Shadow / Light Engine  (js/mapgen.js)

### computeShadow(map, cols, rows, wx, wy) → Set<number>
Ray-cast from warden position center (wx+0.5, wy+0.5).
For every non-tree tile, trace a ray. If the ray crosses a tree tile before
reaching the destination, that tile is IN SHADOW.
Returns a Set of tile keys (y*cols + x) that are in shadow.

### connectedShadow(shadowSet, cols, sx, sy) → Set<number>
BFS flood-fill from (sx, sy) through the shadow set.
Returns all shadow tiles reachable without crossing a lit tile.
Used for: shadowling movement validation, minimap reveal, win condition check.

### generateMap(cols, rows, density) → number[][]
Generates a random map where every empty tile is reachable from (1,1).
Border is always trees. Warden start area (1,1) and immediate neighbors always clear.
Retries up to 80 times to get a fully connected map.

---

## Raycaster  (js/raycaster.js)

Classic DDA (Digital Differential Analysis) raycaster.
Grid = game map tiles. Trees = walls. Empty tiles = open space.

### Key parameters
- FOV: 75 degrees (1.3089 radians)
- Ray count: matches canvas width (one ray per pixel column)
- Max render distance: configurable, default 20 tiles
- Wall height: projected as (tileSize / distance) * projectionPlane

### Sprites (shadowlings + warden lantern hand)
Billboard sprites sorted by distance, rendered back-to-front.
Sprite visibility: only shown if not occluded by a wall at that angle.

### Warden view
- Warm lantern light: brightness falls off with distance
- Lit cone: ~75° in front of warden
- Outside cone: dark (shadowlings invisible here even if technically in range)

### Shadowling view
- Cooler ambient light, dimmer overall
- Cannot see other shadowlings (they are hidden in shadow)
- CAN see warden's light glow through trees as a distant orange bloom
- Warden-frozen shadowlings appear as grey sprites (always visible)

---

## Minimap  (js/minimap.js)

Rendered as a small overlay canvas in the corner of game.html.

### Warden minimap
- Shows all walkable (empty) tiles the warden can reach
- Warden position + facing arrow shown
- Shadow regions are blacked out (warden can't see into shadow)
- Frozen shadowlings NOT shown on minimap

### Shadowling minimap
- Shows ONLY tiles in the connected shadow region from their current position
- Lit tiles and unreachable shadow regions are blacked out
- Their own position + facing arrow shown
- Other shadowlings NOT shown

---

## Controls  (js/controls.js)

### Warden
| Action        | Keyboard      | Touch button  |
|---------------|---------------|---------------|
| Turn left     | ArrowLeft / A | ◁ button      |
| Turn right    | ArrowRight / D| ▷ button      |
| Move forward  | ArrowUp / W   | ↑ button      |
| Move back     | ArrowDown / S | ↓ button      |
| Roll dice     | Space         | Dice button   |
| End turn      | Enter         | End turn btn  |

### Shadowlings (during 60s window)
Same as warden minus dice. After timer: turn left/right only, no movement.

---

## Freeze States

| State           | Field                     | Can move? | Cleared when?                        |
|-----------------|---------------------------|-----------|--------------------------------------|
| Timer-frozen    | shadowTimerFrozen[id]=true| No        | Start of next shadow_move phase      |
| Warden-frozen   | shadowFrozen[id]=true     | No        | Another shadowling steps on same tile|

A shadowling rescued during the 60s window has shadowFrozen set to false
and can move for the remainder of the timer.

---

## Win Conditions

### Warden wins
All shadowlings have shadowFrozen = true simultaneously.
Checked after every warden move step.

### Shadowlings win
All shadowlings (none warden-frozen, or all rescued) are on the same tile,
that tile is in shadow, and all positions are within the same connected shadow region.
Checked at end of each shadow_move phase.

---

## Known Issues / TODO
- [ ] First-person raycaster not yet implemented (current build is top-down)
- [ ] Sprite billboarding not yet implemented
- [ ] Minimap not yet implemented
- [ ] Touch controls not yet implemented
- [ ] Warden lantern hand sprite not yet designed

---

## Idle Timeout
20 minutes of no Firebase writes → game closes with winner='timeout'.
Checked client-side via setInterval every 1s.
Any Firebase write updates lastActionAt.
