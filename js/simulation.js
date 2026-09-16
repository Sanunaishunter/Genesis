import {
  COLS, ROWS, TERRAIN,
  ADULT_AGE, MAX_AGE, HUNGER_MAX, STARVE_TICKS_TO_DIE, SEEK_FOOD_THRESHOLD,
  MATE_HUNGER_MAX, SENSE_RADIUS, PANIC_SPEED_MUL, MOVE_SPEED,
  SEASON_LIST, SEASON_LENGTH, SEASON_LABEL,
  FIRE_DAMAGE_CHANCE, DROWN_CHANCE, CROP_GROW_TICKS,
  ANIMAL_CAP, ANIMAL_ROLE, animalSpeedFor,
  SAGE_WORSHIP_RADIUS, WISDOM_PER_WORSHIPPER, TECH_THRESHOLD,
  MIN_TREES_TO_KEEP, CHOP_CHANCE_PER_TICK, WOOD_PER_CHOP, WOOD_PER_FARM_CLEAR,
  HOUSE_COST, HOUSE_CAP, BRIDGE_COST,
} from "./constants.js";
import { rand, randRange, randInt, choice } from "./rng.js";
import { dist2 } from "./utils.js";
import { toast } from "./toast.js";
import {
  state, addEntity, addEffect, isLand, isDangerousRiver, isOnFire, isOnCave,
  weatherAt, findLandNear, findWaterNear,
} from "./state.js";
import { makeAnimal, makeHuman, treeAt } from "./entities.js";
import { popCap, mateCooldown, fruitNeedTicks } from "./tech.js";

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
    if (e.kind === "tree" || e.kind === "fish" || e.kind === "whale" || e.isSage) continue;
    if (isDangerousRiver(e.x, e.y) && rand() < DROWN_CHANCE) e.dead = true;
  }
}

function tickFarmland() {
  const ready = [];
  const growMul = seasonGrowMul();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = state.tiles[y][x];
      if (!t.farmland) continue;
      if (t.cropReady) { ready.push({ x, y }); continue; }
      t.cropTimer += 1 / growMul;
      if (t.cropTimer >= CROP_GROW_TICKS) { t.cropReady = true; t.cropTimer = 0; ready.push({ x, y }); }
    }
  }
  state.readyFarmland = ready;
}

function tickSeaLife() {
  const fishAndWhales = state.entities.filter(e => e.kind === "fish" || e.kind === "whale");
  for (const s of fishAndWhales) {
    if (s.wanderCd <= 0) {
      const spot = findWaterNear(Math.round(s.x + randRange(-4, 4)), Math.round(s.y + randRange(-4, 4)), 3);
      if (spot) { s.moveTX = spot.x; s.moveTY = spot.y; }
      s.wanderCd = randInt(6, 12);
    } else s.wanderCd--;

    if (s.kind === "whale") {
      s.spoutCd--;
      if (s.spoutCd <= 0) {
        addEffect({ type: "spout", x: s.x, y: s.y, life: 22, maxLife: 22 });
        s.spoutCd = randInt(35, 80);
      }
    }
  }
}

