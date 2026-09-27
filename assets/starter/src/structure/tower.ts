import type { Point, StructureBuilder } from "./builder";

/**
 * Every phase is an interval in the single 0..1 construction progress. Phases
 * overlap on purpose: real sites pour the core while finishing the podium, and
 * overlapping reads as a place that is being built rather than a slideshow.
 * `tower` is subdivided again per storey below.
 */
export const PHASE = {
  site: [0.000, 0.080] as [number, number],
  podium: [0.050, 0.180] as [number, number],
  podiumGlazing: [0.150, 0.260] as [number, number],
  /** The core is on a jump-form rig: it must lead the floors it serves, but only
   *  by a couple of storeys. Running it to the full height early leaves a bare
   *  concrete spike sticking eight floors out of a four-storey building. */
  core: [0.220, 0.720] as [number, number],
  tower: [0.270, 0.760] as [number, number],
  roof: [0.735, 0.845] as [number, number],
  crown: [0.820, 0.910] as [number, number],
  landscape: [0.855, 0.945] as [number, number],
  /** Every emissive piece is scheduled here, so the finale is a lighting event
   *  rather than another pile of geometry. */
  lighting: [0.920, 0.998] as [number, number],
};

/** Design constants. Change one and the storey loop, glazing, and crown follow. */
export const PODIUM = { hx: 15, hz: 11, h: 8.0, plinth: 0.6 };
export const TOWER = { hx: 9, hz: 7.5 };
export const FLOOR_H = 3.6;
export const FLOORS = 12;
/** Tower first floor level = top of the podium roof slab. */
export const BASE_Y = PODIUM.plinth + PODIUM.h + 0.8;
export const ROOF_Y = BASE_Y + FLOORS * FLOOR_H;
export const TOP_Y = ROOF_Y + 10.0;

const SLAB_OVER = 0.42;  // white slab edge projects past the glass plane
const GLASS_IN = 0.30;   // glazing plane sits this far inside the structural face
const SLAB_H = 0.34;
const BAY = 1.8;

const at = (span: [number, number], u: number) => span[0] + (span[1] - span[0]) * u;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Radial fraction of a point around the tower axis, used to stagger glazing so
 *  the curtain wall sweeps around the building instead of closing in one gulp. */
function sweep(x: number, z: number) {
  const angle = Math.atan2(z / TOWER.hz, x / TOWER.hx);
  return (angle + Math.PI) / (Math.PI * 2);
}

function mullionRange(half: number) {
  const raw = Math.max(3, Math.round((half * 2) / BAY));
  // Force an odd bay count so every facade has one pane centred on its own axis.
  // That centre pane is glazed transparent and gets a light panel behind it.
  const bays = raw % 2 === 0 ? raw + 1 : raw;
  const width = (half * 2) / bays;
  const positions: number[] = [];
  for (let k = 0; k <= bays; k++) positions.push(-half + k * width);
  return { positions, bays, width };
}

