import {
  TILE, COLS, ROWS, CANVAS_W, CANVAS_H, TERRAIN,
  ADULT_AGE, WEATHER_DURATION, SEASON_GRASS_TINT, SEASON_BLEND_AMOUNT, SHAKE_DURATION,
} from "./constants.js";
import { rand, randRange } from "./rng.js";
import { clamp, adjustColor, blendHex } from "./utils.js";
import { state } from "./state.js";

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");

const TERRAIN_COLOR = {
  [TERRAIN.WATER]: "#0d3a63",
  [TERRAIN.SAND]: "#d8c07a",
  [TERRAIN.GRASS]: "#3f8f4f",
  [TERRAIN.MOUNTAIN]: "#8a8175",
  [TERRAIN.RIVER]: "#2f7fc1",
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
  const grassBase = blendHex(TERRAIN_COLOR[TERRAIN.GRASS], SEASON_GRASS_TINT[state.season], SEASON_BLEND_AMOUNT);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tile = state.tiles[y][x];
      const wx = x * TILE, wy = y * TILE;

      if (tile.type === TERRAIN.WATER) {
        const shimmer = Math.sin(ts * 0.0016 + x * 0.55 + y * 0.4) * 9 + tile.shade * 6;
        ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.WATER], shimmer);
      } else if (tile.type === TERRAIN.RIVER) {
        const shimmer = Math.sin(ts * 0.0022 + x * 0.4 + y * 0.9) * 10 + tile.shade * 6;
        ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.RIVER], shimmer);
      } else if (tile.type === TERRAIN.SAND) {
        ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.SAND], tile.shade * 10);
      } else if (tile.type === TERRAIN.MOUNTAIN) {
        ctx.fillStyle = adjustColor(TERRAIN_COLOR[TERRAIN.MOUNTAIN], tile.shade * 14);
      } else if (tile.farmland) {
        ctx.fillStyle = adjustColor("#8a6a3f", tile.shade * 12);
      } else {
        ctx.fillStyle = adjustColor(grassBase, tile.shade * 12);
      }
      ctx.fillRect(wx, wy, TILE, TILE);

      if (tile.type === TERRAIN.GRASS && !tile.farmland && (x * 3 + y * 7) % 13 === 0) {
        ctx.fillStyle = "rgba(0,0,0,0.07)";
        ctx.fillRect(wx + 3, wy + 3, TILE - 6, TILE - 6);
      }
      if (tile.farmland) {
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 1;
        for (let furrow = 3; furrow < TILE; furrow += 5) {
          ctx.beginPath();
          ctx.moveTo(wx + furrow, wy + 2);
          ctx.lineTo(wx + furrow, wy + TILE - 2);
          ctx.stroke();
        }
        if (tile.cropReady) {
          ctx.fillStyle = "#8fd35c";
          for (let sx = 4; sx < TILE - 2; sx += 5) {
            ctx.beginPath(); ctx.arc(wx + sx, wy + TILE * 0.6, 1.4, 0, 7); ctx.fill();
          }
        }
      }
      if (tile.type === TERRAIN.MOUNTAIN) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(wx + TILE * 0.5, wy + 2);
        ctx.lineTo(wx + TILE * 0.8, wy + TILE * 0.55);
        ctx.lineTo(wx + TILE * 0.2, wy + TILE * 0.55);
        ctx.closePath();
        ctx.fill();
        if (tile.cave) {
          ctx.fillStyle = "#241d17";
          ctx.beginPath();
          ctx.ellipse(wx + TILE / 2, wy + TILE * 0.65, TILE * 0.28, TILE * 0.22, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (tile.type === TERRAIN.RIVER && tile.bridge) {
        ctx.fillStyle = "#8a5a2f";
        ctx.fillRect(wx + 1, wy + 3, TILE - 2, TILE - 6);
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        for (let plank = 3; plank < TILE - 2; plank += 4) {
          ctx.beginPath();
          ctx.moveTo(wx + plank, wy + 3);
          ctx.lineTo(wx + plank, wy + TILE - 3);
          ctx.stroke();
        }
      }

      const fire = state.tileFire[y][x];
      if (fire.active) {
        const flick = Math.sin(ts * 0.02 + x * 1.7 + y * 1.3) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255,${100 + flick * 60},40,${0.28 + flick * 0.2})`;
        ctx.fillRect(wx, wy, TILE, TILE);
        ctx.fillStyle = `rgba(255,${180 + flick * 40},60,0.8)`;
        ctx.beginPath();
        ctx.moveTo(wx + TILE * 0.5, wy + TILE * (0.2 - flick * 0.1));
        ctx.lineTo(wx + TILE * 0.75, wy + TILE * 0.8);
        ctx.lineTo(wx + TILE * 0.25, wy + TILE * 0.8);
        ctx.closePath();
        ctx.fill();
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

function drawAnimalBody(species, px, py) {
  if (species === "chicken") {
    ctx.fillStyle = "#f0e6d2";
    ctx.beginPath(); ctx.ellipse(px, py, 2.8, 2.2, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 2.2, py - 1.6, 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#d94f4f";
    ctx.beginPath(); ctx.arc(px + 2.2, py - 2.8, 0.7, 0, 7); ctx.fill();
    ctx.fillStyle = "#e08a2b";
    ctx.beginPath(); ctx.arc(px + 3.4, py - 1.6, 0.6, 0, 7); ctx.fill();
  } else if (species === "duck") {
    ctx.fillStyle = "#e4e8ea";
    ctx.beginPath(); ctx.ellipse(px, py, 3.1, 2.2, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 2.4, py - 1.7, 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#e08a2b";
    ctx.beginPath(); ctx.ellipse(px + 3.7, py - 1.5, 1.1, 0.6, 0, 0, 7); ctx.fill();
  } else if (species === "pig") {
    ctx.fillStyle = "#e9a8ae";
    ctx.beginPath(); ctx.ellipse(px, py, 3.6, 2.6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 2.8, py - 0.6, 1.6, 0, 7); ctx.fill();
    ctx.fillStyle = "#c97e88";
    ctx.beginPath(); ctx.ellipse(px + 3.6, py - 0.4, 0.8, 0.6, 0, 0, 7); ctx.fill();
  } else if (species === "sheep") {
    ctx.fillStyle = "#efe9dd";
    ctx.beginPath(); ctx.arc(px - 1.4, py - 0.6, 1.8, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 1.2, py - 0.8, 1.9, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py + 1, 2, 0, 7); ctx.fill();
    ctx.fillStyle = "#4a3f38";
    ctx.beginPath(); ctx.arc(px + 3, py - 0.4, 1.1, 0, 7); ctx.fill();
  } else if (species === "lion") {
    ctx.fillStyle = "#a9762f";
    ctx.beginPath(); ctx.arc(px + 2.6, py - 1.2, 3.1, 0, 7); ctx.fill();
    ctx.fillStyle = "#cf9a3f";
    ctx.beginPath(); ctx.ellipse(px, py, 3.8, 2.6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 2.8, py - 1.4, 1.7, 0, 7); ctx.fill();
    ctx.fillStyle = "#5a3e1b";
    ctx.beginPath(); ctx.arc(px + 3.7, py - 1.3, 0.5, 0, 7); ctx.fill();
  } else if (species === "cheetah") {
    ctx.fillStyle = "#e0c07a";
    ctx.beginPath(); ctx.ellipse(px, py, 3.6, 2.1, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 3, py - 1.2, 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#4a3a28";
    for (const [ox, oy] of [[-2, -0.6], [-0.4, 0.6], [1.2, -0.8], [2, 0.6]]) {
      ctx.beginPath(); ctx.arc(px + ox, py + oy, 0.55, 0, 7); ctx.fill();
    }
  } else if (species === "dog") {
    ctx.fillStyle = "#a5714a";
    ctx.beginPath(); ctx.ellipse(px, py, 3, 2.1, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 2.5, py - 1.3, 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#7a4f30";
    ctx.beginPath(); ctx.moveTo(px + 1.8, py - 2.2); ctx.lineTo(px + 1.2, py - 3.6); ctx.lineTo(px + 2.6, py - 2.6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#7a4f30";
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.quadraticCurveTo(px - 4.6, py - 1.8, px - 3.6, py - 3); ctx.stroke();
  } else {
    ctx.fillStyle = "#b98455";
    ctx.beginPath(); ctx.ellipse(px, py, 3.4, 2.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 2.6, py - 1.4, 1.7, 0, 7); ctx.fill();
    ctx.fillStyle = "#8a6339";
    ctx.beginPath(); ctx.arc(px + 3.4, py - 3, 0.8, 0, 7); ctx.fill();
  }
}

function drawEntities() {
  const trees = [], animals = [], humans = [], houses = [], fishes = [], whales = [];
  for (const e of state.entities) {
    if (e.kind === "tree") trees.push(e);
    else if (e.kind === "animal") animals.push(e);
    else if (e.kind === "human") humans.push(e);
    else if (e.kind === "house") houses.push(e);
    else if (e.kind === "fish") fishes.push(e);
    else if (e.kind === "whale") whales.push(e);
  }
  const byY = (a, b) => a.y - b.y;
  trees.sort(byY); animals.sort(byY); humans.sort(byY); houses.sort(byY);

  for (const w of whales) {
    const px = w.x * TILE + TILE / 2, py = w.y * TILE + TILE / 2;
    ctx.fillStyle = "#3d5a72";
    ctx.beginPath(); ctx.ellipse(px, py, 9, 4.2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#2e4658";
    ctx.beginPath();
    ctx.moveTo(px + 2, py - 3.5);
    ctx.lineTo(px + 5, py - 8);
    ctx.lineTo(px + 6, py - 3);
    ctx.closePath();
    ctx.fill();
  }

  for (const f of fishes) {
    const px = f.x * TILE + TILE / 2, py = f.y * TILE + TILE / 2;
    ctx.fillStyle = "#bcd8e6";
    ctx.beginPath(); ctx.ellipse(px, py, 3, 1.4, 0, 0, 7); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px - 3, py);
    ctx.lineTo(px - 5, py - 1.6);
    ctx.lineTo(px - 5, py + 1.6);
    ctx.closePath();
    ctx.fill();
  }

  for (const e of houses) {
    const px = e.x * TILE + TILE / 2, py = e.y * TILE + TILE / 2;
    drawShadow(px, py, 6, 2.2);
    ctx.fillStyle = "#c9a06b";
    ctx.fillRect(px - 5, py - 1, 10, 6);
    ctx.fillStyle = "#6b5a4a";
    ctx.fillRect(px + 2.6, py - 11, 2.4, 4.5);
    ctx.fillStyle = "#8a4b3a";
    ctx.beginPath();
    ctx.moveTo(px - 6.5, py - 1);
    ctx.lineTo(px, py - 8);
    ctx.lineTo(px + 6.5, py - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5a3722";
    ctx.fillRect(px - 1.5, py + 1, 3, 4);
  }

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
    drawAnimalBody(a.species, px, py);
  }

  for (const h of humans) {
    const px = h.x * TILE + TILE / 2, py = h.y * TILE + TILE / 2;
    const isAdult = h.age >= ADULT_AGE;
    const r = h.isSage ? 4.4 : (isAdult ? 3.6 : 2.4);
    const color = h.isSage ? "#ffd35c" : (h.gender === "m" ? "#4fb0ff" : "#ff7fc0");
    if (h.isSage) {
      const glowR = 8 + Math.sin(performance.now() * 0.003) * 1.5;
      const glow = ctx.createRadialGradient(px, py, 1, px, py, glowR);
      glow.addColorStop(0, "rgba(255,220,120,0.55)");
      glow.addColorStop(1, "rgba(255,220,120,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(px, py, glowR, 0, 7); ctx.fill();
    }
    drawShadow(px, py, r * 1.1, r * 0.45);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(px, py + r * 0.3, r * 0.85, r, 0, 0, 7); ctx.fill();
    ctx.fillStyle = adjustColor(color, 35);
    ctx.beginPath(); ctx.arc(px, py - r * 0.65, r * 0.62, 0, 7); ctx.fill();
    if (h.state === "seekFood") {
      ctx.strokeStyle = "#ffcf6b";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, r + 3, 0, 7); ctx.stroke();
    } else if (h.state === "panic") {
      ctx.strokeStyle = "#ff5a5a";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(px, py, r + 3, 0, 7); ctx.stroke();
    }
  }
}

function drawEffects() {
  for (const ef of state.effects) {
    const px = ef.x * TILE + TILE / 2, py = ef.y * TILE + TILE / 2;
    const t = ef.life / ef.maxLife;
    if (ef.type === "lightning") {
      ctx.strokeStyle = `rgba(230,220,255,${t})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let cx = px, cy = 0;
      ctx.moveTo(cx, cy);
      while (cy < py) {
        cx += randRange(-6, 6);
        cy += randRange(10, 18);
        ctx.lineTo(cx, Math.min(cy, py));
      }
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${t * 0.6})`;
      ctx.beginPath(); ctx.arc(px, py, 6 * t + 2, 0, 7); ctx.fill();
    } else if (ef.type === "skeleton") {
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("💀", px, py - (1 - t) * 10);
      ctx.globalAlpha = 1;
    } else if (ef.type === "scorch") {
      ctx.fillStyle = `rgba(40,30,20,${t * 0.6})`;
      ctx.beginPath(); ctx.arc(px, py, 5 * (1 - t) + 2, 0, 7); ctx.fill();
    } else if (ef.type === "spout") {
      const rise = (1 - t) * 12;
      ctx.strokeStyle = `rgba(220,240,255,${t * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py - 4);
      ctx.lineTo(px, py - 4 - rise);
      ctx.stroke();
      ctx.fillStyle = `rgba(220,240,255,${t * 0.6})`;
      ctx.beginPath(); ctx.arc(px - 3, py - 4 - rise, 1.6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 3, py - 4 - rise, 1.6, 0, 7); ctx.fill();
    } else if (ef.type === "smoke") {
      const age = 1 - t;
      const rise = age * 14;
      const drift = Math.sin(age * 6 + ef.x * 3) * 2.5;
      const r = 1.3 + age * 2.6;
      ctx.fillStyle = `rgba(210,210,215,${t * 0.5})`;
      ctx.beginPath(); ctx.arc(px + drift, py - rise, r, 0, 7); ctx.fill();
    }
  }
}

export function render(ts) {
  ctx.save();
  if (state.shakeTicks > 0) {
    const mag = (state.shakeTicks / SHAKE_DURATION) * 4;
    ctx.translate(randRange(-mag, mag), randRange(-mag, mag));
    state.shakeTicks--;
  }

  ctx.clearRect(-8, -8, CANVAS_W + 16, CANVAS_H + 16);
  drawWorld(ts);
  drawEntities();
  drawEffects();
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
  ctx.restore();
}

export { canvas };
