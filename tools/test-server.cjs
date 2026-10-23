#!/usr/bin/env node
/**
 * 删除视频接口的集成测试（零依赖）。
 *
 * 覆盖：
 * - 正常删除：只删目标目录，同级视频保留；
 * - 路径穿越 `../audios`、`../..`、绝对路径、`videos` 根目录：必须被拒绝；
 * - 不存在的目录：返回单条失败而不影响其它条目；
 * - 空列表：整个请求失败；
 * - 删除后 `/workspace` 不再列出该视频。
 *
 * 运行：npm run test:server
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 19000 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * 等待服务器起来（最多 15 秒）。
 * @param {() => string} readLog 读取服务器输出（用于失败时打印）。
 * @returns {Promise<void>} 服务可用时 resolve。
 */
async function waitForServer(readLog) {
  for (let i = 0; i < 75; i += 1) {
    try {
      const res = await fetch(`${BASE}/info`);
      if (res.ok) return;
    } catch (e) { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务器未启动：\n${readLog()}`);
}

/**
 * POST JSON。
 * @param {string} route 接口路径。
 * @param {object} payload 请求体。
 * @returns {Promise<object>} 响应 JSON。
 */
async function postJson(route, payload) {
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/**
 * 建一个临时工作目录：videos/BVok/1/80/audio.m4s、videos/BVother/1、audios/keep.mp3。
 * @returns {string} 工作目录绝对路径。
 */
function makeWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bbnaeh-delete-'));
  fs.mkdirSync(path.join(ws, 'videos', 'BVok', '1', '80'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'videos', 'BVother', '1'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'audios'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'videos', 'BVok', '1', 'entry.json'), '{"title":"ok"}');
  fs.writeFileSync(path.join(ws, 'videos', 'BVok', '1', '80', 'audio.m4s'), 'fake');
  fs.writeFileSync(path.join(ws, 'videos', 'BVother', '1', 'entry.json'), '{"title":"other"}');
  fs.writeFileSync(path.join(ws, 'audios', 'keep.mp3'), 'fake');
  return ws;
}

/**
 * 断言单条删除结果。
 * @param {object} response 接口响应。
 * @param {boolean} ok 期望是否成功。
 * @param {string} [errPart] 期望错误信息包含的片段。
 * @returns {void}
 */
function assertItem(response, ok, errPart) {
  assert.equal(response.succeed, true, `请求应被处理：${JSON.stringify(response)}`);
  assert.equal(response.result.deleted, ok ? 1 : 0);
  assert.equal(response.result.results.length, 1);
  const item = response.result.results[0];
  assert.equal(item.ok, ok);
  if (errPart) {
    assert.ok(String(item.err).includes(errPart), `错误信息应包含「${errPart}」，实际：${item.err}`);
  }
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });

  const ws = makeWorkspace();
  const videos = path.join(ws, 'videos');
  let failed = 0;

  try {
    await waitForServer(() => log);

    // 1. 正常删除
    let response = await postJson('/videos/delete', { workspacePath: ws, list: [{ path: 'BVok\\1' }] });
    assertItem(response, true);
    assert.equal(fs.existsSync(path.join(videos, 'BVok', '1')), false, '目标目录应被删除');
    assert.equal(fs.existsSync(path.join(videos, 'BVok')), false, '变空的上级目录也应被清理');
    assert.equal(fs.existsSync(path.join(videos, 'BVother', '1')), true, '其它视频应保留');

    // 删除后 /workspace 不再列出该视频
    const listRes = await fetch(`${BASE}/workspace?path=${encodeURIComponent(ws)}`);
    const listJson = await listRes.json();
    const paths = listJson.workspace.videos.map((video) => video.path);
    assert.deepEqual(paths, ['BVother\\1'], `workspace 应只剩 BVother，实际 ${JSON.stringify(paths)}`);

    // 2. 路径穿越：../audios
    response = await postJson('/videos/delete', { workspacePath: ws, list: [{ path: '../audios' }] });
    assertItem(response, false, '不在 videos 目录内');
    assert.equal(fs.existsSync(path.join(ws, 'audios', 'keep.mp3')), true, 'audios 不能被删');

    // 3. 路径穿越：..\..\ 试图跳到工作目录之外
    response = await postJson('/videos/delete', { workspacePath: ws, list: [{ path: '..\\..\\Windows' }] });
    assertItem(response, false, '不在 videos 目录内');

    // 4. videos 根目录本身
    response = await postJson('/videos/delete', { workspacePath: ws, list: [{ path: '.' }] });
    assertItem(response, false, '根目录');
    assert.equal(fs.existsSync(videos), true, 'videos 目录必须还在');

    // 5. 绝对路径
    response = await postJson('/videos/delete', { workspacePath: ws, list: [{ path: path.join(ws, 'audios') }] });
    assertItem(response, false, '绝对路径');

    // 6. 不存在的目录：单条失败
    response = await postJson('/videos/delete', { workspacePath: ws, list: [{ path: 'BVmissing\\1' }] });
    assertItem(response, false, '不存在');

    // 7. 空列表：整个请求失败
    response = await postJson('/videos/delete', { workspacePath: ws, list: [] });
    assert.equal(response.succeed, false);

    // 8. 混合：一个成功一个失败，成功的不受失败影响
    response = await postJson('/videos/delete', {
      workspacePath: ws,
      list: [{ path: 'BVother\\1' }, { path: 'BVmissing\\1' }],
    });
    assert.equal(response.succeed, true);
    assert.equal(response.result.requested, 2);
    assert.equal(response.result.deleted, 1);
    assert.equal(response.result.failed, 1);
    assert.equal(fs.existsSync(path.join(videos, 'BVother', '1')), false, '成功的条目应被删除');
    assert.equal(fs.existsSync(videos), true, 'videos 根目录必须保留');
    assert.deepEqual(fs.readdirSync(videos), [], 'videos 下应已清空');

    console.log(`ok   删除接口 ${8} 项断言全部通过（端口 ${PORT}）`);
  } catch (error) {
    failed = 1;
    console.error('FAIL 删除接口测试');
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
    console.error(`\n服务器输出：\n${log}`);
  } finally {
    child.kill();
    fs.rmSync(ws, { recursive: true, force: true });
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
