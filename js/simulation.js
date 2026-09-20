import {
  COLS, ROWS, TERRAIN,
  ADULT_AGE, MAX_AGE, HUNGER_MAX, STARVE_TICKS_TO_DIE, SEEK_FOOD_THRESHOLD,
  MATE_HUNGER_MAX, SENSE_RADIUS, PANIC_SPEED_MUL, MOVE_SPEED,
  SEASON_LIST, SEASON_LENGTH, SEASON_LABEL,
  FIRE_DAMAGE_CHANCE, DROWN_CHANCE, CROP_GROW_TICKS,
  ANIMAL_CAP, ANIMAL_ROLE, animalSpeedFor,
  SAGE_WORSHIP_RADIUS, WISDOM_PER_WORSHIPPER, TECH_ORDER, TECH_THRESHOLD, TECH_LABEL,
  MIN_TREES_TO_KEEP, CHOP_CHANCE_PER_TICK, WOOD_PER_CHOP, WOOD_PER_FARM_CLEAR,
  HOUSE_COST, HOUSE_CAP, BRIDGE_COST,
  EVIL_CORRUPT_RADIUS, CORRUPTION_CHANCE_PER_TICK,
  RAID_KILL_CHANCE, HUNTER_KILL_CHANCE, SHAMAN_HEAL_AMOUNT, SHAMAN_CURE_CHANCE, COMBAT_TIER_BONUS,
  PREDATOR_HUMAN_KILL_CHANCE, HUNTER_BEAST_KILL_CHANCE,
  HUNTER_RATIO, SHAMAN_RATIO, PROFESSION_PROMOTE_CHANCE,
  WALL_COST, WALL_RING_COUNT, WALL_RADIUS, WALL_PROTECT_MUL,
  TRIBE_GRACE_TICKS, BIG_TREE_GROW_TICKS, BIG_TREE_WOOD_BONUS,
  POP_EXPLOSION_THRESHOLD, POP_EXPLOSION_CULL_FRACTION, POP_CATEGORY_LABEL,
} from "./constants.js";
import { rand, randRange, randInt, choice } from "./rng.js";
import { dist2 } from "./utils.js";
import { toast } from "./toast.js";
import {
  state, addEntity, addEffect, isLand, isDangerousRiver, isOnFire, isSheltered,
  weatherAt, findLandNear, findWaterNear,
} from "./state.js";
import { makeAnimal, makeHuman, makeTrex, treeAt } from "./entities.js";
import { popCap, mateCooldown, fruitNeedTicks, techTier, evilTier } from "./tech.js";

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
    if (isSheltered(e.x, e.y)) continue; // caves and big trees shelter from fire
    if (e.kind === "tree") { if (rand() < FIRE_DAMAGE_CHANCE.tree) e.dead = true; }
    else if (e.kind === "human" || e.kind === "animal") {
      if (!e.isSage && !e.isEvil && rand() < FIRE_DAMAGE_CHANCE.creature) e.dead = true;
    }
  }
}

