import { describe, expect, it } from 'vitest';

import {
  assetDisplayName,
  builtinAssetLabel,
  deriveCustomAssetId,
  modelGlbUrl,
  suggestChineseName,
} from './model';

describe('modelGlbUrl', () => {
  it('使用产线模型版本隔离浏览器 GLB 缓存', () => {
    expect(modelGlbUrl('transfer-conveyor', 'freshcut-v1.0.1')).toBe(
      '/model/glb/transfer-conveyor.glb?v=freshcut-v1.0.1',
    );
  });

  it('缺少版本时保持原有下载地址', () => {
    expect(modelGlbUrl('conveyor')).toBe('/model/glb/conveyor.glb');
  });

  it('支持自定义资产 id 生成下载地址', () => {
    expect(modelGlbUrl('custom-cnc-mill')).toBe('/model/glb/custom-cnc-mill.glb');
  });
});

describe('deriveCustomAssetId', () => {
  it('从文件名推导 custom- 前缀的合法 id', () => {
    expect(deriveCustomAssetId('CNC Mill.glb')).toBe('custom-cnc-mill');
    expect(deriveCustomAssetId('下料机-01.GLB')).toBe('custom-01');
    expect(deriveCustomAssetId('press')).toBe('custom-press');
  });

  it('已带 custom- 前缀不重复添加', () => {
    expect(deriveCustomAssetId('custom-cnc-mill.glb')).toBe('custom-cnc-mill');
  });

  it('纯非法字符文件名返回空串', () => {
    expect(deriveCustomAssetId('下料机.glb')).toBe('');
    expect(deriveCustomAssetId('.glb')).toBe('');
  });

  it('超长基础名截断到 custom- 前缀合法上限', () => {
    const id = deriveCustomAssetId(`${'a'.repeat(80)}.glb`);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.startsWith('custom-')).toBe(true);
  });
});

describe('展示名：内置标签 / displayName', () => {
  it('内置资产返回中文标签，未知 id 回退原样', () => {
    expect(builtinAssetLabel('vision-module')).toBe('视觉分拣模块');
    expect(builtinAssetLabel('transfer-conveyor')).toBe('转运输送段');
    expect(builtinAssetLabel('custom-press')).toBe('custom-press');
  });

  it('assetDisplayName 优先级：displayName → 内置中文 → assetId', () => {
    expect(assetDisplayName({ assetId: 'custom-press', displayName: '数控冲压机' })).toBe('数控冲压机');
    expect(assetDisplayName({ assetId: 'conveyor' })).toBe('输送机');
    expect(assetDisplayName({ assetId: 'custom-press' })).toBe('custom-press');
    expect(assetDisplayName({ assetId: 'custom-press', displayName: '   ' })).toBe('custom-press');
  });
});

describe('suggestChineseName：上传时英文名 → 中文建议', () => {
  it('整句词库命中（CNC Mill / Metal Detector）', () => {
    expect(suggestChineseName('CNC Mill.glb')).toBe('数控铣床');
    expect(suggestChineseName('Metal Detector.glb')).toBe('金属检测机');
    expect(suggestChineseName('robotic_arm_v2.glb')).toBe('机械臂');
  });

  it('逐词映射兜底拼接（cnc + press）', () => {
    expect(suggestChineseName('cnc press.glb')).toBe('数控冲压机');
  });

  it('文件名已含中文时原样返回', () => {
    expect(suggestChineseName('自动封箱机.glb')).toBe('自动封箱机');
  });

  it('无词库命中的英文返回空串（交给用户手填）', () => {
    expect(suggestChineseName('quantum-widget.glb')).toBe('');
  });
});
