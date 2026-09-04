import { describe, expect, it } from 'vitest';

import { modelGlbUrl } from './model';

describe('modelGlbUrl', () => {
  it('使用产线模型版本隔离浏览器 GLB 缓存', () => {
    expect(modelGlbUrl('transfer-conveyor', 'freshcut-v1.0.1')).toBe(
      '/model/glb/transfer-conveyor.glb?v=freshcut-v1.0.1',
    );
  });

  it('缺少版本时保持原有下载地址', () => {
    expect(modelGlbUrl('conveyor')).toBe('/model/glb/conveyor.glb');
  });
});
