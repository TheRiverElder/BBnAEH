/**
 * Vocabulary used to separate "title" text from upload metadata
 * (production credits, version tags, event names, staff handles…).
 *
 * The lists are deliberately conservative: they drive *features* of the
 * candidate ranker, not hard decisions, so a false positive only costs a small
 * score penalty.
 *
 * @module lexicon
 */

/**
 * Patterns that almost always mark a fragment as upload metadata rather than a
 * song title (production credits, PV tags, event names, version suffixes).
 *
 * @type {RegExp}
 */
export const STRONG_META_RE = new RegExp(
  [
    '原创', '翻唱', '翻调', '自调', '调教', '本家', '翻填',
    'cover', 'Cover', 'COVER',
    'PV', 'pv', 'Pv',
    '付', '收录', '专辑', '合集', '精选', '特辑', '收录曲',
    '字幕', '填词', '混音', '母带', '扒带', '伴奏', '重编', '作词', '作曲', '编曲', '后期',
    '映像', '制作组', '制作', '工作室', '出品', '授权', '已授权', '搬运', '转载', '补档',
    '片段', '剪辑', '高音质', '无损', '重制', '重置', '修复', '完整版', '官方版', '剧场版',
    '教程', '手书', '一图流', '一图', 'MMD', 'VOCALOID', 'Vocaloid', 'vocaloid', 'VSQX', 'vsqx',
    '配布', '合唱', '联唱', 'DEMO', 'demo', '试听', '演唱会', '现场版',
    '生贺', '诞生日', '诞生祭', '贺岁', '拜年', '单品', '应援', '初投稿', '首发', '生快',
    '中文版', '日文版', '英文版', '粤语版', '国语版', '版本',
    '策划', '企划', '大赛', '征稿', 'Project', 'project',
    '主题曲', '片头曲', '片尾曲', 'BGM', 'bgm', '生诞祭', '祭付',
  ].join('|'),
);

/**
 * Patterns that are only *weakly* indicative of metadata; each may appear in a
 * genuine song title (`明日、晴`, `夜曲`, `声`).
 *
 * @type {RegExp}
 */
export const WEAK_META_RE = /曲|歌|音乐|系列|祭|社|版|纪念|周年|生日|庆|贺|投稿|演|演奏|乐器|钢琴|吉他|纯音乐|OST|原声|v家|V家/i;

/**
 * Markers followed by staff/credit text inside a free-text fragment
 * (`… -Arrange ver.-`, `… feat.洛天依`, `… cover YOASOBI`).
 *
 * @type {RegExp}
 */
export const CREDIT_MARKER_RE = /(?:\s[-—–]|feat\.?|ft\.?|cover|Cover|COVER|ver\.|Ver\.|VER\.|version|Version|Arrange|arrange|remix|Remix|REMIX)/;

/**
 * Trailing decorations that are never part of a title: version tags, PV tags,
 * quality tags, staff fragments.
 *
 * @type {RegExp}
 */
export const TRAILING_META_RE = new RegExp(
  '(?:' + [
    '完整版\\s*PV付?', '完整版', '官方PV版', '官方版', '高清版', '修复版', '重投',
    '中日字幕', '中文字幕', '中文字幕付', '字幕付', '字幕',
    'PV付', 'pv付', 'PV附', 'pv附', 'PV', 'pv',
    '翻译付', '戏腔付', '一图流付', '一图流', '一图付',
    '3DPV', 'MMD', 'HD', 'hd', '4K', '1080P', '1080p',
    '版',
  ].join('|') + ')\\s*$',
);

/**
 * Separators that end a title inside a free-text fragment
 * (`我的歌，威力永恒！` is one title, but `心说，这将是我的…` is a title
 * followed by a description).
 *
 * @type {RegExp}
 */
export const NARRATIVE_BREAK_RE = /——|--|—/;

/**
 * Quotation marks.  Unlike other punctuation these are *always* segmentation
 * characters: a song title never spans a quote boundary.  The ASCII apostrophe
 * is deliberately excluded — it belongs to English titles (`And I'm home`).
 *
 * @type {string}
 */
export const QUOTE_CHARS = '“”‘’"';

/**
 * Characters that force segmentation; any candidate containing one of them
 * spans a quote boundary and is therefore not a title.
 *
 * @type {RegExp}
 */
