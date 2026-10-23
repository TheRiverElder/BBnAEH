/**
 * Feature extraction for title candidates.
 *
 * Every candidate is described by a fixed-length numeric vector.  The same
 * extractor feeds the hand-tuned rule scorer ({@link module:scoring}) and the
 * learned linear ranker ({@link module:model/linear}), so both approaches are
 * comparable on identical information.
 *
 * @module features
 */

import { scriptStats, foldMatch, squeezeSpaces, trimEdgeJunk } from './text.js';
import {
  CREDIT_MARKER_RE,
  FEAT_RE,
  metadataScore,
} from './lexicon.js';
import { groupByParent } from './segment.js';

/**
 * Ordered feature names.  The order is part of the persisted model format:
 * appending new features is safe, reordering is not.
 *
 * @type {readonly string[]}
 */
export const FEATURE_NAMES = Object.freeze([
  'bias',
  'len1',
  'len2',
  'len3_5',
  'len6_10',
  'len11_20',
  'len21plus',
  'outside',
  'br_fang',
  'br_book',
  'br_corner',
  'br_paren',
  'br_square',
  'depth2',
  'firstBlock',
  'lastBlock',
  'blockRelPos',
  'mvRelPos',
  'charCjk',
  'charKana',
  'charLatin',
  'charDigit',
  'charSpace',
  'charSymbol',
  'symbolRatioHi',
  'punctEnd',
  'punctStart',
  'hasArtist',
  'isArtist',
  'artistCoverageHi',
  'prevArtist',
  'prevMeta',
  'nextAllMeta',
  'nearArtist',
  'insideArtistBlock',
  'metaStrong',
  'metaSoft',
  'hasPV',
  'hasCover',
  'hasVer',
  'hasFeat',
  'hasDigit',
  'digitRatioHi',
  'latinOnly',
  'mixedScript',
  'creditTail',
  'blockCoverage',
  'mvCoverage',
  'equalsBlock',
  'blockPrefix',
  'blockSuffix',
  'coversBlock',
  'cleanBlock',
  'cleanText',
  'brBookClean',
  'brCornerClean',
  'brFangClean',
  'outsideClean',
  'prevArtistClean',
  'afterArtistBlock',
  'poolRelIndex',
  'startsWithDecoration',
  'endsWithDecoration',
  'variantRaw',
  'variantEdge',
  'variantTrimmed',
  'variantFeat',
  'variantNarrative',
  'variantSplit',
  'variantSpace',
  'variantCjk',
  'variantIndex',
]);

/**
 * Per-block annotations derived once per MV string.
 *
 * @typedef {object} BlockAnnotation
 * @property {boolean} isArtistBlock Block is dominated by artist names.
 * @property {boolean} isMetaBlock   Block is dominated by metadata patterns.
 * @property {number} artistCoverage Share of characters covered by artist names.
 * @property {number} metaScore      {@link module:lexicon.metadataScore} of the block.
 */

/**
 * Extraction context shared by the scorer and the feature extractor.
 *
 * @typedef {object} ExtractContext
 * @property {string} mv                MV title string.
 * @property {import('./segment.js').Block[]} blocks Segmented blocks.
 * @property {string[]} artists          Canonical artist names.
 * @property {import('./dictionary.js').NameMatch[]} matches All dictionary hits in `mv`.
 * @property {Map<number, BlockAnnotation>} annotations Per-block annotations.
 * @property {Map<number|null, import('./segment.js').Block[]>} siblingsByParent
 */

/**
 * Build the shared extraction context for one MV string.
 *
 * @param {object} input
 * @param {string} input.mv MV title string.
 * @param {import('./segment.js').Block[]} input.blocks Parsed blocks.
 * @param {string[]} input.artists Canonical artist names.
 * @param {import('./dictionary.js').NameMatch[]} input.matches Dictionary hits inside `mv`.
 * @returns {ExtractContext} Context usable by {@link featuresOf}.
 */
export function buildContext({ mv, blocks, artists, matches }) {
  const siblingsByParent = groupByParent(blocks);
  /** @type {Map<number, BlockAnnotation>} */
  const annotations = new Map();

  for (const block of blocks) {
    let covered = 0;
    for (const match of matches) {
      const from = Math.max(block.start, match.start);
      const to = Math.min(block.end, match.end);
      if (to > from) covered += to - from;
    }
    const length = Math.max(1, block.end - block.start);
    const artistCoverage = covered / length;
    const meta = metadataScore(block.text);
    annotations.set(block.index, {
      isArtistBlock: artistCoverage >= 0.6 && meta < 0.6,
      isMetaBlock: meta >= 0.6,
      artistCoverage,
      metaScore: meta,
    });
  }

  return { mv, blocks, artists, matches, annotations, siblingsByParent };
}

/**
 * Feature extractor bound to one MV string.
 */
