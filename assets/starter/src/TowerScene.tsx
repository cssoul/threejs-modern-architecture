import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { StructureBuilder } from "./structure/builder";
import { createModernMaterials, createSkyEnvironment } from "./structure/materials";
import { DEFAULT_TIME, presetOf, type TimeId } from "./structure/daylight";
import { buildSite } from "./structure/site";
import { buildTower } from "./structure/tower";
import { buildVegetation, WIND_TIME } from "./structure/vegetation";

export type ViewId = "overview" | "facade" | "crown" | "plaza";
type Props = { progress: number; view?: ViewId; time?: TimeId; onReady?: () => void };

const PRESETS: Record<ViewId, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  overview: { position: new THREE.Vector3(64, 42, 88), target: new THREE.Vector3(0, 30, 3) },
  facade: { position: new THREE.Vector3(30, 42, 36), target: new THREE.Vector3(0, 38, 0) },
  crown: { position: new THREE.Vector3(19, 78, 42), target: new THREE.Vector3(0, 57, -2) },
  plaza: { position: new THREE.Vector3(28, 9, 44), target: new THREE.Vector3(0, 5, 8) },
};

export default function TowerScene({ progress, view = "overview", time = DEFAULT_TIME, onReady }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  const viewRef = useRef(view);
  const timeRef = useRef(time);
  const readyRef = useRef(onReady);
  const applyTimeRef = useRef<((id: TimeId) => void) | null>(null);
  /** Which hour the live scene is currently dressed in. Guards the mount pass. */
  const appliedTime = useRef<TimeId | null>(null);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);

  // Re-dress the scene whenever the hour changes. The scene is built once and
  // never rebuilt: `applyTime` only swaps the sky pair and rewrites the lamps
  // and a few scalars, so switching hour costs one PMREM pass, not a rebuild.
  useEffect(() => {
    timeRef.current = time;
    if (appliedTime.current === time) return;
    const apply = applyTimeRef.current;
    // Scene not built yet — the mount pass will dress it with `timeRef.current`.
    if (!apply) return;
    apply(time);
    // Forget to write this back and the guard above latches onto the *mount*
    // hour forever: every other hour still switches, but coming back to the
    // initial one silently does nothing.
    appliedTime.current = time;
  }, [time]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.2, 900);
    camera.position.copy(PRESETS.overview.position);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, window.innerWidth < 700 ? 1.5 : 2));
    // Transparent clear is only the fallback: `scene.background` (set by applyTime
    // below) paints over it. It keeps the canvas honest if the sky is ever taken out.
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in current three and silently falls back to
    // this anyway; the softness comes from the map resolution and normalBias.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Nothing in the scene moves except the construction, so shadows only need
    // to be re-rendered when the progress value actually changes.
    renderer.shadowMap.autoUpdate = false;
    mount.appendChild(renderer.domElement);

    // The sky, the exposure and every lamp are owned by `applyTime` further down;
    // the values passed to the constructors here are placeholders that are
    // overwritten before the first frame.

    const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x6f6a60, 0.5);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
    key.position.set(-52, 96, 60);
    key.castShadow = true;
    key.shadow.mapSize.set(3072, 3072);
    key.shadow.camera.left = -60; key.shadow.camera.right = 60;
    key.shadow.camera.top = 60; key.shadow.camera.bottom = -60;
    key.shadow.camera.near = 4; key.shadow.camera.far = 320;
    key.target.position.set(0, 26, 0);
    key.shadow.normalBias = 0.06;
    key.shadow.bias = -0.0002;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe6eef4, 0.45);
    fill.position.set(70, 34, -16);
    scene.add(fill);
    // Rim light rakes the glazing from behind: without it the mirror glass goes
    // flat black on the faces the key light misses.
    const rim = new THREE.DirectionalLight(0xfff2de, 0.75);
    rim.position.set(-26, 26, -72);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(PRESETS.overview.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 18;
    controls.maxDistance = 260;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI * 0.495;

    const materialKit = createModernMaterials(renderer);
    const builder = new StructureBuilder(materialKit.materials);
    // Register before finish(): emissive pieces then ramp up one by one on their
    // own schedule instead of all switching on together.
    builder.rampedEmissive.add("glow");
    buildSite(builder);
    buildTower(builder);
    builder.finish(scene);
    // The vegetation field rides the builder's progress object, so one scalar
    // still drives the entire scene.
    const vegetation = buildVegetation(builder.progress);
    scene.add(vegetation.group);

    const ripple = (materialKit.materials.water as THREE.MeshPhysicalMaterial).bumpMap;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastView: ViewId = "overview";
    let transition = false;
    let raf = 0;
    let lastNow = performance.now();
    let frames = 0, elapsed = 0, renderedFrames = 0, shadowUpdates = 0;
    let needsFrame = true, lastProgress = -2, lastShadowProgress = -2, lastShadowTime = -Infinity;

    const interrupt = () => { transition = false; };
    controls.addEventListener("start", interrupt);

    const resize = () => {
      const w = Math.max(1, mount.clientWidth), h = Math.max(1, mount.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Standing the camera back is not enough on a phone: open the lens instead.
      camera.fov = camera.aspect < 0.58 ? 42 : 34;
      camera.updateProjectionMatrix();
      needsFrame = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    builder.progress.value = progressRef.current;

    // ---- the hour -----------------------------------------------------------
    // Everything that differs between hours is written here and nowhere else, so
    // switching hour can never leave a stale lamp colour or exposure behind. The
    // scene itself is never rebuilt: a switch costs one PMREM pass plus a
    // handful of property writes. The starter ships a daylight sky; the four
    // presets live in `daylight.ts` and switching them is a one-line UI prop.
    const hour: { sky: THREE.Texture | null; env: THREE.WebGLRenderTarget | null } = { sky: null, env: null };

    const applyTime = (id: TimeId) => {
      const preset = presetOf(id);
      const next = createSkyEnvironment(renderer, preset.sky, preset.interior);
      // Assign first, dispose second. Dropping the texture that `scene.background`
      // still points at leaves one frame sampling a deleted object.
      scene.background = next.sky;
      scene.environment = next.environment.texture;
      if (hour.sky && hour.env) { hour.env.dispose(); hour.sky.dispose(); }
      hour.sky = next.sky;
      hour.env = next.environment;

      scene.backgroundIntensity = preset.backgroundIntensity;
      scene.environmentIntensity = preset.environmentIntensity;
      renderer.toneMappingExposure = preset.exposure;

      const { rig } = preset;
      hemi.color.set(rig.hemi.sky);
      hemi.groundColor.set(rig.hemi.ground);
      hemi.intensity = rig.hemi.intensity;
      key.color.set(rig.key.color);
      key.intensity = rig.key.intensity;
      key.position.set(...rig.key.position);
      fill.color.set(rig.fill.color);
      fill.intensity = rig.fill.intensity;
      rim.color.set(rig.rim.color);
      rim.intensity = rig.rim.intensity;

      // The half of "which hour is it" a sky cannot express: at noon the
      // building is a closed object, at night it is a lantern.
      materialKit.setInterior(preset.interior);

      // Re-arm the on-demand renderer — the hour is usually switched while the
      // timeline is paused, and a paused renderer would otherwise not draw.
      needsFrame = true;
    };

    applyTimeRef.current = applyTime;
    applyTime(timeRef.current);
    appliedTime.current = timeRef.current;
    renderer.compile(scene, camera);

    const render = (now: number) => {
      const frameSeconds = (now - lastNow) / 1000;
      const dt = Math.min(frameSeconds, 0.1);
      lastNow = now;
      builder.progress.value = progressRef.current;
      const seconds = now / 1000;
      if (!reducedMotion) {
        WIND_TIME.value = seconds;
        if (ripple) ripple.offset.set(seconds * 0.005, seconds * 0.0035);
      }

      if (lastView !== viewRef.current) { lastView = viewRef.current; transition = true; }
      if (transition) {
        const preset = PRESETS[lastView];
        const amount = reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
        camera.position.lerp(preset.position, amount);
        controls.target.lerp(preset.target, amount);
        if (camera.position.distanceTo(preset.position) < 0.04) transition = false;
      }

      const cameraChanged = controls.update();
      const progressChanged = lastProgress !== progressRef.current;
      // Construction shadows update at 30 Hz at most. Rewinds and the finished
      // pose flush immediately so a scrubbed frame is never wrong.
      const shadowChanged = lastShadowProgress !== progressRef.current &&
        (now - lastShadowTime >= 1000 / 30 || progressRef.current === 0 || progressRef.current === 1);

      if (!document.hidden && (needsFrame || cameraChanged || transition || progressChanged || shadowChanged)) {
        if (shadowChanged) {
          renderer.shadowMap.needsUpdate = true;
          lastShadowProgress = progressRef.current;
          lastShadowTime = now;
          shadowUpdates++;
        }
        renderer.render(scene, camera);
        renderedFrames++;
        needsFrame = false;
        lastProgress = progressRef.current;
      }

      frames++; elapsed += frameSeconds;
      if (elapsed > 0.6) {
        mount.dataset.renderStats = JSON.stringify({
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          pieces: builder.pieces,
          trees: vegetation.group.children.reduce((sum, child) => sum + (child as THREE.InstancedMesh).count, 0),
          fps: Math.round(frames / elapsed),
          renderFps: Math.round(renderedFrames / elapsed),
          shadowUpdatesPerSecond: Math.round(shadowUpdates / elapsed),
          idle: renderedFrames === 0,
          dpr: renderer.getPixelRatio(),
          postPasses: 0,
        });
        frames = 0; elapsed = 0; renderedFrames = 0; shadowUpdates = 0;
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    readyRef.current?.();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener("start", interrupt);
      controls.dispose();
      vegetation.dispose();
      builder.dispose();
      materialKit.dispose();
      // Only the pair currently in use is alive; `applyTime` already disposed the
      // ones it replaced.
      hour.env?.dispose();
      hour.sky?.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="three-scene" aria-label="可旋转的现代建筑逐层生长动画" />;
}
