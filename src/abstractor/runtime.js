/**
 * 浏览器端的抽象器运行时：把「词典 + 排序器」装配成一次调用即可用的提取器。
 *
 * 与 abstractor2026 的 `src/index.js` 不同，这里不读文件系统：
 * 词典与模型来自 `data/*.js`（由 tools/build-abstractor-data.mjs 生成）。
 *
 * @module abstractor/runtime
 */

import { EntityDictionary } from './dictionary.js';
import { extract } from './extract.js';
import { FEATURE_NAMES } from './features.js';
import { EnsembleModel, reviveRanker } from './model/ensemble.js';
import { ALIAS_ROWS, BAND_ROWS } from './data/aliases.js';
import { TITLE_RANKER } from './data/ranker.js';

/** @type {EntityDictionary|null} */
let dictionaryCache = null;
/** @type {import('./extract.js').Ranker|null} */
let rankerCache = null;

/**
 * 取（并缓存）歌手词典。
 * @returns {EntityDictionary} 由 alias_list.csv / band_list.csv 生成的词典。
 */
export function getDictionary() {
  if (!dictionaryCache) dictionaryCache = EntityDictionary.fromRows(ALIAS_ROWS, BAND_ROWS);
  return dictionaryCache;
}

/**
 * 校验模型的特征顺序与当前代码一致。
 *
 * 排序器把特征向量按下标点乘，顺序错了不会报错、只会静默变差；这里显式检查，
 * 让「模型文件过期」变成一个可见的错误。
 *
 * @param {import('./extract.js').Ranker} model 已加载的排序器。
 * @returns {void}
 * @throws {Error} 当某个成员的特征名/数量与 {@link FEATURE_NAMES} 不一致时。
 */
function assertFeatureLayout(model) {
  const members = model instanceof EnsembleModel ? model.members : [model];
  for (const member of members) {
    const names = member.features ?? [];
    const mismatch = names.length !== FEATURE_NAMES.length
      || names.some((name, index) => name !== FEATURE_NAMES[index]);
    if (mismatch) {
      throw new Error(
        `排序器与代码的特征布局不一致（模型 ${names.length} 维，代码 ${FEATURE_NAMES.length} 维）：` +
        '请用 tools/build-abstractor-data.mjs 重新生成模型数据，或回退旧版规则。',
      );
    }
  }
}

/**
 * 取（并缓存）训练好的排序器。
 * @returns {import('./extract.js').Ranker} 集成排序器（线性 + MLP 概率平均）。
 */
export function getRanker() {
  if (!rankerCache) {
    const model = TITLE_RANKER.version === 'ensemble-ranker-v1'
      ? EnsembleModel.fromJSON(TITLE_RANKER)
      : reviveRanker(TITLE_RANKER);
    assertFeatureLayout(model);
    rankerCache = model;
  }
  return rankerCache;
}

/**
 * 用词典 + 排序器提取一条 MV 的歌手与歌名。
 *
 * @param {string} mv MV 标题。
 * @param {object} [options] 提取选项。
 * @param {number} [options.maxCandidates=96] 候选池上限。
 * @returns {import('./extract.js').ExtractionResult} 提取结果（含候选排名）。
 */
export function extractMv(mv, options = {}) {
  return extract(mv, {
    dictionary: getDictionary(),
    model: getRanker(),
    maxCandidates: options.maxCandidates,
  });
}

/**
 * 数据集与模型的元信息，供界面/排查使用。
 * @returns {{artists: number, bands: number, model: object, members: number, features: number}} 元信息。
 */
export function extractorInfo() {
  const dictionary = getDictionary();
  return {
    artists: dictionary.canonicalNames.length,
    bands: dictionary.bands.size,
    model: TITLE_RANKER.meta ?? {},
    members: Array.isArray(TITLE_RANKER.members) ? TITLE_RANKER.members.length : 1,
    features: FEATURE_NAMES.length,
  };
}