/** One storey of the tower: slab band, concrete fins, mullions, glazing, piers. */
function storey(b: StructureBuilder, index: number, glazed: boolean) {
  const y0 = BASE_Y + index * FLOOR_H;
  const u = (index + 1) / FLOORS;
  const span = PHASE.tower;
  const slabStart = lerp(span[0], span[1], u * 0.84);
  const frameStart = slabStart + 0.011;
  const glassStart = slabStart + 0.020;

  // Slab plate. Doubles as the ceiling of the storey below, so an unfinished
  // floor always has a floor and a soffit — never a floating platform.
  const bx = b.box.bind(b);
  bx([TOWER.hx * 2 + SLAB_OVER * 2, SLAB_H, TOWER.hz * 2 + SLAB_OVER * 2], [0, y0 + SLAB_H / 2, 0], "white", slabStart, {
    duration: 0.022, lift: 1.4,
  });

  const gx = TOWER.hx - GLASS_IN;
  const gz = TOWER.hz - GLASS_IN;

  // Concrete piers at the four corners, cast one storey at a time.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bx([1.3, FLOOR_H, 1.3], [sx * (TOWER.hx - 0.9), y0 + FLOOR_H / 2, sz * (TOWER.hz - 0.85)], "concrete", frameStart, {
        duration: 0.020, lift: 1.6,
      });
    }
  }

  // Vertical concrete fins are placed inside the per-facade loop below, snapped
  // to that facade's bay grid.

  const glassTop = y0 + SLAB_H;
  const paneH = FLOOR_H - SLAB_H - 0.16;
  const paneY = glassTop + 0.08 + paneH / 2;
  // One mechanical floor breaks the twelve-storey repetition with a dark louver
  // band. Cheapest possible variation: swap the pane material and drop the
  // interior light. Without it a uniform tower reads as a car park.
  const mechanical = index === 6;
  const paneMaterial = mechanical ? "glassDeep" : "glass";

  // Four facades. `-1 | 1` walks the two opposite walls of an axis.
  const faces: { axis: "x" | "z"; sign: number }[] = [
    { axis: "z", sign: 1 }, { axis: "z", sign: -1 },
    { axis: "x", sign: 1 }, { axis: "x", sign: -1 },
  ];

  for (const face of faces) {
    const half = face.axis === "z" ? gx : gz;
    const { positions, width } = mullionRange(half);
    const plane = (face.axis === "z" ? gz : gx) * face.sign;
    // `t` runs along the face: x for the ±Z walls, z for the ±X walls.
    // `depth` is an offset along the face normal, already sign-corrected.
    const toPoint = (t: number, y: number, depth: number): Point =>
      face.axis === "z" ? [t, y, plane + depth * face.sign] : [plane + depth * face.sign, y, t];

    // Aluminium mullions on every bay line.
    for (const t of positions) {
      bx(face.axis === "z" ? [0.14, paneH + 0.2, 0.24] : [0.24, paneH + 0.2, 0.14],
        toPoint(t, paneY, 0), "mullion", frameStart, { duration: 0.017, lift: 1.8 });
    }
    // One transom per facade ties the mullions together at mid-storey.
    const transomLength = half * 2;
    bx(face.axis === "z" ? [transomLength, 0.12, 0.18] : [0.18, 0.12, transomLength],
      toPoint(0, glassTop + paneH / 2, 0.02), "mullion", frameStart, { duration: 0.017, lift: 1.8 });

    // Concrete fins. The grey rhythm that keeps the tower from reading as one
    // continuous mirror. Snapped to bay lines (2.5 and 4.5 bays out from the
    // centre) so a fin always lands on a mullion, and **skipping the centre
    // line** so it never covers the light slot. Placed inside the slab overhang
    // so they never poke past the white band.
    for (const bayOffset of [2.5, 4.5]) {
      for (const sign of [-1, 1]) {
        const t = sign * bayOffset * width;
        if (Math.abs(t) > half - 0.7) continue;
        bx(face.axis === "z" ? [0.8, FLOOR_H, 0.5] : [0.5, FLOOR_H, 0.8],
          toPoint(t, y0 + FLOOR_H / 2, 0.25), "concrete", frameStart + Math.abs(bayOffset) * 0.0006, {
            duration: 0.019, lift: 1.7,
          });
      }
    }

    if (!glazed) continue;

    // Which bay sits on the facade's own centre line. That one is glazed
    // transparent, with the lit panel behind it, so the tower carries a vertical
    // light slot up each face — the only place interior light can escape a
    // mirror-glass curtain wall.
    const centreBay = Math.floor((positions.length - 1) / 2);

    // Glazing pans. Each pane is its own piece so the sweep reads pane by pane.
    for (let k = 0; k < positions.length - 1; k++) {
      const t = (positions[k] + positions[k + 1]) / 2;
      const start = glassStart + sweep(
        face.axis === "z" ? t : plane, face.axis === "z" ? plane : t,
      ) * 0.005;
      const slot = !mechanical && k === centreBay;
      bx(face.axis === "z" ? [width - 0.16, paneH, 0.07] : [0.07, paneH, width - 0.16],
        toPoint(t, paneY, 0), slot ? "glassClear" : paneMaterial, start, {
          duration: 0.026, lift: 2.2,
          // Panes rise and lean in from outside — they come to the building
          // rather than out of the ground.
          drift: face.axis === "z" ? [0.25, 1, 0.75 * face.sign] : [0.75 * face.sign, 1, 0.25],
        });
      if (!slot) continue;
      // Light panel behind the slot, deliberately narrower than the pane so you
      // read a lit room through a window rather than a glowing stripe. Scheduled
      // inside the lighting window and staggered by storey, so the light climbs
      // the tower from the podium to the crown instead of switching on at once.
      const lit = PHASE.lighting;
      bx(face.axis === "z" ? [width * 0.56, paneH - 0.45, 0.18] : [0.18, paneH - 0.45, width * 0.56],
        toPoint(t, paneY, -0.7), "glow", lerp(lit[0], lit[1], 0.05 + (index / FLOORS) * 0.72), {
          duration: 0.02, lift: 0.05,
        });
    }
  }

  // Interior soffit. Seen through an unfinished storey it gives the raw frame
  // some depth; once the glass closes it just darkens the reveals.
  bx([TOWER.hx * 2 - 2.4, 0.25, TOWER.hz * 2 - 2.4], [0, glassTop + 0.9, 0], "concreteDeep", frameStart, {
    duration: 0.018, lift: 1.2, shade: 0.72,
  });
}

