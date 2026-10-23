/**
 * Artist extraction from an MV string.
 *
 * Rules (matching the labelling conventions of `fine_result.csv`):
 * 1. Dictionary lookup: every canonical name and alias is searched
 *    case-insensitively (full-width/half-width folded), longest match first.
 * 2. Bands: a band mention only counts when it sits in the artist slot (the
 *    first block, or a block that also names a member, or when no artist was
 *    found at all).  Expanding a band to *more than three* artists is not
 *    allowed — the band name from the MV is kept instead; otherwise the member
 *    list is written out.
 * 3. Collectives: when the MV talks about a virtual-singer collective
 *    (`虚拟`, `Vsinger`, `V家`, `VC`, `全员`, `N人合唱`, …) and no single artist
 *    can be identified, or five and more artists are involved, the answer is
 *    the collective label `VOCALOID`.
 * 4. Artists outside the dictionary: the artist slot (`【…原创】`, `【A/B】`, …)
 *    is parsed and name-like tokens are returned verbatim.
 * 5. Nothing identifiable → empty list (the dataset labels such rows empty).
 *
 * @module artists
 */

import { metadataScore } from './lexicon.js';
import { parseBlocks } from './segment.js';
import { splitWithOffsets } from './text.js';

/**
 * Words that indicate a virtual-singer collective.
 *
 * @type {RegExp}
 */
export const VIRTUAL_RE = /虚拟|vsinger|vocaloid|V家|中V|歌姬|五维介质|术力口|VCH/i;

/**
 * Short collective tag (`VC`) — only counts as a collective when the MV also
 * mentions a group size (`VC女团6人`), otherwise it is a convention acronym
 * (`VCF4魅力来袭`).
 *
 * @type {RegExp}
 */
export const VC_RE = /VC/;

/**
 * Words/counts that indicate "many singers" (`6人`, `全员`, `大合唱`, …).
 *
 * @type {RegExp}
 */
export const COLLECTIVE_RE = /(?:\d+|[一二三四五六七八九十百]+)\s*(?:人|位)|全员|大合唱|合唱|女团|男团|人组|人合唱/;

/**
 * Label used for an unidentified virtual-singer collective.
 *
 * @type {string}
 */
export const COLLECTIVE_LABEL = 'VOCALOID';

/**
 * Default tuning knobs for artist extraction.
 *
 * @type {Readonly<object>}
 */
export const ARTIST_OPTIONS = Object.freeze({
  /** Keep a band name instead of expanding it when the result would exceed this many artists. */
  bandKeepThreshold: 3,
  /** Number of identified artists that turns a virtual collective into `VOCALOID`. */
  collectiveArtistThreshold: 5,
  /** Ignore dictionary hits that live inside metadata blocks (`【PV付】`, `【VOCALOID COVER】`…). */
  ignoreMetadataBlocks: true,
  /** Parse the artist slot for names that are missing from the dictionary. */
  guessUnknownArtists: true,
  /** Expand single-character shorthands (`洛/言/绫/尘`). */
  expandShorthands: true,
  /** Label written for an unidentified virtual-singer collective. */
  collectiveLabel: COLLECTIVE_LABEL,
});

/**
 * @typedef {object} BandUse
 * @property {string} name Band name as found in the MV.
 * @property {string[]} members Canonical members.
 * @property {'expanded'|'kept'|'ignored'} mode What the extractor did with it.
 */

/**
 * @typedef {object} ArtistExtraction
 * @property {string[]} artists Canonical artist names, in reading order.
 * @property {import('./dictionary.js').NameMatch[]} matches All dictionary hits.
 * @property {BandUse[]} bands Band mentions and how they were handled.
 * @property {'dictionary'|'collective'|'guessed'|'empty'} source Which rule produced the result.
 */

/**
 * Strip trailing upload-metadata words from an artist slot (`星砂原创` → `星砂`).
 *
 * @param {string} text Block text.
 * @returns {string} Text without trailing credit markers.
 */
function stripArtistSuffix(text) {
  return text
    .replace(/(?:原创曲?|翻唱|翻调|翻填|原创部|cover曲?|Cover曲?|COVER曲?|出品|制作|策划)\s*$/u, '')
    .replace(/[\s\-—–·・]+$/u, '')
    .trim();
}

