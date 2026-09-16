import { POP_CAP, MATE_COOLDOWN } from "./constants.js";
import { state } from "./state.js";

export function popCap() { return POP_CAP + (state.tech.tribe ? 40 : 0); }
export function mateCooldown() { return state.tech.tribe ? Math.round(MATE_COOLDOWN * 0.6) : MATE_COOLDOWN; }
export function fruitNeedTicks() { return state.tech.farming ? 5 : 8; }