function buildTowerBody(b: StructureBuilder) {
  // Climbing core. Segments start ahead of the floors they serve, exactly like
  // a jump-form rig, and it is the only thing you see sticking out of the roof
  // while the top floors are still going up.
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    const u = i / (segments - 1);
    const y = BASE_Y + u * (ROOF_Y + 4.4 - BASE_Y);
    const height = (ROOF_Y + 4.4 - BASE_Y) / segments + 0.4;
    b.box([5.4, height, 6.0], [0, y, -2.0], "concrete", at(PHASE.core, u * 0.95), {
      duration: 0.030, lift: 2.6,
    });
  }

  for (let i = 0; i < FLOORS; i++) storey(b, i, true);

  // --- roof ---------------------------------------------------------------
  const rs = PHASE.roof;
  b.box([TOWER.hx * 2 + SLAB_OVER * 2, 0.46, TOWER.hz * 2 + SLAB_OVER * 2], [0, ROOF_Y + 0.23, 0], "white", at(rs, 0.1), {
    duration: 0.024, lift: 1.5,
  });
  b.box([TOWER.hx * 2 - 0.8, 0.24, TOWER.hz * 2 - 0.8], [0, ROOF_Y + 0.56, 0], "roof", at(rs, 0.42), {
    duration: 0.02, lift: 0.7,
  });
  const parapetY = ROOF_Y + 0.46 + 0.62;
  for (const sz of [-1, 1]) {
    b.box([TOWER.hx * 2 + 1.0, 1.24, 0.34], [0, parapetY, sz * (TOWER.hz + 0.33)], "white", at(rs, 0.66), {
      duration: 0.022, lift: 1.1,
    });
  }
  for (const sx of [-1, 1]) {
    b.box([0.34, 1.24, TOWER.hz * 2], [sx * (TOWER.hx + 0.33), parapetY, 0], "white", at(rs, 0.8), {
      duration: 0.022, lift: 1.1,
    });
  }

  // --- crown --------------------------------------------------------------
  const cs = PHASE.crown;
  b.box([5.2, 4.2, 5.0], [0, ROOF_Y + 0.46 + 2.1, -2.2], "concrete", at(cs, 0.08), {
    duration: 0.028, lift: 2.4,
  });
  for (const sz of [-1, 1]) {
    for (const x of [-1.4, 1.4]) {
      b.box([0.9, 2.6, 0.22], [x, ROOF_Y + 2.6, sz === 1 ? 0.36 : -4.76], "glassDeep", at(cs, 0.4), {
        duration: 0.02, lift: 1.4,
      });
    }
  }
  // A ring of white blades around the parapet: the one gesture that makes the
  // silhouette read as a crown rather than a cut-off box.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box([0.28, 2.5, 0.9], [Math.cos(a) * (TOWER.hx + 0.3), ROOF_Y + 1.9, Math.sin(a) * (TOWER.hz + 0.3)], "white",
      at(cs, 0.28 + (i / 10) * 0.22), {
        duration: 0.019, lift: 1.6, r: [0, -a, 0],
      });
  }
  // Mast: two tapered tubes and the aviation beacon, standing on the plant
  // enclosure so it never ends up buried inside the roof box.
  const mastBase = ROOF_Y + 0.46 + 4.2;
  b.cylinder(0.32, 0.46, 2.6, [0, mastBase + 1.3, -2.2], "steel", at(cs, 0.62), { duration: 0.018, lift: 2.0 });
  b.cylinder(0.14, 0.30, 2.4, [0, mastBase + 3.7, -2.2], "steel", at(cs, 0.76), { duration: 0.016, lift: 2.0 });
  // The aviation beacon is the last thing to come on.
  b.sphere([0, mastBase + 5.1, -2.2], [0.22, 0.22, 0.22], "glow", at(PHASE.lighting, 0.92), {
    duration: 0.014, lift: 0.05,
  });
}