export class FeatureExtractor {
  /**
   * @param {ExtractContext} context Context from {@link buildContext}.
   */
  constructor(context) {
    this.context = context;
    /** @type {Map<number, string[]>} Folded surfaces per artist. */
    this.artistSurfaces = new Map();
    for (const artist of context.artists) {
      this.artistSurfaces.set(artist, [artist].map(foldMatch));
    }
    /** @type {Map<number, {prev: import('./segment.js').Block|null, nextAllMeta: boolean}>} */
    this.siblingInfo = new Map();

    for (const [parent, siblings] of context.siblingsByParent) {
      siblings.forEach((block, i) => {
        const prev = i > 0 ? siblings[i - 1] : null;
        const nextAllMeta = siblings.slice(i + 1).every((sibling) => {
          const annotation = context.annotations.get(sibling.index);
          return annotation ? annotation.isMetaBlock || annotation.isArtistBlock : false;
        });
        this.siblingInfo.set(block.index, { prev, nextAllMeta });
        void parent;
      });
    }
  }

  /**
   * Compute the feature vector of one candidate.
   *
   * @param {import('./candidates.js').Candidate} candidate Candidate span.
   * @returns {Float64Array} Vector ordered like {@link FEATURE_NAMES}.
   */
  vector(candidate) {
    return this.vectorFromNamed(this.features(candidate));
  }

  /**
   * Convert named features into the ordered model vector.
   *
   * @param {Record<string, number>} named Feature name → value.
   * @returns {Float64Array} Vector ordered like {@link FEATURE_NAMES}.
   */
  vectorFromNamed(named) {
    const vector = new Float64Array(FEATURE_NAMES.length);
    FEATURE_NAMES.forEach((name, i) => {
      vector[i] = named[name] ?? 0;
    });
    return vector;
  }

