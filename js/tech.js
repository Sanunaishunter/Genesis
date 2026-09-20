import { POP_CAP, MATE_COOLDOWN, TECH_ORDER, LOOT_PER_EVIL_TIER } from "./constants.js";
import { state } from "./state.js";

export function popCap() { return POP_CAP + (state.tech.tribe ? 40 : 0); }
export function mateCooldown() { return state.tech.tribe ? Math.round(MATE_COOLDOWN * 0.6) : MATE_COOLDOWN; }
export function fruitNeedTicks() { return state.tech.farming ? 5 : 8; }

// Index of the highest tech tier the (good) tribes have unlocked, -1 if none.
export function techTier() {
  let tier = -1;
  TECH_ORDER.forEach((key, i) => { if (state.tech[key]) tier = i; });
  return tier;
}

// Evil tribes evolve through looted resources rather than wisdom.
export function evilTier() {
  return Math.min(TECH_ORDER.length - 1, Math.floor(state.evilLoot / LOOT_PER_EVIL_TIER));
}
