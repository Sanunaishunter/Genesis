import { ADULT_AGE, ANIMAL_SPECIES } from "./constants.js";
import { choice, randInt, randRange } from "./rng.js";
import { state, addEntity } from "./state.js";

// ----- Entity factories -----------------------------------------------------
export function makeTree(x, y) {
  return addEntity({
    kind: "tree", x, y, stage: 0, growTimer: 0,
    hasFruit: false, fruitTimer: 0, bigTimer: 0, lightningHits: 0,
  });
}

export function makeAnimal(x, y, species) {
  return addEntity({
    kind: "animal", species: species || choice(ANIMAL_SPECIES), x, y,
    moveTX: x, moveTY: y, wanderCd: 0,
    breedCd: randInt(10, 30), panicTicks: 0,
  });
}

export function makeHuman(x, y, gender, age) {
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
    isEvil: false,
    corrupted: false,
    role: "villager",
    tribeId: null,
  });
}

export function makeSage(x, y) {
  return addEntity({
    kind: "human", x, y, gender: choice(["m", "f"]),
    age: ADULT_AGE, hunger: 0, state: "sage",
    moveTX: x, moveTY: y, wanderCd: randInt(30, 60),
    starveTicks: 0, mateCd: 999999, panicTicks: 0, isSage: true,
    isEvil: false, corrupted: false, role: "sage", tribeId: null,
    teachCooldown: 0, hadMembers: false, zeroPopTick: null,
  });
}

export function makeEvil(x, y) {
  return addEntity({
    kind: "human", x, y, gender: choice(["m", "f"]),
    age: ADULT_AGE, hunger: 0, state: "evil",
    moveTX: x, moveTY: y, wanderCd: randInt(20, 40),
    starveTicks: 0, mateCd: 999999, panicTicks: 0, isSage: false,
    isEvil: true, corrupted: true, role: "evil", tribeId: null,
    inciteCooldown: 0, hadMembers: false, zeroPopTick: null,
  });
}

export function makeTrex(x, y, huntCategory, cullFloor) {
  return addEntity({
    kind: "animal", species: "trex", x, y,
    moveTX: x, moveTY: y, wanderCd: 0,
    breedCd: Infinity, panicTicks: 0,
    huntCategory, cullFloor,
  });
}

export function makeFish(x, y) {
  return addEntity({ kind: "fish", x, y, moveTX: x, moveTY: y, wanderCd: 0 });
}

export function makeWhale(x, y) {
  return addEntity({ kind: "whale", x, y, moveTX: x, moveTY: y, wanderCd: 0, spoutCd: randInt(20, 50) });
}

export function treeAt(tx, ty) {
  return state.entities.find(e => e.kind === "tree" && Math.round(e.x) === tx && Math.round(e.y) === ty);
}

export function sageAt(tx, ty) {
  return state.entities.find(e => e.isSage && Math.round(e.x) === tx && Math.round(e.y) === ty);
}

export function evilAt(tx, ty) {
  return state.entities.find(e => e.isEvil && Math.round(e.x) === tx && Math.round(e.y) === ty);
}
