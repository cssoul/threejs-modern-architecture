# 验证视觉产物

**`npm run build` 通过 ≠ 画面正确。** 这个 skill 的产出是视觉产物，只有截图能证明它对了。

## 0. 交付前必跑

```sh
npx tsc --noEmit     # 类型必须干净
npm run build        # 生产构建
```

再确认：控制台**在全新加载后**零 error 零 warning（HMR 期间的报错不算，但要能在 reload 后复现才算真 bug）。

## 1. 运行时指标出口

场景组件把统计写进 `mount.dataset.renderStats`，每 0.6 s 刷新：

```js
{ calls, triangles, geometries, textures, pieces, trees,
  fps, renderFps, shadowUpdatesPerSecond, idle, dpr, postPasses }
```

本模板实测（1440×900，dpr 1，Chrome）：

| 状态 | calls | triangles | pieces | trees | fps | renderFps | shadow/s | idle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **播放中** | 28 | 57,056 | 1,599 | 123 | 60 | 60 | 23 | false |
| **完工暂停** | 28 | 57,056 | 1,599 | 123 | 60 | **0** | 0 | **true** |

**`idle: true` + `renderFps: 0` 是需求渲染生效的证据** —— 暂停之后 GPU 完全不再空转。这一条必须保持。

> 注意：`renderFps: 0` 也可能只是"刚 seek 完还没到下一次统计窗口"。**判断需求渲染是否生效，要看暂停 3 秒后的读数**，不要在 seek 之后立刻下结论。

## 2. 用浏览器自动化验收

一键脚本（本 skill 自带，封装了下面所有的坑）：

```sh
bash <this-skill-dir>/scripts/shoot.sh <url> <progress-0-1000> <out.png> [width] [height]
# 例：
bash scripts/shoot.sh http://127.0.0.1:5199 560  /tmp/growth.png        # 生长中期（约 8/12 层）
bash scripts/shoot.sh http://127.0.0.1:5199 1000 /tmp/done.png 420 820  # 完工 + 窄屏
```

它会依次打印：`frame:`（延迟复核过的 `footer time` + 播放态）、`canvas rect:`（裁切用，含 dpr）、`data-render-stats`、
过滤后的控制台输出。脚本内已按上面的三段式发 eval，并自动隐藏 canvas 浮层。

手工等价操作：

```sh
agent-browser open http://127.0.0.1:5199/
agent-browser set viewport 1440 900
agent-browser screenshot /tmp/shot.png
agent-browser console                       # 过滤掉 [vite] connected
agent-browser close
```

### 四个必踩的坑

1. **`agent-browser eval` 复用同一个页面上下文**，第二次 `const s = ...` 会抛
   `SyntaxError: Identifier 's' has already been declared`。**一律用 IIFE 包起来**：

   ```js
   (()=>{ const el=document.querySelector('.timeline input'); ... ; return el.value; })()
   ```

   而且要看 eval 的返回值 —— 把输出重定向到 /dev/null 会让你以为 seek 成功了，其实整段脚本早炸了。

2. **一次 eval 里做"点击 → seek → 立刻读值"，读到的是上一帧。** React 的渲染是异步的，
   `click()` 之后同步读 `footer time` 或播放按钮文字，拿到的是**改之前**的 DOM。
   实测就翻过车：点完"暂停"立刻读，按钮仍是 `Ⅱ`（播放态）；读到的 `9.0 / 16 S` 其实是别处的旧值。
   后果是"核对帧位"这一步形同虚设。

   **正确做法：拆成三段独立 eval，中间留 sleep。** 每一段只做一件事，读值永远单独发一次：

   ```sh
   # 1) 暂停，等 React flush
   agent-browser eval "(()=>{const p=document.querySelector('footer .play');if(p.textContent.trim()==='\u2161')p.click();return 'pause requested'})()"
   sleep 1
   # 2) seek
   agent-browser eval "(()=>{const el=document.querySelector('.timeline input');const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(el,'560');el.dispatchEvent(new Event('input',{bubbles:true}));return 'seek requested'})()"
   sleep 2
   # 3) 现在才读 —— 唯一可信的帧位凭据
   agent-browser eval "(()=>document.querySelector('footer time').textContent)()"   # 应为 9.0 / 16 S
   ```

   React 受控 input 必须走 `native setter + input 事件`，直接赋值 `el.value` 不会触发 onChange。

3. **`location.reload()` 会重置自动播放。** 想截"某一帧的静帧"必须**先暂停再 seek**，
   否则画面会在截图的那两秒里继续往前走。

   另外浮层要单独处理：`.view-selector` / `.stage-label` / `.orbit-hint` 是**压在 canvas 之上**的
   绝对定位元素。只按 canvas 边界裁切仍会把控件裁进图里。截图前注入
   `.view-selector,.stage-label,.orbit-hint{display:none!important}` 即可（`display:none` 不改 canvas 尺寸）。
   裁切用 `canvas.getBoundingClientRect()` 的真实值，**不要按固定像素猜** —— 猜偏 83px 就会把侧栏标题露进画面。

