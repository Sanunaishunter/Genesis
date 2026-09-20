import {
  COLS, ROWS, TERRAIN,
  WEATHER_BRUSH_RADIUS, WEATHER_DURATION, WEATHER_PAINT_LABEL,
  FIRE_DURATION, FIRE_BRUSH_RADIUS, MOUNTAIN_BRUSH_RADIUS,
  EARTHQUAKE_RADIUS, PANIC_DURATION, SHAKE_DURATION,
  LIGHTNING_HITS_TO_IGNITE,
  ANIMAL_CAP, SAGE_CAP, EVIL_CAP, FISH_CAP, WHALE_CAP, BEAST_SPECIES,
  TEACH_WISDOM_BOOST, TEACH_COOLDOWN, TECH_LABEL, TECH_ORDER,
  INCITE_COOLDOWN, INCITE_CORRUPT_COUNT, EVIL_CORRUPT_RADIUS, ADULT_AGE,
} from "./constants.js";
import { rand, randRange, choice } from "./rng.js";
import { clamp, dist2 } from "./utils.js";
import { toast } from "./toast.js";
import { state, addEffect, isLand, isOcean, findLandNear, findNearestShelter } from "./state.js";
import { makeTree, makeAnimal, makeHuman, makeSage, makeEvil, makeFish, makeWhale, treeAt, sageAt, evilAt } from "./entities.js";
import { popCap } from "./tech.js";

export function setSpeed(s) {
  state.speed = s;
  toast("時間流速：" + (s === "pause" ? "暫停" : s === "fast" ? "加速" : "正常"));
}

export function isWeatherLocked() {
  return !!(state.selectedTool && state.selectedTool.startsWith("weather-") && state.selectedTool !== "weather-sunny");
}

export function commandSageTeach(sage, silent) {
  if (sage.teachCooldown > 0) { if (!silent) toast("聖人正在傳授中，請稍候"); return; }
  const nextTech = TECH_ORDER.find(key => !state.tech[key]);
  if (!nextTech) { if (!silent) toast("🧙 各項智慧都已傳授完畢"); return; }
  state.wisdom += TEACH_WISDOM_BOOST;
  sage.teachCooldown = TEACH_COOLDOWN;
  toast("🧙 聖人正傳授「" + TECH_LABEL[nextTech] + "」的智慧！");
}

export function commandEvilIncite(evil, silent) {
  if (evil.inciteCooldown > 0) { if (!silent) toast("惡人正在煽動人心，請稍候"); return; }
  const targets = state.entities.filter(e =>
    e.kind === "human" && e.role === "villager" && !e.corrupted && e.age >= ADULT_AGE &&
    dist2(e, evil) <= EVIL_CORRUPT_RADIUS * EVIL_CORRUPT_RADIUS
  );
  if (targets.length === 0) { if (!silent) toast("😈 附近沒有可以煽動的村民"); return; }
  let turned = 0;
  for (let i = 0; i < INCITE_CORRUPT_COUNT && targets.length > 0; i++) {
    const idx = Math.floor(rand() * targets.length);
    const t = targets.splice(idx, 1)[0];
    t.corrupted = true; t.role = "raider";
    turned++;
  }
  evil.inciteCooldown = INCITE_COOLDOWN;
  toast(turned > 0 ? "😈 惡人煽動人心，" + turned + " 位村民黑化了" : "😈 附近沒有可以煽動的村民");
}

export function paintWeather(tx, ty, type) {
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

export function igniteFire(tx, ty, radius) {
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

export function paintMountain(tx, ty) {
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

export function paintRiver(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  const t = state.tiles[ty][tx];
  if (t.type !== TERRAIN.GRASS && t.type !== TERRAIN.SAND) return false;
  t.type = TERRAIN.RIVER;
  t.bridge = false;
  const tree = treeAt(tx, ty);
  if (tree) tree.dead = true;
  return true;
}

export function triggerEarthquake(tx, ty) {
  state.shakeTicks = SHAKE_DURATION;
  const epi = { x: tx, y: ty };
  for (const e of state.entities) {
    if (e.kind === "human" || e.kind === "animal") {
      if (e.isSage || e.isEvil) continue; // leaders are unshaken
      if (dist2(e, epi) <= EARTHQUAKE_RADIUS * EARTHQUAKE_RADIUS) {
        e.panicTicks = PANIC_DURATION;
        const shelter = findNearestShelter(e.x, e.y, 12);
        if (shelter) {
          e.moveTX = shelter.x; e.moveTY = shelter.y;
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

export function triggerLightning(tx, ty) {
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

export function applyGodAction(tx, ty, opts) {
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
  if (tool === "spawn-fish") {
    if (!isOcean(tx, ty)) { if (!silent) toast("魚只能放到海裡"); return; }
    if (state.entities.filter(e => e.kind === "fish").length >= FISH_CAP) { if (!silent) toast("魚群已經足夠"); return; }
    makeFish(tx, ty);
    if (!silent) toast("🐟 一群魚游進了海裡");
    return;
  }
  if (tool === "spawn-whale") {
    if (!isOcean(tx, ty)) { if (!silent) toast("鯨魚只能放到海裡"); return; }
    if (state.entities.filter(e => e.kind === "whale").length >= WHALE_CAP) { if (!silent) toast("鯨魚已經足夠"); return; }
    makeWhale(tx, ty);
    if (!silent) toast("🐋 一頭鯨魚躍入海中");
    return;
  }
  if (tool === "sage") {
    const existing = sageAt(tx, ty);
    if (existing) {
      commandSageTeach(existing, silent);
    } else if (state.entities.filter(e => e.isSage).length >= SAGE_CAP) {
      if (!silent) toast("聖人的數量已經足夠");
    } else if (isLand(state.tiles, tx, ty)) {
      makeSage(tx, ty);
      if (!silent) toast("🧙 一位聖人降臨，人們開始向祂膜拜");
    } else if (!silent) {
      toast("這裡無法施展這項能力");
    }
    return;
  }
  if (tool === "evil") {
    const existing = evilAt(tx, ty);
    if (existing) {
      commandEvilIncite(existing, silent);
    } else if (state.entities.filter(e => e.isEvil).length >= EVIL_CAP) {
      if (!silent) toast("惡人的數量已經足夠");
    } else if (isLand(state.tiles, tx, ty)) {
      makeEvil(tx, ty);
      if (!silent) toast("😈 一位惡人降臨，黑暗開始蔓延");
    } else if (!silent) {
      toast("這裡無法施展這項能力");
    }
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
  } else if (tool === "spawn-beast") {
    if (state.entities.filter(e => e.kind === "animal").length >= ANIMAL_CAP) { if (!silent) toast("動物數量已達上限"); return; }
    const species = choice(BEAST_SPECIES);
    makeAnimal(tx, ty, species);
    if (!silent) toast(species === "dog" ? "🐕 一隻狗跑了過來" : "🦁 一頭猛獸降臨");
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
  }
}
