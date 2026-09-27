import * as THREE from "three";
import { makeRandom } from "./rng";
import type { SkySpec } from "./daylight";

export type SurfaceName =
  | "concrete"      // 清水混凝土：竖向结构、柱、核心筒
  | "concreteDeep"  // 背光混凝土：室内楼板底、核心筒内壁
  | "white"         // 白色幕墙板 / 楼板边缘带
  | "stone"         // 浅色花岗岩铺装
  | "paving"        // 深色铺装 / 场地
  | "roof"          // 屋面砾石
  | "mullion"       // 铝型材竖梃
  | "steel"         // 结构钢 / 栏杆 / 桅杆
  | "wood"          // 大堂木饰面
  | "glass"         // 镜面玻璃幕墙
  | "glassDeep"     // 深色玻璃：竖缝、核心筒条形窗
  | "glassClear"    // 通透玻璃：大堂
  | "glow"          // 室内灯光
  | "planting"      // 灌木
  | "lawn"          // 绿屋顶草坪
  | "water";        // 镜面水池

/** Surfaces that must not cast or receive baked shadows. */
export const NO_CAST: SurfaceName[] = ["glass", "glassDeep", "glassClear", "water", "glow", "lawn", "planting"];
export const NO_RECEIVE: SurfaceName[] = ["glass", "glassDeep", "glassClear", "water", "glow"];
/** Surfaces whose texture origin must stay aligned across pieces (panel joints). */
export const NO_UV_JITTER: SurfaceName[] = ["glass", "glassDeep", "glassClear", "glow", "water", "white"];

type Feature = "boardform" | "paneljoint" | "brushed" | "slats" | "foliage" | "gravel" | "speckle";

const PALETTE: Record<SurfaceName, string> = {
  concrete: "#c5c2ba",
  concreteDeep: "#8f8d87",
  white: "#e8e6e0",
  stone: "#b6b1a6",
  paving: "#9d988f",
  roof: "#a9a59d",
  mullion: "#b4b9be",
  steel: "#6d7175",
  wood: "#c49a6a",
  glass: "#8fadc6",
  glassDeep: "#42545f",
  glassClear: "#bccdd8",
  glow: "#4a4034",
  planting: "#4d6a3c",
  lawn: "#6f8a52",
  water: "#1e3f4e",
};

const FEATURE: Partial<Record<SurfaceName, Feature>> = {
  concrete: "boardform",
  concreteDeep: "boardform",
  white: "paneljoint",
  mullion: "brushed",
  steel: "brushed",
  wood: "slats",
  planting: "foliage",
  lawn: "foliage",
  roof: "gravel",
  stone: "speckle",
  paving: "speckle",
};

/** Emissive bases. Kept near 1.0–1.3: ACES tone mapping flattens anything much
 *  higher into white and the window stops reading as a window. `setInterior()`
 *  scales these at runtime when the hour changes. */
const EMISSIVE: Partial<Record<SurfaceName, { color: string; intensity: number }>> = {
  glow: { color: "#ffd2a0", intensity: 1.05 },
};

/**
 * Build the whole modern-material set from canvases. No image files, no network,
 * and the same seed always produces the same wall.
 *
 * **Texture scale contract:** the builder's extruded boxes emit UVs in world
 * units, so one texture tile covers exactly one world unit (≈ one metre here).
 * Every feature below is therefore authored in metres: a 1024 px canvas means
 * 1024 px = 1 m, and a board-form line drawn every 256 px is a joint every
 * 25 cm. Keep that contract when you re-paint these or the joints will drift
 * between a transom and a slab band.
 */
