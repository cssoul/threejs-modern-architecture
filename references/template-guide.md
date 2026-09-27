# 模板地图与改造顺序

## 环境

需要 Node.js 22.13+、npm、支持 WebGL2 的浏览器。依赖版本已锁定，首次安装需要网络。不需要 API key、不需要任何外部模型服务。

```sh
node <this-skill-dir>/scripts/scaffold.mjs /path/to/my-tower
cd /path/to/my-tower
npm ci
npm run dev
```

开发服务器默认监听 `127.0.0.1:5173`。生产检查：`npm run build`，然后 `npm run preview`。端口被占时看终端实际输出的地址；starter 自带 `package-lock.json`，优先用 `npm ci` 保持版本锁定。

> 端口冲突提示：vite 可能只绑定到 IPv6 的 `[::1]`，此时 `http://127.0.0.1:5173` 会 `ERR_CONNECTION_REFUSED`，而 `http://localhost:5173` 通。用 `lsof -nP -iTCP:5173 -sTCP:LISTEN` 确认到底是哪个进程在听，别把别的项目的服务器当成自己的。

## 文件职责

| 文件 | 什么时候改 |
| --- | --- |
| `src/App.tsx` | 播放/暂停、时间轴、阶段名与阶段边界、时间与视角按钮、文案 |
| `src/TowerScene.tsx` | `applyTime()` 四时写入点、相机预设、OrbitControls、阴影节流、需求渲染、dispose、渲染统计出口 |
| `src/structure/tower.ts` | **体量常量**（`PODIUM` / `TOWER` / `FLOOR_H` / `FLOORS`）、`PHASE` 时序总谱、`storey()` 单层构件、裙房、屋顶、塔冠、桅杆 |
| `src/structure/daylight.ts` | 一天四时的**预设表**：天空 stop + 光晕 + 云带、五盏灯、曝光、环境强度、`interior` 室内灯光系数 |
| `src/structure/site.ts` | 场地大板、广场铺装、水池、台阶、灯柱、树位 `TREE_SPOTS` |
| `src/structure/vegetation.ts` | InstancedMesh 植被、逐实例生长、顶点风摆、绿篱 |
| `src/structure/materials.ts` | 表面清单与色板、程序化 canvas 纹理、`createSkyEnvironment(sky, interior)`、`setInterior(f)`、玻璃/水面/发光材质 |
| `src/structure/builder.ts` | 几何缓存、合批、逐构件时序、`aBuild`/`aOffset`/`color` 顶点属性、生长着色器、emissive 爬升 |
| `src/structure/rng.ts` | 确定性随机（`variation` / `makeRandom` / `smoothstep`） |
| `src/style.css` | 展陈版式（满屏画布 + 浮层卡片 + 浮层控件，见 SKILL.md）与窄屏适配，**不要**在这里改建筑外观 |

组件 props：`progress`（0–1）、`view`（`overview` / `facade` / `crown` / `plaza`）、`time`
（`morning` / `noon` / `dusk` / `night`，默认 `DEFAULT_TIME`）、`onReady`。

## 展陈版式

满屏 3D + 浮层控件，规则见 SKILL.md 的「展陈版式」一节。要点：`.poster` fixed 满屏、
canvas `inset:0` 永远 100%×100%、说明卡片磨砂半透明垂直居中、右上角按钮组、底部播放条
自带暗色 scrim、阶段读数折进卡片脚注。**不要**回退成"页眉 + 内嵌画框 + 右侧竖排标题"的
纸面版式。

## 一天四时

- 预设住在 `daylight.ts`，`applyTime(id)`（TowerScene 内）是唯一写入点：换时 = 重建天空
  PMREM + 重写灯与标量 + `setInterior(f)`，**不重建几何**。
- 切换时先把 `scene.background` / `scene.environment` 指向新资源，**再** dispose 旧的——
  反过来会有一帧采到已删除的贴图。
- `appliedTime` 守卫必须在应用后回写，否则切回**默认时辰**会静默失效（其它时辰照常，
  极难发现）。
