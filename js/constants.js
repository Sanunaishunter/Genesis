// ----- Config -----------------------------------------------------------
export const TILE = 18;
export const COLS = 48;
export const ROWS = 32;
export const CANVAS_W = COLS * TILE;
export const CANVAS_H = ROWS * TILE;

export const TERRAIN = { WATER: 0, SAND: 1, GRASS: 2, MOUNTAIN: 3, RIVER: 4 };

export const ADULT_AGE = 16;
export const MAX_AGE = 90;
export const POP_CAP = Infinity;
export const ANIMAL_CAP = Infinity;
export const SAGE_CAP = Infinity;
export const HUNGER_MAX = 100;
export const STARVE_TICKS_TO_DIE = 45;
export const SEEK_FOOD_THRESHOLD = 55;
export const MATE_HUNGER_MAX = 40;
export const MATE_COOLDOWN = 55;
export const SENSE_RADIUS = 9;
export const HUMAN_SPEED = 0.045 / 6;
export const ANIMAL_SPEED = 0.032 / 6;
export const PANIC_SPEED_MUL = 1.9;

export const TICK_MS = { pause: 0, normal: 260, fast: 70 };

export const WEATHER_BRUSH_RADIUS = 3;
export const WEATHER_DURATION = { rain: 150, storm: 55, drought: 170 };
export const REPEAT_MS = 150; // holding the pointer re-triggers the ability at this interval

export const WEATHER_PAINT_LABEL = {
  sunny: "☀️ 撥雲見日，恢復晴朗",
  rain: "🌧️ 降下甘霖",
  storm: "⛈️ 召喚風暴",
  drought: "🏜️ 烈日炙烤大地",
};

export const SEASON_LIST = ["spring", "summer", "autumn", "winter"];
export const SEASON_LENGTH = 130; // ticks per season
export const SEASON_LABEL = { spring: "🌸 春", summer: "☀️ 夏", autumn: "🍂 秋", winter: "❄️ 冬" };
export const SEASON_GRASS_TINT = { spring: "#57c26a", summer: "#3f8f4f", autumn: "#a67a3d", winter: "#dbe6e6" };
export const SEASON_BLEND_AMOUNT = 0.5;

export const EARTHQUAKE_RADIUS = 9;
export const PANIC_DURATION = 40;
export const SHAKE_DURATION = 22;

export const LIGHTNING_HITS_TO_IGNITE = 3;
export const FIRE_DURATION = 230; // ~60s of real time at normal speed
export const FIRE_BRUSH_RADIUS = 2;
export const FIRE_DAMAGE_CHANCE = { tree: 0.1, creature: 0.05 };

export const MOUNTAIN_BRUSH_RADIUS = 2;

export const SAGE_WORSHIP_RADIUS = 10;
export const WISDOM_PER_WORSHIPPER = 0.015;

export const TECH_ORDER = [
  "fire", "farming", "tribe",
  "bronze", "copper", "iron", "swords",
  "rifles", "autorifles", "missiles", "nuclear",
];
export const TECH_THRESHOLD = {
  fire: 40, farming: 120, tribe: 300,
  bronze: 500, copper: 700, iron: 950, swords: 1250,
  rifles: 1650, autorifles: 2150, missiles: 2750, nuclear: 3500,
};
export const TECH_LABEL = {
  fire: "🔥用火", farming: "🌾農耕", tribe: "🏘️部落",
  bronze: "🟫青銅器", copper: "🟠銅器", iron: "⚙️鐵器", swords: "⚔️刀劍",
  rifles: "🔫步槍", autorifles: "💥全自動步槍", missiles: "🚀飛彈", nuclear: "☢️核子武器",
};

// ----- Evil deity / corruption / tribes ---------------------------------
export const EVIL_CAP = Infinity;
export const EVIL_CORRUPT_RADIUS = 10;
export const CORRUPTION_CHANCE_PER_TICK = 0.006;
export const INCITE_COOLDOWN = 15;
export const INCITE_CORRUPT_COUNT = 3;

export const RAID_KILL_CHANCE = 0.05;
export const HUNTER_KILL_CHANCE = 0.09;
export const PREDATOR_HUMAN_KILL_CHANCE = 0.12;
export const HUNTER_BEAST_KILL_CHANCE = 0.14;
export const SHAMAN_HEAL_AMOUNT = 30;
export const SHAMAN_CURE_CHANCE = 0.01;
export const COMBAT_TIER_BONUS = 0.1; // extra multiplier per unlocked tech tier

export const HUNTER_RATIO = 0.15;
export const SHAMAN_RATIO = 0.1;
export const PROFESSION_PROMOTE_CHANCE = 0.02;

export const WALL_COST = 15;
export const WALL_RING_COUNT = 10;
export const WALL_RADIUS = 6;
export const WALL_PROTECT_MUL = 0.4; // raid kill chance multiplier for walled + protected targets

export const TRIBE_GRACE_TICKS = 60;
export const LOOT_PER_EVIL_TIER = 5;

// ----- Apex predator (population control valve) -------------------------
export const POP_EXPLOSION_THRESHOLD = { predator: 30, companion: 30, prey: 120, human: 250 };
export const POP_EXPLOSION_CULL_FRACTION = 0.1;
export const POP_CATEGORY_LABEL = { predator: "猛獸", companion: "狗群", prey: "家禽家畜", human: "人口" };

export const BIG_TREE_GROW_TICKS = 260;
export const BIG_TREE_WOOD_BONUS = 10;

export const MIN_TREES_TO_KEEP = 4;
export const CHOP_CHANCE_PER_TICK = 0.02;
export const WOOD_PER_CHOP = 6;
export const WOOD_PER_FARM_CLEAR = 3;
export const HOUSE_COST = 30;
export const HOUSE_CAP = Infinity;
export const BRIDGE_COST = 20;
export const DROWN_CHANCE = 0.08; // per tick spent in a river tile with no bridge

export const CROP_GROW_TICKS = 12;

export const TEACH_WISDOM_BOOST = 40;
export const TEACH_COOLDOWN = 15; // ticks before a commanded sage can teach again

export const FISH_CAP = Infinity;
export const WHALE_CAP = Infinity;
export const FISH_SPEED = 0.05;
export const WHALE_SPEED = 0.02;

export const ANIMAL_SPECIES = ["chicken", "duck", "pig", "sheep"];
export const PREDATOR_SPECIES = ["lion", "cheetah"];
export const COMPANION_SPECIES = ["dog"];
export const BEAST_SPECIES = PREDATOR_SPECIES.concat(COMPANION_SPECIES);
export const ANIMAL_ROLE = {};
for (const s of ANIMAL_SPECIES) ANIMAL_ROLE[s] = "prey";
for (const s of PREDATOR_SPECIES) ANIMAL_ROLE[s] = "predator";
for (const s of COMPANION_SPECIES) ANIMAL_ROLE[s] = "companion";
ANIMAL_ROLE.trex = "apex";

export function animalSpeedFor(species) {
  if (species === "trex") return ANIMAL_SPEED * 1.15;
  if (species === "cheetah") return ANIMAL_SPEED * 2.2;
  if (species === "lion") return ANIMAL_SPEED * 1.4;
  if (species === "dog") return ANIMAL_SPEED * 1.3;
  return ANIMAL_SPEED;
}

export const MOVE_SPEED = { human: HUMAN_SPEED, fish: FISH_SPEED, whale: WHALE_SPEED };
