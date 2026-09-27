# 生长 · 现代建筑营造（starter）

一栋 12 层镜面玻璃塔楼从场地平整开始逐层长出来的可环视三维动画。这是
`threejs-modern-architecture` skill 附带的起步工程，自包含、无外部资源、
无 API key。

展陈版式是**满屏 3D + 浮层控件**：canvas 永远 100%×100%，说明文字是左侧磨砂
半透明卡片，右上角「时间 / 视角 / 重新建造」按钮组，底部播放条自带暗色 scrim。
支持**一天四时**（早晨 / 中午 / 黄昏 / 夜晚）切换，默认中午。

## 跑起来

```sh
npm ci
npm run dev          # 127.0.0.1:5173
npm run build        # tsc --noEmit && vite build
npm run preview      # 预览生产构建
```

需要 Node.js 22.13+。

## 它做了什么

| 机制 | 位置 |
| --- | --- |
| 按材质合批，每材质 1 个 draw call（1,599 块构件 → 18~29 个 draw call） | `src/structure/builder.ts` |
| 把建造时序烘进顶点属性的生长着色器（`aBuild` / `aOffset`），颜色与阴影共用同一段位移 | `builder.ts` `inject()` |
| 逐构件 emissive 爬升，「灯光依次点亮」由建成状态直接驱动 | `builder.ts` `rampedEmissive` + `tower.ts` `PHASE.lighting` |
| 一天四时预设：天空 stop + 五盏灯 + 曝光 + `interior` 室内灯光系数，换时只换 PMREM 不重建几何 | `structure/daylight.ts` + `TowerScene.tsx` `applyTime()` |
| 程序化 equirect 天空 → PMREM，同时当 `scene.background`（地平线永远在真实地平线） | `materials.ts` `createSkyEnvironment(sky, interior)` |
| `setInterior(f)` 统一缩放室内灯光（中午 0 = 楼是封闭体量，夜晚 1.1 = 内透成为主光源） | `materials.ts` |
| 清水混凝土板缝与拉杆孔、白色幕墙分缝、铝型材拉丝 | `materials.ts` |
| 每层三段式（楼板 → 竖梃 → 玻璃）、幕墙按方位角波次合拢 | `tower.ts` `storey()` |
| InstancedMesh 植被 + 逐实例生长 + 顶点风摆 | `structure/vegetation.ts` |
| 需求渲染 + 30 Hz 阴影节流 | `TowerScene.tsx` |

## 结构

```
src/
  App.tsx                 播放控制、时间轴、阶段标签、时间/视角按钮
  TowerScene.tsx          three.js 场景、applyTime()、相机预设、渲染循环、性能出口
  style.css               满屏展陈版式（与建筑外观无关）
  structure/
    builder.ts            合批 + 生长着色器 + emissive 爬升
    materials.ts          程序化现代材质库 + 四时天空环境贴图 + setInterior
    daylight.ts           一天四时预设表（天空 / 灯光 / 曝光 / 室内系数）
    tower.ts              体量常量、PHASE 时序总谱、单层构件、裙房、塔冠
    site.ts               场地、广场铺装、水池、灯柱、树位
    vegetation.ts         实例化植被 + 风摆
    rng.ts                确定性随机
```

## 改哪里

- **改体量**（层数 / 层高 / 半宽）→ `tower.ts` 顶部的 `PODIUM` / `TOWER` / `FLOOR_H` / `FLOORS`，
  同时要更新 `TowerScene.tsx` 的四个相机预设。
- **改时序** → `tower.ts` 的 `PHASE`，并同步 `App.tsx` 的 `STAGES`（后者只是显示）。
- **改配色** → `materials.ts` 的 `PALETTE`。
- **改某个时辰的观感** → `daylight.ts` 对应预设。注意四项要成套改：天空 stop、五盏灯、
  曝光、`interior`。天空 stop 的位置必须落在相机可见的 v 区间内（本工程约 0.37–0.62），
  不要凭眼睛挪。

细节见 skill 的 `references/`。

## 已测指标

1440×900 / dpr 1 / Chrome，`data-render-stats` 实测：

- 完工静止（全景）：29 draw calls、57,068 triangles、1,599 pieces、123 植被实例、
  60 FPS，且 `renderFps: 0` + `idle: true`（静止时彻底不再渲染）
- 幕墙细部机位：17 draw calls、32,708 triangles（视锥剔除生效）
- 四时切换全程控制台零 error 零 warning；`textures` 数量不变（旧天空贴图被正确 dispose）
- `npx tsc --noEmit` 干净；`npm run build` 通过

> 换了体量或材质后这些数字都会变，**重新测一遍再写进文档**，不要沿用旧值。

## 注意

- 场景单位是**米**（层高 3.6、行道树 ≈ 9）。改构件尺寸时请顺手核对参照物，"建筑像玩具"几乎总是植被或道具缩小了。
- 所有"随机"必须是索引的纯函数。**不要在几何代码里用 `Math.random()`**，否则回拖时间轴会得到另一栋楼。
- 换时辰时 `applyTime` 里「先赋值后 dispose」的顺序、`appliedTime` 回写、`needsFrame = true`
  三处都不能动——各有对应的翻车模式（黑帧一闪 / 默认时辰失效 / 暂停时切换无反应）。
