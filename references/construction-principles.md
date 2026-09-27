# 构造原理：合批、生长着色器、时序编排

## 1. 分材质合批（`builder.ts`）

一栋 12 层塔楼的构件清单大致是：

| 构件 | 每层 | 12 层合计 |
| --- | --- | --- |
| 楼板带 | 1 | 12 |
| 混凝土竖肋 | 6 | 72 |
| 铝型材竖梃 | ~40 | 480 |
| 幕墙玻璃扇 | ~40 | 480 |
| 角柱 | 4 | 48 |
| 发光片 | 4 | 48 |
| 合成梁 / 内衬 / 女儿墙 / 塔冠 / 桅杆 / 景观 | — | ~350 |

**1500+ 块构件，如果不合批就是 1500+ 个 draw call。** 按材质归桶、用 `mergeGeometries` 合并后，**每种材质 1 个 Mesh**。本模板实测 **17~28 个 draw call**（17 = 材质数，多出来的在施工中期出现，因为部分材质的桶在早期还不存在）。

```ts
// add(): 把几何烘焙到世界空间，写入 aBuild / aOffset / color 三个顶点属性
const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
g.applyMatrix4(this.transform.matrix);          // 合批后 Mesh 保持单位矩阵
...
g.setAttribute("aBuild", new THREE.BufferAttribute(schedule, 3));
g.setAttribute("aOffset", new THREE.BufferAttribute(offset, 3));
g.setAttribute("color", new THREE.BufferAttribute(color, 3));
```

要点：

- **顶点属性只能有 position / normal / uv / aBuild / aOffset / color**，其它一律删掉，否则 `mergeGeometries` 会因为属性集合不一致而失败。
- **`color` 属性承担"廉价 AO"**：法线朝下的顶点乘 0.74，朝上的乘 1。这样楼板底面、檐口下缘自然变暗，不用开 SSAO。
- **UV 抖动防重复**：每个 piece 的 uv 偏移 `variation(pieces)`，同一块混凝土衬板/铺装不会出现完全一样的纹理。白墙板例外（`NO_UV_JITTER`），分缝必须对齐。

## 2. 生长着色器（本 skill 的核心）

每个顶点携带：

```glsl
// aBuild  = vec3(start, duration, lift)
// aOffset = vec3(x, y, z) 位移方向（默认 0,1,0）
float buildT = clamp((uBuildProgress - aBuild.x) / max(.0001, aBuild.y), 0.0, 1.0);
vConstruction = buildT;
float arrive = pow(1.0 - buildT, 3.0);                              // 三次缓出
float thud   = sin(buildT * 6.2831853) * pow(1.0 - buildT, 2.0) * 0.035;  // 一次阻尼回弹
transformed += aOffset * aBuild.z * (arrive - thud);
```

fragment 里 `if (vConstruction <= 0.0) discard;`

四条不能忘的规则：

1. **构件永远不透明、永远实体，只做位移。** 不要用 `opacity` 淡入 —— 那是溶解，不是施工。
2. **`aOffset` 让"落位方向"成为设计变量。** 楼板 `[0,1,0]` + lift 1.4 是"从上方落下"；幕墙玻璃 `[0.25,1,0.75]` 是"从外侧斜向上滑入"。这个 0.75 的外向分量就是"玻璃扇凑到楼前"的手感来源。
3. **阴影深度材质必须注入同一段位移。** 否则未建成的构件会提前投影：
   ```ts
   const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
   inject(depth, null);
   mesh.customDepthMaterial = depth;
   ```
4. **只要 shader 源码不同，`customProgramCacheKey` 就必须不同。** 本模板有两种变体（普通 / 带 emissive 爬升），键值分别是 `modern-solid-assembly-v1` 和 `modern-solid-assembly-ramp-v1`。偷懒返回常量会让两个变体共用同一个 program，表现成"灯光完全不亮"。

### `duration` 的单位是 progress，不是秒

`duration = 0.02` 表示占整个时间轴 2%。总时长 16 s 时，一块构件约 **0.32 s** 到位。层数多时先算预算：`(tower_span / 层数) × 0.84` 要大于三段式的总时长，否则每层还没建完下一层就开始了。

## 3. 逐实例生长 + 顶点风摆（`vegetation.ts`）

植被不能用合批（每棵位置/比例都不同），走 InstancedMesh：

- **每个 InstancedMesh 一份 `aStart` 缓冲，长度 = 该 mesh 的实例数。** 三个 mesh 共用几何就会踩到"缓冲长度对不上"的坑：树干 33 实例、树冠 66 实例、绿篱 30 实例，各写各的。
- **`aAnchor` 是逐顶点的摆动权重**（根部 0、梢部 1），烘到几何里，shader 不需要知道自己在画哪棵。
- **相位必须来自世界坐标** `instanceMatrix[3].xz`，不能用 `instanceId`：后者会让整排树同频抖动，看起来像贴图坏了。
- **生长 = 在自身原点缩放** `transformed *= mix(0.001, 1.0, grow)`：树干几何已平移到 y∈[0,1]，所以是从地里长出来；树冠几何居中，所以是"张开"。
- **风摆和阴影共用一份深度材质**，同样注入 `aOffset` 之外的同一段位移，否则未长出的树会投影。

