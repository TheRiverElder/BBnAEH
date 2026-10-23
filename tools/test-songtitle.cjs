#!/usr/bin/env node
/**
 * 曲名提取的回归测试（零依赖，node:assert）。
 *
 * 覆盖：
 * - 智能引擎的典型投稿格式（歌手槽 / 尾部 PV 标签 / 组合展开 / 组合保留 / 词典外歌手）；
 * - 旧版引擎的行为必须与历史完全一致（保留旧逻辑的硬约束）；
 * - 文件名清洗（Windows 非法字符、保留名、长度）；
 * - 空输入等边界；
 * - 单条提取的耗时（本地毫秒级，避免界面卡顿）。
 *
 * 运行：npm test
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const { registerEsmLoader } = require('./lib/esm-loader.cjs');

registerEsmLoader();

const {
  ENGINE_LEGACY,
  ENGINE_SMART,
  artistSourceLabel,
  extractSongInfo,
  formatSongName,
  sanitizeFileName,
  songFileNameOf,
} = require('../src/songTitle.js');
const { predicateSongName } = require('../src/utils.js');

/** @type {Array<{name: string, run: () => void}>} */
const tests = [];

/**
 * 注册一个用例。
 * @param {string} name 用例名。
 * @param {() => void} run 断言函数。
 * @returns {void}
 */
function test(name, run) {
  tests.push({ name, run });
}

test('智能引擎：歌手槽 + 尾部 PV 标签', () => {
  const info = extractSongInfo('【洛天依/乐正绫】情话【PV付】');
  assert.equal(info.engine, ENGINE_SMART);
  assert.deepEqual(info.artists, ['洛天依', '乐正绫']);
  assert.equal(info.title, '情话');
  assert.equal(info.text, '洛天依&乐正绫 - 情话');
  assert.equal(artistSourceLabel(info), '词典');
});

test('智能引擎：不会把尾部「官方PV版」当成歌名', () => {
  const info = extractSongInfo('【Vsinger乐正绫】未来的我【官方PV版】');
  assert.deepEqual(info.artists, ['乐正绫']);
  assert.equal(info.title, '未来的我');
  assert.equal(info.text, '乐正绫 - 未来的我');
});

test('智能引擎：组合超过 3 人时保留组合名', () => {
  const info = extractSongInfo('【五色战队原创】雪夜短剧');
  assert.deepEqual(info.artists, ['五色战队']);
  assert.equal(info.title, '雪夜短剧');
});

test('智能引擎：组合不超过 3 人时展开成员', () => {
  const info = extractSongInfo('【南北组】心空');
  assert.deepEqual(info.artists, ['洛天依', '乐正绫']);
  assert.equal(info.title, '心空');
});

test('智能引擎：词典外歌手从歌手槽推测', () => {
  const info = extractSongInfo('【星砂原创】彼方');
  assert.deepEqual(info.artists, ['星砂']);
  assert.equal(info.title, '彼方');
  assert.equal(info.artistSource, 'guessed');
});

test('智能引擎：尾部标签里的组合名不算歌手', () => {
  const info = extractSongInfo('【洛天依原创】寻你【PV付/南北组】');
  assert.deepEqual(info.artists, ['洛天依']);
  assert.equal(info.title, '寻你');
});

test('旧版引擎：完全保留历史输出（含已知缺陷）', () => {
  // 旧逻辑取「最长的非歌手段」，3 个字符的「PV付」赢过了 2 个字符的「情话」，
  // 这正是本次改造要修掉的问题，也是旧逻辑必须原样保留的基准。
  assert.equal(predicateSongName('【洛天依/乐正绫】情话【PV付】'), '洛天依 & 乐正绫 - PV付');
  const info = extractSongInfo('【洛天依/乐正绫】情话【PV付】', { engine: ENGINE_LEGACY });
  assert.equal(info.engine, ENGINE_LEGACY);
  assert.deepEqual(info.artists, ['洛天依', '乐正绫']);
  assert.equal(info.title, 'PV付');
  // 旧版 predicateSongName 的原始输出保持不变（带空格），但界面/落盘格式统一不带空格。
  assert.equal(formatSongName(info), '洛天依&乐正绫 - PV付');
});

test('旧版引擎：无歌手时保留原文（去掉多余分隔符）', () => {
  assert.equal(predicateSongName('心空'), ' - 心空');
  const info = extractSongInfo('心空', { engine: ENGINE_LEGACY });
  assert.deepEqual(info.artists, []);
  assert.equal(formatSongName(info), '心空');
});

test('文件名清洗：Windows 非法字符改成全角', () => {
  assert.equal(sanitizeFileName('Re:0 / 从零开始?'), 'Re：0 ／ 从零开始？');
  assert.equal(sanitizeFileName('A\\B|C*D"E<F>G'), 'A＼B｜C＊D＂E＜F＞G');
});

test('文件名清洗：保留名与结尾点/空格', () => {
  assert.equal(sanitizeFileName('CON'), '_CON');
  assert.equal(sanitizeFileName('  ..你好..  '), '..你好');
  assert.equal(sanitizeFileName('   '), '未命名');
  assert.equal(sanitizeFileName('', { fallback: '空' }), '空');
});

test('文件名清洗：控制字符与超长标题', () => {
  assert.equal(sanitizeFileName('a\u0000b\nc'), 'a b c');
  const long = '长'.repeat(300);
  assert.equal([...sanitizeFileName(long)].length, 120);
});

test('空输入不会抛异常', () => {
  const info = extractSongInfo('');
  assert.equal(info.title, '');
  assert.deepEqual(info.artists, []);
  assert.equal(sanitizeFileName(formatSongName(info)), '未命名');
  assert.equal(extractSongInfo(undefined).text, '');
});

test('songFileNameOf：一步得到可写盘的名字与结果', () => {
  const { name, info } = songFileNameOf('【洛天依】心空【PV付】');
  assert.equal(name, '洛天依 - 心空');
  assert.equal(info.title, '心空');
});

test('性能：单条提取在毫秒级（100 条 < 2s）', () => {
  const mv = '【洛天依/乐正绫】情话【PV付】';
  const start = Date.now();
  for (let i = 0; i < 100; i += 1) extractSongInfo(mv);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `100 条耗时 ${elapsed}ms，超出预期`);
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} 通过`);
if (failed > 0) {
  process.exitCode = 1;
  console.error(`源码目录：${path.relative(process.cwd(), path.join(__dirname, '..'))}`);
}
