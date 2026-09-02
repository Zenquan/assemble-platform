/**
 * 产线目录组合式健康派生态语义测试（CODE_STYLE §7：中文描述、验证公共导出）。
 */
import { describe, expect, it } from 'vitest';
import { deriveHealth } from '@/composables/useLineCatalog';

describe('deriveHealth 产线健康态派生', () => {
  it('停用线无论预检结果一律 disabled', () => {
    expect(deriveHealth(false, 'ok', 0)).toBe('disabled');
    expect(deriveHealth(false, 'ok', 12)).toBe('disabled');
    expect(deriveHealth(false, 'loading', null)).toBe('disabled');
  });

  it('启用线预检命中 0 → ready（就绪，可进入工作台）', () => {
    expect(deriveHealth(true, 'ok', 0)).toBe('ready');
  });

  it('启用线预检命中 > 0 → attention（待检修，引导处理干涉）', () => {
    expect(deriveHealth(true, 'ok', 3)).toBe('attention');
    expect(deriveHealth(true, 'ok', 135)).toBe('attention');
  });

  it('预检进行中/失败/未开始 → 默认 ready，不阻塞进入', () => {
    expect(deriveHealth(true, 'loading', null)).toBe('ready');
    expect(deriveHealth(true, 'error', null)).toBe('ready');
    expect(deriveHealth(true, 'idle', null)).toBe('ready');
  });
});
