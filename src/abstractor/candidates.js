/**
 * Candidate generation for the song title.
 *
 * The gold titles in the dataset are always *substrings of the MV string*
 * (`fine_result.csv` coverage: 1425/1425), so title extraction can be framed as
 * "generate plausible spans, then pick one".  This module produces the span
 * pool; {@link module:features} and {@link module:scoring} do the ranking.
 *
 * Variants produced per block:
 * - `raw`        the block text as-is (whitespace trimmed),
 * - `edge`       with decoration characters (♥, quotes, brackets…) stripped,
 * - `trimmed`    with trailing metadata tags (`完整版PV`, `ver.`) removed,
 * - `narrative`  cut around an em-dash narration,
 * - `split`      one item of an enumeration (`A/B/C`, `A~B`, `A - B`),
 * - `space`      one whitespace-delimited chunk,
 * - `cjk`        a maximal CJK/Latin run inside a mixed-script fragment,
 * - `index`      with a leading track number removed (`02.蝶` → `蝶`).
 *
 * Every candidate keeps an exact offset into the MV string, which lets the
 * feature extractor reason about position without re-searching text.
 *
 * @module candidates
 */

import { isCjk, isKana, isLatin, splitWithOffsets, trimEdgeJunkSpan } from './text.js';
import {
  CREDIT_MARKER_RE,
  ENUMERATION_SPLIT_RE,
  HYPHEN_SPLIT_RE,
  LEADING_INDEX_RE,
  NARRATIVE_BREAK_RE,
  SOFT_SPLIT_RE,
  STRICT_QUOTE_RE,
  TRAILING_VERSION_RE,
  stripTrailingMeta,
} from './lexicon.js';
import { parseBlocks } from './segment.js';

/**
 * @typedef {'raw'|'edge'|'trimmed'|'feat'|'narrative'|'split'|'space'|'cjk'|'index'} CandidateVariant
 */

/**
 * One span that could be the song title.
 *
 * @typedef {object} Candidate
 * @property {string} text       Candidate title text.
 * @property {number} start      Start offset inside the MV string.
 * @property {number} end        End offset inside the MV string.
 * @property {number} blockIndex Index of the block the candidate was cut from.
 * @property {number} ordinal    Position of the span in the candidate pool.
 * @property {number} poolSize   Size of the candidate pool.
 * @property {CandidateVariant} variant How the span was produced.
 */

export { splitWithOffsets } from './text.js';

/**
 * Cut a string at the first credit marker (`feat.`, `cover`, `ver.`, ` - `).
 *
 * @param {string} text Fragment.
 * @returns {string} Prefix before the marker (`''` when the marker is at offset 0).
 */
function cutAtCreditMarker(text) {
  const match = CREDIT_MARKER_RE.exec(text);
  if (!match || match.index === 0) return '';
  return text.slice(0, match.index);
}

/**
 * Cut a string at the first narrative em-dash.
 *
 * @param {string} text Fragment.
 * @returns {string} Prefix before the dash (`''` when the dash is at offset 0).
 */
function cutAtNarrative(text) {
  const match = NARRATIVE_BREAK_RE.exec(text);
  if (!match || match.index === 0) return '';
  return text.slice(0, match.index);
}

/**
 * Extract maximal runs of a character class from a string.
 *
 * @param {string} text Source text.
 * @param {(ch: string) => boolean} predicate Character test.
 * @param {number} [minLength=2] Minimum run length to keep.
 * @returns {Array<{text: string, offset: number}>} Runs with their offsets.
 */
export function runsOf(text, predicate, minLength = 2) {
  /** @type {Array<{text: string, offset: number}>} */
  const runs = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = i < text.length ? text[i] : '';
    const inside = i < text.length && predicate(ch);
    if (inside && start === -1) start = i;
    if (!inside && start !== -1) {
      let from = start;
      let to = i;
      while (from < to && /\s/.test(text[from])) from += 1;
      while (to > from && /\s/.test(text[to - 1])) to -= 1;
      const run = text.slice(from, to);
      if ([...run].length >= minLength) runs.push({ text: run, offset: from });
      start = -1;
    }
  }
  return runs;
}

