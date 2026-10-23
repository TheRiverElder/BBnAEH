#!/usr/bin/env node
/**
 * 曲名提取评测 / 冒烟脚本。
 *
 * 在 abstractor2026 的标注集（fine_result.csv: avid, MV, 歌手, 歌名）上，
 * 同时跑本项目的新旧两个引擎，输出准确率对比，用来验证移植没有走样、
 * 以及新引擎相对旧版的提升幅度。
 *
 * 用法：
 *   node tools/eval-songtitle.cjs
 *   node tools/eval-songtitle.cjs --dataset D:\data\fine_result.csv
 *   node tools/eval-songtitle.cjs --limit 100 --show 5
 *
 * 说明：
 * - 本项目源码是给 webpack 用的 ESM，而 package.json 不带 "type": "module"
 *   （server.js 是 CJS），所以这里用 @babel/core 把 src 下的 ESM 现场转成 CJS
 *   再 require，不改动任何源文件。
 * - 标注集不在仓库里（数据量 130 KB，且属于 abstractor2026 项目），
 *   默认去同级目录找 ../abstractor2026/fine_result.csv。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, registerEsmLoader } = require('./lib/esm-loader.cjs');

/**
 * 解析命令行参数。
 * @param {string[]} argv 参数列表（不含 node 与脚本名）。
 * @returns {{dataset: string, limit: number, show: number}} 解析结果。
 */
function parseArgs(argv) {
  const options = {
    dataset: process.env.BBNAEH_DATASET
      || path.resolve(ROOT, '..', 'abstractor2026', 'fine_result.csv'),
    limit: 0,
    show: 10,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dataset') options.dataset = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]) || 0;
    else if (arg === '--show') options.show = Number(argv[++i]) || 0;
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node tools/eval-songtitle.cjs [--dataset <csv>] [--limit N] [--show N]');
      process.exit(0);
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

/** 比较歌名时忽略空白，与 abstractor2026 的评测口径一致。 */
const normalizeTitle = (value) => String(value ?? '').replace(/\s+/gu, '');

/**
 * 歌手比较：不计顺序、去掉空项。
 * @param {string[]|string} value 歌手数组或 `A&B` 字符串。
 * @returns {string} 规范化后的比较键。
 */
function artistKey(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split('&');
  return list.map((name) => name.trim()).filter(Boolean).sort().join('&');
}

/**
 * 百分数格式化。
 * @param {number} part 命中数。
 * @param {number} total 总数。
 * @returns {string} 例如 `94.89%`。
 */
const percent = (part, total) => `${((part / Math.max(1, total)) * 100).toFixed(2)}%`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.dataset)) {
    console.error(`找不到标注集：${options.dataset}`);
    console.error('可以用 --dataset <fine_result.csv> 指定，或设置环境变量 BBNAEH_DATASET。');
    process.exit(2);
  }

  registerEsmLoader();
  const { parseCsv } = require('../src/abstractor/csv.js');
  const { extractSongInfo, artistSourceLabel } = require('../src/songTitle.js');
  const { predicateSongName } = require('../src/utils.js');

  const table = parseCsv(fs.readFileSync(options.dataset, 'utf8'));
  let rows = table
    .filter((row) => row[0])
    .map((row) => ({
      avid: row[0] ?? '',
      mv: row[1] ?? '',
      artists: row[2] ?? '',
      title: row[3] ?? '',
    }));
  if (options.limit > 0) rows = rows.slice(0, options.limit);
  if (rows.length === 0) {
    console.error('标注集为空');
    process.exit(1);
  }

  const stats = {
    smart: { title: 0, artists: 0, joint: 0 },
    legacy: { title: 0, artists: 0, joint: 0 },
    sources: new Map(),
    smartOnly: [],
    legacyOnly: [],
    bothWrong: [],
  };

  for (const row of rows) {
    const goldTitle = normalizeTitle(row.title);
    const goldArtists = artistKey(row.artists);

    const smart = extractSongInfo(row.mv, { engine: 'smart' });
    const legacy = extractSongInfo(row.mv, { engine: 'legacy' });

    const smartTitleOk = normalizeTitle(smart.title) === goldTitle;
    const smartArtistsOk = artistKey(smart.artists) === goldArtists;
    const legacyTitleOk = normalizeTitle(legacy.title) === goldTitle;
    const legacyArtistsOk = artistKey(legacy.artists) === goldArtists;

    if (smartTitleOk) stats.smart.title += 1;
    if (smartArtistsOk) stats.smart.artists += 1;
    if (smartTitleOk && smartArtistsOk) stats.smart.joint += 1;
    if (legacyTitleOk) stats.legacy.title += 1;
    if (legacyArtistsOk) stats.legacy.artists += 1;
    if (legacyTitleOk && legacyArtistsOk) stats.legacy.joint += 1;

    const label = artistSourceLabel(smart);
    stats.sources.set(label, (stats.sources.get(label) ?? 0) + 1);

    if (smartTitleOk && !legacyTitleOk && stats.smartOnly.length < options.show) {
      stats.smartOnly.push({ row, smart, legacy, goldTitle });
    }
    if (legacyTitleOk && !smartTitleOk && stats.legacyOnly.length < options.show) {
      stats.legacyOnly.push({ row, smart, legacy, goldTitle });
    }
    if (!smartTitleOk && !legacyTitleOk && stats.bothWrong.length < options.show) {
      stats.bothWrong.push({ row, smart, legacy, goldTitle });
    }
  }

  const total = rows.length;
  console.log(`标注集：${path.relative(ROOT, options.dataset) || options.dataset}（${total} 行）\n`);
  console.log('引擎        歌名准确率   歌手(不计顺序)   歌手+歌名');
  for (const [name, key] of [['智能', 'smart'], ['旧版', 'legacy']]) {
    const s = stats[key];
    console.log(
      `${name.padEnd(6)}      ${percent(s.title, total).padStart(8)}   `
      + `${percent(s.artists, total).padStart(10)}   ${percent(s.joint, total).padStart(9)}`,
    );
  }
  console.log(`\n旧版实际调用：predicateSongName() —— 输出示例 ${JSON.stringify(predicateSongName('【洛天依/乐正绫】情话【PV付】'))}`);

  console.log('\n智能引擎的歌手来源分布：');
  for (const [label, count] of [...stats.sources.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(6)} ${String(count).padStart(5)}  ${percent(count, total)}`);
  }

  /**
   * 打印一组对照样例。
   * @param {string} heading 标题。
   * @param {Array<object>} list 样例。
   * @returns {void}
   */
  const printSamples = (heading, list) => {
    if (list.length === 0) return;
    console.log(`\n${heading}`);
    for (const { row, smart, legacy } of list) {
      console.log(`  MV      ${row.mv}`);
      console.log(`  标注    ${row.artists || '∅'} - ${row.title || '∅'}`);
      console.log(`  智能    ${smart.artists.join('&') || '∅'} - ${smart.title || '∅'}`);
      console.log(`  旧版    ${legacy.artists.join('&') || '∅'} - ${legacy.title || '∅'}`);
      console.log('');
    }
  };

  printSamples('智能正确、旧版错误的例子：', stats.smartOnly);
  printSamples('旧版正确、智能错误的例子（回归）：', stats.legacyOnly);
  printSamples('两者都错的例子：', stats.bothWrong);
}

main();
