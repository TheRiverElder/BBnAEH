/**
 * 曲名提取的统一入口。
 *
 * 两套引擎并存：
 *
 * - `smart`  —— 移植自 abstractor2026 的「词典 + 括号感知分词 + 特征排序」流水线
 *   （`src/abstractor/`）。它把 MV 标题切成一堆候选 span，再用训练好的排序器
 *   打分选最优，因此能处理 `【歌手】歌名【PV付】`、`「歌名」`、`A/B 合唱`、
 *   `完整版PV`、破折号旁白等常见投稿格式。
 * - `legacy` —— 本项目原有的关键词匹配逻辑（`src/utils.js` 的
 *   `predicateSongName`），行为完全保留，用于对照与回退。
 *
 * 两个引擎都只返回「歌手数组 + 歌名」，输出文件名由 {@link formatSongName}
 * 统一拼装，并由 {@link sanitizeFileName} 处理 Windows 非法字符。
 *
 * @module songTitle
 */

import { predicateSongName } from './utils.js';
import { extractMv } from './abstractor/runtime.js';

export { extractorInfo } from './abstractor/runtime.js';

/** 智能引擎标识。 */
export const ENGINE_SMART = 'smart';
/** 旧版引擎标识。 */
export const ENGINE_LEGACY = 'legacy';

/** 界面上可选的引擎列表。 */
export const ENGINE_OPTIONS = [
  { value: ENGINE_SMART, label: '智能（词典 + 排序）' },
  { value: ENGINE_LEGACY, label: '旧版（关键词匹配）' },
];

/** 歌手来源的中文说明。 */
export const ARTIST_SOURCE_LABELS = {
  dictionary: '词典',
  collective: '虚拟歌姬',
  guessed: '推测',
  empty: '未识别',
  legacy: '旧版',
};

/** Windows 文件名里不允许出现的字符 → 视觉上接近的全角字符。 */
const ILLEGAL_FILE_CHARS = {
  '<': '＜',
  '>': '＞',
  ':': '：',
  '"': '＂',
  '/': '／',
  '\\': '＼',
  '|': '｜',
  '?': '？',
  '*': '＊',
};

/**
 * 去掉控制字符（换行、制表符等），换成空格。
 * 用循环而不是正则，避免 eslint 的 no-control-regex 规则。
 *
 * @param {string} text 原始文本。
 * @returns {string} 不含控制字符的文本。
 */
function removeControlChars(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    out += (code <= 0x1f || code === 0x7f) ? ' ' : ch;
  }
  return out;
}

/**
 * 把歌名清洗成 Windows / Linux 都合法的文件名。
 *
 * 旧逻辑按标点切分，天然不会带出非法字符；新逻辑保留原始 span
 * （`Gimme×Gimme`、`Re:0`、`A/B` 都是合法歌名），所以落盘前必须清洗，
 * 否则 server.js 用 `path.format()` 拼路径时会建出子目录或直接写失败。
 *
 * @param {string} name 原始名字。
 * @param {object} [options] 选项。
 * @param {string} [options.fallback='未命名'] 清洗后为空时的兜底名。
 * @param {number} [options.maxLength=120] 最大长度（Windows MAX_PATH 保护）。
 * @returns {string} 可安全用作文件名的字符串。
 * @example
 * sanitizeFileName('Re:0 / 从零开始'); // 'Re：0 ／ 从零开始'
 */