function tickHouses() {
  for (const e of state.entities) {
    if (e.kind !== "house") continue;
    e.smokeCd--;
    if (e.smokeCd <= 0) {
      addEffect({ type: "smoke", x: e.x + 0.2, y: e.y - 0.6, life: 45, maxLife: 45 });
      e.smokeCd = randInt(6, 14);
    }
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
  const humans = state.entities.filter(e => e.kind === "human");

  for (const a of animals) {
    const role = ANIMAL_ROLE[a.species];

    if (a.panicTicks > 0) {
      a.panicTicks--;
      if (dist2(a, { x: a.moveTX, y: a.moveTY }) < 0.3) {
        const spot = findLandNear(Math.round(a.x + randRange(-6, 6)), Math.round(a.y + randRange(-6, 6)), 4);
        if (spot) { a.moveTX = spot.x; a.moveTY = spot.y; }
      }
      continue;
    }

    if (role === "predator") {
      let prey = null, bestD = SENSE_RADIUS * SENSE_RADIUS;
      for (const e of animals) {
        if (ANIMAL_ROLE[e.species] !== "prey") continue;
        const d = dist2(a, e);
        if (d < bestD) { bestD = d; prey = e; }
      }
      if (prey) {
        a.moveTX = prey.x; a.moveTY = prey.y;
        if (dist2(a, prey) < 0.4) prey.dead = true;
      } else if (a.wanderCd <= 0) {
        const spot = findLandNear(Math.round(a.x + randRange(-5, 5)), Math.round(a.y + randRange(-5, 5)), 3);
        if (spot) { a.moveTX = spot.x; a.moveTY = spot.y; }
        a.wanderCd = randInt(4, 9);
      } else a.wanderCd--;
    } else if (role === "companion") {
      if (a.wanderCd <= 0) {
        let cx = a.x, cy = a.y, range = 5;
        let nearest = null, bestD = 12 * 12;
        for (const h of humans) {
          const d = dist2(a, h);
          if (d < bestD) { bestD = d; nearest = h; }
        }
        if (nearest) { cx = nearest.x; cy = nearest.y; range = 4; }
        const spot = findLandNear(Math.round(cx + randRange(-range, range)), Math.round(cy + randRange(-range, range)), 3);
        if (spot) { a.moveTX = spot.x; a.moveTY = spot.y; }
        a.wanderCd = randInt(4, 9);
      } else a.wanderCd--;
    } else {
      if (a.wanderCd <= 0) {
        const spot = findLandNear(Math.round(a.x + randRange(-4, 4)), Math.round(a.y + randRange(-4, 4)), 3);
        if (spot) { a.moveTX = spot.x; a.moveTY = spot.y; }
        a.wanderCd = randInt(4, 9);
      } else a.wanderCd--;
    }

    if (a.breedCd <= 0 && animals.length < ANIMAL_CAP) {
      for (const other of animals) {
        if (other === a || ANIMAL_ROLE[other.species] !== role) continue;
        if (dist2(a, other) <= 4 && rand() < 0.15) {
          const spot = findLandNear(Math.round(a.x), Math.round(a.y), 2);
          if (spot) { makeAnimal(spot.x, spot.y, choice([a.species, other.species])); a.breedCd = randInt(25, 45); other.breedCd = randInt(25, 45); }
          break;
        }
      }
    } else a.breedCd--;
  }
}

function nearestFoodForHuman(h) {
  let best = null, bestD = SENSE_RADIUS * SENSE_RADIUS, bestIsFarm = false;
  for (const e of state.entities) {
    if ((e.kind === "tree" && e.stage === 2 && e.hasFruit) || (e.kind === "animal" && ANIMAL_ROLE[e.species] === "prey") || e.kind === "fish") {
      const d = dist2(h, e);
      if (d < bestD) { bestD = d; best = e; bestIsFarm = false; }
    }
  }
  for (const f of state.readyFarmland) {
    const d = dist2(h, f);
    if (d < bestD) { bestD = d; best = f; bestIsFarm = true; }
  }
  return best ? { target: best, isFarm: bestIsFarm } : null;
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
        addEntity({ kind: "house", x: spot.x, y: spot.y, smokeCd: randInt(4, 12) });
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
  const treeCountOk = state.entities.filter(e => e.kind === "tree").length > MIN_TREES_TO_KEEP;
  const canFarm = state.tech.farming && treeCountOk;
  const canChop = state.tech.tribe && treeCountOk;
  const sages = humans.filter(h => h.isSage);

  for (const h of humans) {
    if (h.isSage) {
      if (h.teachCooldown > 0) h.teachCooldown--;
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
    } else if (isAdult && canFarm && (h.state === "farmClear" || rand() < CHOP_CHANCE_PER_TICK)) {
      h.state = "farmClear";
    } else if (isAdult && canChop && (h.state === "chopWood" || rand() < CHOP_CHANCE_PER_TICK)) {
      h.state = "chopWood";
    } else {
      h.state = "wander";
    }

    if (h.state === "seekFood") {
      const found = nearestFoodForHuman(h);
      if (found) {
        const target = found.target;
        h.moveTX = target.x; h.moveTY = target.y;
        if (dist2(h, target) < 0.4) {
          h.hunger = Math.max(0, h.hunger - 60);
          if (found.isFarm) {
            const t = state.tiles[target.y][target.x];
            t.cropReady = false; t.cropTimer = 0;
          } else if (target.kind === "tree") {
            target.hasFruit = false;
          } else {
            target.dead = true; // ate the animal or fish
          }
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

    if (h.state === "farmClear") {
      const target = nearestChoppableTree(h);
      if (target) {
        h.moveTX = target.x; h.moveTY = target.y;
        if (dist2(h, target) < 0.4) {
          const tx = Math.round(target.x), ty = Math.round(target.y);
          target.dead = true;
          const t = state.tiles[ty][tx];
          if (t.type === TERRAIN.GRASS) { t.farmland = true; t.cropReady = false; t.cropTimer = 0; }
          state.wood += WOOD_PER_FARM_CLEAR;
          h.state = "wander";
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
        let cx = h.x, cy = h.y, range = 5;
        if (sages.length > 0) {
          let nearest = null, bestD = SAGE_WORSHIP_RADIUS * SAGE_WORSHIP_RADIUS;
          for (const s of sages) {
            const d = dist2(h, s);
            if (d < bestD) { bestD = d; nearest = s; }
          }
          if (nearest) { cx = nearest.x; cy = nearest.y; range = 6; }
        }
        const spot = findLandNear(Math.round(cx + randRange(-range, range)), Math.round(cy + randRange(-range, range)), 3);
        if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
        h.wanderCd = randInt(5, 10);
      } else h.wanderCd--;
    }
  }

  tickCivilizationBuildings(humans);
  tickWisdomAndTech(humans);
}

export function moveEntitiesStep(dtFactor) {
  for (const e of state.entities) {
    const base = e.kind === "animal" ? animalSpeedFor(e.species) : MOVE_SPEED[e.kind];
    if (!base) continue;
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

export function updateEffects() {
  for (const ef of state.effects) ef.life--;
  state.effects = state.effects.filter(ef => ef.life > 0);
}

export function simulateDay() {
  state.day++;
  tickSeason();
  tickWeatherDecay();
  tickFire();
  tickRiverHazard();
  tickTrees();
  tickFarmland();
  tickAnimals();
  tickSeaLife();
  tickHouses();
  tickHumans();
  state.entities = state.entities.filter(e => !e.dead);
}
