import * as THREE from "three";
import { makeRandom } from "./rng";
import { TREE_SPOTS } from "./site";
import { PHASE } from "./tower";

/** One clock for every swaying shader in the scene. Write once per frame. */
export const WIND_TIME = { value: 0 };

type Item = {
  x: number; y: number; z: number; rot: number; start: number;
  trunkH: number; trunkR: number; canopyR: number; columnar: boolean;
  tint: THREE.Color;
};

/**
 * Instanced vegetation with per-instance construction timing and a vertex wind
 * sway. A whole avenue costs three draw calls, growth rides the same `progress`
 * scalar as the building, and the wind phase comes from each instance's world
 * position so a row never sways in unison.
 */
export function buildVegetation(progress: { value: number }) {
  const group = new THREE.Group();
  group.name = "vegetation";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const rand = makeRandom(90210);
  const span = PHASE.landscape;

  const items: Item[] = TREE_SPOTS.map((spot, index) => {
    const columnar = index % 3 === 2;
    const scale = 0.85 + rand() * 0.65;
    const tint = new THREE.Color();
    tint.setHSL(0.245 + rand() * 0.075, 0.30 + rand() * 0.16, 0.24 + rand() * 0.12);
    return {
      x: spot[0], y: spot[1], z: spot[2], rot: rand() * Math.PI * 2,
      start: span[0] + (span[1] - span[0]) * (0.04 + ((index % 17) / 17) * 0.62),
      // Scale reference: one world unit is one metre, floor-to-floor is 3.6, so
      // a street tree is ~9 units tip to root. Getting this wrong is the single
      // most visible scale bug in an architectural miniature.
      trunkH: (columnar ? 5.2 : 4.0) * scale,
      trunkR: (columnar ? 0.20 : 0.30) * scale,
      canopyR: (columnar ? 1.90 : 3.10) * scale,
      columnar, tint,
    };
  });

  const hedges: { x: number; y: number; z: number; h: number; len: number; start: number; tint: THREE.Color }[] = [];
  for (let i = 0; i < 11; i++) {
    hedges.push({ x: -31.8, y: 0.32, z: -24 + i * 5.0, h: 1.1, len: 4.4, start: 0, tint: new THREE.Color() });
    hedges.push({ x: 31.8, y: 0.32, z: -21.6 + i * 5.0, h: 1.1, len: 4.4, start: 0, tint: new THREE.Color() });
  }
  for (let i = 0; i < 8; i++) {
    hedges.push({ x: -25 + i * 7.2, y: 0.32, z: -31.4, h: 1.2, len: 5.6, start: 0, tint: new THREE.Color() });
  }
  hedges.forEach((hedge, index) => {
    hedge.start = span[0] + (span[1] - span[0]) * (0.30 + ((index % 11) / 11) * 0.32);
    hedge.tint.setHSL(0.26, 0.34, 0.20 + (index % 4) * 0.02);
  });

  // --- shared shader patch ------------------------------------------------
  const attach = (material: THREE.Material, strength: number) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uProgress = progress;
      shader.uniforms.uTime = WIND_TIME;
      shader.uniforms.uStrength = { value: strength };
      shader.vertexShader =
        "attribute float aStart;\nattribute float aAnchor;\nuniform float uProgress;\nuniform float uTime;\nuniform float uStrength;\nvarying float vGrow;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
        float grow = clamp((uProgress - aStart) / 0.045, 0.0, 1.0);
        vGrow = grow;
        // Grow from each instance's own origin: trunks push out of the ground,
        // canopies unfurl from their centre.
        transformed *= mix(0.001, 1.0, grow);
        // Phase from world position, never from instanceId, or the whole row
        // sways as one block and reads as a broken texture.
        vec3 wpos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float phase = wpos.x * 0.32 + wpos.z * 0.24;
        float h = aAnchor;
        float sway = sin(uTime * 1.5 + phase) * 0.5 + sin(uTime * 2.8 + phase * 1.7) * 0.25;
        transformed.x += sway * uStrength * h * h * 0.35 * grow;
        transformed.z += sway * uStrength * h * h * 0.22 * grow;`,
        );
      shader.fragmentShader =
        "varying float vGrow;\n" +
        shader.fragmentShader.replace("void main() {", "void main() { if (vGrow <= 0.0005) discard;");
    };
    // All three instanced meshes share this patch, so the cache key must not
    // depend on the shader instance.
    material.customProgramCacheKey = () => "modern-vegetation-growth-v1";
    material.needsUpdate = true;
    materials.push(material);
    return material;
  };

  // The shadow pass needs the identical displacement, or trees cast shadows
  // before they exist. One depth material serves all three instanced meshes.
  const depth = attach(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 1.0);

  const trunkGeometry = new THREE.CylinderGeometry(0.62, 1, 1, 7);
  trunkGeometry.translate(0, 0.5, 0);
  const canopyGeometry = new THREE.IcosahedronGeometry(1, 1);
  const hedgeGeometry = new THREE.BoxGeometry(1, 1, 1);
  // Sway weight per vertex: 0 at the ground, 1 at the tip. Baking it into the
  // geometry keeps the shader ignorant of which mesh it is drawing.
  addAnchor(trunkGeometry, (y) => y);
  addAnchor(canopyGeometry, (y) => THREE.MathUtils.clamp((y + 1) * 0.5, 0, 1));
  addAnchor(hedgeGeometry, (y) => THREE.MathUtils.clamp(y + 0.5, 0, 1));

  // Each instanced mesh needs its own per-instance start times, sized to its own
  // instance count.
  const trunkStarts = new THREE.InstancedBufferAttribute(new Float32Array(items.length), 1);
  const canopyStarts = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 2), 1);
  const hedgeStarts = new THREE.InstancedBufferAttribute(new Float32Array(hedges.length), 1);
  trunkGeometry.setAttribute("aStart", trunkStarts);
  canopyGeometry.setAttribute("aStart", canopyStarts);
  hedgeGeometry.setAttribute("aStart", hedgeStarts);

  const trunkMaterial = attach(new THREE.MeshStandardMaterial({ color: 0x6a5342, roughness: 0.92, metalness: 0, envMapIntensity: 0.25 }), 0.6);
  const canopyMaterial = attach(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0, flatShading: true, envMapIntensity: 0.3 }), 1.0);
  const hedgeMaterial = attach(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true, envMapIntensity: 0.25 }), 0.18);

  // --- instances ----------------------------------------------------------
  const trunk = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, items.length);
  // Two canopy blobs per tree reads as a crown rather than a lollipop.
  const canopy = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, items.length * 2);
  const hedge = new THREE.InstancedMesh(hedgeGeometry, hedgeMaterial, hedges.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  let canopyIndex = 0;

  items.forEach((item, index) => {
    quaternion.setFromAxisAngle(axis, item.rot);
    position.set(item.x, item.y, item.z);
    scale.set(item.trunkR, item.trunkH, item.trunkR);
    trunk.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    trunk.setColorAt(index, item.tint.clone().multiplyScalar(0.62));
    trunkStarts.setX(index, item.start);

    const blobs: [number, number, number, number, number][] = item.columnar
      ? [[0, item.trunkH + item.canopyR * 1.05, 0, 1, 0], [0, item.trunkH + item.canopyR * 2.0, 0, 0.72, 0.012]]
      : [[0, item.trunkH + item.canopyR * 0.72, 0, 1, 0], [item.canopyR * 0.55, item.trunkH + item.canopyR * 1.16, -item.canopyR * 0.32, 0.68, 0.010]];
    for (const [ox, oy, oz, r, delay] of blobs) {
      position.set(item.x + ox, item.y + oy, item.z + oz);
      scale.set(item.canopyR * r, item.canopyR * r * (item.columnar ? 1.35 : 1), item.canopyR * r);
      canopy.setMatrixAt(canopyIndex, matrix.compose(position, quaternion, scale));
      canopy.setColorAt(canopyIndex, item.tint);
      canopyStarts.setX(canopyIndex, item.start + delay);
      canopyIndex++;
    }
  });

  hedges.forEach((item, index) => {
    quaternion.setFromAxisAngle(axis, 0);
    position.set(item.x, item.y + item.h * 0.5, item.z);
    scale.set(1.5, item.h, item.len);
    hedge.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    hedge.setColorAt(index, item.tint);
    hedgeStarts.setX(index, item.start);
  });

  for (const mesh of [trunk, canopy, hedge]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The bounding volume is computed from un-grown matrices, so it is only
    // ever too large — but skip culling anyway, it is three draw calls.
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = depth;
    group.add(mesh);
  }
  trunkStarts.needsUpdate = true;
  canopyStarts.needsUpdate = true;
  hedgeStarts.needsUpdate = true;
  geometries.push(trunkGeometry, canopyGeometry, hedgeGeometry);

  return {
    group,
    dispose() {
      group.removeFromParent();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      depth.dispose();
    },
  };
}

/** Bake the sway weight into a vertex attribute. */
function addAnchor(geometry: THREE.BufferGeometry, weight: (y: number) => number) {
  const position = geometry.getAttribute("position");
  const anchor = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) anchor[i] = weight(position.getY(i));
  geometry.setAttribute("aAnchor", new THREE.BufferAttribute(anchor, 1));
}