4. **正交相机（`OrthographicCamera`）项目的「对焦」只改 `zoom`，完全不碰视锥。**
   典型实现 `focusOn(point, radius)` 里只有一句
   `zoom = clamp(0.62 · baseHalfH / radius, minZoom, maxZoom)`，
   `left / right / top / bottom` 一个都不动。于是对焦出来的**实际取景取决于调用前视锥长什么样** ——
   上一步若跑过俯视机位或近景探针（它们会重写视锥），对焦结果能离谱到
   「要么贴脸只剩一片玻璃幕墙、要么整栋楼缩成画面里一个小点」，而且**同样的参数每次跑还不一样**。

   两条推论，都要写进脚本：
   - 任何「先切机位 → 再对焦」的自动化，必须先复位视锥（`resetView()`）再 `select()`。
   - **不要拿 `camera.right / camera.top` 当画布宽高比。** `top` 会被上一条改视锥的命令
     （俯视图、定点机位）改写，这个比值会跟着漂 —— 实测同一条命令链在不同时刻读出 4.27 和 5.55，
     而真实宽高比是 2.02。一律读宿主元素：`mount.clientWidth / mount.clientHeight`。

   > 区分一下责任：这**不是**场景代码的 bug。`frame(box, aspect)` 里
   > `baseHalfW = baseHalfH · aspect` 用的是真实 aspect，画面不会被拉伸。
   > 坑只存在于**验收脚本**：它绕过了 `frame()` 直接手改视锥。

### 视口尺寸

```sh
agent-browser set viewport 1600 1000
```

⚠️ 这个子命令在 `--help` 的 **Browser Settings** 分组（`agent-browser set <setting> [value]`）里，
**不在** Core Commands 清单中 —— 只扫帮助前半段会误判成"没有设置视口的接口"。

改完视口**必须 reload**：取景用的 `baseHalfH` 只在 `CameraManager.frame()` 里算，
而 `frame()` 通常是多阶段构建的**最后一步**才调用；`resize()` 只改 `left / right`、不改 `baseHalfH`。
只改视口不重建，`preset` / `focus` 的取景会全部失准。

顺带：宽高比变了，「定点机位」类的参数要跟着换算。视口从 2.02 变成 1.6 时水平视域收窄 21%，
同一个垂直 `half` 会左右裁掉内容，需要把 `half` 放大约 `2.02 / 1.6 ≈ 1.26` 倍。

## 3. 像素统计（PIL）

`agent-browser screenshot` 存 PNG，用 PIL 量：

```python
from PIL import Image
im = Image.open('/tmp/shot.png').convert('RGB'); px = im.load()
# 暖色像素（灯光）
hot = [(x,y) for y in range(60,780) for x in range(200,1120)
       if (lambda r,g,b: r>170 and r-b>35 and r-g>12)(*px[x,y])]
print(len(hot))
```

**⚠️ 阈值会漏掉过曝的光。** 排查灯光时先用这个判据，得到 `0`，于是判断"灯没亮"——
实际上灯亮着，只是 `emissiveIntensity: 2.2` 被 ACES 压成了纯白，
`r-b` 从 45 掉到 35，正好落在阈值外。**过曝的暖光 = 白色**，任何"暖色检测"都抓不到它。

结论：**先裁剪放大用眼睛看，再上数值判据。** 一眼就能看出"那根白色竖条其实是灯槽"。

```python
im.crop((500,120,760,660)).resize((520,1080), Image.LANCZOS).save('/tmp/crop.png')
```

裁剪放大几乎总能立刻区分"几何不存在"和"几何在但参数不对"，比堆判据快得多。

## 4. 由症状定位（本项目真实踩过的）

