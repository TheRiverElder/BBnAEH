#!/usr/bin/env node
/**
 * 「从手机导入 B 站缓存」的集成测试（零依赖，不需要真机）。
 *
 * 用一个假的 adb（tools/fake-adb.cjs）模拟一台 Android 设备，真的拉起 server.js：
 * - 设备发现、自动查找缓存目录（多个包名）、目录浏览；
 * - 缓存列表（一次性快速读取 + 回退的逐个 cat）；
 * - 复制到本地临时文件夹 / 工作文件夹（结构必须是 <avid>/<cid>/entry.json）；
 * - 重复导入跳过、workspace 列表能看到导入的视频；
 * - 路径/设备/目录校验（命令注入、路径穿越、相对路径都要被拒绝）；
 * - 找不到 adb 时的友好提示。
 *
 * 运行：npm run test:adb
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FAKE_ADB = path.join(ROOT, 'tools', 'fake-adb.cjs');
const ROOT_A = '/sdcard/Android/data/com.bilibili.app.in/download';
const ROOT_B = '/sdcard/Android/data/tv.danmaku.bili/download';

/**
 * 启动一个 server.js 并等它可用。
 *
 * @param {object} options 选项。
 * @param {number} options.port 端口。
 * @param {object} options.env 额外的环境变量。
 * @returns {Promise<{base: string, child: object, log: () => string}>} 服务信息。
 */
async function startServer({ port, env }) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 75; i += 1) {
    try {
      const res = await fetch(`${base}/info`);
      if (res.ok) return { base, child, log: () => output };
    } catch (e) { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`服务器未启动：\n${output}`);
}

/**
 * GET JSON。
 * @param {string} url 地址。
 * @returns {Promise<object>} JSON。
 */
async function getJson(url) {
  return (await fetch(url)).json();
}

/**
 * POST JSON。
 * @param {string} url 地址。
 * @param {object} payload 请求体。
 * @returns {Promise<object>} JSON。
 */
async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/**
 * 写一个 entry.json。
 * @param {string} dir 目录。
 * @param {object} entry 内容。
 * @returns {void}
 */
function writeEntry(dir, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(entry));
}

/**
 * 建一台「虚拟设备」的 /sdcard 目录：
 *
 *   Android/data/com.bilibili.app.in/download/123/456   ← 主包，带坏 entry.json
 *   Android/data/tv.danmaku.bili/download/789/111       ← 第二个包
 *   Android/data/com.coloros.accessibilityassistant/... ← 干扰项（名字里也有 bili）
 *
 * @returns {string} fixture 根目录（对应 /sdcard）。
 */
function makeDeviceFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bbnaeh-device-'));
  const data = path.join(fixture, 'Android', 'data');

  writeEntry(path.join(data, 'com.bilibili.app.in', 'download', '123', '456'), {
    title: '【洛天依】情话',
    avid: 123,
    cid: 456,
    bvid: 'BV1xx411c7mD',
    cover: 'http://example.invalid/1.jpg',
    page_data: { page: 1, part: '情话' },
  });
  fs.mkdirSync(path.join(data, 'com.bilibili.app.in', 'download', '123', '456', '80'), { recursive: true });
  fs.writeFileSync(path.join(data, 'com.bilibili.app.in', 'download', '123', '456', '80', 'audio.m4s'), 'fake-audio');
  fs.writeFileSync(path.join(data, 'com.bilibili.app.in', 'download', '123', '456', '80', 'video.m4s'), 'fake-video');

  // 坏掉的 entry.json：列表里应标记为 broken，而不是让整个列表失败
  fs.mkdirSync(path.join(data, 'com.bilibili.app.in', 'download', '999', '888'), { recursive: true });
  fs.writeFileSync(path.join(data, 'com.bilibili.app.in', 'download', '999', '888', 'entry.json'), 'not a json');

  writeEntry(path.join(data, 'tv.danmaku.bili', 'download', '789', '111'), {
    title: '【乐正绫】未来的我',
    avid: 789,
    cid: 111,
    bvid: 'BV1yy411c7mE',
    page_data: { page: 2, part: '未来的我 P2' },
  });

  fs.mkdirSync(path.join(data, 'com.coloros.accessibilityassistant', 'cache'), { recursive: true });
  return fixture;
}