export function sanitizeFileName(name, options = {}) {
  const fallback = options.fallback ?? '未命名';
  const maxLength = options.maxLength ?? 120;
  let out = removeControlChars(String(name ?? ''))
    .replace(/[<>:"/\\|?*]/g, (ch) => ILLEGAL_FILE_CHARS[ch] ?? ' ')
    .replace(/[<>:"/\\|?*]/g, (ch) => ILLEGAL_FILE_CHARS[ch] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows 不允许文件名以点或空格结尾。
    .replace(/[. ]+$/g, '');

  if ([...out].length > maxLength) out = [...out].slice(0, maxLength).join('').replace(/[. ]+$/g, '');
  if (!out) out = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(out)) out = `_${out}`;
  return out;
}

/**
 * 用旧版引擎提取。
 *
 * 旧版只产出一个拼好的字符串（`歌手 & 歌手 - 歌名`），这里把它拆回结构化字段；
 * `text` 保留原样，方便界面/脚本对照旧输出。界面展示与落盘统一走
 * {@link formatSongName}，歌手之间用不带空格的 `&` 连接。
 *
 * @param {string} mv MV 标题。
 * @returns {object} 提取结果。
 */
function legacyResult(mv) {
  const text = predicateSongName(mv);
  const separator = text.indexOf(' - ');
  const artistPart = separator >= 0 ? text.slice(0, separator) : '';
  const title = separator >= 0 ? text.slice(separator + 3) : text;
  return {
    engine: ENGINE_LEGACY,
    // 兼容旧版输出的 `A & B` 与可能的 `A&B`
    artists: artistPart ? artistPart.split(/\s*&\s*/).filter(Boolean) : [],
    title: title.trim(),
    artistSource: 'legacy',
    text,
    candidates: [],
  };
}

/**
 * 用智能引擎提取，失败时自动回退旧版。
 *
 * @param {string} mv MV 标题。
 * @returns {object} 提取结果。
 */
function smartResult(mv) {
  if (!mv.trim()) {
    // 空标题没有可提取的信息；不要回退旧版（旧版会返回 " - " 这种垃圾）。
    return { engine: ENGINE_SMART, artists: [], title: '', artistSource: 'empty', text: '', candidates: [] };
  }
  const result = extractMv(mv);
  const artists = result.artists.filter(Boolean);
  const title = (result.title || '').trim();
  const candidates = result.ranked.slice(0, 3).map((candidate) => ({
    text: candidate.text,
    score: Number(candidate.score.toFixed(4)),
    variant: candidate.variant,
  }));

  if (!title) {
    // 候选池为空（例如整串都是元数据）：旧版至少能给一个名字，别让输入框空着。
    const fallback = legacyResult(mv);
    return {
      ...fallback,
      engine: ENGINE_SMART,
      fallback: ENGINE_LEGACY,
      artists: artists.length > 0 ? artists : fallback.artists,
      artistSource: result.artistSource,
      candidates,
    };
  }

  return {
    engine: ENGINE_SMART,
    artists,
    title,
    artistSource: result.artistSource,
    text: formatSongName({ artists, title }),
    candidates,
  };
}

/**
 * 提取一条 MV 的歌手与歌名。
 *
 * @param {string} mv MV 标题（例如 `【洛天依/乐正绫】情话【PV付】`）。
 * @param {object} [options] 选项。
 * @param {'smart'|'legacy'} [options.engine='smart'] 使用的引擎。
 * @returns {{engine: string, artists: string[], title: string, artistSource: string,
 *   text: string, candidates: Array<{text: string, score: number, variant: string}>,
 *   fallback?: string, error?: string}} 提取结果；
 *   `fallback` 表示智能引擎失败后回退到了旧版，`error` 是失败原因。
 * @example
 * extractSongInfo('【洛天依/乐正绫】情话【PV付】').text; // '洛天依&乐正绫 - 情话'
 */
export function extractSongInfo(mv, options = {}) {
  const source = typeof mv === 'string' ? mv : '';
  if (options.engine === ENGINE_LEGACY) return legacyResult(source);
  try {
    return smartResult(source);
  } catch (error) {
    const fallback = legacyResult(source);
    return {
      ...fallback,
      engine: ENGINE_SMART,
      fallback: ENGINE_LEGACY,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 把提取结果拼成 `歌手&歌手 - 歌名`（歌手之间不留空格；缺少一侧时就只输出另一侧）。
 *
 * @param {{artists: string[], title: string}} info 提取结果。
 * @returns {string} 展示 / 落盘用的名字。
 */
export function formatSongName(info) {
  const artists = (info.artists ?? []).filter(Boolean).join('&');
  const title = (info.title ?? '').trim();
  if (artists && title) return `${artists} - ${title}`;
  return artists || title;
}

/**
 * 一步到位：MV 标题 → 可直接写盘的曲名。
 *
 * @param {string} mv MV 标题。
 * @param {object} [options] 选项。
 * @param {'smart'|'legacy'} [options.engine='smart'] 使用的引擎。
 * @param {number} [options.maxLength] 最大长度。
 * @returns {{name: string, info: object}} 清洗后的文件名与完整结果。
 */
export function songFileNameOf(mv, options = {}) {
  const info = extractSongInfo(mv, options);
  return { name: sanitizeFileName(formatSongName(info), { maxLength: options.maxLength }), info };
}

/**
 * 歌手来源的展示文案。
 *
 * @param {{artistSource: string, fallback?: string, error?: string}} info 提取结果。
 * @returns {string} 例如 `词典`、`回退旧版`。
 */
export function artistSourceLabel(info) {
  if (info.error) return '出错·回退旧版';
  if (info.fallback === ENGINE_LEGACY) return '回退旧版';
  return ARTIST_SOURCE_LABELS[info.artistSource] ?? '—';
}

export { predicateSongName };