function buildPodium(b: StructureBuilder) {
  const ps = PHASE.podium;
  const px = PODIUM.hx, pz = PODIUM.hz, ph = PODIUM.h, plinth = PODIUM.plinth;
  const wallTop = plinth + ph;

  b.box([px * 2 + 2.6, plinth, pz * 2 + 2.6], [0, plinth / 2, 0], "stone", at(ps, 0.02), {
    duration: 0.024, lift: 0.9,
  });

  const bodyH = wallTop - plinth;
  const bodyY = plinth + bodyH / 2;
  b.box([px * 2, bodyH, 0.7], [0, bodyY, -pz + 0.35], "concrete", at(ps, 0.14), { duration: 0.024, lift: 1.9 });
  for (const sx of [-1, 1]) {
    b.box([0.7, bodyH, pz * 2], [sx * (px - 0.35), bodyY, 0], "concrete", at(ps, 0.28), {
      duration: 0.024, lift: 1.9,
    });
  }
  // Front facade is carried on four piers so the lobby can be fully glazed.
  for (const x of [-px + 0.8, -5.0, 5.0, px - 0.8]) {
    b.box([1.6, bodyH, 0.7], [x, bodyY, pz - 0.35], "concrete", at(ps, 0.40), { duration: 0.022, lift: 1.9 });
  }
  b.box([px * 2, 0.7, 0.7], [0, plinth + 0.35, pz - 0.35], "concrete", at(ps, 0.50), { duration: 0.02, lift: 1.2 });
  // Mezzanine plate and the white band that wraps the podium at mid height.
  b.box([px * 2 - 1.4, 0.4, pz * 2 - 1.4], [0, plinth + 3.9, 0], "concreteDeep", at(ps, 0.62), {
    duration: 0.022, lift: 1.3, shade: 0.8,
  });
  b.box([px * 2 + 0.9, 0.48, pz * 2 + 0.9], [0, plinth + 3.9, 0], "white", at(ps, 0.70), {
    duration: 0.022, lift: 1.4,
  });
  // Podium roof slab: overhangs, and its underside is what you read as the
  // canopy soffit over the whole glazed front.
  b.box([px * 2 + 1.5, 0.8, pz * 2 + 1.5], [0, wallTop + 0.4, 0], "white", at(ps, 0.84), {
    duration: 0.026, lift: 1.6,
  });

  // Roof terrace planting beds, either side of the tower footprint.
  for (const sx of [-1, 1]) {
    b.box([px - TOWER.hx - 1.6, 0.22, pz * 2 - 3.2], [sx * ((px + TOWER.hx) / 2), BASE_Y + 0.11, 0], "lawn",
      at(PHASE.landscape, 0.1 + (sx + 1) * 0.12), { duration: 0.02, lift: 0.5 });
  }
  // Terrace parapet.
  const terraceY = BASE_Y + 0.55;
  for (const sz of [-1, 1]) {
    b.box([px * 2 + 1.2, 1.1, 0.3], [0, terraceY, sz * (pz + 0.45)], "white", at(ps, 0.92), {
      duration: 0.02, lift: 1.0,
    });
  }
  for (const sx of [-1, 1]) {
    b.box([0.3, 1.1, pz * 2 + 1.2], [sx * (px + 0.45), terraceY, 0], "white", at(ps, 0.92), {
      duration: 0.02, lift: 1.0,
    });
  }

  // Entrance canopy + the lit soffit under it.
  const canopyY = plinth + 4.3;
  b.box([13.0, 0.45, 5.6], [0, canopyY, pz + 2.6], "white", at(ps, 0.95), { duration: 0.024, lift: 1.3 });
  b.box([11.4, 0.16, 4.6], [0, canopyY - 0.3, pz + 2.6], "glow", at(PHASE.lighting, 0.10), {
    duration: 0.02, lift: 0.05,
  });
  for (const x of [-5.0, -1.9, 1.9, 5.0]) {
    b.cylinder(0.15, 0.15, canopyY - plinth, [x, plinth + (canopyY - plinth) / 2, pz + 4.4], "steel", at(ps, 0.88), {
      duration: 0.018, lift: 1.4,
    });
  }

  // Interior of the double-height lobby: a lit back wall behind the glass.
  b.box([px * 2 - 3.0, 4.4, 0.3], [0, plinth + 2.6, -pz + 1.5], "glow", at(PHASE.lighting, 0.02), {
    duration: 0.022, lift: 0.05,
  });
}

