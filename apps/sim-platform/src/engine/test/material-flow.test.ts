import { describe, expect, it } from 'vitest';

import { MaterialFlowPlayer } from '../material-flow.js';

const path = [
  { id: 'station-a', position: [0, 1, 0] as const },
  { id: 'station-b', position: [10, 1, 0] as const },
  { id: 'station-c', position: [20, 1, 0] as const },
];

describe('MaterialFlowPlayer · 产线物料流转', () => {
  it('沿工位路径输出稳定的物料帧', () => {
    const player = new MaterialFlowPlayer(path, { itemCount: 2, cycleSeconds: 10 });
    expect(player.start(0)).toBe(true);

    const frames = player.tick(2500);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.position[0]).toBeCloseTo(5);
    expect(frames[0]?.stationId).toBe('station-b');
    expect(frames[1]?.position[0]).toBeCloseTo(15);
    expect(frames[1]?.stationId).toBe('station-c');
  });

  it('暂停保持位置，恢复后继续并统计完成件数', () => {
    const player = new MaterialFlowPlayer(path, { itemCount: 2, cycleSeconds: 2 });
    player.start(100);
    player.tick(1100);
    const beforePause = player.tick(1100);
    player.pause(1100);
    expect(player.tick(3100)).toEqual(beforePause);

    player.start(3100);
    player.tick(5100);
    expect(player.completedUnits).toBe(2);
  });

  it('空路径或单点路径不启动', () => {
    expect(new MaterialFlowPlayer([]).start(0)).toBe(false);
    expect(new MaterialFlowPlayer([path[0]!]).start(0)).toBe(false);
  });
});
