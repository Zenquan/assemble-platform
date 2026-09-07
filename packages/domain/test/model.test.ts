import { describe, expect, it } from 'vitest';
import {
  CUSTOM_ASSET_PREFIX,
  MODEL_ASSET_IDS,
  MODEL_ASSET_LABELS,
  isBuiltinAssetId,
  isCustomAssetId,
  isValidModelAssetId,
} from '../src/model.js';

describe('内置资产白名单', () => {
  it('MODEL_ASSET_IDS 内的 id 判定为内置', () => {
    for (const id of MODEL_ASSET_IDS) {
      expect(isBuiltinAssetId(id)).toBe(true);
    }
  });

  it('未知 id 判定为非内置', () => {
    expect(isBuiltinAssetId('custom-press')).toBe(false);
    expect(isBuiltinAssetId('')).toBe(false);
  });
});

describe('自定义资产 id 规则', () => {
  it('合法 custom- id 通过', () => {
    expect(isCustomAssetId('custom-press')).toBe(true);
    expect(isCustomAssetId('custom-cnc-mill-01')).toBe(true);
    expect(isCustomAssetId(`${CUSTOM_ASSET_PREFIX}a`)).toBe(true);
  });

  it('非法形式拒绝：缺前缀/大写/非法字符/超长/空尾', () => {
    expect(isCustomAssetId('press')).toBe(false);
    expect(isCustomAssetId('Custom-press')).toBe(false);
    expect(isCustomAssetId('custom-')).toBe(false);
    expect(isCustomAssetId('custom--')).toBe(false);
    expect(isCustomAssetId('custom-下料机')).toBe(false);
    expect(isCustomAssetId('custom-a b')).toBe(false);
    expect(isCustomAssetId(`custom-${'a'.repeat(58)}`)).toBe(false);
  });
});

describe('内置资产中文名 MODEL_ASSET_LABELS', () => {
  it('每个内置资产都有非空中文名（一一对应）', () => {
    for (const id of MODEL_ASSET_IDS) {
      const label = MODEL_ASSET_LABELS[id];
      expect(label).toBeDefined();
      expect(label!.length).toBeGreaterThan(0);
    }
  });

  it('常见条目语义正确', () => {
    expect(MODEL_ASSET_LABELS['vision-module']).toBe('视觉分拣模块');
    expect(MODEL_ASSET_LABELS['transfer-conveyor']).toBe('转运输送段');
  });
});

describe('统一判定 isValidModelAssetId', () => {
  it('内置与合法自定义 id 均通过', () => {
    expect(isValidModelAssetId('conveyor')).toBe(true);
    expect(isValidModelAssetId('custom-press')).toBe(true);
  });

  it('既非内置也非合法自定义的 id 拒绝（含路径穿越形态）', () => {
    expect(isValidModelAssetId('unknown-asset')).toBe(false);
    expect(isValidModelAssetId('../etc/passwd')).toBe(false);
    expect(isValidModelAssetId('custom-..%2fpasswd')).toBe(false);
    expect(isValidModelAssetId('')).toBe(false);
  });
});