/**
 * Derive title candidates from one base fragment.
 *
 * All offsets passed to `emit` are relative to the MV string, so callers keep
 * exact positions even after edge trimming (which is where naive
 * `indexOf(text)` bookkeeping goes wrong on repeated substrings).
 *
 * @param {string} base Fragment text.
 * @param {number} baseOffset Offset of `base` inside the MV string.
 * @param {CandidateVariant} baseVariant Variant tag of the base fragment.
 * @param {(input: {text: string, offset: number, variant: CandidateVariant}) => void} emit Sink.
 * @returns {void}
 */
function deriveCandidates(base, baseOffset, baseVariant, emit) {
  /**
   * Emit a fragment after whitespace-only trimming (decorations are kept).
   * @param {string} rawText Fragment text.
   * @param {number} relOffset Offset of `rawText` inside `base`.
   * @param {CandidateVariant} variant Variant tag.
   * @returns {void}
   */
  const emitRaw = (rawText, relOffset, variant) => {
    const text = rawText.trim();
    if (!text) return;
    emit({ text, offset: baseOffset + relOffset + (rawText.length - rawText.trimStart().length), variant });
  };

  /**
   * Emit a fragment after trimming decoration characters at both ends.
   * @param {string} rawText Fragment text.
   * @param {number} relOffset Offset of `rawText` inside `base`.
   * @param {CandidateVariant} variant Variant tag.
   * @returns {void}
   */
  const emitTrimmed = (rawText, relOffset, variant) => {
    const span = trimEdgeJunkSpan(rawText);
    if (!span.text) return;
    emit({ text: span.text, offset: baseOffset + relOffset + span.lead, variant });
  };

  emitRaw(base, 0, baseVariant);

  // Trailing metadata is removed without touching the front of the fragment so
  // the emitted offset stays valid.
  const stripped = stripTrailingMeta(base);
  if (stripped && stripped !== base) emitTrimmed(stripped, 0, 'trimmed');

  // Software-style version suffixes: `遇梦记2.0` → `遇梦记`.
  const withoutVersion = base.replace(TRAILING_VERSION_RE, '');
  if (withoutVersion && withoutVersion !== base) emitRaw(withoutVersion, 0, 'trimmed');

  for (const cut of [cutAtCreditMarker(base), cutAtNarrative(base)]) {
    if (cut && cut !== base) emitTrimmed(cut, 0, 'trimmed');
  }

  // The narrated prefix keeps its own punctuation (`摩柯想变成女孩子！！`), and
  // its soft punctuation is segmented again (`…双厨狂喜！Gimme×Gimme`).
  const narrativePrefix = cutAtNarrative(base);
  if (narrativePrefix && narrativePrefix !== base) {
    emitRaw(narrativePrefix, 0, 'trimmed');
    for (const part of splitWithOffsets(narrativePrefix, SOFT_SPLIT_RE)) {
      emitRaw(part.text, part.offset, 'split');
    }
  }

  // A leading track number (`02.蝶`) is metadata, not part of the title.
  const indexMatch = LEADING_INDEX_RE.exec(base);
  if (indexMatch) emitRaw(base.slice(indexMatch[0].length), indexMatch[0].length, 'index');

  // Narrated uploads put the title *after* the dash as often as before it,
  // e.g. `相信我！真的不是刀子！乐正绫原创曲——剖心`.
  const narrative = NARRATIVE_BREAK_RE.exec(base);
  if (narrative) {
    const relOffset = narrative.index + narrative[0].length;
    emitTrimmed(base.slice(relOffset), relOffset, 'narrative');
  }

  for (const regex of [ENUMERATION_SPLIT_RE, HYPHEN_SPLIT_RE, SOFT_SPLIT_RE]) {
    for (const part of splitWithOffsets(base, regex)) {
      const span = trimEdgeJunkSpan(part.text);
      if (!span.text) continue;
      const relOffset = part.offset + span.lead;
      emit({ text: span.text, offset: baseOffset + relOffset, variant: 'split' });
      const trimmed = stripTrailingMeta(span.text);
      if (trimmed && trimmed !== span.text) emitRaw(trimmed, relOffset, 'trimmed');
      const index = LEADING_INDEX_RE.exec(span.text);
      if (index) emitRaw(span.text.slice(index[0].length), relOffset + index[0].length, 'index');
    }
  }

  for (const part of splitWithOffsets(base, /\s+/)) {
    emitTrimmed(part.text, part.offset, 'space');
  }

  // Mixed-script fragments: `星夜之诗POETRY OF STARRY NIGHT`.
  const hasCjk = [...base].some(isCjk);
  const hasLatin = [...base].some(isLatin);
  const hasKana = [...base].some(isKana);
  if (hasCjk && (hasLatin || hasKana)) {
    for (const run of runsOf(base, isCjk, 2)) {
      emitRaw(run.text, run.offset, 'cjk');
    }
    for (const run of runsOf(base, (ch) => isLatin(ch) || isKana(ch) || ch === ' ', 2)) {
      if ([...run.text].length >= 2) emitRaw(run.text, run.offset, 'cjk');
    }
  }
}