/**
 * Metadata words that mark a *credit* block (as opposed to an artist block that
 * also carries a credit word, e.g. `乐正绫原创`).
 *
 * @type {RegExp}
 */
const CREDIT_BLOCK_RE = /PV|pv|cover|Cover|COVER|字幕|混音|调教|后期|母带|配布|一图流|手书/;

/**
 * Words that make a block an artist slot even when it also contains a credit
 * word (`乐正绫原创`, `心华翻唱`, `赤羽&苍穹原创曲`).
 *
 * @type {RegExp}
 */
const ARTIST_SLOT_RE = /原创|翻唱|翻调|自调|原创曲/;

/**
 * Whether a block is a pure credit block whose artist mentions are not the
 * performers of this upload (`【初音系列插画PV】`, `【VOCALOID COVER】`).
 *
 * @param {string} text Block text.
 * @returns {boolean} `true` for credit blocks.
 */
function isCreditBlock(text) {
  return CREDIT_BLOCK_RE.test(text) && !ARTIST_SLOT_RE.test(text);
}

/**
 * Metadata words that disqualify a token from being treated as an artist name.
 *
 * @type {RegExp}
 */
const NOT_A_NAME_RE = /PV|pv|付|原创|翻唱|翻调|cover|Cover|COVER|社|工作室|Project|project|专辑|曲|祭|年|月|日|版本|ver|Ver|大赛|比赛|吧|字幕|音效|混音|出品|制作|调教|合唱|合集|单品|拜年|贺岁|纪|赛|live|Live|LIVE|教程|片段|完整版|高清|版|主催|画师|曲绘|作词|作曲|编曲|演奏/;

/**
 * Whether a token looks like a person/act name that could be an artist.
 *
 * @param {string} token Candidate name.
 * @returns {boolean} `true` when the token is name-like.
 */
function looksLikeName(token) {
  const text = token.trim();
  if (!text) return false;
  if (NOT_A_NAME_RE.test(text)) return false;
  const chars = [...text];
  const cjk = chars.filter((ch) => /[\u4e00-\u9fff]/u.test(ch)).length;
  const latin = chars.filter((ch) => /[A-Za-z]/.test(ch)).length;
  const digits = chars.filter((ch) => /\d/.test(ch)).length;
  const others = chars.length - cjk - latin - digits;
  if (digits > 0 || others > 0) return false;
  if (cjk > 0 && latin > 0) return false;
  if (cjk >= 2) return cjk <= 6;
  if (latin >= 2) return latin <= 14;
  return false;
}

/**
 * Single-character shorthand table for the common virtual singers
 * (`洛/言/绫/尘` → 洛天依, 言和, 乐正绫, 星尘).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SHORTHAND = Object.freeze({
  洛: '洛天依',
  天: '洛天依',
  依: '洛天依',
  言: '言和',
  绫: '乐正绫',
  尘: '星尘',
  星: '星尘',
  心: '心华',
  墨: '墨清弦',
  牙: '乐正龙牙',
  柯: '徵羽摩柯',
  海: '海伊',
  羽: '赤羽',
});

/**
 * Expand a block made only of single-character shorthand tokens.
 *
 * @param {string} text Block text.
 * @returns {string[]} Canonical artists (`[]` when the block is not shorthand).
 */
export function expandShorthandBlock(text) {
  const tokens = text.split(/[\s\\/|｜&＆、，,·・×♡❤★☆✡✿]+/u).filter(Boolean);
  if (tokens.length < 2) return [];
  if (!tokens.every((token) => [...token].length === 1)) return [];
  /** @type {string[]} */
  const artists = [];
  for (const token of tokens) {
    const canonical = SHORTHAND[token];
    if (!canonical) return [];
    if (!artists.includes(canonical)) artists.push(canonical);
  }
  return artists;
}

/**
 * Expand a run of single-character shorthands written without separators
 * (`洛言心绫星墨` → 洛天依, 言和, 心华, 乐正绫, 星尘, 墨清弦).
 *
 * @param {string} text Block text.
 * @returns {string[]} Canonical artists (`[]` when the text is not a shorthand run).
 */
