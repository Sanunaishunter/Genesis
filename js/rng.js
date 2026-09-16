// ----- Seeded RNG -----------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLD_SEED = Math.floor(Math.random() * 1e9);
export const rand = mulberry32(WORLD_SEED);
export function randRange(a, b) { return a + rand() * (b - a); }
export function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
export function choice(arr) { return arr[randInt(0, arr.length - 1)]; }
