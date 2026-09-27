# 现代材质体系

全部程序化：没有任何图片文件、没有网络请求，同一份 seed 永远得到同一面墙。

## 0. 纹理尺度契约（先读这条，否则后面全是错的）

`builder.box()` 在 `min(size) >= 0.18` 时走 `ExtrudeGeometry`，而 Extrude 的默认 UV 生成器返回**世界单位坐标**（顶底盖返回 shape 的 x/y，侧壁返回 x/y/z 中的一个）。于是：

> **1 个纹理 tile = 1 个世界单位 ≈ 1 米。1024 px 的画布上，每 256 px 画一条板缝 = 每 25 cm 一道缝。**

好处：宽 60 cm 的合成梁和宽 20 m 的楼板带上，混凝土板缝的**实际间距一致**。这条不成立（比如各处随手 `repeat.set`），构件之间就会出现"大字报"和"蚊蝇腿"混杂的质感。

小于 0.18 的薄件（幕墙玻璃扇、竖梃、发光片）走普通 `BoxGeometry`，UV 是 0..1 —— 但它们**不带 map**，所以无所谓。
例外：混凝土/白墙这类 UV 敏感材质请务必用「≥0.18 的尺寸」，别用薄板拼。

## 1. 表面清单与色板

| 表面 | 用途 | 基色 | 关键参数 |
| --- | --- | --- | --- |
| `concrete` | 柱、竖肋、核心筒、裙房墙 | `#c5c2ba` | roughness .94 / env .30 |
| `concreteDeep` | 室内楼板底、背光面 | `#8f8d87` | 同上 + 顶点色 `shade: .72~.8` |
| `white` | 楼板外挑带、女儿墙、雨篷 | `#e8e6e0` | roughness .94 / env .42 / **不做 UV 抖动** |
| `mullion` | 铝型材竖梃 / 横梁 | `#b4b9be` | metalness **.92** / roughness .30 / env 1.0 |
| `steel` | 结构钢、雨篷柱、桅杆、灯柱 | `#6d7175` | metalness .78 / roughness .54 / env .75 |
| `stone` | 花岗岩铺装 | `#b6b1a6` | roughness .62 |
| `paving` | 场地 / 大地面 | `#9d988f` | roughness .94 |
| `roof` | 屋面砾石 | `#a9a59d` | bumpScale .030 |
| `wood` | 大堂木饰面 | `#c49a6a` | 板条纹理，bumpScale .016 |
| `glass` | 立面镜面玻璃 | `#8fadc6` | 见 §2 |
| `glassDeep` | 深色玻璃、设备层 | `#42545f` | 见 §2 |
| `glassClear` | 大堂 / 灯槽通透玻璃 | `#bccdd8` | opacity .42 |
| `glow` | 室内灯 / 灯柱 / 航空障碍灯 | `#4a4034` + emissive `#ffd2a0` | emissiveIntensity **1.05** |
| `planting` / `lawn` | 灌木 / 绿屋顶 | `#4d6a3c` / `#6f8a52` | |
| `water` | 镜面水池 | `#1e3f4e` | roughness .09 / metalness .12 / env .65 |

## 2. 玻璃：为什么用**不透明**镜面

```ts
output.glass = new THREE.MeshPhysicalMaterial({
  color: "#8fadc6", metalness: 0.88, roughness: 0.055,
  envMapIntensity: 1.45, clearcoat: 1, clearcoatRoughness: 0.04, vertexColors: true,
});
```

三个理由，缺一不可：

1. **建筑尺度上真实镀膜玻璃本来接近镜面。** 参数越"物理透明"，越容易读成塑料盒。
2. **不透明彻底绕开透明排序。** 一栋楼有约 500 块玻璃扇，合并成一个 Mesh 之后 three 只能按 Mesh 排序，扇与扇之间没有逐三角排序；透明化必然出现"远端立面压住近端"的错乱。不透明则完全无此问题。
3. **施工叙事不需要它透明。** "幕墙没上之前你看到的是裸混凝土楼板 + 角柱 + 竖梃"，这个对比比隔着玻璃看室内强得多。

**唯一需要通透的地方**是每面中缝的灯槽（见 `construction-principles.md` §5）与大堂幕墙：用 `glassClear`（opacity .42），面积很小，排序风险可以忽略。

透视玻璃扇用**薄盒 + 默认 `FrontSide`**：从外面只看得到本侧立面的玻璃，远端立面的背面被剔除，天然不会压近端。

### 环境贴图才是玻璃的灵魂

```ts
export function createSkyEnvironment(renderer: THREE.WebGLRenderer) {
  // 1024×512 canvas：天顶 → 地平线 → 地面 的硬渐变 + 太阳斑 + 几条云带
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(texture);
  pmrem.dispose(); texture.dispose();
  return environment;
}
```

