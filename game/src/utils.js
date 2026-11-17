// utils.js — small math and seeded-random helpers shared by every system.
// Written for Solmar Bay: Street Heat (make.fun gta6-01), V2 visual overhaul.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rand(rng, a, b) {
  return a + rng() * (b - a);
}

export function randInt(rng, a, b) {
  return Math.floor(rand(rng, a, b + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Clamp to 0..1 — handy for animation weights and audio gains.
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Frame-rate independent exponential damping: damp(current, target, rate, dt).
// Used for the chase camera and for smoothing walk-cycle weights.
export function damp(current, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

// Smoothstep easing for pulsing UI and beacon rings.
export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// Deterministic 2D hash in [0, 1) for a world position — stable per (x, z)
// without consuming the shared rng, so prop placement never shifts the
// seeded sequence other systems depend on.
export function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Interpolate two 0xRRGGBB colours, returns a 0xRRGGBB number. Used to give
// each car and building a slightly different paint shade from one palette.
export function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// Shortest-arc angle interpolation (radians).
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Circle (x, z, r) pushed out of an axis-aligned box collider.
export function pushOutOfBox(x, z, r, box) {
  // A malformed box must never poison a position with NaN.
  if (!Number.isFinite(box.x0) || !Number.isFinite(box.z0) || !Number.isFinite(box.x1) || !Number.isFinite(box.z1)) return null;
  const cx = clamp(x, box.x0, box.x1);
  const cz = clamp(z, box.z0, box.z1);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    return { x: x + dx * push, z: z + dz * push, nx: dx / d, nz: dz / d };
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const pl = x - box.x0;
  const pr = box.x1 - x;
  const pt = z - box.z0;
  const pb = box.z1 - z;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) return { x: box.x0 - r, z, nx: -1, nz: 0 };
  if (m === pr) return { x: box.x1 + r, z, nx: 1, nz: 0 };
  if (m === pt) return { x, z: box.z0 - r, nx: 0, nz: -1 };
  return { x, z: box.z1 + r, nx: 0, nz: 1 };
}
