import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NO_CAST, NO_RECEIVE, NO_UV_JITTER, type SurfaceName } from "./materials";
import { variation } from "./rng";

export type Point = [number, number, number];

type Transform = {
  p?: Point;
  r?: Point;
  s?: Point;
  /** Brightness multiplier baked into vertex colour. Use it to darken a soffit,
   *  a recessed reveal, or an interior face without authoring a new material. */
  shade?: number;
  /** Per-channel multiplier for one-off colour accents. */
  tint?: Point;
  /** How long the piece takes to reach its place, in progress units (0..1 of
   *  the whole timeline), not seconds. */
  duration?: number;
  /** Travel distance, in world units, of the settle-in motion. */
  lift?: number;
  /** Direction of that travel. Default [0,1,0] = the piece drops in from above. */
  drift?: Point;
};

/**
 * Batches solid pieces by material and bakes the construction schedule into
 * every vertex. One merged mesh per surface keeps draw calls in the low tens no
 * matter how many thousands of pieces the building is made of, and because the
 * motion lives in the vertex shader the whole scene is driven by a single
 * scalar `progress`.
 *
 * Pieces are always OPAQUE and always SOLID: they travel and settle, they never
 * fade in. That is what keeps the tower reading as construction rather than as
 * a dissolve.
 */
export class StructureBuilder {
  private batches = new Map<SurfaceName, THREE.BufferGeometry[]>();
  private cache = new Map<string, THREE.BufferGeometry>();
  private transform = new THREE.Object3D();
  /** Shared by every injected material. Write once per frame. */
  readonly progress = { value: 0 };
  readonly meshes: THREE.Mesh[] = [];
  private depths: THREE.MeshDepthMaterial[] = [];
  pieces = 0;

  /**
   * Surfaces whose emissive output ramps up **per piece** as that piece lands,
   * instead of switching on with the material.
   *
   * Register a surface here before `finish()`, then schedule its pieces inside a
   * "lights on" window instead of a construction window: each window then lights
   * up on its own, and a staggered schedule makes the light climb the facade.
   * Far more controllable than one global emissive uniform, and far cheaper than
   * interior point lights (which a floor soffit swallows whole).
   */
  readonly rampedEmissive = new Set<SurfaceName>();

  constructor(readonly materials: Record<SurfaceName, THREE.MeshStandardMaterial>) {}

  add(geometry: THREE.BufferGeometry, material: SurfaceName, start: number, options: Transform = {}) {
    this.transform.position.set(...(options.p ?? [0, 0, 0]));
    this.transform.rotation.set(...(options.r ?? [0, 0, 0]));
    this.transform.scale.set(...(options.s ?? [1, 1, 1]));
    this.transform.updateMatrix();

    // Baked into world space so the merged mesh can keep an identity transform.
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(this.transform.matrix);

    const count = g.getAttribute("position").count;
    const schedule = new Float32Array(count * 3);
    const offset = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const shade = options.shade ?? 1;
    const tint = options.tint ?? [1, 1, 1];
    const drift = options.drift ?? [0, 1, 0];
    const lift = options.lift ?? 0.45;
    const duration = options.duration ?? 0.013;

    // Shift the UV atlas per piece so repeated concrete panels and paving tiles
    // never share one identical grain.
    const uv = g.getAttribute("uv");
    if (uv && !NO_UV_JITTER.includes(material)) {
      const shift = variation(this.pieces);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + shift, uv.getY(i) + shift * 0.731);
    }

    const normal = g.getAttribute("normal");
    for (let i = 0; i < count; i++) {
      schedule.set([start, duration, lift], i * 3);
      offset.set(drift, i * 3);
      // Undersides read darker: cheap ambient occlusion where geometry meets.
      const occlusion = normal ? THREE.MathUtils.lerp(0.74, 1, THREE.MathUtils.smoothstep(normal.getY(i), -0.85, 0.15)) : 1;
      color.set(
        [tint[0] * shade * occlusion, tint[1] * shade * occlusion, tint[2] * shade * occlusion],
        i * 3,
      );
    }

