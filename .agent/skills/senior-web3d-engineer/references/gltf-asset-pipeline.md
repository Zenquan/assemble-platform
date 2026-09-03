# glTF / GLB 资产管线细则（Blender → Babylon.js）

> 本文件是 `senior-web3d-engineer` 主 SKILL 的补充，记录本工程（assemble-platform）实际跑通的资产生产与接线全流程，含每个环节的坑。

---

## 1. Blender headless 生成 glb

本机 Blender 4.4 路径：`/Applications/Blender.app/Contents/MacOS/Blender`。

后台脚本化生成，**不要**用 GUI：

```bash
Blender -b --python scripts/gltf-gen/gen_device.py
```

**坑 1 · `--python` 而非把脚本当场景**：`blender -b script.py` 会把 `.py` 当场景文件报 `File format is not supported`，必须 `blender -b --python script.py`。

**坑 2 · `use_empty` 后无 World**：`bpy.ops.wm.read_factory_settings(use_empty=True)` 后场景没有 World，直接用材质/光照会 `KeyError: 'World'`，需先 `bpy.ops.world.new()`。

**坑 3 · Python 条件表达式急切求值**：`A if False else B` 会**先求值 A**（因为 `if False` 的条件在运行时才判定，但表达式左右两边的对象构造在语法上是整体求值的坑——实际上是三元表达式只求值选中分支，但若 A 是函数调用且被误写成"占位桩"，任何残留都会崩）。**教训：删干净的占位桩，不要留 `xxx() if False else None` 这种残句。**

**导出设置**：`bpy.ops.export_scene.gltf(export_format='GLB', export_yup=True, use_selection=True, export_apply=True)`。
- `export_yup=True`：强制 +Y up，对齐 glTF 规范。
- `use_selection=True`：只导出选中的合并物体（先 `join_to_single` 合并成单 mesh）。

---

## 2. 合并 mesh（降低 draw call）

多个 primitive 合并成单 mesh（每个 primitive 一个 object → `bpy.ops.object.join()`），合并前统一 `context.view_layer.objects.active`。合并后：
- glb 里的 mesh 数量 = 合并后的 object 数（每个 object 一个 node）。
- Babylon `container.meshes` 会包含一个空的 `__root__` 节点（`getTotalVertices() === 0`）+ 若干有顶点的 mesh，遍历时**跳过空节点**。

---

## 3. 量包围盒验证尺寸（导入前必做）

用纯 node 解析 GLB 的 accessor `min/max`（不依赖渲染引擎，最快）：

```js
// 读 GLB header → JSON chunk → 遍历 mesh.primitives 的 POSITION accessor 的 min/max
// 见 scripts/gltf-gen/measure_glb_pure.mjs
```

**为什么重要**：glTF 单位是米，但不同设备的实际物理尺寸差异大（本工程 conveyor 8m 长、vision-module 2.5m 高、box-pack 仅 1.04m）。**导入后布局时，必须知道每个 glb 的真实尺寸和"原点在底面还是几何中心"**，否则设备会半埋地下或悬空。

本工程 5 件设备的实测（见 measure 脚本）：

| 设备 | 尺寸 X×Y×Z (m) | 中心 Y (m) | 说明 |
|------|---------------|-----------|------|
| conveyor | 8.00 × 0.73 × 0.70 | 0.37 | 沿 X 贯穿，scale 按产线长度缩放 |
| feeder | 1.21 × 0.55 × 1.35 | 0.27 | 上料工位 |
| vision-module | 2.40 × 2.50 × 1.70 | 1.25 | 视觉检测立柱（高） |
| gantry-arm | 1.60 × 1.97 × 0.60 | 0.99 | 桁架机械臂 |
| box-pack | 1.04 × 0.74 × 0.98 | 0.37 | 末端装箱 |

**底面锚点**：运行时不依赖写死的 `centerY`。`BabylonScene.renderParts` 读取真实世界包围盒，自动把 GLB 底面中心对齐 `AssemblyPart.localPosition`。

---

## 4. 后端资产下发

GLB 单一事实源位于 `services/model-svc/assets/glb/`，model-svc 通过 `/model/glb/:assetId.glb` 返回二进制。前端只保存 `assetId`，由 Vite 或生产网关做同源代理。

**禁止**把 GLB 复制到 `apps/sim-platform/public/`，也禁止加载失败后生成可见盒子。失败必须由 `SimEngine.init` 拒绝并进入工作台错误态。

---

## 5. Babylon 接线（BOM 模式）

```ts
import '@babylonjs/loaders/glTF'; // 必须有，否则 "Unable to find a plugin to load .glb files"

const container = await SceneLoader.LoadAssetContainerAsync('', assetUrl, scene);
const visualRoot = new TransformNode(`visual-${part.id}`, scene);
for (const mesh of container.meshes) {
  mesh.isPickable = false;
  if (mesh.getTotalVertices() === 0) continue;
}
// 用真实 bbox 对齐 BOM 底面锚点，再建 visibility=0 的交互代理。
```

**坑 · `SceneLoader` 类型歧义**：`@babylonjs/core` 同时导出顶层函数 `ImportMeshAsync` 和同名 `class SceneLoader` 的 static 方法，TS 优先解析 static 版本。**统一用 `SceneLoader.LoadAssetContainerAsync('', url, scene)`（rootUrl 传空串，完整 URL 给 sceneFilename）避免歧义。**

**坑 · PBR 金属无 IBL 全黑**：无环境贴图时保留原始 PBR 材质，并在运行时把 `metallic` 降为 0、`roughness` 提到可见阈值。不要用统一 `StandardMaterial` 覆盖资产外观。

---

## 6. 验收（视觉确认，不是看数字）

1. 用 `pnpm dev` 启动 assembly/model 等核心服务与 Vite，访问 `/#/workbench/<lineId>`。
2. 用浏览器分别检查至少两条流水线，确认 GLB 数量、资产组合和 BOM 树工位分组随后端 BOM 改变。
3. 检查画面像素与场景状态：可见模型非空、材质可辨识、相机完整取景、透明 box 代理不可见。
4. 若看不到模型，按主 SKILL §0 诊断顺序排查：BOM → GLB 404 → bbox → 相机取景 → 材质/光照。

**坑 · hash 路由**：vite dev 下路由是 `createWebHashHistory()`，URL 必须 `/#/workbench/<lineId>`，不是 `/workbench/<lineId>`（后者只会显示产线列表页）。

---

## 7. 相关文件索引

- `scripts/gltf-gen/gen_device.py` —— Blender 资产生成器（支持 feeder/gantry-arm/conveyor/box-pack/vision-module 批量）
- `scripts/gltf-gen/measure_glb_pure.mjs` —— 纯 node 解析 GLB accessor 算包围盒
- `services/assembly-svc/src/repositories/index.ts` —— 由流水线工位生成 BOM
- `services/model-svc/src/app.ts` —— 真实 GLB 下载接口与资产白名单
- `apps/sim-platform/src/engine/babylon.ts` —— GLB 加载、bbox 对齐、透明交互代理