**一条硬地平线是全部关键。** 用 `RoomEnvironment` 或纯色环境，玻璃只会得到一片死板的灰面；有地平线 + 太阳斑 + 云带之后，玻璃才会出现"上下分界、随视角流动"的反射，一眼就是玻璃。

#### 这张天空要不要同时当背景？一律要

| 场景 | 做法 |
| --- | --- |
| ~~白昼 / 天空大面积且均匀~~ | ~~`alpha: true` + 页面 CSS 渐变，环境贴图只管反射~~ **已废弃** |
| 任何时刻（starter 四时统一走这条路） | **`scene.background = sky`** |

旧版 starter 曾把白昼背景交给 CSS 渐变，理由是省一次全屏 draw。这个做法在引入「一天四时」后
变成负资产：页面上那张 CSS 渐变是死的，而天空每换一次时辰就要换一张，两套背景必然漂移；
而且地平线落在画面里的**哪一行由相机俯角决定**，CSS 的固定渐变根本对不上——俯角一变，
CSS 的地平线就和几何的地平线错开，天空与地面之间出现一条谁也对不上的缝。把天空交给
three.js，地平线自动落在真实地平线上，换时辰也只是换一张 `scene.background`。

同一份 canvas 先 `pmrem.fromEquirectangular()` 得到环境，**再**保留原 texture 当 background，
不要 `dispose()` 掉它。换时辰时**先赋值、后 dispose** 旧的两个资源，反过来会有一帧采到已删除
的贴图，黑屏一闪。

#### 三个反直觉的坑（多时辰场景必踩）

**1. 渐变 stop 的位置由相机决定，不能凭眼睛调。**

先算相机到底能看见哪一段 v，再定 stop。equirect 的 `v = 0.5 − 仰角/180`，而可见区间
由**俯角 + 竖直 fov + 地面尺寸**三者共同决定。例：俯角 4.5°、竖直 fov 34°、地面
240 单位见方时，天空只占 **v ∈ [0.43, 0.55]**，也就是地平线以上约 12°。

把暖色带铺在 0.44–0.56 曾让幕墙从头到脚反射琥珀色，"深蓝绿玻璃"完全读不出来——不是
配色错，是暖色带正好等于整个可见天空。**蓝色必须压到接近 0.49。**

判断方法：肉眼觉得"暖色占了半个画面"时，先用 PIL 逐行采样算出暖区的真实起点/宽度，
再决定是挪 stop 还是降饱和度。面积问题靠挪，饱和度问题靠调色——这两件事经常被
混为一谈。

**2. 画在 equirect 上的圆形渐变，在竖直方向会被放大 2 倍。**

1024×512 是 2:1，所以 1 px 宽度 ≈ 0.35° 方位角，而 1 px 高度 ≈ 0.35° 仰角——一个
圆形径向渐变画上去其实是对的。但人们习惯按"宽度"给半径：半径 230 px 看着只占宽度
的 22%，**在高度上却占了 45%（≈81° 仰角）**，整片天都被点亮。

要得到"地平线上一个约 18° 的光穹"，得显式压扁：

```ts
ctx.save();
ctx.translate(0, 258); ctx.scale(1, 0.22); ctx.translate(0, -258);
ctx.fillStyle = pool;
ctx.fillRect(0, 258 - spread * 0.22 - 4, 1024, spread * 0.44 + 8);
ctx.restore();
```

云带本来就用 `ctx.scale(1, h / w)` 压扁了，规则是同一个；太阳斑常常漏掉，170 px 的
太阳在竖直方向等于 60° 仰角。

#### 黄昏布光：暖光要"少于"直觉

暖光（轮廓光 + 街面反弹）的强度要**明显低于**冷色主光，否则白色石材、白色幕墙会整体
偏米黄，"冷调外立面 vs 暖调内透光"的张力就没了。参照值：冷色 key 0.66 / 冷色 fill
0.34 / 半球光 0.38，而暖色轮廓光 0.42、暖色街面反弹 0.26。暖光的作用是**只染到近地面
和室内**，不是照亮整栋楼。

#### 夜晚布光：环境是最容易翻车的一项

夜晚的建筑几乎没有直射光，材质的亮度大头来自 `scene.environmentIntensity × envMapIntensity`
——也就是说**夜空本身成了主光源**。两个直接后果：

1. 夜空地平线的颜色会被"刷"到所有立面上。偏紫的 stop（如 `#57485a`）会把白色石材染成
   品红（实测 `rgb(61,43,48)`：G 同时低于 R 和 B）。**判据：石材像素的 G 必须落在 R 与 B
   之间**——暖褐（如 `#5c4a3e`）才是城市光晕该有的颜色。