export const STRICT_QUOTE_RE = /[“”‘’"]/u;

/**
 * Splitting pattern for fragments that are always segmented: bracket-ish
 * slashes, pipes, enumeration marks, the mandatory quotation marks and the
 * `x`/`X` joiner used between artist names.
 *
 * `×` is deliberately *not* a separator (it is part of titles such as
 * `Gimme×Gimme`), and `·`/`，` are handled by {@link SOFT_SPLIT_RE} so that both
 * the split and the un-split reading remain available.
 *
 * @type {RegExp}
 */
export const ENUMERATION_SPLIT_RE = new RegExp(
  `\\s*[\\\\/／|｜丨、~～:：;；${QUOTE_CHARS.replace(/[\\\]^]/g, '\\$&')}]\\s*|\\s+x\\s+|\\s+X\\s+`,
  'u',
);

/**
 * Ambiguous separators.  A title may or may not be split here (`花·雨`,
 * `明天，你好` are titles; `小星球，那是我的小星球` is a title followed by
 * prose), so both readings are generated as candidates.
 *
 * @type {RegExp}
 */
export const SOFT_SPLIT_RE = /\s*[，,、·・。…！!？?]\s*/;

/**
 * Splitting pattern for free-text fragments where a hyphen separates the title
 * from a subtitle/credit (`CONNECT~心的连接~`, `beyond the ocean -海的彼方-`).
 *
 * @type {RegExp}
 */
export const HYPHEN_SPLIT_RE = /\s*[-–—]+\s*/;

/**
 * Matches a leading track/index number (`01.最初的旋律`, `02.蝶`).
 *
 * @type {RegExp}
 */
export const LEADING_INDEX_RE = /^\s*\d{1,3}\s*[.、．]\s*/;

/**
 * Matches a trailing software-style version suffix (`遇梦记2.0`, `v2`, `2 . 0`).
 *
 * @type {RegExp}
 */
export const TRAILING_VERSION_RE = /[\s_-]*(?:v|V|ver\.?)?\d(?:[\s.]*\d)*\s*$/;

/**
 * `feat.` / `ft.` clause start (everything from here on is a credit).
 *
 * @type {RegExp}
 */
export const FEAT_RE = /[\s(（]*\b(?:feat|ft)\.?\s*/i;

/**
 * Leading filler words that introduce a title but are not part of it
 * (`催泪向`, `送给A路人`, `改编版`).
 *
 * @type {RegExp}
 */
export const LEADING_FILLER_RE = /^(?:催泪向|高燃|治愈向|洗脑向|神曲|燃向|福利|搬运|转载|补档|改编版|翻唱版|初投稿|新人|官方|字幕)\s*/;

/**
 * Score how much a fragment looks like upload metadata.
 *
 * The score is returned on a `0…1` scale and combines the strong pattern list,
 * weak indicators and bracket-free credit tails.  It is a soft signal: the
 * ranker decides, this only measures.
 *
 * @param {string} text Fragment to score.
 * @returns {number} Metadata-likeness in `[0, 1]`.
 * @example
 * metadataScore('原创PV付'); // 1
 * metadataScore('彼方');     // 0
 */
export function metadataScore(text) {
  if (!text) return 0;
  let score = 0;
  if (STRONG_META_RE.test(text)) {
    score += 0.85;
  } else {
    const weakHits = text.match(new RegExp(WEAK_META_RE.source, 'gi'));
    score += Math.min(0.45, 0.15 * (weakHits ? weakHits.length : 0));
  }
  // Standalone staff/studio suffixes: `踏云社`, `坐标P`, `洞心社`.
  if (/(?:社|工作室|制作组|乐团|出品)$/.test(text)) score += 0.3;
  if (/^[A-Za-z][A-Za-z0-9_.&' -]*P$/.test(text)) score += 0.2;
  return Math.min(1, score);
}

/**
 * Whether a fragment is metadata-like enough to be rejected outright.
 *
 * @param {string} text Fragment to test.
 * @returns {boolean} `true` when the fragment is dominated by metadata patterns.
 */
export function isMetadataLike(text) {
  return metadataScore(text) >= 0.6;
}

/**
 * Strip trailing metadata tags without touching the leading whitespace.
 *
 * Kept separate from {@link trimTrailingMeta} so candidate generation can
 * preserve exact offsets into the MV string.
 *
 * @param {string} text Candidate fragment.
 * @returns {string} Fragment without trailing tags (leading whitespace kept).
 */
export function stripTrailingMeta(text) {
  let current = text;
  for (let guard = 0; guard < 4; guard += 1) {
    const next = current.replace(TRAILING_META_RE, '').replace(/[\s\-–—~·]+$/, '');
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Strip trailing metadata tags (version, PV, quality, event names) from a
 * candidate title.  Applied repeatedly until the string stops changing.
 *
 * @param {string} text Candidate fragment.
 * @returns {string} Fragment without trailing tags.
 * @example
 * trimTrailingMeta('漂亮面对完整版PV'); // '漂亮面对'
 */
export function trimTrailingMeta(text) {
  return stripTrailingMeta(text).trim();
}
