import type { StructureBuilder } from "./builder";
import { variation } from "./rng";
import { PHASE, PODIUM } from "./tower";

/** Reflecting pool, laid out in front of the entrance, in world units. */
export const POOL = { hx: 14, z0: 18, z1: 26 };

const GROUND = { half: 50 };
const PLAZA = { half: 24, tile: 4, spacing: 4 };

/**
 * Tree positions, in the two boulevard rows and the back edge. Kept here so the
 * landscape module plants where the paving actually has a lawn strip, rather
 * than guessing coordinates of its own.
 */
export const TREE_SPOTS: [number, number, number][] = (() => {
  const spots: [number, number, number][] = [];
  for (let i = 0; i < 11; i++) {
    const z = -24 + i * 5.0;
    spots.push([-29.4 - variation(i * 3 + 1) * 2.4, 0.32, z]);
    spots.push([29.4 + variation(i * 3 + 2) * 2.4, 0.32, z + 2.4]);
  }
  for (let i = 0; i < 9; i++) spots.push([-26 + i * 6.5 + variation(i + 40) * 3, 0.32, -32 - variation(i + 70) * 3]);
  return spots;
})();

const at = (span: [number, number], u: number) => span[0] + (span[1] - span[0]) * u;

export function buildSite(b: StructureBuilder) {
  const site = PHASE.site;
  const plinthX = PODIUM.hx + 1.3;
  const plinthZ = PODIUM.hz + 1.3;

  // Ground plate. One large slab; the plaza carpet is laid on top of it so the
  // miniature has a definite edge instead of fading into nothing.
  b.box([GROUND.half * 2, 1.2, GROUND.half * 2], [0, -0.6, 0], "paving", at(site, 0.0), {
    duration: 0.05, lift: 1.0, shade: 0.86,
  });

  // Lawn strips. Placed before the paving so their edges are covered by tiles.
  for (const sx of [-1, 1]) {
    b.box([5.5, 0.34, 46], [sx * 29.4, 0.17, -4], "lawn", at(site, 0.3 + (sx + 1) * 0.06), {
      duration: 0.03, lift: 0.5,
    });
  }
  b.box([56, 0.34, 6], [0, 0.17, -32.6], "lawn", at(site, 0.42), { duration: 0.03, lift: 0.5 });

  // Plaza carpet. One granite, two tones: a full-light / full-dark checker at
  // this tile size reads as a chessboard and destroys the miniature, so the
  // paving pattern comes from a 10 % tonal shift instead of two materials.
  const count = Math.floor((PLAZA.half * 2) / PLAZA.spacing);
  for (let i = 0; i <= count; i++) {
    for (let j = 0; j <= count; j++) {
      const cx = -PLAZA.half + i * PLAZA.spacing;
      const cz = -PLAZA.half + j * PLAZA.spacing;
      const underPlinth = Math.abs(cx) <= plinthX && Math.abs(cz) <= plinthZ;
      // The pool is sized to the paving grid (tile centres are 4 units apart),
      // so the skipped tiles form a clean rectangle exactly the size of the
      // basin rather than a ragged hole.
      const underPool = Math.abs(cx) <= POOL.hx && cz >= POOL.z0 && cz <= POOL.z1;
      if (underPlinth || underPool) continue;
      const distance = Math.hypot(cx, cz) / (PLAZA.half * 1.5);
      b.box([PLAZA.tile, 0.28, PLAZA.tile], [cx, 0.14, cz], "stone", at(site, 0.18 + distance * 0.5), {
        duration: 0.028, lift: 0.6, shade: (i + j) % 2 === 0 ? 1 : 0.9,
      });
    }
  }

  // Pool basin and coping are cast with the plaza; the WATER only arrives with
  // the landscaping. Building the basin late would leave a bare rectangular
  // hole punched in the plaza for the whole construction sequence.
  const poolZ = (POOL.z0 + POOL.z1) / 2;
  const poolD = POOL.z1 - POOL.z0;
  b.box([POOL.hx * 2, 0.3, poolD], [0, 0.15, poolZ], "stone", at(site, 0.72), {
    duration: 0.03, lift: 0.6, shade: 0.76,
  });
  for (const sz of [-1, 1]) {
    b.box([POOL.hx * 2 + 1.2, 0.5, 0.6], [0, 0.25, poolZ + sz * (poolD / 2 + 0.3)], "white", at(site, 0.80), {
      duration: 0.03, lift: 0.7,
    });
  }
  for (const sx of [-1, 1]) {
    b.box([0.6, 0.5, poolD + 1.2], [sx * (POOL.hx + 0.3), 0.25, poolZ], "white", at(site, 0.80), {
      duration: 0.03, lift: 0.7,
    });
  }
  // Water surface sits just below the coping, so the pool reads as full.
  b.box([POOL.hx * 2 - 0.1, 0.22, poolD - 0.1], [0, 0.33, poolZ], "water", at(PHASE.landscape, 0.30), {
    duration: 0.06, lift: 0.18,
  });

  // Three steps up to the podium plinth.
  for (let i = 0; i < 3; i++) {
    b.box([13, 0.2, 0.95], [0, 0.1 + i * 0.2, plinthZ + 0.5 + i * 0.95], "stone", at(site, 0.5 + i * 0.08), {
      duration: 0.025, lift: 0.4,
    });
  }

  // Bollard lights. Steel post + emissive lens; the lens shares the same
  // material as the lobby, so the whole scene lights up from one uniform.
  const lamps: [number, number][] = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) lamps.push([sx * 22, -18 + k * 6]);
  for (let k = 0; k < 5; k++) lamps.push([-12 + k * 6, 28]);
  lamps.forEach(([x, z], index) => {
    const start = at(PHASE.landscape, 0.42 + (index / lamps.length) * 0.5);
    b.box([0.24, 1.1, 0.24], [x, 0.55, z], "steel", start, { duration: 0.02, lift: 1.2 });
    // The lens shares the same emissive surface as the lobby and the tower
    // slots, so the whole site comes alight from one schedule.
    b.box([0.17, 0.3, 0.17], [x, 1.22, z], "glow", at(PHASE.lighting, 0.12 + index / lamps.length * 0.55), {
      duration: 0.016, lift: 0.05,
    });
  });
}
