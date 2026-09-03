#!/usr/bin/env bash
# gen-all.sh — 一键生成 5 件工位设备 glb，直接输出到后端资产目录（单一事实源）。
#
# 架构约定（资产管线）：glb 唯一事实源 = services/model-svc/assets/glb/。
# 前端经 /model/glb/:id.glb 从后端下载，不再落 public 静态副本；
# scripts/gltf-gen/ 只保留生成器与预览/验证工具，不另存一份 glb。
#
# 用法:
#   scripts/gltf-gen/gen-all.sh            # 生成全部 5 件
#   scripts/gltf-gen/gen-all.sh conveyor   # 只生成某一件（可逗号分隔多件）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
if [[ ! -x "${BLENDER}" ]]; then
  echo "[gen] Blender 未找到: ${BLENDER}" >&2
  exit 2
fi

# 单一事实源：后端 model-svc 资产目录（与 model-svc/src/app.ts 的 GLB_DIR 对齐）
OUT_DIR="${REPO_ROOT}/services/model-svc/assets/glb"
mkdir -p "${OUT_DIR}"

DEVICES="${1:-conveyor,feeder,vision-module,gantry-arm,box-pack}"

echo "[gen] 输出目录: ${OUT_DIR}"
"${BLENDER}" -b --python "${SCRIPT_DIR}/gen_device.py" -- "${DEVICES}" --out "${OUT_DIR}"

echo "[gen] 完成。后端资产目录:"
ls -la "${OUT_DIR}"
