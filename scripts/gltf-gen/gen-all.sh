#!/usr/bin/env bash
# gen-all.sh — 一键生成通用设备与净菜加工线设备，直接输出到后端资产目录。
#
# 架构约定（资产管线）：glb 唯一事实源 = services/model-svc/assets/glb/。
# 前端经 /model/glb/:id.glb 从后端下载，不再落 public 静态副本；
# scripts/gltf-gen/ 只保留生成器与预览/验证工具，不另存一份 glb。
#
# 用法:
#   scripts/gltf-gen/gen-all.sh                  # 生成全部资产
#   scripts/gltf-gen/gen-all.sh freshcut         # 生成净菜加工线七设备
#   scripts/gltf-gen/gen-all.sh bubble-washer    # 只生成某一件
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BLENDER="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [[ ! -x "${BLENDER}" ]]; then
  echo "[gen] Blender 未找到: ${BLENDER}" >&2
  exit 2
fi

# 单一事实源：后端 model-svc 资产目录（与 model-svc/src/app.ts 的 GLB_DIR 对齐）
OUT_DIR="${REPO_ROOT}/services/model-svc/assets/glb"
mkdir -p "${OUT_DIR}"

TARGET="${1:-all}"
LEGACY_DEVICES="conveyor,feeder,vision-module,gantry-arm,box-pack"
PREVIEW_DIR="${GLTF_PREVIEW_OUT:-${SCRIPT_DIR}/assets}"

run_freshcut() {
  local devices="$1"
  if [[ "${GLTF_RENDER_PREVIEWS:-0}" == "1" ]]; then
    "${BLENDER}" -b --python "${SCRIPT_DIR}/gen_freshcut.py" -- "${devices}" --out "${OUT_DIR}" --preview-out "${PREVIEW_DIR}"
  else
    "${BLENDER}" -b --python "${SCRIPT_DIR}/gen_freshcut.py" -- "${devices}" --out "${OUT_DIR}"
  fi
}

echo "[gen] 输出目录: ${OUT_DIR}"
case "${TARGET}" in
  all)
    "${BLENDER}" -b --python "${SCRIPT_DIR}/gen_device.py" -- "${LEGACY_DEVICES}" --out "${OUT_DIR}"
    run_freshcut all
    ;;
  legacy)
    "${BLENDER}" -b --python "${SCRIPT_DIR}/gen_device.py" -- "${LEGACY_DEVICES}" --out "${OUT_DIR}"
    ;;
  freshcut)
    run_freshcut all
    ;;
  infeed-elevator|bubble-washer|inspection-conveyor|vegetable-cutter|vibratory-dewaterer|weigh-packer|metal-detector)
    run_freshcut "${TARGET}"
    ;;
  *)
    "${BLENDER}" -b --python "${SCRIPT_DIR}/gen_device.py" -- "${TARGET}" --out "${OUT_DIR}"
    ;;
esac

echo "[gen] 完成。后端资产目录:"
ls -la "${OUT_DIR}"
