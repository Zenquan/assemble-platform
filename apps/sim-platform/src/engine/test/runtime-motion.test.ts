import { describe, expect, it } from 'vitest';

import { RuntimeMotionPlayer, type RuntimeMotionSpec } from '../runtime-motion.js';

const specs: RuntimeMotionSpec[] = [
  { nodeId: 'belt', motion: 'translate-x-loop' },
  { nodeId: 'incline', motion: 'translate-incline-loop' },
  { nodeId: 'rotor', motion: 'rotate-y' },
  { nodeId: 'deck', motion: 'vibrate-xz' },
  { nodeId: 'feeder', motion: 'vibrate-radial' },
  { nodeId: 'buckets', motion: 'bucket-gates' },
  { nodeId: 'jaws', motion: 'close-open-x' },
  { nodeId: 'pusher', motion: 'translate-y' },
];

describe('RuntimeMotionPlayer · 设备运行态动画', () => {
  it('为 GLB 声明的八类运动输出相对基础位姿', () => {
    const player = new RuntimeMotionPlayer(specs);
    expect(player.bindingCount).toBe(8);
    expect(player.start(0)).toBe(true);

    const frames = player.tick(370);
    const poses = new Map(frames.map((frame) => [frame.nodeId, frame.pose]));
    expect(poses.get('belt')?.translation[0]).not.toBe(0);
    expect(poses.get('rotor')?.rotation[1]).not.toBe(0);
    expect(poses.get('deck')?.translation[2]).not.toBe(0);
    expect(poses.get('buckets')?.rotation[0]).not.toBe(0);
    expect(poses.get('jaws')?.scale[0]).not.toBe(1);
  });

  it('暂停保持当前时间，恢复后继续推进而不是重置', () => {
    const player = new RuntimeMotionPlayer([{ nodeId: 'belt', motion: 'translate-x-loop' }]);
    player.start(100);
    const beforePause = player.tick(700)[0]?.pose.translation[0];
    player.pause(700);
    const paused = player.tick(1700)[0]?.pose.translation[0];
    expect(paused).toBe(beforePause);

    player.start(1700);
    player.tick(2300);
    expect(player.elapsed).toBeCloseTo(1.2, 5);
  });

  it('重置恢复零偏移并停止播放器', () => {
    const player = new RuntimeMotionPlayer([{ nodeId: 'pusher', motion: 'translate-y' }]);
    player.start(0);
    player.tick(300);
    expect(player.elapsed).toBeGreaterThan(0);
    player.reset();
    expect(player.playing).toBe(false);
    expect(player.elapsed).toBe(0);
    expect(player.tick(1000)[0]?.pose.translation).toEqual([0, 0, 0]);
  });

  it('没有运动节点时拒绝启动', () => {
    const player = new RuntimeMotionPlayer([]);
    expect(player.start(0)).toBe(false);
    expect(player.playing).toBe(false);
  });
});