/**
 * Build the title candidate pool for an MV string.
 *
 * Duplicate spans (same text at the same offset) are removed.  Candidate order
 * is generation order, which is deterministic for a given input.
 *
 * @param {string} mv MV title string.
 * @param {object} [options] Generation options.
 * @param {number} [options.maxCandidates=96] Hard cap on the pool size.
 * @param {import('./segment.js').Block[]} [options.blocks] Pre-parsed blocks (avoids re-parsing).
 * @returns {{blocks: import('./segment.js').Block[], candidates: Candidate[]}} Blocks and candidate pool.
 * @example
 * buildCandidates('【洛天依】心空【PV付】').candidates.map((c) => c.text);
 * // ['洛天依', '心空', 'PV付']
 */
export function buildCandidates(mv, options = {}) {
  const maxCandidates = options.maxCandidates ?? 96;
  const blocks = options.blocks ?? parseBlocks(mv);

  /** @type {Candidate[]} */
  const pool = [];
  /** @type {Set<string>} */
  const seen = new Set();

  /**
   * Register a candidate span, de-duplicating on `offset:text`.
   *
   * Spans that cross a quotation mark are dropped: quotes are mandatory
   * segmentation characters, so the quoted segments (already emitted) are the
   * only valid readings.
   *
   * @param {{text: string, offset: number, variant: CandidateVariant}} input
   * @returns {void}
   */
  const emit = ({ text, offset, variant }) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (STRICT_QUOTE_RE.test(trimmed)) return;
    const cleanOffset = offset + (text.length - text.trimStart().length);
    const key = `${cleanOffset}:${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({ text: trimmed, start: cleanOffset, end: cleanOffset + trimmed.length, blockIndex: -1, variant });
  };

  for (const block of blocks) {
    // Never rewrite the block text: every candidate must stay an exact
    // substring of the MV string (that is what makes the output verifiable).
    const base = block.text;
    if (!base.trim()) continue;
    const baseOffset = block.start;

    deriveCandidates(base, baseOffset, 'raw', emit);

    const span = trimEdgeJunkSpan(base);
    if (span.text && span.text !== base) {
      deriveCandidates(span.text, baseOffset + span.lead, 'edge', emit);
    }

    if (pool.length >= maxCandidates) break;
  }

  // Attach the originating block index (the deepest block containing the span).
  for (const candidate of pool) {
    let best = 0;
    let bestDepth = -1;
    for (const block of blocks) {
      if (block.start <= candidate.start && block.end >= candidate.end && block.depth > bestDepth) {
        best = block.index;
        bestDepth = block.depth;
      }
    }
    candidate.blockIndex = best;
  }

  const capped = pool.slice(0, maxCandidates);
  capped.forEach((candidate, i) => {
    candidate.ordinal = i;
    candidate.poolSize = capped.length;
  });

  return { blocks, candidates: capped };
}

/**
 * Convenience wrapper returning only the candidate array.
 *
 * @param {string} mv MV title string.
 * @param {object} [options] See {@link buildCandidates}.
 * @returns {Candidate[]} Candidate spans in generation order.
 */
export function generateCandidates(mv, options = {}) {
  return buildCandidates(mv, options).candidates;
}
