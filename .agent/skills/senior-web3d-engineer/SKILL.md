---
name: senior-web3d-engineer
description: 资深 Web3D 前端工程师技能，融合计算机图形学原理与 Web3D 工程实践。覆盖渲染管线、光照模型（Lambert/Phong/PBR/IBL）、坐标系统与矩阵、相机投影与取景、包围盒与空间加速、glTF/GLB 资产管线、Babylon.js / three.js / 原生 WebGL 技术栈，以及 Web3D 性能优化。当涉及 3D 场景搭建、渲染管线、着色器、光照/材质调优、glTF 资产导入导出、相机取景、几何/包围盒计算、PBR 金属/透明/纹理渲染问题、3D 性能瓶颈排查，或本工程（assemble-platform）任何 Babylon 渲染层改动时，先加载本 skill。触发词："3D"、"渲染"、"光照"、"材质"、"PBR"、"glTF/GLB"、"Babylon"、"three.js"、"WebGL"、"相机/取景"、"包围盒"、"着色器"、"性能优化"。
---

# 资深 Web3D 前端工程师

> **本技能定位：把「计算机图形学原理」落到「Web3D 工程可执行决策」。** 不背书、不堆术语，每条原理都带一条"在 Web3D 里怎么用 / 会踩什么坑"。

## 项目流程接入

本技能是 [assemble-platform-workflow](../assemble-platform-workflow/SKILL.md) 的 Web3D 专业执行层。新需求先由 [grill-me](../grill-me/SKILL.md) 锁定边界；涉及 model-svc、HTTP 契约、Vue API、Vite 代理或服务编排时，同时加载 [senior-fullstack-engineer](../senior-fullstack-engineer/SKILL.md)；错误与可复用经验按 [self-improving-agent](../self-improving-agent/SKILL.md) 即时沉淀。

当你面对一个 3D 渲染问题（物体看不见、材质发黑、相机取景不对、资产导不进、帧率低），先按本技能的「诊断顺序」逐项排查，再对症下药。**核心方法论：先定位是哪一层出问题（资产 / 材质 / 光照 / 相机 / 坐标系），再动手改，不要盲目加灯、加 scale、加相机 radius 试错。**

---

## 0. 诊断顺序（3D 问题排查的固定套路）

当「物体存在但看不见 / 渲染效果不对」时，按此顺序从**最底层、最高频**的原因开始排：

| # | 排查层 | 检查项 | 典型症状 → 根因 |
|---|--------|--------|----------------|
| 1 | **资产就位** | 网络 404？文件路径？ | glb 请求 404 → loader 静默失败，场景里根本没加载 |
| 2 | **加载成功** | `container.meshes.length`？有无 `load failed` 日志 | 有顶点 mesh 被当成空节点，或 loader 没注册 |
| 3 | **坐标系/原点** | glb 原点在底面还是几何中心？Y-up 还是 Z-up？ | 设备半埋地下 / 悬空，或整体旋转 90° |
| 4 | **包围盒/位置** | mesh 的世界 bbox 是否在相机视野内 | 位置对但相机 target/radius 没把它框进来 |
| 5 | **材质可见性** | PBR 还是 Standard？有无 IBL/环境光 | PBR 金属无环境贴图 → 接近全黑（最常见！） |
| 6 | **光照** | 光源类型/强度/方向是否照到 | 只有半球光、无方向光 → 无体积感、无高光 |
| 7 | **相机取景** | target/radius/fov 是否覆盖所有内容 | 新内容加入后相机没重新 frame |

> **红线**：任何一步没确认前，不要跳到"加灯 / 加 scale / 加 radius"这种末端试错。先读数据（bbox、材质类型、加载日志），再改。

---

## 1. 渲染管线（图形学地基）

- **实时渲染核心链路**：`顶点(局部空间) → 模型矩阵M → 世界空间 → 视图矩阵V → 相机空间 → 投影矩阵P → 裁剪空间 → NDC → 视口`。`MVP = P·V·M` 是把模型画到屏幕的唯一通路，任何"看不见"先怀疑这条链的某一环。
- **Web3D 对应**：Babylon 的 `mesh.getWorldMatrix()`、`camera.getViewMatrix()`、`camera.getProjectionMatrix()`；three.js 的 `object.matrixWorld`、`camera.matrixWorldInverse`、`projectionMatrix`。**调试坐标时永远问：这个点是局部还是世界？是否已 `computeWorldMatrix(true)`？**
- **坐标系约定差异（Web3D 第一大坑）**：
  - **Babylon.js**：左手系，**Y 轴向上**，Z 指向屏幕内。
  - **three.js**：右手系，**Y 轴向上**，Z 指向屏幕外（相机看向 -Z）。
  - **glTF 规范**：右手系，**Y 轴向上**，**+Z 指向观察者（前）**。
  - **含义**：Babylon 导入 glTF 时 loader 会自动做 Y-up→内部约定的适配；但**自定义几何、自己拼的 primitive、手写矩阵**时坐标系全靠自己保证，最容易翻车。

