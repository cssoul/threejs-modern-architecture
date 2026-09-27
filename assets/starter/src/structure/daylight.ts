/**
 * Four hours of one day.
 *
 * A time of day is **not** a colour filter over one render. It is four
 * independent rigs that have to agree with each other:
 *
 *  1. the equirect sky, which is simultaneously the background and the only
 *     thing the curtain wall has to mirror;
 *  2. the directional rig — where the sun is, how warm, how strong;
 *  3. how much the *interior* lights are on, which is what actually sells the
 *     hour: at noon the building is a closed object, at night it is a lantern.
 *
 * ## Where the gradient stops go
 *
 * Read `material-system.md` first. The short version: the visible sky is a
 * narrow slice of the equirect, and **which** slice depends on the camera. For
 * this project the four stations together see roughly `v ∈ [0.37, 0.62]`
 * (the overview looks 4.5° down, the street 5.7° up, with a 34° vertical fov),
 * so every distinguishing stop below lives inside 0.35–0.62. Stops outside that
 * window only exist to keep the sphere seamless.
 *
 * The warm band is deliberately kept below `v = 0.49` in every preset. Above
 * that line is where a facade is most likely to be reflecting, and a warm
 * reflection there is what made the first version of the dusk scene read as
 * "sunset postcard" instead of blue hour.
 */

export type TimeId = "morning" | "noon" | "dusk" | "night";

/** `[v, cssColor]` pairs for the vertical equirect gradient. */
export type SkyStops = readonly (readonly [number, string])[];

export type SkySpec = {
  stops: SkyStops;
  /**
   * City-glow pools: `[xPx, radiusPx, alpha]`. Drawn squashed in Y — a circular
   * radial gradient on a 2:1 equirect is 2× taller in elevation than in
   * azimuth, so an unsquashed 230 px radius covers 45% of the sky.
   */
  glows: readonly (readonly [number, number, number])[];
  /** Cloud band alpha multiplier. Night has almost none. */
  cloud: number;
  /** Cloud tint, `r,g,b` triplet string. */
  cloudTint: string;
};

export type LightRig = {
  hemi: { sky: string; ground: string; intensity: number };
  /** `[color, intensity, [x,y,z]]` */
  key: { color: string; intensity: number; position: [number, number, number] };
  fill: { color: string; intensity: number };
  rim: { color: string; intensity: number };
  bounce: { color: string; intensity: number };
};

export type DayPreset = {
  id: TimeId;
  label: string;
  /** Caption shown on the card while this hour is active. */
  caption: string;
  sky: SkySpec;
  rig: LightRig;
  exposure: number;
  backgroundIntensity: number;
  environmentIntensity: number;
  /**
   * Multiplier on every emissive material's `emissiveIntensity`.
   *
   * Capped near 1.1 on purpose: `glowHot` already sits at 1.45 and ACES
   * flattens anything much past ~1.5 into white, at which point the window
   * stops reading as a window. Night is made to feel dark by pulling the
   * *ambient* down, not by pushing the emissives up.
   */
  interior: number;
  /** Shadow tint — the ambient colour the crush of a low sun leaves behind. */
  shadowSoftness: number;
};

