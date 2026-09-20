import { COLS, ROWS, TERRAIN, TECH_ORDER } from "./constants.js";
import { rand, randRange } from "./rng.js";
import { tileIndex } from "./utils.js";

// ----- World generation (fake fractal noise + radial falloff) ------------
function generateWorld() {
  const phase = [randRange(0, 100), randRange(0, 100), randRange(0, 100), randRange(0, 100)];
  const tiles = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      const nx = x / COLS - 0.5;
      const ny = y / ROWS - 0.5;
      const dist = Math.sqrt(nx * nx * 2.6 + ny * ny * 3.6);
      const base = 1 - dist * 1.3; // guarantees positive (land) near the center every time
      let n = 0;
      n += Math.sin(x * 0.22 + phase[0]) * Math.cos(y * 0.24 + phase[1]) * 0.22;
      n += Math.sin(x * 0.09 + phase[2]) * Math.cos(y * 0.11 + phase[3]) * 0.15;
      n += (rand() - 0.5) * 0.2;
      const value = base + n;
      let type;
      if (value > 0.25) type = TERRAIN.GRASS;
      else if (value > 0) type = TERRAIN.SAND;
      else type = TERRAIN.WATER;
      row.push({ type, shade: rand() * 2 - 1, cave: false, bridge: false, farmland: false, cropReady: false, cropTimer: 0 });
    }
    tiles.push(row);
  }
  return tiles;
}

function makeWeatherGrid() {
  const grid = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) row.push({ type: "sunny", ticks: 0 });
    grid.push(row);
  }
  return grid;
}

function makeFireGrid() {
  const grid = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) row.push({ active: false, ticks: 0 });
    grid.push(row);
  }
  return grid;
}

export function isLand(tiles, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  const t = tiles[ty][tx];
  if (t.type === TERRAIN.GRASS || t.type === TERRAIN.SAND) return true;
  if (t.type === TERRAIN.MOUNTAIN && t.cave) return true;
  if (t.type === TERRAIN.RIVER && t.bridge) return true;
  return false;
}

export function isDangerousRiver(xf, yf) {
  const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
  const t = state.tiles[ty][tx];
  return t.type === TERRAIN.RIVER && !t.bridge;
}

export function isOcean(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  return state.tiles[ty][tx].type === TERRAIN.WATER;
}

function makeTechState() {
  const t = {};
  for (const key of TECH_ORDER) t[key] = false;
  return t;
}

// ----- Game state ----------------------------------------------------------
export const state = {
  tiles: generateWorld(),
  tileWeather: makeWeatherGrid(),
  tileFire: makeFireGrid(),
  weatherCounts: { rain: 0, storm: 0, drought: 0 },
  stormFlash: 0,
  shakeTicks: 0,
  effects: [],
  season: "spring",
  seasonTick: 0,
  wisdom: 0,
  tech: makeTechState(),
  evilLoot: 0,
  tribes: [],
  wood: 0,
  readyFarmland: [],
  entities: [], // trees, animals, humans
  day: 0,
  speed: "normal",
  selectedTool: null,
  pressing: false,
  pointerTile: { x: 0, y: 0 },
  lastActionTime: 0,
  nextId: 1,
  accum: 0,
  lastTime: 0,
};

export function addEntity(e) {
  e.id = state.nextId++;
  state.entities.push(e);
  return e;
}

export function addEffect(e) {
  state.effects.push(e);
}

export function findLandNear(tx, ty, radius) {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx, y = ty + dy;
        if (isLand(state.tiles, x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function findWaterNear(tx, ty, radius) {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx, y = ty + dy;
        if (isOcean(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function findNearestCave(xf, yf, radius) {
  const cx = Math.round(xf), cy = Math.round(yf);
  let best = null, bestD = Infinity;
  for (let y = Math.max(0, cy - radius); y <= Math.min(ROWS - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(COLS - 1, cx + radius); x++) {
      if (state.tiles[y][x].cave) {
        const d = (x - xf) * (x - xf) + (y - yf) * (y - yf);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
  }
  return best;
}

export function weatherAt(xf, yf) {
  const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
  return state.tileWeather[ty][tx].type;
}

export function isOnFire(xf, yf) {
  const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
  return state.tileFire[ty][tx].active;
}

export function isOnCave(xf, yf) {
  const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
  return state.tiles[ty][tx].cave;
}

export function isBigTreeAt(xf, yf) {
  const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
  return state.entities.some(e => e.kind === "tree" && e.stage === 3 && !e.dead && Math.round(e.x) === tx && Math.round(e.y) === ty);
}

export function isSheltered(xf, yf) {
  return isOnCave(xf, yf) || isBigTreeAt(xf, yf);
}

export function findNearestShelter(xf, yf, radius) {
  const cx = Math.round(xf), cy = Math.round(yf);
  let best = null, bestD = Infinity;
  for (let y = Math.max(0, cy - radius); y <= Math.min(ROWS - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(COLS - 1, cx + radius); x++) {
      if (isSheltered(x, y)) {
        const d = (x - xf) * (x - xf) + (y - yf) * (y - yf);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
  }
  return best;
}
