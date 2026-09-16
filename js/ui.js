import { TILE, CANVAS_W, CANVAS_H, TICK_MS, REPEAT_MS, ADULT_AGE, SEASON_LABEL, TECH_LABEL } from "./constants.js";
import { state } from "./state.js";
import { toast } from "./toast.js";
import { applyGodAction, setSpeed, isWeatherLocked } from "./abilities.js";
import { simulateDay, moveEntitiesStep, updateEffects } from "./simulation.js";
import { render, canvas } from "./render.js";

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
  document.getElementById("stat-fish").textContent = state.entities.filter(e => e.kind === "fish").length;
  document.getElementById("stat-whales").textContent = state.entities.filter(e => e.kind === "whale").length;

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
const LIFE_TOOLS = ["plant-seed", "spawn-animal", "spawn-beast", "spawn-man", "spawn-woman", "spawn-fish", "spawn-whale"];
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