export function expandShorthandRun(text) {
  const chars = [...text.trim()];
  if (chars.length < 3) return [];
  if (!chars.every((ch) => SHORTHAND[ch])) return [];
  /** @type {string[]} */
  const artists = [];
  for (const ch of chars) if (!artists.includes(SHORTHAND[ch])) artists.push(SHORTHAND[ch]);
  // A single canonical name spelled out (`洛天依`) is not shorthand.
  return artists.length >= 2 ? artists : [];
}

/**
 * Parse an artist slot for names that are missing from the dictionary.
 *
 * Only `【…】` blocks are considered (the artist slot convention), and the whole
 * block must consist of name-like tokens so that titles and credits are not
 * mistaken for artists.
 *
 * @param {import('./segment.js').Block[]} blocks Parsed blocks.
 * @param {import('./dictionary.js').EntityDictionary} dictionary Artist dictionary.
 * @param {boolean} expandShorthands Whether to expand `洛/言/绫/尘`-style slots.
 * @returns {string[]} Name-like tokens in reading order (`[]` when unsure).
 */
function guessFromArtistSlot(blocks, dictionary, expandShorthands) {
  for (const block of blocks) {
    if (block.open !== '【') continue;
    const raw = block.text.trim();
    if (!raw) continue;

    if (expandShorthands) {
      const shorthand = expandShorthandBlock(raw);
      if (shorthand.length > 0) return shorthand;
      const run = expandShorthandRun(raw);
      if (run.length > 0) return run;
    }

    const text = stripArtistSuffix(raw);
    if (!text) continue;
    const tokens = text.split(/[\s\\/|｜&＆、，,·・×]+/u).map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) continue;
    if (!tokens.every(looksLikeName)) continue;
    if (tokens.some((token) => dictionary.bandExists(token) || dictionary.canonicalOf(token))) continue;
    return [...new Set(tokens)];
  }
  return [];
}

/**
 * Extract the artist list from an MV string.
 *
 * @param {string} mv MV title string.
 * @param {import('./dictionary.js').EntityDictionary} dictionary Artist dictionary.
 * @param {object} [options] Extraction options (see {@link ARTIST_OPTIONS}).
 * @param {import('./segment.js').Block[]} [options.blocks] Pre-parsed blocks (avoids re-parsing).
 * @returns {ArtistExtraction} Artists, raw matches and diagnostics.
 * @example
 * extractArtists('【洛天依/乐正绫】心空', dict).artists; // ['洛天依', '乐正绫']
 */
