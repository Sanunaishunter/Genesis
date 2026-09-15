(() => {
  "use strict";

  // ----- Config -----------------------------------------------------------
  const TILE = 18;
  const COLS = 48;
  const ROWS = 32;
  const CANVAS_W = COLS * TILE;
  const CANVAS_H = ROWS * TILE;

  const TERRAIN = { WATER: 0, SAND: 1, GRASS: 2 };
  const WEATHER = { SUNNY: "sunny", RAIN: "rain", STORM: "storm", DROUGHT: "drought" };
  const WEATHER_LABEL = { sunny: "晴朗", rain: "降雨", storm: "風暴", drought: "乾旱" };

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
        row.push({ type });
      }
      tiles.push(row);
    }
    return tiles;
  }

  function isLand(tiles, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    const t = tiles[ty][tx].type;
    return t === TERRAIN.GRASS || t === TERRAIN.SAND;
  }

  // ----- Game state ----------------------------------------------------------
  const state = {
    tiles: generateWorld(),
    entities: [], // trees, animals, humans
    day: 0,
    weather: WEATHER.SUNNY,
    speed: "normal",
    selectedTool: null,
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
    return state.entities.find(e => e.kind === "tree" && e.x === tx && e.y === ty);
  }

  function setWeather(w) {
    state.weather = w;
    toast("天氣轉為：" + WEATHER_LABEL[state.weather]);
  }

  function setSpeed(s) {
    state.speed = s;
    toast("時間流速：" + (s === "pause" ? "暫停" : s === "fast" ? "加速" : "正常"));
  }

  function applyGodAction(tx, ty) {
    const tool = state.selectedTool;
    if (!tool) { toast("請先在右側選擇一項天神能力"); return; }
    if (!isLand(state.tiles, tx, ty)) { toast("那裡是海洋，無法施展能力"); return; }

    if (tool === "plant-seed") {
      if (treeAt(tx, ty)) { toast("這裡已經有一株植物了"); return; }
      makeTree(tx, ty);
      toast("🌱 一顆種子落入土壤");
    } else if (tool === "spawn-animal") {
      if (state.entities.filter(e => e.kind === "animal").length >= ANIMAL_CAP) { toast("動物數量已達上限"); return; }
      makeAnimal(tx, ty);
      toast("🐇 一隻動物誕生了");
    } else if (tool === "spawn-man") {
      if (state.entities.filter(e => e.kind === "human").length >= POP_CAP) { toast("人口已達上限"); return; }
      makeHuman(tx, ty, "m");
      toast("🧔 一位男人誕生了");
    } else if (tool === "spawn-woman") {
      if (state.entities.filter(e => e.kind === "human").length >= POP_CAP) { toast("人口已達上限"); return; }
      makeHuman(tx, ty, "f");
      toast("👩 一位女人誕生了");
    }
  }

  // ----- Simulation tick (one "day") -----------------------------------------
  function weatherGrowMul() {
    switch (state.weather) {
      case WEATHER.RAIN: return 0.55;
      case WEATHER.DROUGHT: return 1.9;
      case WEATHER.STORM: return 0.9;
      default: return 1;
    }
  }
  function weatherHungerMul() {
    switch (state.weather) {
      case WEATHER.DROUGHT: return 1.6;
      case WEATHER.RAIN: return 0.85;
      default: return 1;
    }
  }

  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  function tickTrees() {
    const growMul = weatherGrowMul();
    for (const e of state.entities) {
      if (e.kind !== "tree") continue;
      if (state.weather === WEATHER.STORM && rand() < (e.stage < 2 ? 0.05 : 0.012)) {
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
    const hungerMul = weatherHungerMul();
    const humans = state.entities.filter(e => e.kind === "human");
    for (const h of humans) {
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
  const WEATHER_TINT = {
    sunny: null,
    rain: "rgba(70,110,180,0.16)",
    storm: "rgba(30,40,60,0.35)",
    drought: "rgba(200,150,60,0.14)",
  };

  function drawWorld() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = state.tiles[y][x].type;
        ctx.fillStyle = TERRAIN_COLOR[t];
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        if (t === TERRAIN.GRASS && (x + y * 7) % 13 === 0) {
          ctx.fillStyle = "rgba(0,0,0,0.06)";
          ctx.fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6);
        }
      }
    }
    const tint = WEATHER_TINT[state.weather];
    if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
  }

  function drawEntities() {
    for (const e of state.entities) {
      const px = e.x * TILE + TILE / 2;
      const py = e.y * TILE + TILE / 2;
      if (e.kind === "tree") {
        if (e.stage === 0) {
          ctx.fillStyle = "#8bd17a";
          ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fill();
        } else {
          const r = e.stage === 1 ? 4 : 7;
          ctx.fillStyle = "#5a3a22";
          ctx.fillRect(px - 1, py, 2, r * 0.6);
          ctx.fillStyle = e.stage === 1 ? "#4fae5c" : "#2f8f43";
          ctx.beginPath(); ctx.arc(px, py - r * 0.3, r, 0, 7); ctx.fill();
          if (e.hasFruit) {
            ctx.fillStyle = "#e2543b";
            ctx.beginPath(); ctx.arc(px + r * 0.4, py - r * 0.2, 1.6, 0, 7); ctx.fill();
          }
        }
      } else if (e.kind === "animal") {
        ctx.fillStyle = "#b98455";
        ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill();
      } else if (e.kind === "human") {
        const isAdult = e.age >= ADULT_AGE;
        const r = isAdult ? 4 : 2.6;
        ctx.fillStyle = e.gender === "m" ? "#4fb0ff" : "#ff7fc0";
        ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
        if (e.state === "seekFood") {
          ctx.strokeStyle = "#ffcf6b";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(px, py, r + 2, 0, 7); ctx.stroke();
        }
      }
    }
  }

  function render() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawWorld();
    drawEntities();
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
    document.getElementById("stat-weather").textContent = WEATHER_LABEL[state.weather];
  }

  // ----- Input ---------------------------------------------------------------
  document.querySelectorAll("button.tool").forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (tool.startsWith("weather-") || tool.startsWith("speed-")) {
        const prefix = tool.startsWith("weather-") ? "weather-" : "speed-";
        document.querySelectorAll(`button.tool[data-tool^="${prefix}"]`)
          .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (prefix === "weather-") setWeather(tool.replace(prefix, ""));
        else setSpeed(tool.replace(prefix, ""));
        return;
      }
      document.querySelectorAll('button.tool:not([data-tool^="weather-"]):not([data-tool^="speed-"])')
        .forEach(b => b.classList.remove("active"));
      if (state.selectedTool === tool) {
        state.selectedTool = null;
      } else {
        state.selectedTool = tool;
        btn.classList.add("active");
      }
      document.getElementById("selected-tool-label").textContent = state.selectedTool ? btn.textContent : "尚未選擇";
    });
  });

  canvas.addEventListener("click", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const px = (ev.clientX - rect.left) * scaleX;
    const py = (ev.clientY - rect.top) * scaleY;
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    applyGodAction(tx, ty);
  });

  // default active buttons
  document.querySelector('[data-tool="weather-sunny"]').classList.add("active");
  document.querySelector('[data-tool="speed-normal"]').classList.add("active");

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

    render();
    updateStats();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