---

## 2. 光照模型（从 Lambert 到 PBR/IBL）

### 2.1 经验光照（Phong/Blinn-Phong）
- **组成**：`Ambient(环境) + Diffuse(漫反射, Lambert) + Specular(高光, Blinn-Phong)`。
- 漫反射 `I_d = k_d · (N·L) · I_light`，只取决于法线与光源夹角，与视角无关 → 有方向光才看得到体积。
- **只有半球光（HemisphericLight）会怎样**：只有渐变环境色，**无方向感、无高光、物体扁平**。要塑造体积，至少补一个 `DirectionalLight`。

### 2.2 PBR（Physically Based Rendering）
- **核心参数**：`albedo(反照率/基色)`、`metallic(金属度 0~1)`、`roughness(粗糙度 0~1)`、`normal(法线贴图)`、`AO`。
- **关键物理事实**：**金属（metallic→1）几乎不产生漫反射**，它的颜色全部来自**环境反射**（specular）。金属的"本色"是 albedo 乘以镜面反射环境。
- **PBR 金属发黑的根因（本工程踩过的坑）**：**没有 IBL（环境贴图）时，金属没有环境可反射 → specular 贡献≈0 → 只剩几乎为 0 的漫反射 → 渲染出来接近纯黑**。这不是"光照太暗"，是"金属材质缺反射来源"。
- **解决方案（三选一，按成本从低到高）**：
  1. **降级材质**：把 PBR 金属 mesh 换成 `StandardMaterial`（或把 `metallic` 调 0、`roughness` 调高、`albedo` 调亮），牺牲金属质感换可见性。
  2. **加 IBL**：`scene.createDefaultEnvironment()` 或手动 `CubeTexture` + `scene.environmentTexture`，让金属有东西可反射（最正确，但需要 HDR/环境贴图资源）。
  3. **加强方向光 + 半球填光**：让 specular 有高光点可看，但金属整体仍偏暗，仅作兜底。

### 2.3 IBL（Image-Based Lighting，基于图像的光照）
- 用环境贴图（HDR 立方体贴图）提供全局反射与漫反射辐照，是 PBR 金属/玻璃/车漆类材质的**必备**。
- Babylon：`new CubeTexture('env.dds', scene)` + `scene.environmentTexture = ...`；three.js：`scene.environment` + `THREE.PMREMGenerator`。

---

## 3. 材质与纹理

- **StandardMaterial（经验材质）**：`diffuseColor`/`ambientColor`/`specularColor`/`emissiveColor`。无环境贴图也能靠 diffuse 看得到，**是"保证可见"的兜底材质**。
- **PBRMaterial**：`albedoColor`/`metallic`/`roughness`/`environmentTexture`。**注意：PBRMaterial 没有 `diffuseColor` 属性**，判断材质类型用 `material.getClassName()`（返回 `"PBRMaterial"` 或 `"StandardMaterial"`），不要假设有 `diffuseColor`。
- **透明/混合**：半透明要设 `alpha` + `needAlphaBlending`，且**透明物体渲染顺序**（不透明先、透明后、按距离排序）是常见 bug 源。

---

## 4. 相机与取景（把内容框进视野）

- **ArcRotateCamera**（Babylon）/ **OrbitControls**（three.js）：围绕 target 旋转，核心三参数 `target(注视点) + radius(距离) + alpha/beta(方位角/仰角)`。
- **取景（framing）通用算法**：给定一组点/包围盒，计算：
  1. **质心** `c = Σp_i / n` → 设为 `camera.target`；
  2. **包围半径** `r = max(|p_i - c| + r_i)` → `radius = r / tan(fov/2) × 安全系数`。
- **常见错误**：新增了内容（如加了设备布景层）但**没有重新 frame**，相机 target 还停在旧内容质心，新内容被挤到画面边缘甚至视野外。
- **视野外排查**：把相机 target 移到疑似物体 bbox 中心、radius 拉近，看它是否出现在画面里——这是判断"位置错"还是"太小/太远"的最快手段。

---

## 5. 包围盒与空间计算（图形学几何）

- **AABB（轴对齐包围盒）**：`min/max`，相交检测 O(1)，但随物体旋转会膨胀。
- **OBB（有向包围盒）**：随物体旋转，贴合更紧，相交检测要 SAT（分离轴定理）。
- **包围球**：最简，用于相机取景/粗剔除。
- **世界包围盒**：`mesh.getBoundingInfo().boundingBox.minimumWorld/maximumWorld`（Babylon）或 `Box3.setFromObject(object)`（three.js）。**注意必须先让 `worldMatrix` 更新**，否则拿到的是局部 bbox。
- **用途**：干涉检测（本工程 clearance-core）、相机取景、视锥剔除、碰撞。