| 症状 | 真因 | 修法 |
| --- | --- | --- |
| 广场渲染成黑白棋盘格，微缩感全毁 | 两种材质 4×4 米交替 | 同材质 + 10% 顶点色差 |
| 水面发白发亮，不像水 | 近镜面 + 明亮天空环境 = 反射天顶 | 基色压暗、metalness .30→.12、env 1.0→.65 |
| 树像灌木丛，建筑像玩具 | 树高 5.5 单位配 62 高塔楼 | 提到 9 单位（树干 4.0 + 树冠 3.1×1.7） |
| 灯全亮着但看不见 | `emissiveIntensity 2.2` 被 ACES 打成纯白 | 降到 1.05，暖色才留得住 |
| 一面立面上灯槽完全被挡 | x=0 处的混凝土竖肋正好压在中缝灯槽上 | 竖肋改为**对齐分格线**并跳过中缝 |
| 灯光"唰"地一起亮 | 一个全局 `emissiveIntensity` uniform | 用 `rampedEmissive` + `smoothstep(.35,1,vConstruction)` 逐块点亮 |
| 未建成的楼层提前投影 | 只给颜色材质注入位移，忘了 `MeshDepthMaterial` | `inject(depth, null)` |
| 灯完全不亮，其它一切正常 | `customProgramCacheKey` 对两个 shader 变体返回了同一个常量 | 键值带上变体后缀 |
| 拖时间轴中间出现上一帧姿态的影子 | 阴影节流把中间帧也节掉了 | `progress===0 \|\| progress===1` 时强制刷阴影 |
| 控制台一条 `PCFSoftShadowMap has been deprecated` | three 0.185 起废弃 | 改 `THREE.PCFShadowMap` |
| 门面看起来像立体停车场 | 12 层完全重复，没有节奏 | 第 7 层做设备层：换 `glassDeep`、去掉室内灯 |
| HMR 时报 `<TowerScene> component` 崩，reload 后正常 | HMR 反复重建场景导致的状态残留 | 以**全新加载**的结果为准；真 bug 一定能 reload 复现 |
| 深色幕墙整面反射琥珀色，"深蓝绿玻璃"读不出来 | 天空暖色带正好铺满了相机可见的那一段 v | 把暖色带压到地平线附近，蓝色下压到 v≈0.49；见 `material-system.md` |
| 黄昏天空暖色"占了半个画面" | equirect 上的圆形径向渐变在竖直方向被放大 2 倍 | `ctx.scale(1, 0.22)` 压扁光晕，别只按宽度给半径 |
| 白色石材整体偏米黄，冷暖张力消失 | 暖色轮廓光 / 反弹光强度接近甚至超过冷色主光 | 暖光压到冷光的 1/2 以下（0.42 / 0.26 对 0.66 / 0.34） |
| 静帧里最高一层挂板"悬在半空"，背后透出天空 | `lift` 让每层从上方 2.2 单位落位，某一瞬间总有约两层在空中 | **不是 bug**。换个进度截图即可；黑色塔同区域会出现同样间隙，可用来确认 |
| 想给左侧招牌让位，把相机往左挪，招牌反而更出框 | 相机左移会让视线**转向 +x**，内容在画面里左移 | 保持相机在轴线，改把 **target 往左移**（改偏航，不改位置） |
| 低视角静帧里雨篷顶面把画面下四分之一糊成亮白带 | 视点低于雨篷时俯视看它 | 把 target 抬到**视线水平以上**，雨篷自然沉出画框 |
| 拍地标特写，要么贴脸只剩一片幕墙、要么整栋楼缩成一个小点 | 正交相机的 `focusOn()` 只改 `zoom`、不改视锥，继承了上一步机位残留的视锥 | 先 `resetView()` 复位视锥，再 `select()` |
| 同一条截图命令链连跑，取景每次都不一样 | 拿 `camera.right / camera.top` 当画布宽高比，而 `top` 被上一条命令改写 | 读 `mount.clientWidth / clientHeight` |
| 改了视口尺寸，`preset` / `focus` 的取景全歪 | `baseHalfH` 只在 `frame()` 里算，而 `frame()` 是构建最后一步；`resize()` 只改 left/right | 改视口后 `reload` 重建 |

## 5. 一定要看的四个视角

1. **全景**：塔楼 + 裙房 + 广场 + 树，检查尺度关系与取景；确认没有内容被画框切掉。
2. **幕墙细部**：玻璃反射里**必须能看见地平线**（否则环境贴图不对）；板缝、竖梃、竖肋的重复节奏是否自然。
3. **塔冠**：桅杆有没有被机房盒子吞掉（本项目第一版就吞了）；航空障碍灯在不在最顶端。
4. **裙房广场**（低视角，≈10° 仰角）：水池、雨篷、大堂通透玻璃后的暖光、灯柱。**低视角是比例 bug 最藏不住的地方。**

## 6. 窄屏

```sh
agent-browser set viewport 420 820
```

检查：HUD 不溢出、视角按钮折行、`data-render-stats` 仍有值、相机不吃进模型。场景组件在 `aspect < 0.58` 时把 fov 从 34 开到 42，靠这个保证竖屏不裁切。

## 7. 自检清单

- [ ] `tsc --noEmit` 与 `npm run build` 都过
- [ ] 全新加载后控制台干净
- [ ] 完工静止时 `idle: true`
- [ ] 玻璃里看得见地平线反射
- [ ] 幕墙是绕楼波次合拢，不是一起出现
- [ ] 未装幕墙的楼层"有顶有底"，不浮空
- [ ] 灯是从下往上依次亮，不是一起亮
- [ ] 树的尺度对得上层高
- [ ] 回拖时间轴到任意位置，画面确定且正确（同一 progress 必得同一栋楼）
- [ ] 四个视角 + 窄屏都看过
- [ ] 在 HUD 里报出的数字与 `data-render-stats` 一致
