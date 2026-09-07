import { ClearanceDetector } from '@assemble/clearance-core';
import {
  MODEL_ASSET_BOUNDS,
  type AssemblyPart,
  type InterferenceReport,
  type ModelAssetEnvelope,
} from '@assemble/domain';
import { obbFromBomPart } from '@assemble/clearance-core';
import { ok } from '@assemble/http';

export interface OfflineCheckResult {
  report: InterferenceReport;
}

/** 解析 part 包络尺寸：自定义资产取 BOM 携带的 envelopeSize，内置回退权威静态表；仍缺才 throw。 */
function resolveEnvelopeSize(
  part: Pick<AssemblyPart, 'assetId' | 'envelopeSize'>,
): { size: ModelAssetEnvelope['size'] } {
  if (part.envelopeSize) return { size: part.envelopeSize };
  const envelope = (MODEL_ASSET_BOUNDS as Partial<Record<string, ModelAssetEnvelope>>)[
    part.assetId
  ];
  if (!envelope) {
    throw new Error(`资产 ${part.assetId} 缺少实测包络元数据，无法参与离线预检`);
  }
  return { size: envelope.size };
}

/**
 * 运行一次「离线整线批量干涉预检」：
 * 直接消费 assembly-svc 返回的 BOM 位姿 + 资产实测包络（自定义取 BOM 携带 envelopeSize，
 * 内置取 domain 权威表），用与 Babylon 视口一致的 OBB 构造，BVH self-collision + OBB-SAT 全量对撞。
 * 对应方案 3.3「服务端离线批量」（数千零件组合校验不压垮浏览器）。
 */
export function runOfflineCheck(params: {
  lineId: string;
  parts: ReadonlyArray<
    Pick<AssemblyPart, 'id' | 'assetId' | 'localPosition' | 'localRotation' | 'envelopeSize'>
  >;
}): OfflineCheckResult {
  const detector = new ClearanceDetector();
  detector.loadAll(params.parts.map((part) => {
    const { size } = resolveEnvelopeSize(part);
    return {
      partId: part.id,
      obb: obbFromBomPart(part, size),
    };
  }));
  const res = detector.runFull();
  const report: InterferenceReport = {
    reportId: `off-${Date.now()}`,
    lineId: params.lineId,
    source: 'offline',
    totalPartCount: params.parts.length,
    pairsChecked: res.pairsChecked,
    hitCount: res.hits.length,
    hits: res.hits,
    elapsedMs: res.elapsedMs,
    broadCullRatio: res.broadCullRatio,
    createdAt: new Date().toISOString(),
  };
  return { report };
}