export function createModernMaterials(renderer: THREE.WebGLRenderer) {
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures: THREE.Texture[] = [];
  const output = {} as Record<SurfaceName, THREE.MeshStandardMaterial>;

  const finishTexture = (texture: THREE.Texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = maxAnisotropy;
    textures.push(texture);
    return texture;
  };

  for (const [name, base] of Object.entries(PALETTE) as [SurfaceName, string][]) {
    // --- reflective glass -------------------------------------------------
    // Curtain wall glass is OPAQUE mirror glass. At building scale that is both
    // what real coated glass looks like and the only way to get a crisp sky /
    // ground reflection without fighting transparency sorting across hundreds
    // of bays. The construction reads because you see bare concrete before the
    // glass sweeps around and seals each floor.
    if (name === "glass" || name === "glassDeep") {
      const dark = name === "glassDeep";
      output[name] = new THREE.MeshPhysicalMaterial({
        color: base, metalness: dark ? 0.8 : 0.88, roughness: dark ? 0.09 : 0.055,
        envMapIntensity: dark ? 0.95 : 1.45, clearcoat: 1, clearcoatRoughness: 0.04,
        vertexColors: true,
      });
      continue;
    }
    // Lobby glass stays see-through so the warm interior is visible from outside.
    if (name === "glassClear") {
      output[name] = new THREE.MeshPhysicalMaterial({
        color: base, metalness: 0.06, roughness: 0.03, transparent: true, opacity: 0.42,
        envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.03, vertexColors: true,
      });
      continue;
    }
    if (EMISSIVE[name]) {
      // Emissive interior. The intensity is constant here; WHEN each window
      // lights up is decided per piece by the builder's emissive ramp, so a
      // staggered schedule makes the light climb the facade one floor at a time.
      // `setInterior()` scales the whole group when the hour changes.
      const spec = EMISSIVE[name]!;
      output[name] = new THREE.MeshStandardMaterial({
        color: base, emissive: new THREE.Color(spec.color), emissiveIntensity: spec.intensity,
        roughness: 0.55, metalness: 0, vertexColors: true,
      });
      continue;
    }
    if (name === "water") {
      const ripple = document.createElement("canvas");
      ripple.width = ripple.height = 256;
      const rc = ripple.getContext("2d")!;
      const rrand = makeRandom(7331);
      rc.fillStyle = "#808080";
      rc.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 900; i++) {
        const y = rrand() * 256;
        const v = 108 + rrand() * 40;
        rc.strokeStyle = `rgba(${v},${v},${v},.5)`;
        rc.lineWidth = 0.6 + rrand() * 1.6;
        rc.beginPath();
        rc.moveTo(-10, y);
        rc.bezierCurveTo(80, y + (rrand() - 0.5) * 14, 170, y + (rrand() - 0.5) * 14, 266, y);
        rc.stroke();
      }
      const bump = finishTexture(new THREE.CanvasTexture(ripple));
      output[name] = new THREE.MeshPhysicalMaterial({
        color: base, roughness: 0.09, metalness: 0.12, envMapIntensity: 0.65,
        bumpMap: bump, bumpScale: 0.03, vertexColors: true,
      });
      continue;
    }

    // --- pigment ---------------------------------------------------------
    const feature = FEATURE[name];
    const size = name === "concrete" || name === "concreteDeep" || name === "white" ? 1024 : 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const rand = makeRandom(83 + name.length * 101);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    if (feature === "boardform") {
      // Board-form joints every 25 cm plus the tie-rod holes that hold the
      // formwork: the two marks that make concrete read as cast, not painted.
      const board = size / 4;
      for (let y = 0; y < size; y += board) {
        ctx.fillStyle = "rgba(58,55,50,.20)";
        ctx.fillRect(0, y, size, 2);
        ctx.fillStyle = "rgba(255,252,244,.12)";
        ctx.fillRect(0, y + 2, size, 1.5);
      }
      for (let y = board / 2; y < size; y += board) {
        for (let x = board / 2; x < size; x += board) {
          const r = size * 0.006;
          ctx.fillStyle = "rgba(48,45,40,.42)";
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,250,240,.20)";
          ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Rain runs below the joints — vertical, never circular stains.
      for (let i = 0; i < 34; i++) {
        const x = rand() * size, w = size * (0.004 + rand() * 0.02), h = size * (0.1 + rand() * 0.5);
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(74,78,70,.13)");
        g.addColorStop(1, "rgba(74,78,70,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, rand() * size * 0.4, w, h);
      }
    }

    if (feature === "paneljoint") {
      // Horizontal panel joints every 1 m (= one texture tile). Slab edge bands
      // are only ~0.55 m tall, so in practice you see the vertical rhythm only.
      for (let x = 0; x < size; x += size) {
        ctx.fillStyle = "rgba(120,118,112,.30)"; ctx.fillRect(x, 0, 2.5, size);
        ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(x + 2.5, 0, 1.5, size);
      }
      ctx.fillStyle = "rgba(120,118,112,.16)"; ctx.fillRect(0, size / 2, size, 2);
    }

    if (feature === "brushed") {
      for (let i = 0; i < 1400; i++) {
        const x = rand() * size;
        ctx.strokeStyle = rand() > 0.5 ? `rgba(255,255,255,${0.02 + rand() * 0.09})` : `rgba(40,44,48,${0.02 + rand() * 0.08})`;
        ctx.lineWidth = 0.5 + rand() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rand() - 0.5) * 6, size);
        ctx.stroke();
      }
    }

    if (feature === "slats") {
      const slat = size / 8;
      for (let x = 0; x < size; x += slat) {
        ctx.fillStyle = "rgba(60,38,18,.34)";
        ctx.fillRect(x, 0, 3, size);
        for (let i = 0; i < 14; i++) {
          ctx.strokeStyle = i % 3 ? "rgba(92,58,26,.10)" : "rgba(255,226,180,.12)";
          ctx.lineWidth = 0.4 + rand() * 1.2;
          const gx = x + 4 + rand() * (slat - 8);
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          for (let y = 0; y <= size; y += 16) ctx.lineTo(gx + Math.sin(y * 0.03 + gx) * 1.6, y);
          ctx.stroke();
        }
      }
    }

    if (feature === "foliage" || feature === "gravel" || feature === "speckle") {
      const blobs = feature === "foliage" ? 340 : feature === "gravel" ? 1500 : 900;
      for (let i = 0; i < blobs; i++) {
        const x = rand() * size, y = rand() * size;
        const r = feature === "foliage" ? size * (0.02 + rand() * 0.09) : size * (0.004 + rand() * 0.012);
        const v = 0.5 + rand() * 0.5;
        ctx.fillStyle =
          feature === "foliage"
            ? (i % 3 ? `rgba(30,52,22,${0.05 + rand() * 0.14})` : `rgba(178,206,126,${0.05 + rand() * 0.12})`)
            : `rgba(${Math.floor(150 * v)},${Math.floor(148 * v)},${Math.floor(142 * v)},${0.18 + rand() * 0.22})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Mineral clouding: pigment ages in patches, not per texel.
    for (let i = 0; i < 170; i++) {
      const x = rand() * size, y = rand() * size, r = size * (0.02 + rand() * 0.13);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, i % 3 ? "rgba(44,42,36,.045)" : "rgba(252,250,240,.055)");
      gradient.addColorStop(1, "rgba(120,116,104,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Fine grain, denser on the materials that are supposed to feel sandy.
    const grain = size === 1024 ? 26000 : 9000;
    for (let i = 0; i < grain; i++) {
      ctx.fillStyle = rand() > 0.45
        ? `rgba(255,252,244,${0.03 + rand() * 0.12})`
        : `rgba(34,32,28,${0.025 + rand() * 0.09})`;
      const s = 0.5 + rand() * 1.6;
      ctx.fillRect(rand() * size, rand() * size, s, s);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    finishTexture(texture);

    // Micro-height only. Stains are not craters, so the bump map stays flat
    // banding-free noise and the roughness map carries the weathering.
    const detail = document.createElement("canvas");
    detail.width = detail.height = 256;
    const dc = detail.getContext("2d")!;
    const pixels = dc.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const v = 128 + (rand() - 0.5) * (name === "stone" || name === "roof" ? 70 : 26);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
        pixels.data[i + 3] = 255;
      }
    }
    dc.putImageData(pixels, 0, 0);
    const bump = finishTexture(new THREE.CanvasTexture(detail));

    const roughCanvas = document.createElement("canvas");
    roughCanvas.width = roughCanvas.height = 256;
    const roughCtx = roughCanvas.getContext("2d")!;
    const polished = name === "stone";
    roughCtx.fillStyle = polished ? "#9c9c9c" : name === "wood" ? "#d6d6d6" : "#efefef";
    roughCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      roughCtx.fillStyle = `rgba(58,58,58,${0.02 + rand() * 0.05})`;
      roughCtx.fillRect(rand() * 256, rand() * 256, 8 + rand() * 36, 8 + rand() * 36);
    }
    const roughness = finishTexture(new THREE.CanvasTexture(roughCanvas));

    const bumpScale =
      name === "concrete" ? 0.010 : name === "concreteDeep" ? 0.008 : name === "white" ? 0.004
      : name === "wood" ? 0.016 : name === "roof" ? 0.030 : name === "stone" ? 0.020 : name === "paving" ? 0.022 : 0.006;

    const metal = name === "mullion" ? 0.92 : name === "steel" ? 0.78 : 0;
    output[name] = new THREE.MeshStandardMaterial({
      map: texture, bumpMap: bump, roughnessMap: roughness, bumpScale,
      roughness: name === "mullion" ? 0.30 : name === "steel" ? 0.54 : name === "stone" ? 0.62 : name === "roof" ? 0.9 : 0.94,
      metalness: metal,
      // Reflection strength against the procedural sky. Concrete barely picks it
      // up; the metal work is what sells the scale.
      envMapIntensity: name === "mullion" ? 1.0 : name === "steel" ? 0.75 : name === "white" ? 0.42 : 0.30,
      vertexColors: true,
    });
  }

  return {
    materials: output,
    /**
     * Scale every interior-light material at once — the per-hour half of "is the
     * building occupied". A plain material write, so it costs no shader
     * recompile, and the per-piece emissive ramp multiplies on top of it.
     * `setInterior(0)` at noon leaves every window dark, which is exactly what
     * a closed building should look like in daylight.
     */
    setInterior(factor: number) {
      for (const name of Object.keys(EMISSIVE) as SurfaceName[]) {
        const material = output[name];
        if (material) material.emissiveIntensity = EMISSIVE[name]!.intensity * factor;
      }
    },
    dispose() {
      textures.forEach((t) => t.dispose());
      Object.values(output).forEach((m) => m.dispose());
    },
  };
}

/**
 * A procedural equirectangular sky, pre-filtered into an environment map *and*
 * returned as a background texture. Which sky is drawn comes from a `SkySpec`
 * in `daylight.ts`, so one function serves every hour of the day (the starter
 * itself stays on the daylight `noon` preset — see `TowerScene.tsx`).
 *
 * This is what makes glass read as glass. A uniform colour environment gives a
 * flat, dead sheen; the hard **horizon line** plus whatever sits on it is what
 * the curtain wall actually mirrors, and it is why a mirror-glass tower looks
 * like a building and not like a blue plastic box.
 *
 * Costs one 1024×512 canvas and one PMREM pass. Switching hour rebuilds it, so
 * the caller must dispose the previous `environment` + `sky`.
 */
export function createSkyEnvironment(
  renderer: THREE.WebGLRenderer,
  sky: SkySpec,
  /** 0 = every interior light off (noon), 1 = fully lit (night). */
  interior: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  // v = 0.5 is the horizon, 0 the zenith, 1 the nadir. Where the stops sit is
  // decided by the camera, not by taste — see the header of `daylight.ts`.
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  for (const [v, color] of sky.stops) gradient.addColorStop(v, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  const rand = makeRandom(4242);

  // City-glow pools straddling the horizon. FLATTEN THE Y AXIS: the texture is
  // 2:1, so a circular radial gradient drawn on it is 2× taller in elevation
  // than in azimuth — an unsquashed 230 px radius covers ~81° of elevation,
  // i.e. the whole visible sky. Squashing y by 0.22 brings the pool back to a
  // ~18° light dome sitting on the horizon.
  for (const [cx, spread, alpha] of sky.glows) {
    const pool = ctx.createRadialGradient(cx, 258, 0, cx, 258, spread);
    pool.addColorStop(0, `rgba(255,198,126,${alpha})`);
    pool.addColorStop(0.45, `rgba(246,158,92,${alpha * 0.45})`);
    pool.addColorStop(1, "rgba(240,150,80,0)");
    ctx.save();
    ctx.translate(0, 258); ctx.scale(1, 0.22); ctx.translate(0, -258);
    ctx.fillStyle = pool;
    ctx.fillRect(0, 258 - spread * 0.22 - 4, 1024, spread * 0.44 + 8);
    ctx.restore();
  }

  // Cloud bands in the upper sky. They give the mirror glass a gradient to
  // slide over, which is the cheapest way to make it feel wet. The per-hour
  // multiplier is what makes noon hazy and night clear.
  if (sky.cloud > 0.01) {
    for (let i = 0; i < 30; i++) {
      const x = rand() * 1024, y = 50 + rand() * 180, w = 70 + rand() * 260, h = 6 + rand() * 20;
      const tint = i % 3 === 0 ? "206,150,140" : sky.cloudTint;
      const a = (0.12 + rand() * 0.22) * sky.cloud;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, w);
      cloud.addColorStop(0, `rgba(${tint},${a})`);
      cloud.addColorStop(1, `rgba(${tint},0)`);
      ctx.save();
      ctx.translate(x, y); ctx.scale(1, h / w); ctx.translate(-x, -y);
      ctx.fillStyle = cloud;
      ctx.beginPath(); ctx.arc(x, y, w, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // A handful of lit windows in the ground half — the neighbouring blocks. They
  // follow the hour too: a city with its own lights off at noon should not be
  // shining back at us.
  const windowAlpha = 0.15 + 0.85 * Math.min(1, Math.max(0, interior));
  for (let i = 0; i < 240; i++) {
    const x = rand() * 1024, y = 274 + rand() * 120;
    ctx.fillStyle = rand() > 0.3
      ? `rgba(255,206,150,${(0.20 + rand() * 0.55) * windowAlpha})`
      : `rgba(190,220,255,${(0.15 + rand() * 0.35) * windowAlpha})`;
    ctx.fillRect(x, y, 1 + rand() * 2.4, 1 + rand() * 2.2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(texture);
  pmrem.dispose();
  // `texture` stays alive: the caller uses it as scene.background (or disposes
  // it itself if it only wanted the environment).
  return { environment, sky: texture };
}
