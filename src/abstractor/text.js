/**
 * Character-level helpers shared by the extraction pipeline.
 *
 * Everything here is dependency free and works on UTF-16 code units.  All
 * "rewriting" helpers preserve string length one character at a time so that
 * offsets computed on a folded string stay valid for the original string.
 *
 * @module text
 */

/** Full-width ASCII block (U+FF01..U+FF5E) mapped to its ASCII counterpart. */
const FULL_WIDTH_TO_ASCII = (() => {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (let code = 0xff01; code <= 0xff5e; code += 1) {
    map.set(String.fromCharCode(code), String.fromCharCode(code - 0xfee0));
  }
  map.set('\u3000', ' '); // ideographic space
  return map;
})();

/**
 * Characters that are structural delimiters for the MV grammar.  They are
 * deliberately *not* folded because bracket matching relies on them.
 */
const STRUCTURAL = new Set(['【', '】', '《', '》', '「', '」', '『', '』', '（', '）', '〔', '〕', '［', '］']);

/**
 * Normalise a string for *matching* while keeping a 1:1 character mapping to
 * the input, so `folded.indexOf(x)` indexes can be reused on the original.
 *
 * Folding applied: full-width ASCII → ASCII, ideographic space → space,
 * `A-Z` → `a-z`.  Structural CJK brackets are left untouched.
 *
 * @param {string} input Source text.
 * @returns {string} Folded text of identical length.
 * @example
 * foldMatch('Ｋａｉｔｏ'); // 'kaito'
 */
export function foldMatch(input) {
  let out = '';
  for (const ch of input) {
    if (STRUCTURAL.has(ch)) {
      out += ch;
      continue;
    }
    const mapped = FULL_WIDTH_TO_ASCII.get(ch);
    if (mapped !== undefined) {
      out += mapped >= 'A' && mapped <= 'Z' ? mapped.toLowerCase() : mapped;
      continue;
    }
    out += ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch;
  }
  return out;
}

/**
 * Test whether a character is a CJK ideograph (including the extension blocks
 * commonly found in song titles).
 *
 * @param {string} ch Single character.
 * @returns {boolean} `true` when the character is an ideograph.
 */
export function isCjk(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

/**
 * Test whether a character is Japanese kana (hiragana or katakana).
 *
 * @param {string} ch Single character.
 * @returns {boolean} `true` for kana.
 */
export function isKana(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x3041 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff);
}

/**
 * Test whether a character is an ASCII letter.
 *
 * @param {string} ch Single character.
 * @returns {boolean} `true` for `A-Z`/`a-z`.
 */
export function isLatin(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * Test whether a character is an ASCII or full-width decimal digit.
 *
 * @param {string} ch Single character.
 * @returns {boolean} `true` for digits.
 */
export function isDigit(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x30 && code <= 0x39) || (code >= 0xff10 && code <= 0xff19);
}

/**
 * Count the number of characters of each script in a string.
 *
 * @param {string} text Input text.
 * @returns {{length: number, cjk: number, kana: number, latin: number, digit: number, space: number, symbol: number}}
 *   Character counts; `symbol` covers everything that is not CJK, kana, Latin,
 *   digit or whitespace (punctuation, emoji, decorations…).
 */
export function scriptStats(text) {
  const chars = [...text];
  let cjk = 0;
  let kana = 0;
  let latin = 0;
  let digit = 0;
  let space = 0;
  let symbol = 0;
  for (const ch of chars) {
    if (isCjk(ch)) cjk += 1;
    else if (isKana(ch)) kana += 1;
    else if (isLatin(ch)) latin += 1;
    else if (isDigit(ch)) digit += 1;
    else if (/\s/.test(ch)) space += 1;
    else symbol += 1;
  }
  return { length: chars.length, cjk, kana, latin, digit, space, symbol };
}

/**
 * Punctuation and decoration characters that carry no title semantics when
 * they appear at the very beginning/end of a fragment.
 */