function buildPodiumGlazing(b: StructureBuilder) {
  const gs = PHASE.podiumGlazing;
  const px = PODIUM.hx, pz = PODIUM.hz, plinth = PODIUM.plinth;
  const sill = plinth + 0.6;
  const head = plinth + PODIUM.h;
  const paneH = head - sill - 0.2;
  const paneY = sill + 0.1 + paneH / 2;

  // Lobby glass on the front, split by the four piers.
  const piers = [-px + 0.8, -5.0, 5.0, px - 0.8];
  for (let k = 0; k < 44; k++) {
    const x = -px + 0.7 + k * 1.5;
    if (x > px - 0.7) break;
    if (piers.some((p) => Math.abs(x - p) < 1.1)) continue;
    b.box([1.36, paneH, 0.07], [x, paneY, pz + 0.05], "glassClear", at(gs, 0.12 + sweep(x, pz) * 0.5), {
      duration: 0.024, lift: 2.4, drift: [0.2, 1, 0.85],
    });
    b.box([0.12, paneH + 0.2, 0.18], [x + 0.75, paneY, pz + 0.05], "mullion", at(gs, 0.06 + sweep(x, pz) * 0.4), {
      duration: 0.018, lift: 2.0,
    });
  }

  // Ribbon windows on the back and both flanks, upper level only. Sits proud of
  // the concrete by 5 cm so it never disappears inside the wall it belongs to.
  const ribbonY = plinth + PODIUM.h - 2.0;
  const ribbonH = 1.9;
  for (let k = 0; k < 20; k++) {
    const x = -px + 1.0 + k * 1.5;
    if (x > px - 1.0) break;
    b.box([1.36, ribbonH, 0.07], [x, ribbonY, -pz - 0.05], "glassDeep", at(gs, 0.55 + sweep(x, -pz) * 0.4), {
      duration: 0.02, lift: 1.8, drift: [0, 1, -0.6],
    });
  }
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 15; k++) {
      const z = -pz + 1.0 + k * 1.5;
      if (z > pz - 1.0) break;
      b.box([0.07, ribbonH, 1.36], [sx * (px + 0.05), ribbonY, z], "glassDeep", at(gs, 0.55 + sweep(sx * px, z) * 0.4), {
        duration: 0.02, lift: 1.8, drift: [0.6 * sx, 1, 0],
      });
    }
  }
}

export function buildTower(b: StructureBuilder) {
  buildPodium(b);
  buildTowerBody(b);
  buildPodiumGlazing(b);
}

/** Storey index the animation is currently working on, for the HUD. */
export function storeyAt(progress: number) {
  const span = PHASE.tower;
  if (progress <= span[0]) return 0;
  return Math.min(FLOORS, Math.floor(((progress - span[0]) / (span[1] - span[0])) / 0.84 * FLOORS));
}
