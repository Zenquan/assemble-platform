#!/usr/bin/env node
/**
 * 同步 .deploy/ 目录与仓库代码（CloudRun 云端构建代码快照）。
 *
 * 背景：CloudRun 云端构建（tcb cloudrun deploy）需要一份不含 node_modules/dist 的源码快照，
 * 放在 .deploy/（已 gitignore）。仓库代码每次改动后，先跑本脚本再触发部署。
 *
 * 同步规则：
 *  - 根：Dockerfile、package.json、pnpm-lock.yaml、pnpm-workspace.yaml、.npmrc、tsconfig.base.json
 *  - packages/*：src + package.json + tsconfig.json（不含 dist/test/node_modules）
 *  - services/*：src + package.json + tsconfig.json + services/tsconfig.base.json
 *    （model-svc 的 assets/glb 一并同步，作为 OSS 未配置时的本地回退）
 *  - apps/*：Vite 构建输入（index.html/public/src/package.json/tsconfig/vite.config）
 *  - 保留 .deploy/ 下不属于仓库映射的文件（如 cloudbaserc.json），不做全量清空
 *  - 清理：.deploy 中已从仓库删除的映射文件会被移除，避免陈旧文件混入部署包
 *
 * 用法（仓库根）：
 *   node scripts/sync-deploy.mjs
 */
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEPLOY = join(ROOT, '.deploy');

/** 部署快照中被视为「外部文件」（仓库外生成、需要保留）的相对路径 */
const KEEP_FILES = new Set(['cloudbaserc.json']);

/** 根目录直接映射的文件 */
const ROOT_FILES = [
  'Dockerfile',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'tsconfig.base.json',
];

/** 每个 workspace 包需要同步的成员（相对包根） */
const PKG_MEMBERS = ['src', 'package.json', 'tsconfig.json'];

/** 前端 app 需要同步的 Vite 构建输入（相对 app 根；dist/design/test 不进云构建上下文） */
const APP_MEMBERS = ['index.html', 'public', 'src', 'package.json', 'tsconfig.json', 'vite.config.ts'];

/** packages/* 与 services/* 的包名清单（apps 单独按 APP_MEMBERS 同步构建输入） */
const PACKAGES = ['domain', 'sim-utils', 'clearance-core', 'http', 'storage'];
const SERVICES = ['assembly-svc', 'interference-svc', 'model-svc', 'takt-svc', 'auth-svc', 'gateway'];

const log = (msg) => process.stdout.write(`${msg}\n`);

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 单文件同步：内容一致则跳过（mtime 在跨目录拷贝后不可靠，用字节比对） */
async function syncFile(src, dst) {
  const srcStat = await stat(src).catch(() => null);
  if (!srcStat) return false;
  const dstStat = await stat(dst).catch(() => null);
  if (dstStat && dstStat.size === srcStat.size) {
    const [srcBuf, dstBuf] = await Promise.all([
      readFile(src),
      readFile(dst).catch(() => null),
    ]);
    if (dstBuf && srcBuf.equals(dstBuf)) return false;
  }
  await cp(src, dst, { force: true });
  return true;
}

/** 目录同步：逐文件比对，清理目标中多余的文件 */
async function syncDir(srcDir, dstDir) {
  if (!(await pathExists(srcDir))) return 0;
  await mkdir(dstDir, { recursive: true });
  let changed = 0;
  const srcEntries = await readdir(srcDir, { withFileTypes: true });
  const dstEntries = (await pathExists(dstDir))
    ? new Set(await readdir(dstDir))
    : new Set();

  for (const entry of srcEntries) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      changed += await syncDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      if (await syncFile(srcPath, dstPath)) changed += 1;
    }
    dstEntries.delete(entry.name);
  }
  // 删除目标中仓库已不再存在的文件/目录
  for (const stale of dstEntries) {
    await rm(join(dstDir, stale), { recursive: true, force: true });
    changed += 1;
  }
  return changed;
}

async function main() {
  await mkdir(DEPLOY, { recursive: true });
  const existing = new Set(await readdir(DEPLOY));
  let changed = 0;

  // 1. 根文件
  for (const file of ROOT_FILES) {
    if (await syncFile(join(ROOT, file), join(DEPLOY, file))) {
      changed += 1;
      log(`synced ${file}`);
    }
  }

  // 2. packages/*
  for (const name of PACKAGES) {
    const pkgDir = join(ROOT, 'packages', name);
    if (!(await pathExists(pkgDir))) continue;
    await mkdir(join(DEPLOY, 'packages', name), { recursive: true });
    for (const member of PKG_MEMBERS) {
      const src = join(pkgDir, member);
      const dst = join(DEPLOY, 'packages', name, member);
      if ((await pathExists(src)) && (await stat(src)).isDirectory()) {
        changed += await syncDir(src, dst);
      } else if (await syncFile(src, dst)) {
        changed += 1;
      }
    }
  }
  log(`packages synced (${PACKAGES.length} packages)`);

  // 3. services/*
  for (const name of SERVICES) {
    const svcDir = join(ROOT, 'services', name);
    if (!(await pathExists(svcDir))) continue;
    await mkdir(join(DEPLOY, 'services', name), { recursive: true });
    for (const member of PKG_MEMBERS) {
      const src = join(svcDir, member);
      const dst = join(DEPLOY, 'services', name, member);
      if ((await pathExists(src)) && (await stat(src)).isDirectory()) {
        changed += await syncDir(src, dst);
      } else if (await syncFile(src, dst)) {
        changed += 1;
      }
    }
    // model-svc 的本地 GLB 回退资产（OSS 未配置时的兜底，云端事实源为 ASSEMBLE_GLB_BASE_URL）
    const assets = join(svcDir, 'assets');
    if (await pathExists(assets)) {
      changed += await syncDir(assets, join(DEPLOY, 'services', name, 'assets'));
    }
  }
  // services/tsconfig.base.json（各服务 tsconfig extends 依赖）
  if (
    await syncFile(
      join(ROOT, 'services', 'tsconfig.base.json'),
      join(DEPLOY, 'services', 'tsconfig.base.json'),
    )
  ) {
    changed += 1;
  }
  log(`services synced (${SERVICES.length} services)`);

  // 4. apps/*（同步 Vite 构建输入；CloudRun 镜像内执行 `vite build` 产出 dist）
  for (const name of ['sim-platform', 'sim-admin']) {
    const appDir = join(ROOT, 'apps', name);
    if (!(await pathExists(appDir))) continue;
    const dstAppDir = join(DEPLOY, 'apps', name);
    await mkdir(dstAppDir, { recursive: true });
    for (const member of APP_MEMBERS) {
      const src = join(appDir, member);
      const dst = join(dstAppDir, member);
      if ((await pathExists(src)) && (await stat(src)).isDirectory()) {
        changed += await syncDir(src, dst);
      } else if (await syncFile(src, dst)) {
        changed += 1;
      }
    }
  }
  log(`apps synced (sim-platform build inputs)`);

  // 5. 清理 .deploy 中不属于映射集合的顶层残留（保留 KEEP_FILES 与本次写入的目录）
  const managedTops = new Set(['Dockerfile', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.base.json', 'packages', 'services', 'apps']);
  for (const entry of existing) {
    if (managedTops.has(entry) || KEEP_FILES.has(entry)) continue;
    await rm(join(DEPLOY, entry), { recursive: true, force: true });
    changed += 1;
    log(`removed stale top-level ${entry}`);
  }

  log(changed > 0 ? `deploy snapshot updated (${changed} items changed)` : 'deploy snapshot up to date');
}

main().catch((err) => {
  console.error(`[sync-deploy] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