const EDGE_JUNK = /[\s"'“”‘’「」『』《》〈〉【】()（）\[\]〔〕［］{}!！?？.。·•・\-—–~～_+=*#@&＆|｜/\\:：;；,，、♥♡❤✿✟✧✦✨⭐★☆✡※※…⋯°♪♫♪:]+/u;

/**
 * Remove leading and trailing decoration characters.
 *
 * Only the edges are touched: separators inside a title (`明天，你好`) survive.
 *
 * @param {string} text Raw fragment.
 * @returns {string} Fragment without edge decorations.
 * @example
 * trimEdgeJunk('♥好想大声告诉你♥'); // '好想大声告诉你'
 */
export function trimEdgeJunk(text) {
  return trimEdgeJunkSpan(text).text;
}

/**
 * Remove leading and trailing decoration characters and report the trim.
 *
 * The `lead` value is the number of UTF-16 code units removed from the front,
 * which lets callers keep offsets into the original string exact.
 *
 * @param {string} text Raw fragment.
 * @returns {{text: string, lead: number}} Trimmed fragment and the leading offset shift.
 * @example
 * trimEdgeJunkSpan('♥你好'); // { text: '你好', lead: 1 }
 */
export function trimEdgeJunkSpan(text) {
  let current = text;
  let lead = 0;
  const leading = new RegExp(`^${EDGE_JUNK.source}`, 'u').exec(current);
  if (leading) {
    lead = leading[0].length;
    current = current.slice(lead);
  }
  const trailing = new RegExp(`${EDGE_JUNK.source}$`, 'u').exec(current);
  if (trailing) {
    current = current.slice(0, current.length - trailing[0].length);
  }
  // `EDGE_JUNK` covers whitespace, but be defensive about exotic spaces.
  const core = current.trim();
  const leadingSpace = current.length - current.trimStart().length;
  if (core !== current) {
    lead += leadingSpace;
    current = core;
  }
  return { text: current, lead };
}

/**
 * Collapse runs of whitespace into a single space and trim.
 *
 * @param {string} text Raw fragment.
 * @returns {string} Normalised whitespace.
 */
export function squeezeSpaces(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalise a title for comparison.
 *
 * Some MVs separate the Chinese title with spaces (`弱 碱 性 费 南 雪`) while the
 * label drops them, so whitespace must not make an otherwise correct title
 * count as wrong.  Case is preserved: the extractor returns exact substrings of
 * the MV, so a case difference is always a real difference.
 *
 * @param {string} title Raw title.
 * @returns {string} Title without any whitespace.
 * @example
 * normalizeTitle('弱 碱 性 费 南 雪'); // '弱碱性费南雪'
 */
export function normalizeTitle(title) {
  return title.replace(/\s+/gu, '');
}

/**
 * Compare two titles, ignoring whitespace.
 *
 * @param {string} a First title.
 * @param {string} b Second title.
 * @returns {boolean} `true` when both titles are equal up to whitespace.
 */
export function titlesEqual(a, b) {
  return a === b || normalizeTitle(a) === normalizeTitle(b);
}

/**
 * Split `text` on a global regex and report the offset of each part.
 *
 * @param {string} text Source text.
 * @param {RegExp} regex Split pattern.
 * @returns {Array<{text: string, offset: number}>} Non-empty parts with offsets.
 * @example
 * splitWithOffsets('a/b', /\//); // [{text: 'a', offset: 0}, {text: 'b', offset: 2}]
 */
export function splitWithOffsets(text, regex) {
  const pattern = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  /** @type {Array<{text: string, offset: number}>} */
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    /** @type {number} */
    const at = match.index ?? 0;
    parts.push({ text: text.slice(cursor, at), offset: cursor });
    cursor = at + match[0].length;
  }
  parts.push({ text: text.slice(cursor), offset: cursor });
  return parts.filter((part) => part.text.trim().length > 0);
}
