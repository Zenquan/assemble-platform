import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serviceNeedsBuild } from './dev.mjs';

test('源码比服务产物新时要求重建', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assemble-dev-'));
  try {
    const sourceDir = join(root, 'src');
    const distFile = join(root, 'dist', 'server.js');
    await mkdir(sourceDir);
    await mkdir(join(root, 'dist'));
    await writeFile(join(sourceDir, 'app.ts'), 'export {}');
    await writeFile(distFile, '');
    const old = new Date(Date.now() - 2_000);
    await utimes(distFile, old, old);
    assert.equal(serviceNeedsBuild(sourceDir, distFile), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('服务产物比源码新时跳过重建', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assemble-dev-'));
  try {
    const sourceDir = join(root, 'src');
    const distFile = join(root, 'dist', 'server.js');
    await mkdir(sourceDir);
    await mkdir(join(root, 'dist'));
    await writeFile(join(sourceDir, 'app.ts'), 'export {}');
    await writeFile(distFile, '');
    const fresh = new Date(Date.now() + 2_000);
    await utimes(distFile, fresh, fresh);
    assert.equal(serviceNeedsBuild(sourceDir, distFile), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
