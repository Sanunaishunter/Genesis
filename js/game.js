(() => {
  "use strict";

  // ----- Config -----------------------------------------------------------
  const TILE = 18;
  const COLS = 48;
  const ROWS = 32;
  const CANVAS_W = COLS * TILE;
  const CANVAS_H = ROWS * TILE;

  const TERRAIN = { WATER: 0, SAND: 1, GRASS: 2, MOUNTAIN: 3, RIVER: 4 };

  const ADULT_AGE = 16;
  const MAX_AGE = 90;
  const POP_CAP = 140;
  const ANIMAL_CAP = 60;
  const SAGE_CAP = 5;
  const HUNGER_MAX = 100;
  const STARVE_TICKS_TO_DIE = 45;
  const SEEK_FOOD_THRESHOLD = 55;
  const MATE_HUNGER_MAX = 40;
  const MATE_COOLDOWN = 55;
  const SENSE_RADIUS = 9;
  const HUMAN_SPEED = 0.045;
  const ANIMAL_SPEED = 0.032;
  const PANIC_SPEED_MUL = 1.9;

  const TICK_MS = { pause: 0, normal: 260, fast: 70 };

  const WEATHER_BRUSH_RADIUS = 3;
  const WEATHER_DURATION = { rain: 150, storm: 55, drought: 170 };
  const REPEAT_MS = 150; // holding the pointer re-triggers the ability at this interval

  const WEATHER_PAINT_LABEL = {
    sunny: "☀️ 撥雲見日，恢復晴朗",
    rain: "🌧️ 降下甘霖",
    storm: "⛈️ 召喚風暴",
    drought: "🏜️ 烈日炙烤大地",
  };

  const SEASON_LIST = ["spring", "summer", "autumn", "winter"];
  const SEASON_LENGTH = 130; // ticks per season
  const SEASON_LABEL = { spring: "🌸 春", summer: "☀️ 夏", autumn: "🍂 秋", winter: "❄️ 冬" };
  const SEASON_GRASS_TINT = { spring: "#57c26a", summer: "#3f8f4f", autumn: "#a67a3d", winter: "#dbe6e6" };
  const SEASON_BLEND_AMOUNT = 0.5;

  const EARTHQUAKE_RADIUS = 9;
  const PANIC_DURATION = 40;
  const SHAKE_DURATION = 22;

  const LIGHTNING_HITS_TO_IGNITE = 3;
  const FIRE_DURATION = 230; // ~60s of real time at normal speed
  const FIRE_BRUSH_RADIUS = 2;
  const FIRE_DAMAGE_CHANCE = { tree: 0.1, creature: 0.05 };

  const MOUNTAIN_BRUSH_RADIUS = 2;

  const SAGE_WORSHIP_RADIUS = 10;
  const WISDOM_PER_WORSHIPPER = 0.015;
  const TECH_THRESHOLD = { fire: 40, farming: 120, tribe: 300 };
  const TECH_LABEL = { fire: "🔥用火", farming: "🌾農耕", tribe: "🏘️部落" };

  const MIN_TREES_TO_KEEP = 4;
  const CHOP_CHANCE_PER_TICK = 0.02;
  const WOOD_PER_CHOP = 6;
  const HOUSE_COST = 30;
  const HOUSE_CAP = 20;
  const BRIDGE_COST = 20;
  const DROWN_CHANCE = 0.08; // per tick spent in a river tile with no bridge

  // ----- Seeded RNG ---------------------------------------------------------
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const WORLD_SEED = Math.floor(Math.random() * 1e9);
  const rand = mulberry32(WORLD_SEED);
  function randRange(a, b) { return a + rand() * (b - a); }
  function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
  function choice(arr) { return arr[randInt(0, arr.length - 1)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function adjustColor(hex, amt) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + amt, g = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
    r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function hexOf(r, g, b) {
    return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  }

  function blendHex(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return hexOf(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  }

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
        row.push({ type, shade: rand() * 2 - 1, cave: false, bridge: false });
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

  function isLand(tiles, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    const t = tiles[ty][tx];
    if (t.type === TERRAIN.GRASS || t.type === TERRAIN.SAND) return true;
    if (t.type === TERRAIN.MOUNTAIN && t.cave) return true;
    if (t.type === TERRAIN.RIVER && t.bridge) return true;
    return false;
  }

  function isDangerousRiver(xf, yf) {
    const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
    const t = state.tiles[ty][tx];
    return t.type === TERRAIN.RIVER && !t.bridge;
  }

  // ----- Game state ----------------------------------------------------------
  const state = {
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
    tech: { fire: false, farming: false, tribe: false },
    wood: 0,
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

  function addEntity(e) {
    e.id = state.nextId++;
    state.entities.push(e);
    return e;
  }

  function addEffect(e) {
    state.effects.push(e);
  }

  function findLandNear(tx, ty, radius) {
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

  function findNearestCave(xf, yf, radius) {
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

  function tileIndex(v, max) { return clamp(Math.round(v), 0, max - 1); }

  function weatherAt(xf, yf) {
    const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
    return state.tileWeather[ty][tx].type;
  }

  function isOnFire(xf, yf) {
    const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
    return state.tileFire[ty][tx].active;
  }

  function isOnCave(xf, yf) {
    const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
    return state.tiles[ty][tx].cave;
  }

  // ----- Entity factories -----------------------------------------------------
  function makeTree(x, y) {
    return addEntity({
      kind: "tree", x, y, stage: 0, growTimer: 0,
      hasFruit: false, fruitTimer: 0, lightningHits: 0,
    });
  }

  function makeAnimal(x, y) {
    return addEntity({
      kind: "animal", x, y,
      moveTX: x, moveTY: y, wanderCd: 0,
      breedCd: randInt(10, 30), panicTicks: 0,
    });
  }

  function makeHuman(x, y, gender, age) {
    return addEntity({
      kind: "human", x, y, gender,
      age: age ?? ADULT_AGE,
      hunger: randRange(10, 30),
      state: "wander",
      moveTX: x, moveTY: y, wanderCd: 0,
      starveTicks: 0,
      mateCd: randInt(0, 15),
      panicTicks: 0,
      isSage: false,
    });
  }

  function makeSage(x, y) {
    return addEntity({
      kind: "human", x, y, gender: choice(["m", "f"]),
      age: ADULT_AGE, hunger: 0, state: "sage",
      moveTX: x, moveTY: y, wanderCd: randInt(30, 60),
      starveTicks: 0, mateCd: 999999, panicTicks: 0, isSage: true,
    });
  }

  // ----- God actions -----------------------------------------------------------
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1400);
  }

  function treeAt(tx, ty) {
    return state.entities.find(e => e.kind === "tree" && Math.round(e.x) === tx && Math.round(e.y) === ty);
  }

  function setSpeed(s) {
    state.speed = s;
    toast("時間流速：" + (s === "pause" ? "暫停" : s === "fast" ? "加速" : "正常"));
  }

  function isWeatherLocked() {
    return !!(state.selectedTool && state.selectedTool.startsWith("weather-") && state.selectedTool !== "weather-sunny");
  }

  function paintWeather(tx, ty, type) {
    for (let dy = -WEATHER_BRUSH_RADIUS; dy <= WEATHER_BRUSH_RADIUS; dy++) {
      for (let dx = -WEATHER_BRUSH_RADIUS; dx <= WEATHER_BRUSH_RADIUS; dx++) {
        if (dx * dx + dy * dy > WEATHER_BRUSH_RADIUS * WEATHER_BRUSH_RADIUS) continue;
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        if (type === "sunny") state.tileWeather[y][x] = { type: "sunny", ticks: 0 };
        else state.tileWeather[y][x] = { type, ticks: WEATHER_DURATION[type] };
      }
    }
  }

  function igniteFire(tx, ty, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        if (state.tiles[y][x].type === TERRAIN.WATER) continue;
        state.tileFire[y][x] = { active: true, ticks: FIRE_DURATION };
      }
    }
  }

  function paintMountain(tx, ty) {
    for (let dy = -MOUNTAIN_BRUSH_RADIUS; dy <= MOUNTAIN_BRUSH_RADIUS; dy++) {
      for (let dx = -MOUNTAIN_BRUSH_RADIUS; dx <= MOUNTAIN_BRUSH_RADIUS; dx++) {
        if (dx * dx + dy * dy > MOUNTAIN_BRUSH_RADIUS * MOUNTAIN_BRUSH_RADIUS) continue;
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        const t = state.tiles[y][x];
        if (t.type !== TERRAIN.GRASS && t.type !== TERRAIN.SAND) continue;
        t.type = TERRAIN.MOUNTAIN;
        t.cave = (dx === 0 && dy === 0);
      }
    }
  }

  function paintRiver(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    const t = state.tiles[ty][tx];
    if (t.type !== TERRAIN.GRASS && t.type !== TERRAIN.SAND) return false;
    t.type = TERRAIN.RIVER;
    t.bridge = false;
    const tree = treeAt(tx, ty);
    if (tree) tree.dead = true;
    return true;
  }

  function triggerEarthquake(tx, ty) {
    state.shakeTicks = SHAKE_DURATION;
    const epi = { x: tx, y: ty };
    for (const e of state.entities) {
      if (e.kind === "human" || e.kind === "animal") {
        if (e.isSage) continue; // sages are unshaken
        if (dist2(e, epi) <= EARTHQUAKE_RADIUS * EARTHQUAKE_RADIUS) {
          e.panicTicks = PANIC_DURATION;
          const cave = findNearestCave(e.x, e.y, 12);
          if (cave) {
            e.moveTX = cave.x; e.moveTY = cave.y;
          } else {
            const angle = Math.atan2(e.y - ty, e.x - tx) + randRange(-0.6, 0.6);
            const fleeDist = randRange(5, 10);
            const fx = clamp(e.x + Math.cos(angle) * fleeDist, 0, COLS - 1);
            const fy = clamp(e.y + Math.sin(angle) * fleeDist, 0, ROWS - 1);
            const spot = findLandNear(Math.round(fx), Math.round(fy), 4);
            if (spot) { e.moveTX = spot.x; e.moveTY = spot.y; }
          }
        }
      } else if (e.kind === "tree") {
        if (dist2(e, epi) <= EARTHQUAKE_RADIUS * EARTHQUAKE_RADIUS && rand() < 0.04) e.dead = true;
      }
    }
  }

  function triggerLightning(tx, ty) {
    addEffect({ type: "lightning", x: tx, y: ty, life: 14, maxLife: 14 });
    const tree = treeAt(tx, ty);
    if (tree) {
      tree.lightningHits++;
      if (tree.lightningHits >= LIGHTNING_HITS_TO_IGNITE) igniteFire(tx, ty, 0);
      return;
    }
    const victim = state.entities.find(e =>
      (e.kind === "human" || e.kind === "animal") && Math.round(e.x) === tx && Math.round(e.y) === ty
    );
    if (victim) {
      victim.dead = true;
      addEffect({ type: victim.kind === "human" ? "skeleton" : "scorch", x: victim.x, y: victim.y, life: 28, maxLife: 28 });
    }
  }

  function applyGodAction(tx, ty, opts) {
    const silent = !!(opts && opts.silent);
    const tool = state.selectedTool;
    if (!tool) { if (!silent) toast("請先在右側選擇一項天神能力"); return; }
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;

    if (tool.startsWith("weather-")) {
      const type = tool.replace("weather-", "");
      paintWeather(tx, ty, type);
      if (!silent) toast(WEATHER_PAINT_LABEL[type]);
      return;
    }
    if (tool === "quake") {
      triggerEarthquake(tx, ty);
      if (!silent) toast("🌍 大地為之震動！");
      return;
    }
    if (tool === "lightning") {
      triggerLightning(tx, ty);
      if (!silent) toast("⚡ 雷霆降下");
      return;
    }
    if (tool === "fire") {
      igniteFire(tx, ty, FIRE_BRUSH_RADIUS);
      if (!silent) toast("🔥 烈焰燃起");
      return;
    }
    if (tool === "river") {
      const ok = paintRiver(tx, ty);
      if (!silent) toast(ok ? "🌊 河道向前延伸" : "這裡無法挖掘河道");
      return;
    }

    if (!isLand(state.tiles, tx, ty)) { if (!silent) toast("這裡無法施展這項能力"); return; }

    if (tool === "plant-seed") {
      if (treeAt(tx, ty)) { if (!silent) toast("這裡已經有一株植物了"); return; }
      makeTree(tx, ty);
      if (!silent) toast("🌱 一顆種子落入土壤");
    } else if (tool === "spawn-animal") {
      if (state.entities.filter(e => e.kind === "animal").length >= ANIMAL_CAP) { if (!silent) toast("動物數量已達上限"); return; }
      makeAnimal(tx, ty);
      if (!silent) toast("🐇 一隻動物誕生了");
    } else if (tool === "spawn-man") {
      if (state.entities.filter(e => e.kind === "human").length >= popCap()) { if (!silent) toast("人口已達上限"); return; }
      makeHuman(tx, ty, "m");
      if (!silent) toast("🧔 一位男人誕生了");
    } else if (tool === "spawn-woman") {
      if (state.entities.filter(e => e.kind === "human").length >= popCap()) { if (!silent) toast("人口已達上限"); return; }
      makeHuman(tx, ty, "f");
      if (!silent) toast("👩 一位女人誕生了");
    } else if (tool === "mountain") {
      paintMountain(tx, ty);
      if (!silent) toast("⛰️ 山岳隆起，中心留下了一個洞穴");
    } else if (tool === "sage") {
      if (state.entities.filter(e => e.isSage).length >= SAGE_CAP) { if (!silent) toast("聖人的數量已經足夠"); return; }
      makeSage(tx, ty);
      if (!silent) toast("🧙 一位聖人降臨，人們開始向祂膜拜");
    }
  }

  // ----- Simulation tick (one "day") -----------------------------------------
  function popCap() { return POP_CAP + (state.tech.tribe ? 40 : 0); }
  function mateCooldown() { return state.tech.tribe ? Math.round(MATE_COOLDOWN * 0.6) : MATE_COOLDOWN; }
  function fruitNeedTicks() { return state.tech.farming ? 5 : 8; }

  function weatherGrowMul(type) {
    switch (type) {
      case "rain": return 0.55;
      case "drought": return 1.9;
      case "storm": return 0.9;
      default: return 1;
    }
  }
  function weatherHungerMul(type) {
    switch (type) {
      case "drought": return 1.6;
      case "rain": return 0.85;
      default: return 1;
    }
  }
  function seasonGrowMul() {
    switch (state.season) {
      case "spring": return 0.85;
      case "autumn": return 1.15;
      case "winter": return 2.2;
      default: return 1;
    }
  }
  function seasonHungerMul() {
    switch (state.season) {
      case "winter": return 1.35;
      case "summer": return 1.08;
      default: return 1;
    }
  }

  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  function tickSeason() {
    state.seasonTick++;
    if (state.seasonTick >= SEASON_LENGTH) {
      state.seasonTick = 0;
      const idx = (SEASON_LIST.indexOf(state.season) + 1) % SEASON_LIST.length;
      state.season = SEASON_LIST[idx];
      toast("季節變化：" + SEASON_LABEL[state.season]);
    }
  }

  function tickWeatherDecay() {
    const counts = { rain: 0, storm: 0, drought: 0 };
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const w = state.tileWeather[y][x];
        if (w.type !== "sunny") {
          w.ticks--;
          if (w.ticks <= 0) { w.type = "sunny"; w.ticks = 0; }
          else counts[w.type]++;
        }
      }
    }
    state.weatherCounts = counts;
  }

  function tickFire() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const f = state.tileFire[y][x];
        if (f.active) {
          f.ticks--;
          if (f.ticks <= 0) f.active = false;
        }
      }
    }
    for (const e of state.entities) {
      if (!isOnFire(e.x, e.y)) continue;
      if (isOnCave(e.x, e.y)) continue; // caves shelter from fire
      if (e.kind === "tree") { if (rand() < FIRE_DAMAGE_CHANCE.tree) e.dead = true; }
      else if (e.kind === "human" || e.kind === "animal") {
        if (!e.isSage && rand() < FIRE_DAMAGE_CHANCE.creature) e.dead = true;
      }
    }
  }

  function tickRiverHazard() {
    for (const e of state.entities) {
      if (e.kind === "tree" || e.isSage) continue;
      if (isDangerousRiver(e.x, e.y) && rand() < DROWN_CHANCE) e.dead = true;
    }
  }

  function tickTrees() {
    for (const e of state.entities) {
      if (e.kind !== "tree") continue;
      const w = weatherAt(e.x, e.y);
      const growMul = weatherGrowMul(w) * seasonGrowMul();
      if (w === "storm" && rand() < (e.stage < 2 ? 0.05 : 0.012)) {
        e.dead = true; // young growth or rare mature tree knocked down
        continue;
      }
      if (e.stage < 2) {
        e.growTimer += 1 / growMul;
        const need = e.stage === 0 ? 10 : 16;
        if (e.growTimer >= need) { e.stage += 1; e.growTimer = 0; }
      } else {
        if (!e.hasFruit) {
          e.fruitTimer += 1 / growMul;
          if (e.fruitTimer >= fruitNeedTicks()) { e.hasFruit = true; e.fruitTimer = 0; }
        }
      }
    }
  }

  function tickAnimals() {
    const animals = state.entities.filter(e => e.kind === "animal");
    for (const a of animals) {
      if (a.panicTicks > 0) {
        a.panicTicks--;
        if (dist2(a, { x: a.moveTX, y: a.moveTY }) < 0.3) {
          const spot = findLandNear(Math.round(a.x + randRange(-6, 6)), Math.round(a.y + randRange(-6, 6)), 4);
          if (spot) { a.moveTX = spot.x; a.moveTY = spot.y; }
        }
        continue;
      }
      if (a.wanderCd <= 0) {
        const spot = findLandNear(Math.round(a.x + randRange(-4, 4)), Math.round(a.y + randRange(-4, 4)), 3);
        if (spot) { a.moveTX = spot.x; a.moveTY = spot.y; }
        a.wanderCd = randInt(4, 9);
      } else a.wanderCd--;

      if (a.breedCd <= 0 && animals.length < ANIMAL_CAP) {
        for (const other of animals) {
          if (other === a) continue;
          if (dist2(a, other) <= 4 && rand() < 0.15) {
            const spot = findLandNear(Math.round(a.x), Math.round(a.y), 2);
            if (spot) { makeAnimal(spot.x, spot.y); a.breedCd = randInt(25, 45); other.breedCd = randInt(25, 45); }
            break;
          }
        }
      } else a.breedCd--;
    }
  }

  function nearestFoodForHuman(h) {
    let best = null, bestD = SENSE_RADIUS * SENSE_RADIUS;
    for (const e of state.entities) {
      if (e.kind === "tree" && e.stage === 2 && e.hasFruit) {
        const d = dist2(h, e);
        if (d < bestD) { bestD = d; best = e; }
      } else if (e.kind === "animal") {
        const d = dist2(h, e);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  function tickWisdomAndTech(humans) {
    const sages = humans.filter(h => h.isSage);
    if (sages.length === 0) return;
    let worshippers = 0;
    for (const s of sages) {
      for (const h of humans) {
        if (h.isSage) continue;
        if (h.age >= ADULT_AGE && dist2(h, s) <= SAGE_WORSHIP_RADIUS * SAGE_WORSHIP_RADIUS) worshippers++;
      }
    }
    if (worshippers === 0) return;
    state.wisdom += worshippers * WISDOM_PER_WORSHIPPER;
    if (!state.tech.fire && state.wisdom >= TECH_THRESHOLD.fire) { state.tech.fire = true; toast("🔥 人類學會了用火！"); }
    if (!state.tech.farming && state.wisdom >= TECH_THRESHOLD.farming) { state.tech.farming = true; toast("🌾 人類學會了農耕！"); }
    if (!state.tech.tribe && state.wisdom >= TECH_THRESHOLD.tribe) { state.tech.tribe = true; toast("🏘️ 人類建立了部落！"); }
  }

  function findBridgeCandidate(humans) {
    if (humans.length === 0) return null;
    let cx = 0, cy = 0;
    for (const h of humans) { cx += h.x; cy += h.y; }
    cx /= humans.length; cy /= humans.length;
    let best = null, bestD = Infinity;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = state.tiles[y][x];
        if (t.type !== TERRAIN.RIVER || t.bridge) continue;
        const neighborsLand = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isLand(state.tiles, x + dx, y + dy));
        if (!neighborsLand) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    return best;
  }

  function nearestChoppableTree(h) {
    let target = null, bestD = SENSE_RADIUS * SENSE_RADIUS;
    for (const e of state.entities) {
      if (e.kind === "tree" && e.stage === 2) {
        const d = dist2(h, e);
        if (d < bestD) { bestD = d; target = e; }
      }
    }
    return target;
  }

  function tickCivilizationBuildings(humans) {
    if (!state.tech.tribe) return;

    if (state.wood >= HOUSE_COST && state.entities.filter(e => e.kind === "house").length < HOUSE_CAP) {
      let sx = 0, sy = 0, n = 0;
      for (const h of humans) { if (!h.isSage) { sx += h.x; sy += h.y; n++; } }
      if (n > 0) {
        const cx = sx / n, cy = sy / n;
        const spot = findLandNear(Math.round(cx + randRange(-3, 3)), Math.round(cy + randRange(-3, 3)), 3);
        if (spot && !treeAt(spot.x, spot.y)) {
          addEntity({ kind: "house", x: spot.x, y: spot.y });
          state.wood -= HOUSE_COST;
          toast("🏠 部落蓋起了一座房子");
        }
      }
    }

    if (state.wood >= BRIDGE_COST) {
      const spot = findBridgeCandidate(humans);
      if (spot) {
        state.tiles[spot.y][spot.x].bridge = true;
        state.wood -= BRIDGE_COST;
        toast("🌉 部落搭起了一座橋");
      }
    }
  }

  function tickHumans() {
    const humans = state.entities.filter(e => e.kind === "human");
    const cap = popCap();
    const canChop = state.tech.tribe && state.entities.filter(e => e.kind === "tree").length > MIN_TREES_TO_KEEP;

    for (const h of humans) {
      if (h.isSage) {
        if (h.wanderCd <= 0) {
          const spot = findLandNear(Math.round(h.x + randRange(-2, 2)), Math.round(h.y + randRange(-2, 2)), 2);
          if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
          h.wanderCd = randInt(30, 60);
        } else h.wanderCd--;
        continue;
      }

      const hungerMul = weatherHungerMul(weatherAt(h.x, h.y)) * seasonHungerMul() * (state.tech.fire ? 0.85 : 1);
      h.age += 1 / 20; // ~20 ticks per "year" for playable pacing
      h.hunger = Math.min(HUNGER_MAX, h.hunger + 0.9 * hungerMul);
      if (h.mateCd > 0) h.mateCd--;

      if (h.age >= MAX_AGE) { h.dead = true; continue; }

      if (h.hunger >= HUNGER_MAX) {
        h.starveTicks++;
        if (h.starveTicks >= STARVE_TICKS_TO_DIE) { h.dead = true; continue; }
      } else {
        h.starveTicks = 0;
      }

      if (h.panicTicks > 0) {
        h.panicTicks--;
        h.state = "panic";
        if (dist2(h, { x: h.moveTX, y: h.moveTY }) < 0.3) {
          const spot = findLandNear(Math.round(h.x + randRange(-6, 6)), Math.round(h.y + randRange(-6, 6)), 4);
          if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
        }
        continue;
      }

      const isAdult = h.age >= ADULT_AGE;

      if (h.hunger >= SEEK_FOOD_THRESHOLD) {
        h.state = "seekFood";
      } else if (isAdult && h.hunger < MATE_HUNGER_MAX && h.mateCd <= 0 && humans.length < cap) {
        h.state = "seekMate";
      } else if (isAdult && canChop && (h.state === "chopWood" || rand() < CHOP_CHANCE_PER_TICK)) {
        h.state = "chopWood";
      } else {
        h.state = "wander";
      }

      if (h.state === "seekFood") {
        const target = nearestFoodForHuman(h);
        if (target) {
          h.moveTX = target.x; h.moveTY = target.y;
          if (dist2(h, target) < 0.4) {
            h.hunger = Math.max(0, h.hunger - 60);
            if (target.kind === "tree") target.hasFruit = false;
            else target.dead = true; // ate the animal
          }
        } else {
          h.state = "wander";
        }
      }

      if (h.state === "seekMate") {
        let mate = null, bestD = SENSE_RADIUS * SENSE_RADIUS;
        for (const o of humans) {
          if (o === h || o.isSage || o.gender === h.gender) continue;
          if (o.age < ADULT_AGE || o.hunger >= MATE_HUNGER_MAX || o.mateCd > 0) continue;
          const d = dist2(h, o);
          if (d < bestD) { bestD = d; mate = o; }
        }
        if (mate) {
          h.moveTX = mate.x; h.moveTY = mate.y;
          if (dist2(h, mate) < 0.6 && rand() < 0.12) {
            const spot = findLandNear(Math.round(h.x), Math.round(h.y), 2);
            if (spot && humans.length < cap) {
              makeHuman(spot.x, spot.y, choice(["m", "f"]), 0);
              const cd = mateCooldown();
              h.mateCd = cd; mate.mateCd = cd;
              toast("👶 誕生了一個新生命");
            }
          }
        } else {
          h.state = "wander";
        }
      }

      if (h.state === "chopWood") {
        const target = nearestChoppableTree(h);
        if (target) {
          h.moveTX = target.x; h.moveTY = target.y;
          if (dist2(h, target) < 0.4) {
            target.dead = true;
            state.wood += WOOD_PER_CHOP;
            h.state = "wander";
          }
        } else {
          h.state = "wander";
        }
      }

      if (h.state === "wander") {
        if (h.wanderCd <= 0) {
          const spot = findLandNear(Math.round(h.x + randRange(-5, 5)), Math.round(h.y + randRange(-5, 5)), 3);
          if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
          h.wanderCd = randInt(5, 10);
        } else h.wanderCd--;
      }
    }

    tickCivilizationBuildings(humans);
    tickWisdomAndTech(humans);
  }

  function moveEntitiesStep(dtFactor) {
    for (const e of state.entities) {
      if (e.kind !== "human" && e.kind !== "animal") continue;
      const base = e.kind === "human" ? HUMAN_SPEED : ANIMAL_SPEED;
      const speed = base * (e.panicTicks > 0 ? PANIC_SPEED_MUL : 1);
      const dx = e.moveTX - e.x, dy = e.moveTY - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.02) {
        const step = Math.min(d, speed * dtFactor);
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }
    }
  }

  function updateEffects() {
    for (const ef of state.effects) ef.life--;
    state.effects = state.effects.filter(ef => ef.life > 0);
  }

  function simulateDay() {
    state.day++;
    tickSeason();
    tickWeatherDecay();
    tickFire();
    tickRiverHazard();
    tickTrees();
    tickAnimals();
    tickHumans();
    state.entities = state.entities.filter(e => !e.dead);
  }

  // ----- Rendering ---------------------------------------------------------
  const canvas = document.getElementById("world");
  const ctx = canvas.getContext("2d");

  const TERRAIN_COLOR = {
    [TERRAIN.WATER]: "#0d3a63",
    [TERRAIN.SAND]: "#d8c07a",
    [TERRAIN.GRASS]: "#3f8f4f",
    [TERRAIN.MOUNTAIN]: "#8a8175",
    [TERRAIN.RIVER]: "#2f7fc1",
  };
  const WEATHER_TINT_COLOR = {
    rain: [70, 110, 190],
    storm: [20, 26, 40],
    drought: [200, 150, 60],
  };

  const vignette = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.35,
    CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.78
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.38)");

  function drawWorld(ts) {
    const grassBase = blendHex(TERRAIN_COLOR[TERRAIN.GRASS], SEASON_GRASS_TINT[state.season], SEASON_BLEND_AMOUNT);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tile = state.tiles[y][x];
        const wx = x * TILE, wy = y * TILE;

        if (tile.type === TERRAIN.WATER) {
          const shimmer = Math.sin(ts * 0.0016 + x * 0.55 + y * 0.4) * 9 + tile.shade * 6;
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.WATER], shimmer);
        } else if (tile.type === TERRAIN.RIVER) {
          const shimmer = Math.sin(ts * 0.0022 + x * 0.4 + y * 0.9) * 10 + tile.shade * 6;
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.RIVER], shimmer);
        } else if (tile.type === TERRAIN.SAND) {
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.SAND], tile.shade * 10);
        } else if (tile.type === TERRAIN.MOUNTAIN) {
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.MOUNTAIN], tile.shade * 14);
        } else {
          ctx.fillStyle = adjustColor(grassBase, tile.shade * 12);
        }
        ctx.fillRect(wx, wy, TILE, TILE);

        if (tile.type === TERRAIN.GRASS && (x * 3 + y * 7) % 13 === 0) {
          ctx.fillStyle = "rgba(0,0,0,0.07)";
          ctx.fillRect(wx + 3, wy + 3, TILE - 6, TILE - 6);
        }
        if (tile.type === TERRAIN.MOUNTAIN) {
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.beginPath();
          ctx.moveTo(wx + TILE * 0.5, wy + 2);
          ctx.lineTo(wx + TILE * 0.8, wy + TILE * 0.55);
          ctx.lineTo(wx + TILE * 0.2, wy + TILE * 0.55);
          ctx.closePath();
          ctx.fill();
          if (tile.cave) {
            ctx.fillStyle = "#241d17";
            ctx.beginPath();
            ctx.ellipse(wx + TILE / 2, wy + TILE * 0.65, TILE * 0.28, TILE * 0.22, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (tile.type === TERRAIN.RIVER && tile.bridge) {
          ctx.fillStyle = "#8a5a2f";
          ctx.fillRect(wx + 1, wy + 3, TILE - 2, TILE - 6);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 1;
          for (let plank = 3; plank < TILE - 2; plank += 4) {
            ctx.beginPath();
            ctx.moveTo(wx + plank, wy + 3);
            ctx.lineTo(wx + plank, wy + TILE - 3);
            ctx.stroke();
          }
        }

        const fire = state.tileFire[y][x];
        if (fire.active) {
          const flick = Math.sin(ts * 0.02 + x * 1.7 + y * 1.3) * 0.5 + 0.5;
          ctx.fillStyle = `rgba(255,${100 + flick * 60},40,${0.28 + flick * 0.2})`;
          ctx.fillRect(wx, wy, TILE, TILE);
          ctx.fillStyle = `rgba(255,${180 + flick * 40},60,0.8)`;
          ctx.beginPath();
          ctx.moveTo(wx + TILE * 0.5, wy + TILE * (0.2 - flick * 0.1));
          ctx.lineTo(wx + TILE * 0.75, wy + TILE * 0.8);
          ctx.lineTo(wx + TILE * 0.25, wy + TILE * 0.8);
          ctx.closePath();
          ctx.fill();
        }

        const w = state.tileWeather[y][x];
        if (w.type !== "sunny") {
          const duration = WEATHER_DURATION[w.type];
          const fraction = clamp(w.ticks / duration, 0, 1);
          const [r, g, b] = WEATHER_TINT_COLOR[w.type];
          const alpha = 0.14 + fraction * 0.26;
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.fillRect(wx, wy, TILE, TILE);

          if (w.type === "rain") {
            const seed = (x * 13 + y * 7) % 17;
            const fallOffset = (ts * 0.07 + seed * 4) % TILE;
            ctx.strokeStyle = "rgba(200,225,255,0.55)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(wx + 4 + (seed % 6), wy + fallOffset - 4);
            ctx.lineTo(wx + 2 + (seed % 6), wy + fallOffset + 4);
            ctx.stroke();
          } else if (w.type === "drought" && (x + y * 3) % 5 === 0) {
            ctx.fillStyle = "rgba(220,190,130,0.4)";
            ctx.beginPath(); ctx.arc(wx + 9, wy + 9, 1.2, 0, 7); ctx.fill();
          }
        }
      }
    }
  }

  function drawShadow(px, py, rx, ry) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(px, py + ry * 0.55, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEntities() {
    const trees = [], animals = [], humans = [], houses = [];
    for (const e of state.entities) {
      if (e.kind === "tree") trees.push(e);
      else if (e.kind === "animal") animals.push(e);
      else if (e.kind === "human") humans.push(e);
      else if (e.kind === "house") houses.push(e);
    }
    const byY = (a, b) => a.y - b.y;
    trees.sort(byY); animals.sort(byY); humans.sort(byY); houses.sort(byY);

    for (const e of houses) {
      const px = e.x * TILE + TILE / 2, py = e.y * TILE + TILE / 2;
      drawShadow(px, py, 6, 2.2);
      ctx.fillStyle = "#c9a06b";
      ctx.fillRect(px - 5, py - 1, 10, 6);
      ctx.fillStyle = "#8a4b3a";
      ctx.beginPath();
      ctx.moveTo(px - 6.5, py - 1);
      ctx.lineTo(px, py - 8);
      ctx.lineTo(px + 6.5, py - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5a3722";
      ctx.fillRect(px - 1.5, py + 1, 3, 4);
    }

    for (const e of trees) {
      const px = e.x * TILE + TILE / 2, py = e.y * TILE + TILE / 2;
      if (e.stage === 0) {
        drawShadow(px, py, 2.4, 1);
        ctx.fillStyle = "#8bd17a";
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fill();
      } else {
        const r = e.stage === 1 ? 4 : 7;
        drawShadow(px, py, r * 0.9, r * 0.35);
        ctx.fillStyle = "#4a2f1a";
        ctx.fillRect(px - 1, py - r * 0.1, 2, r * 0.7);
        ctx.fillStyle = e.stage === 1 ? "#4fae5c" : "#2f8f43";
        ctx.beginPath(); ctx.arc(px, py - r * 0.35, r, 0, 7); ctx.fill();
        ctx.fillStyle = e.stage === 1 ? "#63c26e" : "#3fa855";
        ctx.beginPath(); ctx.arc(px - r * 0.3, py - r * 0.55, r * 0.6, 0, 7); ctx.fill();
        if (e.hasFruit) {
          ctx.fillStyle = "#e2543b";
          ctx.beginPath(); ctx.arc(px + r * 0.4, py - r * 0.2, 1.6, 0, 7); ctx.fill();
        }
      }
    }

    for (const a of animals) {
      const px = a.x * TILE + TILE / 2, py = a.y * TILE + TILE / 2;
      drawShadow(px, py, 3.4, 1.3);
      ctx.fillStyle = "#b98455";
      ctx.beginPath(); ctx.ellipse(px, py, 3.4, 2.4, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 2.6, py - 1.4, 1.7, 0, 7); ctx.fill();
      ctx.fillStyle = "#8a6339";
      ctx.beginPath(); ctx.arc(px + 3.4, py - 3, 0.8, 0, 7); ctx.fill();
    }

    for (const h of humans) {
      const px = h.x * TILE + TILE / 2, py = h.y * TILE + TILE / 2;
      const isAdult = h.age >= ADULT_AGE;
      const r = h.isSage ? 4.4 : (isAdult ? 3.6 : 2.4);
      const color = h.isSage ? "#ffd35c" : (h.gender === "m" ? "#4fb0ff" : "#ff7fc0");
      if (h.isSage) {
        const glowR = 8 + Math.sin(performance.now() * 0.003) * 1.5;
        const glow = ctx.createRadialGradient(px, py, 1, px, py, glowR);
        glow.addColorStop(0, "rgba(255,220,120,0.55)");
        glow.addColorStop(1, "rgba(255,220,120,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(px, py, glowR, 0, 7); ctx.fill();
      }
      drawShadow(px, py, r * 1.1, r * 0.45);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(px, py + r * 0.3, r * 0.85, r, 0, 0, 7); ctx.fill();
      ctx.fillStyle = adjustColor(color, 35);
      ctx.beginPath(); ctx.arc(px, py - r * 0.65, r * 0.62, 0, 7); ctx.fill();
      if (h.state === "seekFood") {
        ctx.strokeStyle = "#ffcf6b";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, r + 3, 0, 7); ctx.stroke();
      } else if (h.state === "panic") {
        ctx.strokeStyle = "#ff5a5a";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(px, py, r + 3, 0, 7); ctx.stroke();
      }
    }
  }

  function drawEffects() {
    for (const ef of state.effects) {
      const px = ef.x * TILE + TILE / 2, py = ef.y * TILE + TILE / 2;
      const t = ef.life / ef.maxLife;
      if (ef.type === "lightning") {
        ctx.strokeStyle = `rgba(230,220,255,${t})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let cx = px, cy = 0;
        ctx.moveTo(cx, cy);
        while (cy < py) {
          cx += randRange(-6, 6);
          cy += randRange(10, 18);
          ctx.lineTo(cx, Math.min(cy, py));
        }
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${t * 0.6})`;
        ctx.beginPath(); ctx.arc(px, py, 6 * t + 2, 0, 7); ctx.fill();
      } else if (ef.type === "skeleton") {
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("💀", px, py - (1 - t) * 10);
        ctx.globalAlpha = 1;
      } else if (ef.type === "scorch") {
        ctx.fillStyle = `rgba(40,30,20,${t * 0.6})`;
        ctx.beginPath(); ctx.arc(px, py, 5 * (1 - t) + 2, 0, 7); ctx.fill();
      }
    }
  }

  function render(ts) {
    ctx.save();
    if (state.shakeTicks > 0) {
      const mag = (state.shakeTicks / SHAKE_DURATION) * 4;
      ctx.translate(randRange(-mag, mag), randRange(-mag, mag));
      state.shakeTicks--;
    }

    ctx.clearRect(-8, -8, CANVAS_W + 16, CANVAS_H + 16);
    drawWorld(ts);
    drawEntities();
    drawEffects();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (state.weatherCounts.storm > 0 && rand() < 0.006) state.stormFlash = 0.9;
    if (state.stormFlash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${state.stormFlash * 0.45})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      state.stormFlash *= 0.82;
    } else {
      state.stormFlash = 0;
    }
    ctx.restore();
  }

  // ----- Stats UI ------------------------------------------------------------
  function updateStats() {
    const humans = state.entities.filter(e => e.kind === "human" && !e.isSage);
    const men = humans.filter(h => h.gender === "m" && h.age >= ADULT_AGE).length;
    const women = humans.filter(h => h.gender === "f" && h.age >= ADULT_AGE).length;
    const children = humans.length - men - women;
    document.getElementById("stat-day").textContent = state.day;
    document.getElementById("stat-pop").textContent = humans.length;
    document.getElementById("stat-men").textContent = men;
    document.getElementById("stat-women").textContent = women;
    document.getElementById("stat-children").textContent = children;
    document.getElementById("stat-trees").textContent = state.entities.filter(e => e.kind === "tree").length;
    document.getElementById("stat-animals").textContent = state.entities.filter(e => e.kind === "animal").length;

    const c = state.weatherCounts;
    const parts = [];
    if (c.rain) parts.push("🌧️" + c.rain);
    if (c.storm) parts.push("⛈️" + c.storm);
    if (c.drought) parts.push("🏜️" + c.drought);
    document.getElementById("stat-weather").textContent = parts.length ? parts.join(" ") : "☀️ 全島晴朗";

    document.getElementById("stat-season").textContent = SEASON_LABEL[state.season];

    const techParts = ["fire", "farming", "tribe"].filter(k => state.tech[k]).map(k => TECH_LABEL[k]);
    document.getElementById("stat-tech").textContent = techParts.length ? techParts.join(" ") : "尚未開化";

    document.getElementById("stat-wood").textContent = Math.floor(state.wood);
    document.getElementById("stat-houses").textContent = state.entities.filter(e => e.kind === "house").length;
  }

  // ----- Ability button UI ---------------------------------------------------
  const LIFE_TOOLS = ["plant-seed", "spawn-animal", "spawn-man", "spawn-woman"];
  const abilityButtons = Array.from(document.querySelectorAll('button.tool:not([data-tool^="speed-"])'));
  const lifeButtons = abilityButtons.filter(b => LIFE_TOOLS.includes(b.dataset.tool));

  function updateAbilityButtonsUI() {
    const locked = isWeatherLocked();
    for (const btn of abilityButtons) {
      btn.classList.toggle("active", btn.dataset.tool === state.selectedTool);
    }
    for (const btn of lifeButtons) {
      btn.disabled = locked;
    }
    const label = document.getElementById("selected-tool-label");
    const lockNote = document.getElementById("lock-note");
    if (state.selectedTool) {
      const activeBtn = abilityButtons.find(b => b.dataset.tool === state.selectedTool);
      label.textContent = activeBtn ? activeBtn.textContent : state.selectedTool;
    } else {
      label.textContent = "尚未選擇";
    }
    lockNote.hidden = !locked;
  }

  // ----- Input ---------------------------------------------------------------
  document.querySelectorAll("button.tool").forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (tool.startsWith("speed-")) {
        document.querySelectorAll('button.tool[data-tool^="speed-"]').forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        setSpeed(tool.replace("speed-", ""));
        return;
      }
      if (btn.disabled) return;
      state.selectedTool = state.selectedTool === tool ? null : tool;
      updateAbilityButtonsUI();
    });
  });

  function getTileFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const px = (ev.clientX - rect.left) * scaleX;
    const py = (ev.clientY - rect.top) * scaleY;
    return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) };
  }

  let activePointerId = null;

  canvas.addEventListener("pointerdown", (ev) => {
    if (!state.selectedTool) { toast("請先在右側選擇一項天神能力"); return; }
    const tile = getTileFromEvent(ev);
    activePointerId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    state.pressing = true;
    state.pointerTile = tile;
    applyGodAction(tile.x, tile.y, { silent: false });
    state.lastActionTime = performance.now();
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!state.pressing || ev.pointerId !== activePointerId) return;
    const tile = getTileFromEvent(ev);
    if (tile.x !== state.pointerTile.x || tile.y !== state.pointerTile.y) {
      state.pointerTile = tile;
      applyGodAction(tile.x, tile.y, { silent: true });
      state.lastActionTime = performance.now();
    }
  });

  function endPress(ev) {
    if (ev && ev.pointerId !== activePointerId) return;
    state.pressing = false;
    activePointerId = null;
  }
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);
  canvas.addEventListener("pointerleave", endPress);

  // default active button
  document.querySelector('[data-tool="speed-normal"]').classList.add("active");
  updateAbilityButtonsUI();

  // ----- Main loop -------------------------------------------------------------
  function loop(ts) {
    if (!state.lastTime) state.lastTime = ts;
    const dt = ts - state.lastTime;
    state.lastTime = ts;

    const tickInterval = TICK_MS[state.speed];
    if (tickInterval > 0) {
      state.accum += dt;
      while (state.accum >= tickInterval) {
        simulateDay();
        state.accum -= tickInterval;
      }
      moveEntitiesStep(dt / 16.6);
    }

    if (state.pressing && state.selectedTool && ts - state.lastActionTime >= REPEAT_MS) {
      applyGodAction(state.pointerTile.x, state.pointerTile.y, { silent: true });
      state.lastActionTime = ts;
    }

    updateEffects();
    render(ts);
    updateStats();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