---

## 6. glTF / GLB 资产管线

- **glTF 2.0**：JSON 场景描述 + 外部/内嵌二进制。`.glb` 是单文件二进制封装（JSON + BIN 打包）。
- **坐标/单位约定**：glTF 默认 **+Y 向上**，单位约定为**米**（但很多导出工具不遵守，需验证）。**原点通常在模型几何中心或底面，取决于导出工具**——导入后要用包围盒量出实际 min/max 决定要不要做"底面贴地"补偿。
- **Babylon 加载 glTF（关键拆包坑）**：Babylon v8+ 起 `@babylonjs/core` **不再内置 glTF loader**，必须额外装 `@babylonjs/loaders` 并 **side-effect import**：
  ```ts
  import '@babylonjs/loaders/glTF'; // 必须有，否则报 "Unable to find a plugin to load .glb files"
  ```
- **加载 API 选择**：
  - `SceneLoader.ImportMeshAsync(meshNames, rootUrl, sceneFilename, scene)`：直接进场景，返回 `{ meshes, animationGroups }`。
  - `SceneLoader.LoadAssetContainerAsync(rootUrl, sceneFilename, scene)`：**不自动进场景**，返回 `AssetContainer`，可先改 transform/材质再 `container.addAllToScene()` —— **推荐用于需要前置处理的布景资产**。
  - 两者都是 **async**，加载完成前 mesh 未就位；**不要用固定 `setTimeout` 等加载**，要监听容器/事件或用 `await`。
- **资产生成（Blender → glb）**：见 `references/gltf-asset-pipeline.md`（Blender headless 生成、合并 mesh、`export_yup=True`、量 bbox 验证）。

---

## 7. 技术栈速查

| 技术 | 定位 | 关键点 |
|------|------|--------|
| **Babylon.js** | 功能全、TS 原生、工业/仿真友好 | 拆包需 `@babylonjs/loaders`；左手系 Y-up；`SceneLoader` 有函数与 class 同名歧义 |
| **three.js** | 生态最大、灵活、案例多 | 右手系 Y-up；`GLTFLoader` 独立引入；`OrbitControls` 独立引入 |
| **原生 WebGL/WebGPU** | 最高可控、最低层 | 手写 shader 与 VAO/VBO；`glTF` 解析自己来 |
| **PlayCanvas / 其他** | 引擎一体化 | 少用，本工程不涉及 |

- **引擎选型建议**：装配/仿真/工业可视化（大量节点、需要类型安全、OBB 干涉）→ **Babylon.js**；通用展示/交互/快速原型 → **three.js**。本工程 assemble-platform 用 Babylon（已约定，勿改）。

---

## 8. Web3D 性能优化

- **顶点/批处理**：减少 draw call —— 合并静态 mesh、复用几何（`CreateInstance`）、用 `MergeMeshes`。
- **剔除**：视锥剔除（默认开启）、遮挡剔除（Babylon `Occlusion Queries`）。
- **LOD（层次细节）**：远距离用低模。
- **纹理**：压缩纹理（KHR_texture_basisu）、mipmap、控制贴图尺寸。
- **渲染循环**：只在需要时渲染（`render()` 按需），避免无意义每帧重绘；动画用 `scene.beginAnimation` 而非手写 requestAnimationFrame 堆叠。
- **性能门禁**：本工程 clearance-core 有 `200 件 < 200ms` 门禁，涉及几何/干涉算法改动必须守住（`docs/TESTING.md`）。

---

## 9. 本工程（assemble-platform）专用红线

1. **SimEngine 门面**：业务代码只经 `@/engine` 窄接口访问渲染，`engine/babylon.ts` 是唯一 import `@babylonjs/core` 的边界，`engine/noop.ts` 是无 WebGL 替身。**别在业务组件里直引 Babylon。**
2. **外观 shell 与碰撞 OBB 解耦**：工位设备只做布景层，`isPickable=false`、无 `partId` 标记，不参与装配/干涉。
3. **取景要包含布景**：设备加载完成后把「零件 ∪ 设备」联合包围盒重新 frame（见 `_frameWithDevices`）。
4. **PBR 金属兜底**：设备 glb 原始 PBR 金属材质在无 IBL 时全黑 → 用 `StandardMaterial` 降级（`_shellMaterialForDevice`）保证可见。
5. **改动后必测**：跑 `verify-workbench-devices.mjs`（vite dev + playwright 截图）视觉确认，不是只看 badge 数字。

---

## 10. 本技能自身迭代

踩了新坑 / 发现更优做法 → 更新本 `SKILL.md` 或 `references/` 下的细则，并记一条到 `.learnings/`（类别 `best_practice` / `error`）。详细资产管线、坐标换算、材质配方放 `references/`，保持主文件精炼。