function tickRiverHazard() {
  for (const e of state.entities) {
    if (e.kind === "tree" || e.kind === "fish" || e.kind === "whale" || e.isSage || e.isEvil) continue;
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
    if (w === "storm" && rand() < (e.stage < 2 ? 0.05 : e.stage === 3 ? 0.006 : 0.012)) {
      e.dead = true; // young growth or rare mature/ancient tree knocked down
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
      if (e.stage === 2) {
        e.bigTimer = (e.bigTimer || 0) + 1 / growMul;
        if (e.bigTimer >= BIG_TREE_GROW_TICKS) { e.stage = 3; e.bigTimer = 0; }
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
      let prey = null, bestD = SENSE_RADIUS * SENSE_RADIUS, preyIsHuman = false;
      for (const e of animals) {
        if (ANIMAL_ROLE[e.species] !== "prey") continue;
        const d = dist2(a, e);
        if (d < bestD) { bestD = d; prey = e; preyIsHuman = false; }
      }
      for (const h of humans) {
        if (h.isSage || h.isEvil) continue; // leaders are immune, like other hazards
        const d = dist2(a, h);
        if (d < bestD) { bestD = d; prey = h; preyIsHuman = true; }
      }
      if (prey) {
        a.moveTX = prey.x; a.moveTY = prey.y;
        if (dist2(a, prey) < 0.4) {
          if (preyIsHuman) {
            if (rand() < PREDATOR_HUMAN_KILL_CHANCE) {
              prey.dead = true;
              addEffect({ type: "skeleton", x: prey.x, y: prey.y, life: 28, maxLife: 28 });
              toast("🦁 一頭猛獸攻擊了一位村民");
            }
          } else {
            prey.dead = true;
          }
        }
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
    if ((e.kind === "tree" && (e.stage === 2 || e.stage === 3) && e.hasFruit) || (e.kind === "animal" && ANIMAL_ROLE[e.species] === "prey") || e.kind === "fish") {
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
      if (h.isSage || h.isEvil) continue;
      if (h.age >= ADULT_AGE && dist2(h, s) <= SAGE_WORSHIP_RADIUS * SAGE_WORSHIP_RADIUS) worshippers++;
    }
  }
  if (worshippers === 0) return;
  state.wisdom += worshippers * WISDOM_PER_WORSHIPPER;
  for (const key of TECH_ORDER) {
    if (!state.tech[key] && state.wisdom >= TECH_THRESHOLD[key]) {
      state.tech[key] = true;
      toast(TECH_LABEL[key] + " 的智慧降臨了部落！");
    }
  }
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
    if (e.kind === "tree" && e.stage >= 2) {
      const d = dist2(h, e);
      if (d < bestD) { bestD = d; target = e; }
    }
  }
  return target;
}

function chopTreeYield(target) {
  return WOOD_PER_CHOP + (target.stage === 3 ? BIG_TREE_WOOD_BONUS : 0);
}

function tickCivilizationBuildings(humans) {
  if (!state.tech.tribe) return;

  if (state.wood >= HOUSE_COST && state.entities.filter(e => e.kind === "house").length < HOUSE_CAP) {
    let sx = 0, sy = 0, n = 0;
    for (const h of humans) { if (!h.isSage && !h.isEvil) { sx += h.x; sy += h.y; n++; } }
    if (n > 0) {
      const cx = sx / n, cy = sy / n;
      const spot = findLandNear(Math.round(cx + randRange(-3, 3)), Math.round(cy + randRange(-3, 3)), 3);
      if (spot && !treeAt(spot.x, spot.y)) {
        addEntity({ kind: "house", x: spot.x, y: spot.y, smokeCd: randInt(4, 12), era: techTier() });
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

// ----- Tribes, corruption & conquest --------------------------------------

function tickTribes(humans) {
  const leaders = humans.filter(h => (h.isSage || h.isEvil) && !h.dead);
  for (const h of humans) {
    if (h.isSage || h.isEvil) { h.tribeId = h.id; continue; }
    if (leaders.length === 0) { h.tribeId = null; continue; }
    let best = null, bestD = Infinity;
    for (const l of leaders) {
      const d = dist2(h, l);
      if (d < bestD) { bestD = d; best = l; }
    }
    h.tribeId = best.id;
  }
  state.tribes = leaders.map(l => ({
    id: l.id,
    leader: l,
    kind: l.isEvil ? "evil" : "good",
    members: humans.filter(h => h.tribeId === l.id && h !== l),
  }));
}

function tribeHasWalls(tribeId) {
  return state.entities.some(e => e.kind === "wall" && e.tribeId === tribeId && !e.dead);
}

function isRaidProtected(target) {
  if (target.tribeId == null) return false;
  const tribe = state.tribes.find(t => t.id === target.tribeId);
  if (!tribe || tribe.kind !== "good") return false;
  if (!tribeHasWalls(tribe.id)) return false;
  return dist2(target, tribe.leader) <= WALL_RADIUS * WALL_RADIUS;
}

function tickCorruption(humans) {
  const evils = humans.filter(h => h.isEvil && !h.dead);
  if (evils.length === 0) return;
  for (const h of humans) {
    if (h.role !== "villager" || h.corrupted || h.age < ADULT_AGE) continue;
    for (const e of evils) {
      if (dist2(h, e) <= EVIL_CORRUPT_RADIUS * EVIL_CORRUPT_RADIUS) {
        if (rand() < CORRUPTION_CHANCE_PER_TICK) {
          h.corrupted = true;
          h.role = "raider";
          toast("😈 一位村民黑化了，加入了惡人的隊伍");
        }
        break;
      }
    }
  }
}

function tickConquest() {
  for (const tribe of state.tribes) {
    if (tribe.leader.dead) continue;
    const alive = tribe.members.filter(m => !m.dead).length;
    if (alive > 0) {
      tribe.leader.hadMembers = true;
      tribe.leader.zeroPopTick = null;
      continue;
    }
    if (!tribe.leader.hadMembers) continue; // never had a population to lose yet
    if (tribe.leader.zeroPopTick == null) { tribe.leader.zeroPopTick = state.day; continue; }
    if (state.day - tribe.leader.zeroPopTick >= TRIBE_GRACE_TICKS) {
      tribe.leader.dead = true;
      addEffect({ type: "skeleton", x: tribe.leader.x, y: tribe.leader.y, life: 40, maxLife: 40 });
      toast(tribe.kind === "good" ? "💀 一個部落人口歸零，已被征服" : "💀 惡人部落人口歸零，黑暗力量消散了");
    }
  }
}

function tickWalls() {
  if (state.wood < WALL_COST) return;
  const anyEvil = state.tribes.some(t => t.kind === "evil");
  if (!anyEvil) return;
  for (const tribe of state.tribes) {
    if (tribe.kind !== "good") continue;
    const builtCount = state.entities.filter(e => e.kind === "wall" && e.tribeId === tribe.id).length;
    if (builtCount >= WALL_RING_COUNT) continue;
    if (state.wood < WALL_COST) break;
    const angle = (builtCount / WALL_RING_COUNT) * Math.PI * 2;
    const wx = Math.round(tribe.leader.x + Math.cos(angle) * WALL_RADIUS);
    const wy = Math.round(tribe.leader.y + Math.sin(angle) * WALL_RADIUS);
    if (!isLand(state.tiles, wx, wy)) continue;
    addEntity({ kind: "wall", x: wx, y: wy, tribeId: tribe.id });
    state.wood -= WALL_COST;
    if (builtCount === 0) toast("🧱 聖人教導村民築起了圍牆，保護資源與族人");
  }
}

function tickProfessions() {
  const evilPresent = state.tribes.some(t => t.kind === "evil");
  const beastPresent = state.entities.some(e => e.kind === "animal" && !e.dead && ANIMAL_ROLE[e.species] === "predator");
  if (!evilPresent && !beastPresent) return;
  for (const tribe of state.tribes) {
    if (tribe.kind !== "good") continue;
    const alive = tribe.members.filter(m => !m.dead);
    const villagers = alive.filter(m => m.role === "villager" && m.age >= ADULT_AGE);
    let hunters = alive.filter(m => m.role === "hunter").length;
    let shamans = alive.filter(m => m.role === "shaman").length;
    const base = alive.length;
    const hunterTarget = Math.max(1, Math.floor(base * HUNTER_RATIO));
    const shamanTarget = Math.max(1, Math.floor(base * SHAMAN_RATIO));
    for (const v of villagers) {
      if (hunters < hunterTarget && rand() < PROFESSION_PROMOTE_CHANCE) {
        v.role = "hunter"; hunters++;
        toast("🏹 一位村民成為了獵人，保衛族人");
      } else if (shamans < shamanTarget && rand() < PROFESSION_PROMOTE_CHANCE) {
        v.role = "shaman"; shamans++;
        toast("💊 一位村民成為了薩滿，救治族人");
      }
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

  tickTribes(humans);
  tickCorruption(humans);

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

    if (h.isEvil) {
      if (h.inciteCooldown > 0) h.inciteCooldown--;
      if (h.wanderCd <= 0) {
        const spot = findLandNear(Math.round(h.x + randRange(-3, 3)), Math.round(h.y + randRange(-3, 3)), 2);
        if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
        h.wanderCd = randInt(20, 40);
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

    if (h.corrupted) {
      h.state = (h.hunger >= SEEK_FOOD_THRESHOLD) ? "seekFood" : "raid";
    } else if (h.role === "hunter") {
      h.state = (h.hunger >= SEEK_FOOD_THRESHOLD) ? "seekFood" : "patrol";
    } else if (h.role === "shaman") {
      h.state = (h.hunger >= SEEK_FOOD_THRESHOLD) ? "seekFood" : "heal";
    } else if (h.hunger >= SEEK_FOOD_THRESHOLD) {
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
        if (o === h || o.isSage || o.isEvil || o.gender === h.gender) continue;
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
          state.wood += chopTreeYield(target);
          h.state = "wander";
        }
      } else {
        h.state = "wander";
      }
    }

    if (h.state === "raid") {
      let target = null, bestD = SENSE_RADIUS * SENSE_RADIUS;
      for (const o of humans) {
        if (o === h || o.dead || o.corrupted || o.isEvil || o.isSage) continue;
        const d = dist2(h, o);
        if (d < bestD) { bestD = d; target = o; }
      }
      if (target) {
        h.moveTX = target.x; h.moveTY = target.y;
        if (dist2(h, target) < 0.5) {
          let chance = RAID_KILL_CHANCE * (1 + evilTier() * COMBAT_TIER_BONUS);
          if (isRaidProtected(target)) chance *= WALL_PROTECT_MUL;
          if (rand() < chance) {
            target.dead = true;
            state.evilLoot++;
            addEffect({ type: "skeleton", x: target.x, y: target.y, life: 28, maxLife: 28 });
            toast("😈 部落遭到掠奪，一位族人倒下了");
          }
        }
      } else {
        const target2 = nearestChoppableTree(h);
        if (target2) {
          h.moveTX = target2.x; h.moveTY = target2.y;
          if (dist2(h, target2) < 0.4) {
            target2.dead = true;
            if (rand() < 0.5) state.wood += chopTreeYield(target2); // otherwise wasted by reckless over-harvesting
          }
        } else if (h.wanderCd <= 0) {
          const leader = humans.find(l => l.id === h.tribeId);
          const cx = leader ? leader.x : h.x, cy = leader ? leader.y : h.y;
          const spot = findLandNear(Math.round(cx + randRange(-4, 4)), Math.round(cy + randRange(-4, 4)), 3);
          if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
          h.wanderCd = randInt(5, 10);
        } else h.wanderCd--;
      }
    }

    if (h.state === "patrol") {
      let target = null, bestD = SENSE_RADIUS * SENSE_RADIUS, targetIsBeast = false;
      for (const o of humans) {
        if (o.dead || (!o.corrupted && !o.isEvil)) continue;
        const d = dist2(h, o);
        if (d < bestD) { bestD = d; target = o; targetIsBeast = false; }
      }
      for (const beast of state.entities) {
        if (beast.kind !== "animal" || beast.dead || ANIMAL_ROLE[beast.species] !== "predator") continue;
        const d = dist2(h, beast);
        if (d < bestD) { bestD = d; target = beast; targetIsBeast = true; }
      }
      if (target) {
        h.moveTX = target.x; h.moveTY = target.y;
        const chance = (targetIsBeast ? HUNTER_BEAST_KILL_CHANCE : HUNTER_KILL_CHANCE) * (1 + techTier() * COMBAT_TIER_BONUS);
        if (dist2(h, target) < 0.5 && rand() < chance) {
          target.dead = true;
          addEffect({ type: targetIsBeast ? "scorch" : "skeleton", x: target.x, y: target.y, life: 28, maxLife: 28 });
          toast(targetIsBeast ? "🏹 獵人獵殺了一頭猛獸" : "🏹 獵人擊退了一名黑化的敵人");
        }
      } else if (h.wanderCd <= 0) {
        const leader = humans.find(l => l.id === h.tribeId);
        const cx = leader ? leader.x : h.x, cy = leader ? leader.y : h.y;
        const spot = findLandNear(Math.round(cx + randRange(-5, 5)), Math.round(cy + randRange(-5, 5)), 3);
        if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
        h.wanderCd = randInt(5, 10);
      } else h.wanderCd--;
    }

    if (h.state === "heal") {
      let curTarget = null, bestCD = SENSE_RADIUS * SENSE_RADIUS;
      for (const o of humans) {
        if (o === h || o.dead || o.isSage || o.isEvil || !o.corrupted) continue;
        const d = dist2(h, o);
        if (d < bestCD) { bestCD = d; curTarget = o; }
      }
      if (curTarget) {
        h.moveTX = curTarget.x; h.moveTY = curTarget.y;
        if (dist2(h, curTarget) < 0.5 && rand() < SHAMAN_CURE_CHANCE) {
          curTarget.corrupted = false;
          curTarget.role = "villager";
          toast("✨ 薩滿的祈禱洗淨了一位族人的黑暗");
        }
      } else {
        let healTarget = null, bestHD = SENSE_RADIUS * SENSE_RADIUS;
        for (const o of humans) {
          if (o === h || o.dead || o.isSage || o.isEvil || o.corrupted) continue;
          if (o.hunger <= 40) continue;
          const d = dist2(h, o);
          if (d < bestHD) { bestHD = d; healTarget = o; }
        }
        if (healTarget) {
          h.moveTX = healTarget.x; h.moveTY = healTarget.y;
          if (dist2(h, healTarget) < 0.5) healTarget.hunger = Math.max(0, healTarget.hunger - SHAMAN_HEAL_AMOUNT);
        } else if (h.wanderCd <= 0) {
          const leader = humans.find(l => l.id === h.tribeId);
          const cx = leader ? leader.x : h.x, cy = leader ? leader.y : h.y;
          const spot = findLandNear(Math.round(cx + randRange(-5, 5)), Math.round(cy + randRange(-5, 5)), 3);
          if (spot) { h.moveTX = spot.x; h.moveTY = spot.y; }
          h.wanderCd = randInt(5, 10);
        } else h.wanderCd--;
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

  tickConquest();
  tickCivilizationBuildings(humans);
  tickWisdomAndTech(humans);
  tickWalls();
  tickProfessions();
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

function currentPopCount(category) {
  if (category === "human") return state.entities.filter(e => e.kind === "human" && !e.isSage && !e.isEvil && !e.dead).length;
  return state.entities.filter(e => e.kind === "animal" && !e.dead && ANIMAL_ROLE[e.species] === category).length;
}

function tickApexPredators() {
  const huntedCategories = new Set(
    state.entities.filter(e => e.kind === "animal" && e.species === "trex" && !e.dead).map(t => t.huntCategory)
  );
  for (const category of Object.keys(POP_EXPLOSION_THRESHOLD)) {
    if (huntedCategories.has(category)) continue;
    const count = currentPopCount(category);
    if (count > POP_EXPLOSION_THRESHOLD[category]) {
      const cullFloor = Math.max(1, Math.floor(count * POP_EXPLOSION_CULL_FRACTION));
      // Cull the bulk of the excess instantly: a physically-chasing T-Rex could never
      // out-pace uncapped exponential breeding, so the population correction itself
      // has to be immediate. One straggler is left above the floor for the T-Rex to
      // visibly hunt down before it leaves.
      const pool = category === "human"
        ? state.entities.filter(e => e.kind === "human" && !e.isSage && !e.isEvil && !e.dead)
        : state.entities.filter(e => e.kind === "animal" && !e.dead && ANIMAL_ROLE[e.species] === category);
      let toKill = Math.max(0, pool.length - (cullFloor + 1));
      while (toKill > 0 && pool.length > 0) {
        const idx = Math.floor(rand() * pool.length);
        pool.splice(idx, 1)[0].dead = true;
        toKill--;
      }
      const spot = findLandNear(randInt(0, COLS - 1), randInt(0, ROWS - 1), 30) || { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
      makeTrex(spot.x, spot.y, category, cullFloor);
      toast("🦖 一隻暴龍降臨，把氾濫成災的" + POP_CATEGORY_LABEL[category] + "獵殺到只剩十分之一");
    }
  }

  for (const t of state.entities) {
    if (t.kind !== "animal" || t.species !== "trex" || t.dead) continue;
    if (t.huntCategory != null) {
      // Population-control T-Rex: leaves once its target category is back under control.
      if (currentPopCount(t.huntCategory) <= t.cullFloor) {
        t.dead = true;
        addEffect({ type: "smoke", x: t.x, y: t.y, life: 40, maxLife: 40 });
        toast("🦖 暴龍完成了狩獵，離開了這座島");
        continue;
      }
    }
    const candidates = t.huntCategory == null
      ? state.entities.filter(e =>
          (e.kind === "animal" && !e.dead && e.species !== "trex" && ["predator", "companion", "prey"].includes(ANIMAL_ROLE[e.species])) ||
          (e.kind === "human" && !e.dead && !e.isSage && !e.isEvil))
      : t.huntCategory === "human"
        ? state.entities.filter(e => e.kind === "human" && !e.isSage && !e.isEvil && !e.dead)
        : state.entities.filter(e => e.kind === "animal" && !e.dead && ANIMAL_ROLE[e.species] === t.huntCategory);
    let target = null, bestD = Infinity;
    for (const c of candidates) {
      const d = dist2(t, c);
      if (d < bestD) { bestD = d; target = c; }
    }
    if (target) {
      t.moveTX = target.x; t.moveTY = target.y;
      if (dist2(t, target) < 0.5) {
        target.dead = true;
        addEffect({ type: "skeleton", x: target.x, y: target.y, life: 28, maxLife: 28 });
      }
    } else if (t.wanderCd <= 0) {
      const spot = findLandNear(Math.round(t.x + randRange(-6, 6)), Math.round(t.y + randRange(-6, 6)), 4);
      if (spot) { t.moveTX = spot.x; t.moveTY = spot.y; }
      t.wanderCd = randInt(4, 8);
    } else t.wanderCd--;
  }
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
  tickApexPredators();
  state.entities = state.entities.filter(e => !e.dead);
}
