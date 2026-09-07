import { describe, expect, it } from 'vitest';

import { deriveCustomAssetId, modelGlbUrl } from './model';

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