## 4. 时序编排（`tower.ts` 的 `PHASE`）

```
site       0.000 - 0.080   场地与基座
podium     0.050 - 0.180   裙房结构
podiumGlz  0.150 - 0.260   裙房幕墙与大堂
core       0.200 - 0.500   核心筒爬升（16 段连续爬升）
tower      0.270 - 0.760   标准层（12 层，每层三段式）
roof       0.735 - 0.845   屋顶与女儿墙
crown      0.820 - 0.910   塔冠与桅杆
landscape  0.855 - 0.945   景观与水池
lighting   0.920 - 0.998   灯光依次点亮
```

**重叠是刻意的。** 真实工地边浇核心筒边收裙房；不重叠会像幻灯片。但仍要满足两条：

- **承重先于被承重**：楼板带必须早于它上面那层的玻璃。
- **上层楼板要落在下层结构上**：`storey()` 里楼板同时是下一层的天花，未装幕墙的楼层永远"有顶有底"。

### 每层三段式

```ts
const u = (index + 1) / FLOORS;
const slabStart  = lerp(span[0], span[1], u * 0.84);
const frameStart = slabStart + 0.011;   // 竖肋 / 竖梃 / 角柱
const glassStart = slabStart + 0.020;   // 玻璃扇
```

### 幕墙波次生长

`u * 0.84` 里的 0.84 留出 16% 给最后一块玻璃收尾。更进一步，把每块玻璃的 `start` 加上它绕塔轴的方位角分数：

```ts
const start = glassStart + sweep(face.axis === "z" ? t : plane, face.axis === "z" ? plane : t) * 0.005;
```

`t` 是沿面的坐标，`plane` 是该面的法向坐标，合起来就是世界坐标 → 玻璃会**绕楼旋转着合拢**。这是全片最抓眼的一秒，别省。

## 5. 灯光：逐块爬升的 emissive 斜坡

镜面玻璃是不透明的，室内灯看不见。解法是**给每面开一条中缝灯槽**：

1. `mullionRange()` 强制**奇数分格**，于是每个面都有一个正好落在自身轴线上（`t = 0`）的玻璃扇。
2. 那一扇换成 `glassClear`（通透玻璃），后面 0.7 m 放一块比窗扇窄的 `glow` 发光片。
3. **发光片的 `start` 排进 `lighting` 窗口，并按层号错开** → 灯光从裙房一层层爬到塔冠。

关键在于**一块材质也能做出逐块点亮的时序**：在 `builder.finish()` 里给注册过的表面追加

```ts
fragment.replace(
  "#include <emissivemap_fragment>",
  "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= smoothstep(0.35, 1.0, vConstruction);",
)
```

`vConstruction` 本来就是该 piece 的建造进度，于是"建成"直接驱动"点亮"。比一个全局 uniform 可控得多，比室内点光源便宜得多（点光源会被楼板天花整块吃掉）。

> ⚠️ **`emissiveIntensity` 要留在 1 附近（本模板用 1.05）。**
> 到 2.2 时 ACES tone mapping 会把暖色直接压成纯白，灯槽读起来像"白色竖肋"而不是窗光——
> 而且缩略图下极难发现。见 `verification.md` 的排查记录。

## 6. 渲染循环：需求渲染 + 阴影节流

```ts
renderer.shadowMap.autoUpdate = false;   // 场景里除了施工进度没有任何东西会动
...
const shadowChanged = lastShadowProgress !== progressRef.current &&
  (now - lastShadowTime >= 1000 / 30 || progressRef.current === 0 || progressRef.current === 1);
if (!document.hidden && (needsFrame || cameraChanged || transition || progressChanged || shadowChanged)) {
  if (shadowChanged) { renderer.shadowMap.needsUpdate = true; ... }
  renderer.render(scene, camera);
  needsFrame = false; lastProgress = progressRef.current;
}
```

- 静止时 `renderer.info.render.*` 不再增长（`data-render-stats` 里 `idle: true`、`renderFps: 0`）。
- 施工期间阴影最多 30 Hz；**回拖和终帧立刻刷**，否则拖到中间会看到上一帧姿态的影子。
- 同时渲染的颜色 pass 与 shadow pass 用的是同一段位移，所以永远不会出现"影子先到位"。

> three 0.185 起 `THREE.PCFSoftShadowMap` 已废弃（会静默降级并打警告）。直接用 `THREE.PCFShadowMap`，柔和度靠 `mapSize` 和 `shadow.normalBias` 调。

## 7. 动画无关的稳定性要求

- 所有"随机"必须是索引的纯函数（`variation(n)` / `makeRandom(seed)`），**几何代码里禁止 `Math.random()`**，否则回拖时间轴会得到另一栋楼。
- 组件卸载时把 geometry / material / texture / environment / shadow map 全走一遍 `dispose()`，否则 React 严格模式下会残留一整套 GPU 资源。
