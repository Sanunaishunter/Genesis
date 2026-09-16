(() => {
  "use strict";

  // ----- Config -----------------------------------------------------------
  const TILE = 18;
  const COLS = 48;
  const ROWS = 32;
  const CANVAS_W = COLS * TILE;
  const CANVAS_H = ROWS * TILE;

  const TERRAIN = { WATER: 0, SAND: 1, GRASS: 2 };

  const ADULT_AGE = 16;
  const MAX_AGE = 90;
  const POP_CAP = 140;
  const ANIMAL_CAP = 60;
  const HUNGER_MAX = 100;
  const STARVE_TICKS_TO_DIE = 45;
  const SEEK_FOOD_THRESHOLD = 55;
  const MATE_HUNGER_MAX = 40;
  const MATE_COOLDOWN = 55;
  const SENSE_RADIUS = 9;

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
        row.push({ type, shade: rand() * 2 - 1 });
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

  function isLand(tiles, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    const t = tiles[ty][tx].type;
    return t === TERRAIN.GRASS || t === TERRAIN.SAND;
  }

  // ----- Game state ----------------------------------------------------------
  const state = {
    tiles: generateWorld(),
    tileWeather: makeWeatherGrid(),
    weatherCounts: { rain: 0, storm: 0, drought: 0 },
    stormFlash: 0,
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

  function tileIndex(v, max) { return clamp(Math.round(v), 0, max - 1); }

  function weatherAt(xf, yf) {
    const tx = tileIndex(xf, COLS), ty = tileIndex(yf, ROWS);
    return state.tileWeather[ty][tx].type;
  }

  // ----- Entity factories -----------------------------------------------------
  function makeTree(x, y) {
    return addEntity({
      kind: "tree", x, y, stage: 0, growTimer: 0,
      hasFruit: false, fruitTimer: 0,
    });
  }

  function makeAnimal(x, y) {
    return addEntity({
      kind: "animal", x, y,
      moveTX: x, moveTY: y, wanderCd: 0,
      breedCd: randInt(10, 30),
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

    if (!isLand(state.tiles, tx, ty)) { if (!silent) toast("那裡是海洋，無法施展能力"); return; }

    if (tool === "plant-seed") {
      if (treeAt(tx, ty)) { if (!silent) toast("這裡已經有一株植物了"); return; }
      makeTree(tx, ty);
      if (!silent) toast("🌱 一顆種子落入土壤");
    } else if (tool === "spawn-animal") {
      if (state.entities.filter(e => e.kind === "animal").length >= ANIMAL_CAP) { if (!silent) toast("動物數量已達上限"); return; }
      makeAnimal(tx, ty);
      if (!silent) toast("🐇 一隻動物誕生了");
    } else if (tool === "spawn-man") {
      if (state.entities.filter(e => e.kind === "human").length >= POP_CAP) { if (!silent) toast("人口已達上限"); return; }
      makeHuman(tx, ty, "m");
      if (!silent) toast("🧔 一位男人誕生了");
    } else if (tool === "spawn-woman") {
      if (state.entities.filter(e => e.kind === "human").length >= POP_CAP) { if (!silent) toast("人口已達上限"); return; }
      makeHuman(tx, ty, "f");
      if (!silent) toast("👩 一位女人誕生了");
    }
  }

  // ----- Simulation tick (one "day") -----------------------------------------
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

  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

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

  function tickTrees() {
    for (const e of state.entities) {
      if (e.kind !== "tree") continue;
      const w = weatherAt(e.x, e.y);
      const growMul = weatherGrowMul(w);
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
          if (e.fruitTimer >= 8) { e.hasFruit = true; e.fruitTimer = 0; }
        }
      }
    }
  }

  function tickAnimals() {
    const animals = state.entities.filter(e => e.kind === "animal");
    for (const a of animals) {
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

  function tickHumans() {
    const humans = state.entities.filter(e => e.kind === "human");
    for (const h of humans) {
      const hungerMul = weatherHungerMul(weatherAt(h.x, h.y));
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

      const isAdult = h.age >= ADULT_AGE;

      // Decide state
      if (h.hunger >= SEEK_FOOD_THRESHOLD) {
        h.state = "seekFood";
      } else if (isAdult && h.hunger < MATE_HUNGER_MAX && h.mateCd <= 0 && humans.length < POP_CAP) {
        h.state = "seekMate";
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
          if (o === h || o.gender === h.gender) continue;
          if (o.age < ADULT_AGE || o.hunger >= MATE_HUNGER_MAX || o.mateCd > 0) continue;
          const d = dist2(h, o);
          if (d < bestD) { bestD = d; mate = o; }
        }
        if (mate) {
          h.moveTX = mate.x; h.moveTY = mate.y;
          if (dist2(h, mate) < 0.6 && rand() < 0.12) {
            const spot = findLandNear(Math.round(h.x), Math.round(h.y), 2);
            if (spot && humans.length < POP_CAP) {
              makeHuman(spot.x, spot.y, choice(["m", "f"]), 0);
              h.mateCd = MATE_COOLDOWN; mate.mateCd = MATE_COOLDOWN;
              toast("👶 誕生了一個新生命");
            }
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
  }

  function moveEntitiesStep(dtFactor) {
    for (const e of state.entities) {
      if (e.kind === "tree") continue;
      const speed = e.kind === "human" ? 0.09 : 0.06;
      const dx = e.moveTX - e.x, dy = e.moveTY - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.02) {
        const step = Math.min(d, speed * dtFactor);
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }
    }
  }

  function simulateDay() {
    state.day++;
    tickWeatherDecay();
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
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tile = state.tiles[y][x];
        const wx = x * TILE, wy = y * TILE;

        if (tile.type === TERRAIN.WATER) {
          const shimmer = Math.sin(ts * 0.0016 + x * 0.55 + y * 0.4) * 9 + tile.shade * 6;
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.WATER], shimmer);
        } else if (tile.type === TERRAIN.SAND) {
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.SAND], tile.shade * 10);
        } else {
          ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.GRASS], tile.shade * 12);
        }
        ctx.fillRect(wx, wy, TILE, TILE);

        if (tile.type === TERRAIN.GRASS && (x * 3 + y * 7) % 13 === 0) {
          ctx.fillStyle = "rgba(0,0,0,0.07)";
          ctx.fillRect(wx + 3, wy + 3, TILE - 6, TILE - 6);
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
    // paint trees first (ground-anchored), then animals, then humans (draw order = rough depth)
    const trees = [], animals = [], humans = [];
    for (const e of state.entities) {
      if (e.kind === "tree") trees.push(e);
      else if (e.kind === "animal") animals.push(e);
      else humans.push(e);
    }
    const byY = (a, b) => a.y - b.y;
    trees.sort(byY); animals.sort(byY); humans.sort(byY);

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
      const r = isAdult ? 3.6 : 2.4;
      const color = h.gender === "m" ? "#4fb0ff" : "#ff7fc0";
      drawShadow(px, py, r * 1.1, r * 0.45);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(px, py + r * 0.3, r * 0.85, r, 0, 0, 7); ctx.fill();
      ctx.fillStyle = adjustColor(color, 35);
      ctx.beginPath(); ctx.arc(px, py - r * 0.65, r * 0.62, 0, 7); ctx.fill();
      if (h.state === "seekFood") {
        ctx.strokeStyle = "#ffcf6b";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, r + 3, 0, 7); ctx.stroke();
      }
    }
  }

  function render(ts) {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawWorld(ts);
    drawEntities();
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
  }

  // ----- Stats UI ------------------------------------------------------------
  function updateStats() {
    const humans = state.entities.filter(e => e.kind === "human");
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

    render(ts);
    updateStats();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
