/** Deterministic helpers. Every "random" value in this project is a pure
 * function of an index, so seeking the timeline back and forth reproduces the
 * exact same building. Never call Math.random() in geometry code.
 */

export const TAU = Math.PI * 2;

/** Hash-ish value in [-1, 1) for an integer or float key. */
export function variation(n: number) {
  return ((Math.sin(n * 127.1 + 31.7) * 43758.5453) % 1 + 1) % 1;
}

/** Small linear congruential generator for texture painting. */
export function makeRandom(seed = 1) {
  let s = (Math.floor(seed) >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
}