    g.setAttribute("aBuild", new THREE.BufferAttribute(schedule, 3));
    g.setAttribute("aOffset", new THREE.BufferAttribute(offset, 3));
    g.setAttribute("color", new THREE.BufferAttribute(color, 3));
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv", "aBuild", "aOffset", "color"].includes(name)) g.deleteAttribute(name);
    }

    if (!this.batches.has(material)) this.batches.set(material, []);
    this.batches.get(material)!.push(g);
    this.pieces++;
  }

  geo(key: string, fn: () => THREE.BufferGeometry) {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key)!;
  }

  /**
   * Rounded, slightly beveled box. Anything above ~0.18 units takes the extrude
   * path, which costs a few more triangles and buys two things that matter for
   * glass-and-concrete architecture: a chamfer that catches a highlight along
   * every slab edge, and world-unit UVs (one texture tile = one world unit), so
   * board-form lines stay the same size on a 0.5 m transom and a 20 m slab.
   */
  box(size: Point, p: Point, material: SurfaceName, start: number, options: Transform = {}) {
    const geometry = this.geo(`box:${size.join(",")}`, () => {
      if (Math.min(...size) < 0.18) return new THREE.BoxGeometry(...size);
      const [w, h, d] = size;
      const r = Math.min(...size) * 0.055;
      const outline = new THREE.Shape();
      outline.moveTo(-w / 2 + r, -h / 2 + r);
      outline.lineTo(w / 2 - r, -h / 2 + r);
      outline.lineTo(w / 2 - r, h / 2 - r);
      outline.lineTo(-w / 2 + r, h / 2 - r);
      outline.closePath();
      const g = new THREE.ExtrudeGeometry(outline, {
        depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 1, steps: 1,
      });
      g.translate(0, 0, -d / 2 + r);
      return g;
    });
    this.add(geometry, material, start, { ...options, p });
  }

  sphere(p: Point, s: Point, material: SurfaceName, start: number, options: Transform = {}) {
    const detail = Math.max(...s) > 0.3;
    this.add(this.geo(`sphere:${detail}`, () => new THREE.SphereGeometry(1, detail ? 16 : 10, detail ? 12 : 7)), material, start, { ...options, p, s });
  }

  cylinder(top: number, bottom: number, height: number, p: Point, material: SurfaceName, start: number, options: Transform = {}) {
    this.add(this.geo(`cyl:${top}/${bottom}/${height}`, () => new THREE.CylinderGeometry(top, bottom, height, 12)), material, start, { ...options, p });
  }

  tube(points: Point[], radius: number, material: SurfaceName, start: number, options: Transform = {}, segments = 18) {
    const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(...q)));
    const geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false);
    this.add(geometry, material, start, options);
    geometry.dispose();
  }

  /** Merge every bucket, inject the construction vertex animation, and attach
   *  the meshes to the scene. Call once, after all geometry is submitted. */
  finish(scene: THREE.Scene) {
    const inject = (m: THREE.Material, surface: SurfaceName | null) => {
      const ramped = surface !== null && this.rampedEmissive.has(surface);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uBuildProgress = this.progress;
        shader.vertexShader =
          "attribute vec3 aBuild;\nattribute vec3 aOffset;\nuniform float uBuildProgress;\nvarying float vConstruction;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
        float buildT = clamp((uBuildProgress - aBuild.x) / max(.0001, aBuild.y), 0.0, 1.0);
        vConstruction = buildT;
        // Cubic ease-out: the piece arrives fast and creeps the last few cm.
        float arrive = pow(1.0 - buildT, 3.0);
        // A single damped overshoot so heavy slabs thud instead of gliding.
        float thud = sin(buildT * 6.2831853) * pow(1.0 - buildT, 2.0) * 0.035;
        transformed += aOffset * aBuild.z * (arrive - thud);`,
          );
        let fragment =
          "varying float vConstruction;\n" +
          shader.fragmentShader.replace("void main() {", "void main() { if (vConstruction <= 0.0) discard;");
        if (ramped) {
          fragment = fragment.replace(
            "#include <emissivemap_fragment>",
            "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= smoothstep(0.35, 1.0, vConstruction);",
          );
        }
        shader.fragmentShader = fragment;
      };
      m.customProgramCacheKey = () => (ramped ? "modern-solid-assembly-ramp-v1" : "modern-solid-assembly-v1");
    };

    for (const [name, geometries] of this.batches) {
      const combined = mergeGeometries(geometries, false)!;
      combined.computeBoundingSphere();
      geometries.forEach((g) => g.dispose());
      const material = this.materials[name];
      inject(material, name);
      const mesh = new THREE.Mesh(combined, material);
      mesh.name = `structure-${name}`;
      mesh.castShadow = !NO_CAST.includes(name);
      mesh.receiveShadow = !NO_RECEIVE.includes(name);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      inject(depth, null);
      mesh.customDepthMaterial = depth;
      this.depths.push(depth);
      this.meshes.push(mesh);
      scene.add(mesh);
    }
    this.cache.forEach((g) => g.dispose());
    this.cache.clear();
    this.batches.clear();
  }

  dispose() {
    this.meshes.forEach((m) => { m.geometry.dispose(); m.removeFromParent(); });
    this.depths.forEach((m) => m.dispose());
    this.meshes.length = 0;
  }
}
