// ----- Generic math / color helpers ------------------------------------------
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function tileIndex(v, max) { return clamp(Math.round(v), 0, max - 1); }

export function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

export function adjustColor(hex, amt) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + amt, g = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
  r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
  return `rgb(${r},${g},${b})`;
}

export function hexOf(r, g, b) {
  return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

export function blendHex(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return hexOf(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
