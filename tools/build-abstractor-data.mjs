#!/usr/bin/env node
/**
 * 由词典 CSV 与排序器 JSON 生成浏览器可直接打包的 JS 数据模块。
 *
 * 浏览器端没有文件系统，所以 `src/abstractor/data/*.csv` 与 `title-ranker.json`
 * 不能直接 import；本脚本把它们转成等价的 ES 模块：
 *
 *   src/abstractor/data/aliases.js  ← alias_list.csv + band_list.csv
 *   src/abstractor/data/ranker.js   ← title-ranker.json
 *
 * 用法：
 *   node tools/build-abstractor-data.mjs            # 生成（覆盖）
 *   node tools/build-abstractor-data.mjs --check    # 只检查是否与生成结果一致
 *
 * 数据来源：abstractor2026 项目的同名文件（2026-10 版本）。
 * 更新词典/模型时：替换 CSV / JSON，然后重跑本脚本。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'src', 'abstractor', 'data');
const ALIAS_FILE = path.join(DATA_DIR, 'alias_list.csv');
const BAND_FILE = path.join(DATA_DIR, 'band_list.csv');
const RANKER_FILE = path.join(DATA_DIR, 'title-ranker.json');
const ALIASES_OUT = path.join(DATA_DIR, 'aliases.js');
const RANKER_OUT = path.join(DATA_DIR, 'ranker.js');

const HEADER = `// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: node tools/build-abstractor-data.mjs
`;

/**
 * 解析本项目使用的简单 CSV（无引号字段）。
 *
 * alias_list.csv / band_list.csv 只有名字、逗号和换行，没有 RFC4180 的引号转义，
 * 因此这里用最小实现；出现引号会直接报错，避免静默解析错位。
 *
 * @param {string} text 文件内容。
 * @param {string} file 文件名（用于报错）。
 * @returns {string[][]} 去掉 BOM、空行与行尾空字段后的表格。
 */
function parseSimpleCsv(text, file) {
  const body = text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.includes('"')) {
    throw new Error(`${file}: 含引号字段，请改用 RFC4180 解析器（本项目数据不应出现引号）`);
  }
  return body
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => {
      const trimmed = row.slice();
      while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
      return trimmed;
    });
}

/**
 * 把行数组渲染为可读的 JS 字面量（每行一条）。
 * @param {string[][]} rows 二维字符串数组。
 * @returns {string} 缩进好的代码块。
 */
function renderRows(rows) {
  return rows.map((row) => `  ${JSON.stringify(row)},`).join('\n');
}

const aliasRows = parseSimpleCsv(fs.readFileSync(ALIAS_FILE, 'utf8'), 'alias_list.csv');
const bandRows = parseSimpleCsv(fs.readFileSync(BAND_FILE, 'utf8'), 'band_list.csv');
const ranker = JSON.parse(fs.readFileSync(RANKER_FILE, 'utf8'));

if (aliasRows.length === 0) throw new Error('alias_list.csv 为空');
if (bandRows.length === 0) throw new Error('band_list.csv 为空');
if (!Array.isArray(ranker.members) || ranker.version !== 'ensemble-ranker-v1') {
  throw new Error(`title-ranker.json 版本异常：${String(ranker.version)}（期望 ensemble-ranker-v1）`);
}

const aliasesSource = `${HEADER}// 来源：alias_list.csv（${aliasRows.length} 位歌手）与 band_list.csv（${bandRows.length} 个组合）。
// 第一列是正式名，其余列是别名 / 组合成员；空列保留与否都不影响匹配。

export const ALIAS_ROWS = [
${renderRows(aliasRows)}
];

export const BAND_ROWS = [
${renderRows(bandRows)}
];
`;

const rankerSource = `${HEADER}// 来源：title-ranker.json（${ranker.members.length} 个成员模型的概率平均）。
// 元信息：${JSON.stringify(ranker.meta ?? {})}

export const TITLE_RANKER = ${JSON.stringify(ranker)};
`;

/**
 * 写入或校验一个生成文件。
 * @param {string} file 目标路径。
 * @param {string} content 期望内容。
 * @param {boolean} checkOnly 是否只校验。
 * @returns {boolean} 是否有差异（checkOnly 模式下）。
 */
function emit(file, content, checkOnly) {
  const exists = fs.existsSync(file);
  const current = exists ? fs.readFileSync(file, 'utf8') : '';
  const same = current === content;
  if (checkOnly) {
    if (!same) console.error(`[stale] ${path.relative(ROOT, file)} 与源数据不一致`);
    return !same;
  }
  if (same) {
    console.log(`[skip ] ${path.relative(ROOT, file)} 无变化`);
  } else {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`[write] ${path.relative(ROOT, file)} (${(content.length / 1024).toFixed(1)} KiB)`);
  }
  return false;
}

const checkOnly = process.argv.includes('--check');
let stale = false;
stale = emit(ALIASES_OUT, aliasesSource, checkOnly) || stale;
stale = emit(RANKER_OUT, rankerSource, checkOnly) || stale;

console.log(
  `数据：${aliasRows.length} 位歌手 / ${bandRows.length} 个组合 / ` +
  `${ranker.members.length} 个模型成员${checkOnly ? '（校验模式）' : ''}`,
);

if (checkOnly && stale) process.exitCode = 1;