export const TIMES: readonly DayPreset[] = [
  {
    id: "morning",
    label: "早晨",
    caption: "东面初照，石材最先醒过来。",
    sky: {
      // Low warm sun on one side, cool pale blue overhead. Still a *soft*
      // sky: haze does most of the work at 7am, not saturation.
      stops: [
        [0.000, "#2b5b90"],
        [0.200, "#4374a4"],
        [0.350, "#78a0c0"],
        [0.430, "#a3bfd2"],
        [0.470, "#c6d3d6"],
        [0.488, "#d3cdbd"],
        [0.502, "#dcb489"],
        [0.516, "#a8804f"],
        [0.545, "#635647"],
        [0.610, "#463d31"],
        [0.730, "#2f2a23"],
        [1.000, "#191612"],
      ],
      glows: [[300, 210, 0.22], [820, 150, 0.12]],
      cloud: 0.9,
      cloudTint: "226,214,206",
    },
    rig: {
      hemi: { sky: "#8fb0d0", ground: "#6a5a48", intensity: 0.55 },
      key: { color: "#ffdcb0", intensity: 1.0, position: [-78, 40, 66] },
      fill: { color: "#a8c4dc", intensity: 0.34 },
      rim: { color: "#ffd0a0", intensity: 0.40 },
      bounce: { color: "#ffbe86", intensity: 0.18 },
    },
    // Under noon on purpose: 7am is a low sun over a cool ground, and if the
    // exposure matches midday the two hours collapse into "bright".
    exposure: 0.96,
    backgroundIntensity: 1.0,
    environmentIntensity: 0.78,
    interior: 0.30,
    shadowSoftness: 0.9,
  },
  {
    id: "noon",
    label: "中午",
    caption: "顶光之下，体量只剩阴影在说话。",
    sky: {
      // No warm band at all: midday haze is white, not gold. This is the one
      // preset where the horizon feature is *desaturation*, not colour.
      //
      // The blue has to hold all the way down to ~0.47, though — the same trap as
      // dusk in the other direction. Wash the whole visible band out and the sky
      // reads as overcast, not as noon.
      stops: [
        [0.000, "#16447f"],
        [0.200, "#2560a0"],
        [0.330, "#3f83bd"],
        [0.420, "#6ba3d0"],
        [0.458, "#93b9dc"],
        [0.482, "#b8d0e4"],
        [0.496, "#d6e2e8"],
        [0.505, "#e2eaea"],
        [0.518, "#a8b3b8"],
        [0.545, "#6d7473"],
        [0.610, "#4b4e49"],
        [0.730, "#33342e"],
        [1.000, "#1c1c19"],
      ],
      glows: [],
      cloud: 0.75,
      cloudTint: "255,255,255",
    },
    rig: {
      hemi: { sky: "#bcd6ea", ground: "#8a8578", intensity: 0.86 },
      key: { color: "#fff6e8", intensity: 1.34, position: [-38, 118, 44] },
      fill: { color: "#9fbcd8", intensity: 0.46 },
      rim: { color: "#f4f8ff", intensity: 0.22 },
      bounce: { color: "#d8d4c8", intensity: 0.12 },
    },
    exposure: 1.0,
    backgroundIntensity: 1.0,
    environmentIntensity: 0.92,
    // Windows off. The building is a closed stone-and-glass object.
    interior: 0.0,
    shadowSoftness: 1.0,
  },
  {
    id: "dusk",
    label: "黄昏",
    caption: "白天是石头的体量，入夜是光的容器。",
    sky: {
      stops: [
        [0.000, "#08122a"],
        [0.190, "#0e2245"],
        [0.320, "#1a3a64"],
        [0.410, "#2a5480"],
        [0.455, "#3f6b93"],
        [0.480, "#5e82a2"],
        [0.494, "#8b9096"],
        [0.502, "#ad8c6e"],
        [0.514, "#7a5f43"],
        [0.535, "#4a3d2d"],
        [0.570, "#332b22"],
        [0.660, "#262119"],
        [0.800, "#1e1a15"],
        [1.000, "#16130f"],
      ],
      glows: [[300, 230, 0.30], [820, 160, 0.18]],
      cloud: 0.45,
      cloudTint: "206,150,140",
    },
    rig: {
      hemi: { sky: "#35507a", ground: "#3a3128", intensity: 0.38 },
      key: { color: "#b6cade", intensity: 0.66, position: [-56, 92, 54] },
      fill: { color: "#6d86a8", intensity: 0.34 },
      // Warm rim stays well under the key: at 0.60 it tinted the white cladding
      // cream on every face it touched and the cold/warm tension was lost.
      rim: { color: "#ffc48c", intensity: 0.42 },
      bounce: { color: "#ffab68", intensity: 0.26 },
    },
    exposure: 1.12,
    backgroundIntensity: 1.0,
    environmentIntensity: 0.86,
    interior: 1.0,
    shadowSoftness: 1.0,
  },
  {
    id: "night",
    label: "夜晚",
    caption: "幕墙沉入夜色，只剩内透在排布。",
    sky: {
      // Deep indigo, and the only preset with a *strong* city glow: with no sun
      // left, light pollution on the horizon is the entire skyline cue.
      //
      // Mind the horizon stops. An earlier pass used mauve values (#57485a) and
      // the stone came back rgb(61,43,48) — green below both red *and* blue, i.e.
      // magenta. Stone has `envMapIntensity` 0.62, so at night the environment is
      // most of its ambient and a purple horizon repaints the whole facade.
      // A city glow is orange, so the band has to carry green: it belongs between
      // the two, not under both.
      stops: [
        [0.000, "#04091a"],
        [0.200, "#07122c"],
        [0.320, "#0b1a3c"],
        [0.420, "#102449"],
        [0.462, "#152c56"],
        [0.486, "#22385f"],
        [0.498, "#3a4258"],
        [0.508, "#5c4a3e"],
        [0.522, "#382f28"],
        [0.552, "#221e1c"],
        [0.610, "#16141a"],
        [0.730, "#0f0d14"],
        [1.000, "#07070b"],
      ],
      glows: [[300, 250, 0.40], [820, 170, 0.26]],
      cloud: 0.10,
      cloudTint: "150,170,196",
    },
    rig: {
      // Night is rebalanced *cool*, not just darker. With only directional lights
      // there is no way to pool the shopfront glow locally, so a warm-dominant rig
      // tints the entire facade mauve and the stone reads as LED-lit. Letting the
      // cool half win means the cladding goes blue-grey and the warm comes from
      // the windows themselves — which is what a real night street looks like.
      hemi: { sky: "#22345c", ground: "#1e1a14", intensity: 0.26 },
      key: { color: "#7d95bd", intensity: 0.26, position: [-56, 92, 54] },
      fill: { color: "#44618c", intensity: 0.20 },
      rim: { color: "#ffc48c", intensity: 0.20 },
      // Street bounce is *higher* than at dusk relative to everything else: the
      // only light left is what the shopfronts throw back up.
      bounce: { color: "#ffb070", intensity: 0.22 },
    },
    exposure: 1.28,
    backgroundIntensity: 1.0,
    // The environment is nearly all of a dark facade's ambient, and at night that
    // ambient is a coloured glow sitting on the horizon. Kept low on purpose.
    environmentIntensity: 0.45,
    interior: 1.1,
    shadowSoftness: 1.0,
  },
];

export const DEFAULT_TIME: TimeId = "noon";

export function presetOf(id: TimeId): DayPreset {
  return TIMES.find((t) => t.id === id) ?? TIMES[2];
}