export function extractArtists(mv, dictionary, options = {}) {
  const settings = { ...ARTIST_OPTIONS, ...options };
  const blocks = options.blocks ?? parseBlocks(mv);
  const matches = dictionary.findMatches(mv);

  /** @type {Map<string, number>} Canonical artist → first offset. */
  const positions = new Map();
  /** @type {Array<{name: string, start: number, members: string[], blockIndex: number}>} */
  const bandHits = [];

  /**
   * Index of the deepest block containing an offset.
   * @param {number} offset Offset in `mv`.
   * @returns {number} Block index.
   */
  const blockAt = (offset) => {
    let best = 0;
    let bestDepth = -1;
    for (const block of blocks) {
      if (block.start <= offset && block.end >= offset && block.depth > bestDepth) {
        best = block.index;
        bestDepth = block.depth;
      }
    }
    return best;
  };

  for (const match of matches) {
    const blockIndex = blockAt(match.start);
    const block = blocks[blockIndex];
    // Credits after the artist slot may name artists without them being the
    // performers of this upload (`【初音系列插画PV】`), so they are ignored.
    if (settings.ignoreMetadataBlocks && block && block.index > 0 && isCreditBlock(block.text)) continue;

    // Band names may also be listed as canonical artists (`南北组`, `兄妹组`);
    // both spellings are treated as bands here.
    if (dictionary.bandExists(match.canonical) || match.kind === 'band') {
      if (bandHits.some((band) => band.name === match.canonical)) continue;
      bandHits.push({
        name: match.canonical,
        start: match.start,
        members: dictionary.membersOf(match.canonical),
        blockIndex,
      });
      continue;
    }
    if (!positions.has(match.canonical)) positions.set(match.canonical, match.start);
  }

  // A band is part of the artist slot when it opens the MV, sits in a block
  // next to a named member, or is the only artist information available; a band
  // inside a trailing tag (`【PV付/南北组】`) is prose.
  /** @type {BandUse[]} */
  const bands = [];
  for (const band of bandHits) {
    const inFirstBlock = band.blockIndex === 0;
    const ownsBlock = matches.some((match) => !dictionary.bandExists(match.canonical)
      && match.kind === 'artist'
      && match.start >= blocks[band.blockIndex].start
      && match.end <= blocks[band.blockIndex].end);
    const active = positions.size === 0 || inFirstBlock || ownsBlock;
    if (!active) {
      bands.push({ name: band.name, members: band.members, mode: 'ignored' });
      continue;
    }
    const missing = band.members.filter((member) => !positions.has(member));
    if (missing.length === 0) {
      bands.push({ name: band.name, members: band.members, mode: 'ignored' });
      continue;
    }
    if (positions.size + missing.length > settings.bandKeepThreshold) {
      if (!positions.has(band.name)) positions.set(band.name, band.start);
      bands.push({ name: band.name, members: band.members, mode: 'kept' });
      continue;
    }
    missing.forEach((member, i) => {
      if (!positions.has(member)) positions.set(member, band.start + i / 1000);
    });
    bands.push({ name: band.name, members: band.members, mode: 'expanded' });
  }

  // `VOCALOID`/`V+` is a collective label, not an artist next to a real one:
  // `【洛天依】…【VOCALOID COVER】` names 洛天依, not VOCALOID.
  if (positions.size > 1) positions.delete(settings.collectiveLabel);

  /** @type {string[]} */
  let artists = [...positions.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  let source = artists.length > 0 ? 'dictionary' : 'empty';

  // Shorthand slots (`洛言心绫星墨`) are names, not dictionary hits.
  for (const block of blocks) {
    if (block.open !== '【') continue;
    if (dictionary.canonicalOf(block.text)) continue;
    const expanded = expandShorthandBlock(block.text);
    if (expanded.length === 0) {
      // Shorthand may be one part of the block (`VC女团6人/洛言心绫星墨`).
      const offset = block.start;
      for (const part of splitWithOffsets(block.text, /[\s\\/|｜&＆、，,·・×♡❤★☆✡✿]+/u)) {
        if (dictionary.canonicalOf(part.text)) continue;
        const run = expandShorthandRun(part.text);
        if (run.length === 0) continue;
        const start = offset + part.offset;
        const end = start + part.text.length;
        artists = artists.filter((name) => !matches.some((match) => match.canonical === name
          && match.start >= start && match.end <= end));
        run.forEach((name, i) => {
          if (!positions.has(name)) positions.set(name, start + i / 1000);
        });
      }
      continue;
    }
    artists = artists.filter((name) => !matches.some((match) => match.canonical === name
      && match.start >= block.start && match.end <= block.end));
    expanded.forEach((name, i) => {
      if (!positions.has(name)) positions.set(name, block.start + i / 1000);
    });
  }

  // Re-sort after shorthand expansion so reading order is preserved.
  artists = [...positions.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  if (artists.length > 0) source = 'dictionary';

  const virtual = VIRTUAL_RE.test(mv);
  const collective = COLLECTIVE_RE.test(mv);
  const vc = VC_RE.test(mv);

  if (artists.length === 0) {
    // Unknown artists: parse the artist slot (`【星砂原创】`, `【A&B】`, …).
    const guessed = settings.guessUnknownArtists
      ? guessFromArtistSlot(blocks, dictionary, settings.expandShorthands)
      : [];
    if (guessed.length > 0 && !virtual && !collective) {
      artists = guessed;
      source = 'guessed';
    } else if (virtual || collective || vc) {
      artists = [settings.collectiveLabel];
      source = 'collective';
    } else if (guessed.length > 0) {
      artists = guessed;
      source = 'guessed';
    }
  } else if (source === 'dictionary') {
    if ((virtual || vc) && artists.length >= settings.collectiveArtistThreshold) {
      artists = [settings.collectiveLabel];
      source = 'collective';
    }
  }

  return { artists, matches, bands, source };
}