async function main() {
  const fixture = makeDeviceFixture();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bbnaeh-ws-'));
  const tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'bbnaeh-import-'));
  const servers = [];
  let failed = 0;

  // 0. adb 发现：PATH 里有中文目录时也必须能找到（不能靠 where 的输出）
  const adbModule = require('../server/adb.cjs');
  const chineseDir = path.join(os.tmpdir(), '搞机 助手 adb');
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  fs.mkdirSync(chineseDir, { recursive: true });
  fs.writeFileSync(path.join(chineseDir, exe), '');
  const savedPath = process.env.PATH;
  const savedAdbEnv = process.env.ADB;
  delete process.env.ADB;
  process.env.PATH = `${chineseDir}${path.delimiter}${savedPath || ''}`;
  try {
    const found = adbModule.findAdb();
    assert.ok(found, '应该在 PATH 里找到 adb');
    assert.equal(found.path, path.join(chineseDir, exe), '中文目录里的 adb 也要能找到');
  } finally {
    process.env.PATH = savedPath;
    if (savedAdbEnv !== undefined) process.env.ADB = savedAdbEnv;
    fs.rmSync(chineseDir, { recursive: true, force: true });
  }

  // 0.1 自动查找结果的解析：不同写法的同一路径要合并
  const parsed = adbModule.parseDetectOutput(
    '@@R@@/storage/sdcard0/Android/data/x/download|5\n'
    + '@@R@@/sdcard/Android/data/x/download|3\n'
    + '@@P@@/storage/emulated/0/Android/data/com.bilibili.app.in\n',
  );
  assert.equal(parsed.roots.length, 1, '同一路径应合并');
  assert.equal(parsed.roots[0].path, '/sdcard/Android/data/x/download');
  assert.equal(parsed.roots[0].entries, 5, '应保留较大的条目数');
  assert.deepEqual(parsed.packages, ['/sdcard/Android/data/com.bilibili.app.in']);

  const deviceEnv = { ADB: FAKE_ADB, FAKE_ADB_FIXTURE: fixture };

  try {
    // A. 快速模式（一次 shell 脚本读回全部 entry.json）
    const fast = await startServer({ port: 19301, env: deviceEnv });
    servers.push(fast);
    const info = await getJson(`${fast.base}/adb/info`);
    assert.equal(info.succeed, true, JSON.stringify(info));
    assert.equal(info.available, true);
    assert.equal(info.devices.length, 1);
    assert.equal(info.devices[0].serial, 'FAKE123');
    assert.equal(info.devices[0].state, 'device');
    assert.match(info.adbVersion, /1\.0\.41/);

    // 自动查找：两个包都要找到，按条目数排序
    const detected = await postJson(`${fast.base}/adb/detect`, { device: 'FAKE123' });
    assert.equal(detected.succeed, true, JSON.stringify(detected));
    assert.deepEqual(detected.roots.map((root) => root.path), [ROOT_A, ROOT_B]);
    assert.deepEqual(detected.roots.map((root) => root.entries), [2, 1]);
    assert.deepEqual(detected.packages, [
      '/sdcard/Android/data/com.bilibili.app.in',
      '/sdcard/Android/data/tv.danmaku.bili',
    ]);
    assert.equal(detected.roots[0].package, 'com.bilibili.app.in');

    // 浏览设备目录
    const browseSd = await postJson(`${fast.base}/adb/browse`, { device: 'FAKE123', path: '/sdcard' });
    assert.equal(browseSd.succeed, true, JSON.stringify(browseSd));
    assert.ok(browseSd.entries.some((entry) => entry.name === 'Android' && entry.isDir));
    assert.equal(browseSd.parent, '/');

    const browseData = await postJson(`${fast.base}/adb/browse`, { device: 'FAKE123', path: '/sdcard/Android/data' });
    const packageDirs = browseData.entries.filter((entry) => entry.isDir).map((entry) => entry.name);
    assert.ok(packageDirs.includes('com.bilibili.app.in'));
    assert.ok(packageDirs.includes('tv.danmaku.bili'));

    const browseRootA = await postJson(`${fast.base}/adb/browse`, { device: 'FAKE123', path: ROOT_A });
    assert.deepEqual(browseRootA.entries.map((entry) => entry.name), ['123', '999']);
    assert.equal(browseRootA.parent, '/sdcard/Android/data/com.bilibili.app.in');

    const browseMissing = await postJson(`${fast.base}/adb/browse`, { device: 'FAKE123', path: '/sdcard/nope' });
    assert.equal(browseMissing.succeed, false);
    assert.match(browseMissing.err, /读取设备目录失败/);

    const browseRelative = await postJson(`${fast.base}/adb/browse`, { device: 'FAKE123', path: 'sdcard' });
    assert.equal(browseRelative.succeed, false);
    assert.match(browseRelative.err, /绝对路径/);

    // 列表
    const listed = await postJson(`${fast.base}/adb/list`, { device: 'FAKE123', root: ROOT_A });
    assert.equal(listed.succeed, true, JSON.stringify(listed));
    assert.equal(listed.mode, 'fast');
    assert.equal(listed.entries.length, 2);
    const plain = listed.entries.find((entry) => entry.path === '123/456');
    assert.equal(plain.title, '【洛天依】情话');
    assert.equal(plain.bvid, 'BV1xx411c7mD');
    const broken = listed.entries.find((entry) => entry.path === '999/888');
    assert.equal(broken.broken, true);

    const listedB = await postJson(`${fast.base}/adb/list`, { device: 'FAKE123', root: ROOT_B });
    assert.equal(listedB.entries.length, 1);
    assert.equal(listedB.entries[0].path, '789/111');

    // 复制到临时文件夹（两个包各一个）
    let imported = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['123/456'],
      target: { mode: 'temp', dir: tempTarget },
    });
    assert.equal(imported.succeed, true, JSON.stringify(imported));
    assert.equal(imported.result.imported, 1);
    assert.equal(imported.result.targetDir, tempTarget);
    assert.equal(fs.existsSync(path.join(tempTarget, '123', '456', 'entry.json')), true);
    assert.equal(fs.readFileSync(path.join(tempTarget, '123', '456', '80', 'audio.m4s'), 'utf8'), 'fake-audio');

    imported = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_B,
      entries: ['789/111'],
      target: { mode: 'temp', dir: tempTarget },
    });
    assert.equal(imported.result.imported, 1);
    assert.equal(fs.existsSync(path.join(tempTarget, '789', '111', 'entry.json')), true);

    // 重复导入 → 跳过
    const again = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['123/456'],
      target: { mode: 'temp', dir: tempTarget },
    });
    assert.equal(again.result.imported, 0);
    assert.equal(again.result.skipped, 1);

    // 复制到默认临时目录（不带 dir → 自动创建带时间戳的子目录）
    const defaultTemp = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['999/888'],
      target: { mode: 'temp' },
    });
    assert.equal(defaultTemp.succeed, true, JSON.stringify(defaultTemp));
    assert.ok(
      defaultTemp.result.targetDir.startsWith(path.join(os.tmpdir(), 'bbnaeh-import')),
      `默认临时目录位置不对：${defaultTemp.result.targetDir}`,
    );
    assert.equal(fs.existsSync(path.join(defaultTemp.result.targetDir, '999', '888')), true);
    fs.rmSync(defaultTemp.result.targetDir, { recursive: true, force: true });

    // 复制到工作文件夹，并确认 /workspace 能列出来
    const toWorkspace = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['123/456'],
      target: { mode: 'workspace', workspacePath: workspace },
    });
    assert.equal(toWorkspace.succeed, true, JSON.stringify(toWorkspace));
    assert.equal(toWorkspace.result.imported, 1);
    assert.equal(toWorkspace.result.targetDir, path.join(workspace, 'videos'));
    const ws = await getJson(`${fast.base}/workspace?path=${encodeURIComponent(workspace)}`);
    assert.equal(ws.succeed, true);
    assert.deepEqual(ws.workspace.videos.map((video) => video.path), [path.join('123', '456')]);
    assert.equal(ws.workspace.videos[0].entry.title, '【洛天依】情话');

    // 校验：设备 / 目录 / 条目 / 目标
    let bad = await postJson(`${fast.base}/adb/list`, { device: 'FAKE123; rm -rf /', root: ROOT_A });
    assert.equal(bad.succeed, false);
    assert.match(bad.err, /设备序列号不合法/);

    bad = await postJson(`${fast.base}/adb/list`, { device: 'FAKE123', root: "/sdcard/x'; rm -rf /" });
    assert.equal(bad.succeed, false);
    assert.match(bad.err, /不支持的字符/);

    bad = await postJson(`${fast.base}/adb/list`, { device: 'FAKE123', root: '/sdcard/../etc' });
    assert.equal(bad.succeed, false);
    assert.match(bad.err, /\.\./);

    bad = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['../../Windows'],
      target: { mode: 'temp', dir: tempTarget },
    });
    assert.equal(bad.succeed, true);
    assert.equal(bad.result.failed, 1);
    assert.equal(bad.result.results[0].ok, false);

    bad = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['123/456/80'],
      target: { mode: 'temp', dir: tempTarget },
    });
    assert.equal(bad.result.failed, 1);

    bad = await postJson(`${fast.base}/adb/import`, {
      device: 'FAKE123',
      root: ROOT_A,
      entries: ['123/456'],
      target: { mode: 'temp', dir: 'relative-dir' },
    });
    assert.equal(bad.succeed, false);
    assert.match(bad.err, /绝对路径/);

    // B. 快速读取失败时，回退到 ls + cat
    const slow = await startServer({
      port: 19302,
      env: { ...deviceEnv, FAKE_ADB_FAIL_LIST: '1' },
    });
    servers.push(slow);
    const slowList = await postJson(`${slow.base}/adb/list`, { device: 'FAKE123', root: ROOT_A });
    assert.equal(slowList.succeed, true, JSON.stringify(slowList));
    assert.equal(slowList.mode, 'simple');
    assert.equal(slowList.entries.length, 2);
    assert.equal(slowList.entries.find((entry) => entry.path === '123/456').title, '【洛天依】情话');

    // C. 没有 adb 时给出提示，而不是崩溃
    const noAdb = await startServer({
      port: 19303,
      env: {
        ADB: '',
        PATH: '',
        LOCALAPPDATA: '',
        USERPROFILE: '',
        HOME: '',
        ANDROID_HOME: '',
        ANDROID_SDK_ROOT: '',
      },
    });
    servers.push(noAdb);
    const noAdbInfo = await getJson(`${noAdb.base}/adb/info`);
    assert.equal(noAdbInfo.succeed, true);
    assert.equal(noAdbInfo.available, false);
    assert.match(noAdbInfo.hint, /adb/);
    const noAdbList = await postJson(`${noAdb.base}/adb/list`, { device: 'X', root: ROOT_A });
    assert.equal(noAdbList.succeed, false);
    assert.match(noAdbList.err, /adb/);

    console.log('ok   adb 导入接口 40+ 项断言全部通过（发现 / 自动查找 / 浏览 / 复制 / 回退 / 无 adb）');
  } catch (error) {
    failed = 1;
    console.error('FAIL adb 导入接口测试');
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
    for (const server of servers) console.error(`\n服务器输出：\n${server.log()}`);
  } finally {
    for (const server of servers) server.child.kill();
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(tempTarget, { recursive: true, force: true });
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