- 换时要 `needsFrame = true`：时间轴通常停着，需求渲染不会自己醒。
- 四时的区别必须**成套**：天空 + 五盏灯 + 曝光 + `interior` 一起换。只换天空不换灯，
  会得到"贴着黄昏壁纸的正午场景"。

## 关键常量

```
PODIUM = { hx: 15, hz: 11, h: 8.0, plinth: 0.6 }   // 裙房半宽/半进深/层高/台基
TOWER  = { hx: 9, hz: 7.5 }                        // 塔楼半宽/半进深
FLOOR_H = 3.6      FLOORS = 12                     // 层高 / 层数
SLAB_OVER = 0.42   // 楼板带外挑
GLASS_IN  = 0.30   // 幕墙相对结构面内收
BAY       = 1.8    // 目标分格宽度（实际会被规整成奇数格）
BASE_Y  = 台基 + 裙房 + 0.8 = 9.4                  // 塔楼首层楼面
ROOF_Y  = BASE_Y + FLOORS × FLOOR_H = 52.6
TOP_Y   = ROOF_Y + 10.0 = 62.6                     // 含桅杆
```

栈高约 **62.6 世界单位**（1 单位 = 1 米）。**不要**把场景单位当成"任意单位"随手改文案——本模板的套内比例（层高 3.6、行道树 9、灯柱 1.4）是按米写的。

## 改造顺序

1. **先把模板完整跑起来**，截下全景 / 幕墙细部 / 塔冠 / 裙房广场四张图作为基线。改完之后要能对着比。
2. **改色板、标题、总时长。** 时间轴一律归一到 0–1。
3. **改体量。** 层数、层高、塔楼半宽任改其一，必须同步：`storey()` 循环、慕墙分格、角柱、竖肋、楼板带外挑、女儿墙、塔冠、桅杆高度、`TOP_Y`、`TowerScene.tsx` 的四个相机预设、`App.tsx` 里 `FLOORS` 的文案。**这些常量是显式设计常量，不是自动 N 层系统。**
4. **换风格要一个一个构件换。** 保留"逐块码放 + 位移落位 + 阴影同步"的骨架，只替换工厂函数：把幕墙换成砖墙、把楼板带换成腰线、把塔冠换成坡屋顶。别推翻 builder。
5. **阶段名只是显示。** 真正的时序住在 `tower.ts` 的 `PHASE` 里。改了 `PHASE` 必须同改 `App.tsx` 的 `STAGES` 数组，否则标签会与画面错位。
6. **删构件要连它的相机一起删。** 去掉塔冠就删掉 `crown` 预设和对应的按钮，否则按钮指向空处。

## 新增一种表面

1. 在 `materials.ts` 的 `SurfaceName` 联合类型里加名字；
2. 在 `PALETTE` 里给基色，在 `FEATURE` 里选纹理特征（`boardform` / `paneljoint` / `brushed` / `slats` / `foliage` / `gravel` / `speckle`）或走特殊分支（像 `glass` / `water` / `glow` 那样 `continue`）；
3. 如果是薄件或不受光件，加进 `NO_CAST` / `NO_RECEIVE`；
4. 分缝必须对齐的（白墙板之类）加进 `NO_UV_JITTER`。

**新增一种材质 = 新增一个 draw call。** 想控制 draw call 就收窄表面清单，不要随手加。

## 示例请求

- "用这个 skill 做一栋 20 层的玻璃写字楼，白色楼板带，逐层长出，幕墙绕楼合拢，最后灯光从下往上点亮。"
- "保持现在的塔楼和相机，只把幕墙换成砖墙 + 条窗，楼板带改成深色腰线。不要换掉生长动画。"
- "把模板改成三层美术馆：大面积清水混凝土 + 一条长玻璃缝，不要塔楼，不要桅杆。"
- "把设备层从第 7 层移到第 15 层，并把它的玻璃换成深色百叶。"
- "参考这张黄昏街景照片做一座商业综合体：白色石材裙房 + 暖光中庭 + 深色玻璃塔楼 + 竖排招牌 + 街道车流，保留生长动画与四时切换。"

模板里已经包含源码。不要把创作者本机的服务器依赖、导出转储或私有配置复制进产出。