  /**
   * Compute named features for one candidate.
   *
   * @param {import('./candidates.js').Candidate} candidate Candidate span.
   * @returns {Record<string, number>} Feature name → value.
   */
  features(candidate) {
    const { mv, blocks, matches, annotations } = this.context;
    const block = blocks[candidate.blockIndex] ?? blocks[0];
    const text = candidate.text;
    const chars = [...text];
    // `×` is a title character (`Gimme×Gimme`), not punctuation, so it is
    // excluded from the symbol statistics.
    const stats = scriptStats(text.replace(/×/gu, 'x'));
    const foldedText = foldMatch(text);
    const annotation = annotations.get(block.index);
    const sibling = this.siblingInfo.get(block.index);

    /** @type {Record<string, number>} */
    const f = {};
    f.bias = 1;
    f.len1 = stats.length === 1 ? 1 : 0;
    f.len2 = stats.length === 2 ? 1 : 0;
    f.len3_5 = stats.length >= 3 && stats.length <= 5 ? 1 : 0;
    f.len6_10 = stats.length >= 6 && stats.length <= 10 ? 1 : 0;
    f.len11_20 = stats.length >= 11 && stats.length <= 20 ? 1 : 0;
    f.len21plus = stats.length > 20 ? 1 : 0;

    f.outside = block.open === null ? 1 : 0;
    f.br_fang = block.open === '【' ? 1 : 0;
    f.br_book = block.open === '《' ? 1 : 0;
    f.br_corner = block.open === '「' || block.open === '『' || block.open === '｢' ? 1 : 0;
    f.br_paren = block.open === '（' || block.open === '(' ? 1 : 0;
    f.br_square = block.open === '[' || block.open === '［' || block.open === '〔' || block.open === '〈' || block.open === '｛' ? 1 : 0;
    f.depth2 = block.depth >= 2 ? 1 : 0;

    const numBlocks = Math.max(1, blocks.length);
    f.firstBlock = block.index === 0 ? 1 : 0;
    f.lastBlock = block.index === blocks.length - 1 ? 1 : 0;
    f.blockRelPos = block.index / (numBlocks - 1 || 1);
    f.mvRelPos = candidate.start / Math.max(1, mv.length);

    f.charCjk = stats.cjk > 0 ? 1 : 0;
    f.charKana = stats.kana > 0 ? 1 : 0;
    f.charLatin = stats.latin > 0 ? 1 : 0;
    f.charDigit = stats.digit > 0 ? 1 : 0;
    f.charSpace = stats.space > 0 ? 1 : 0;
    f.charSymbol = stats.symbol > 0 ? 1 : 0;
    f.symbolRatioHi = stats.symbol / Math.max(1, stats.length) > 0.2 ? 1 : 0;
    f.punctEnd = /[!！?？，,。.、；;：:~～·—–\-]$/u.test(text) ? 1 : 0;
    f.punctStart = /^[!！?？，,。.、；;：:~～·—–\-]/u.test(text) ? 1 : 0;
    f.latinOnly = stats.latin > 0 && stats.cjk === 0 && stats.kana === 0 ? 1 : 0;
    f.mixedScript = stats.latin > 0 && (stats.cjk > 0 || stats.kana > 0) ? 1 : 0;
    f.hasDigit = stats.digit > 0 ? 1 : 0;
    f.digitRatioHi = stats.digit / Math.max(1, stats.length) > 0.4 ? 1 : 0;

    let artistChars = 0;
    for (const match of matches) {
      const from = Math.max(candidate.start, match.start);
      const to = Math.min(candidate.end, match.end);
      if (to > from) artistChars += to - from;
    }
    const artistCoverage = artistChars / Math.max(1, chars.length);
    f.hasArtist = artistChars > 0 ? 1 : 0;
    f.artistCoverageHi = artistCoverage > 0.5 ? 1 : 0;
    f.isArtist = this.context.artists.some((artist) => {
      const surfaces = this.artistSurfaces.get(artist) ?? [];
      return surfaces.includes(foldedText);
    }) ? 1 : 0;
    f.insideArtistBlock = annotation && annotation.artistCoverage > 0 ? 1 : 0;

    const prev = sibling ? sibling.prev : null;
    const prevAnnotation = prev ? annotations.get(prev.index) : null;
    f.prevArtist = prevAnnotation ? (prevAnnotation.isArtistBlock ? 1 : 0) : 0;
    f.prevMeta = prevAnnotation ? (prevAnnotation.isMetaBlock ? 1 : 0) : 0;
    f.nextAllMeta = sibling ? (sibling.nextAllMeta ? 1 : 0) : 0;

    let nearest = Infinity;
    for (const other of blocks) {
      const otherAnnotation = annotations.get(other.index);
      if (!otherAnnotation) continue;
      if (otherAnnotation.isArtistBlock || otherAnnotation.artistCoverage > 0.3) {
        nearest = Math.min(nearest, Math.abs(other.index - block.index));
      }
    }
    f.nearArtist = nearest <= 1 ? 1 : 0;

    const meta = metadataScore(text);
    f.metaStrong = meta >= 0.6 ? 1 : 0;
    f.metaSoft = meta > 0 && meta < 0.6 ? 1 : 0;
    f.hasPV = /PV|pv|Pv|付/.test(text) ? 1 : 0;
    f.hasCover = /cover|Cover|COVER/i.test(text) ? 1 : 0;
    f.hasVer = /ver\.|version|版本/i.test(text) ? 1 : 0;
    f.hasFeat = FEAT_RE.test(text) ? 1 : 0;
    f.creditTail = CREDIT_MARKER_RE.test(text) ? 1 : 0;
    f.blockCoverage = chars.length / Math.max(1, block.text.trim().length);
    f.mvCoverage = chars.length / Math.max(1, mv.length);

    // Boundary relation between the span and its block.  Titles are usually a
    // whole block, or a clean prefix/suffix of one; a span cut from the middle
    // of a sentence is usually prose.
    const blockClean = squeezeSpaces(block.text).trim();
    const cleanBlock = metadataScore(blockClean) < 0.3 && (annotation?.artistCoverage ?? 0) < 0.4;
    const cleanText = meta < 0.3 && artistCoverage < 0.4;
    f.equalsBlock = text === blockClean ? 1 : 0;
    f.blockPrefix = blockClean.startsWith(text) ? 1 : 0;
    f.blockSuffix = blockClean.endsWith(text) ? 1 : 0;
    f.coversBlock = text.length >= blockClean.length * 0.9 ? 1 : 0;
    f.cleanBlock = cleanBlock ? 1 : 0;
    f.cleanText = cleanText ? 1 : 0;
    f.startsWithDecoration = blockClean !== trimEdgeJunk(blockClean) && blockClean.indexOf(text) === 0 && text !== blockClean ? 1 : 0;
    f.endsWithDecoration = blockClean !== trimEdgeJunk(blockClean) && blockClean.endsWith(text) && text !== blockClean ? 1 : 0;

    // Explicit interactions: a clean fragment only means "title" in the right
    // structural slot, which a purely additive model cannot express.
    f.brBookClean = f.br_book * (cleanBlock ? 1 : 0);
    f.brCornerClean = f.br_corner * (cleanBlock ? 1 : 0);
    f.brFangClean = f.br_fang * (cleanBlock ? 1 : 0);
    f.outsideClean = f.outside * (cleanBlock ? 1 : 0);
    f.prevArtistClean = f.prevArtist * (cleanBlock ? 1 : 0);
    f.afterArtistBlock = f.prevArtist && candidate.start <= block.start + 1 ? 1 : 0;
    f.poolRelIndex = candidate.poolSize ? candidate.ordinal / candidate.poolSize : 0;

    const variant = (name) => (candidate.variant === name ? 1 : 0);
    f.variantRaw = variant('raw');
    f.variantEdge = variant('edge');
    f.variantTrimmed = variant('trimmed');
    f.variantFeat = variant('feat');
    f.variantNarrative = variant('narrative');
    f.variantSplit = variant('split');
    f.variantSpace = variant('space');
    f.variantCjk = variant('cjk');
    f.variantIndex = variant('index');

    return f;
  }
}

/**
 * Convenience helper: build the context and extractor in one call.
 *
 * @param {string} mv MV title string.
 * @param {import('./segment.js').Block[]} blocks Parsed blocks.
 * @param {string[]} artists Canonical artist names.
 * @param {import('./dictionary.js').NameMatch[]} matches Dictionary hits.
 * @returns {FeatureExtractor} Extractor bound to the MV string.
 */
export function createFeatureExtractor(mv, blocks, artists, matches) {
  return new FeatureExtractor(buildContext({ mv, blocks, artists, matches }));
}