2. 夜晚的 `environmentIntensity` 要压到 0.45 左右（黄昏 0.86、正午 0.92），不然整栋楼被
   地平线光晕平涂，窗的内透反而读不出来。夜晚变暗靠**压环境**，不是推高 emissive。

四时的完整预设（早晨 / 中午 / 黄昏 / 夜晚的天空 stop、五盏灯、曝光、`interior` 系数）
见 `structure/daylight.ts`——它本身就是一份"每个时辰该是什么样"的参照答案。

`scene.environmentIntensity = 0.55` 与各材质自己的 `envMapIntensity` 相乘，所以混凝土几乎不反光（.30），铝型材明显反光（1.0）。

## 3. 清水混凝土：板缝 + 拉杆孔

`boardform` 特征，1024 px = 1 m：

- 每 256 px 一条 `rgba(58,55,50,.20)` 板缝（2 px 深色 + 1.5 px 亮边）→ 每 25 cm 一道，是木模板的尺度。
- 每 256 px 一个拉杆孔（半径 6 px ≈ 6 mm 的视觉量级），深色孔 + 左上高光。
- 板缝以下的**竖向雨痕**：`createLinearGradient` 从有到无，不要画成重复的圆形污渍 —— 圆形污渍是最像"贴图而不是混凝土"的一处败笔。

`white` 的 `paneljoint` 只有**竖缝**（每 1 tile 一道），因为楼板带高仅 0.34 单位，横缝会随机切在带子中间。

## 4. 金属与屋面

- `mullion` / `steel`：`brushed` 特征 = 上千条细竖纹，宽度 0.5~1.9 px，明暗交错。别用贴图噪点代替，金属的"拉丝"必须是有方向的长条。
- `roof` 砾石：1500 个小圆斑（半径 1~6 px），比 `stone` 的花岗岩斑点更粗更杂。

## 5. 灯光与色调

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
```

| 灯 | 值 | 作用 |
| --- | --- | --- |
| HemisphereLight | `0xdfe8f2` / `0x6f6a60`, 强度 .50 | 天光/地面反弹，托住背光面 |
| DirectionalLight "key" | `0xfff4e6`, 2.30, `(-52, 96, 60)` | 唯一投影光源；`shadow.camera` ±60，`mapSize` 3072，`normalBias .06` |
| DirectionalLight "fill" | `0xe6eef4`, 0.45, `(70, 34, -16)` | 补另一侧 |
| DirectionalLight "rim" | `0xfff2de`, 0.75, `(-26, 26, -72)` | **给镜面玻璃打轮廓光**；没有它，主光打不到的立面会变成死黑 |

- **影棚式布光 + 环境贴图**，不要用雾、泛光或提高曝光来"提质感"。
- 阴影 `mapSize 3072 / 半幅 60` → 每个 texel ≈ 0.039 世界单位，比屏幕上的一像素还细，足够锐。
- ACES 会压暗中间调，所以材质基色要比"看起来对"的更亮一档。

## 6. 铺装：**不要做高对比棋盘**

第一版把广场做成 `stone` / `paving` 两种材质交替的 4×4 米棋盘，结果整片广场渲染成黑白棋盘格，微缩感全毁。改成：

```ts
b.box([4, 0.28, 4], [cx, 0.14, cz], "stone", start, { shade: (i + j) % 2 === 0 ? 1 : 0.9 });
```

**同一种材质 + 10% 顶点色差**，才是花岗岩大板铺装该有的样子，而且顺带把广场降到 1 个 draw call。

## 7. 水池

近乎镜面的水平面 + 明亮天空环境 = 反射天顶的**亮白**面。第一版水面渲染成了发白的浅灰，完全不像水。修法：

- 基色压暗到 `#1e3f4e`；
- `metalness` 从 0.30 降到 0.12，`envMapIntensity` 从 1.0 降到 0.65 —— 让它反光但不至于变成镜子；
- `bumpMap` 用一张贝塞尔波纹 canvas，运行时 `offset` 缓慢漂移，池面便有微弱的活气。

## 8. 尺度纪律：1 世界单位 = 1 米

最容易翻车、也最刺眼的一类 bug 是**道具比例与世界脱节**。本模板的参照系：

- 层高 3.6 → 12 层塔楼 62.6 高；塔楼半宽 9（长细比 ≈ 3.5）。
- **行道树 ≈ 9 单位高**（树干 4.0 + 树冠 3.1×1.7）。第一版把树做成 5.5 单位高，配上 62 高的塔楼，树像灌木丛——这是"建筑看起来像玩具"最常见的原因。
- 灯柱 1.1 + 灯头 0.3 ≈ 1.4；雨篷底 4.9；女儿墙 1.24。

自检话术：**"这棵行道树大概 9 米，那它应该是层高的几倍？"** 把答案写成显式常量并注释参照物，别让数字散落各处。
