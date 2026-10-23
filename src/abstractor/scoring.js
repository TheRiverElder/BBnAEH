/**
 * Hand-tuned scoring for title candidates.
 *
 * This is the interpretable counterpart of the learned ranker in
 * {@link module:model/linear}.  Weights are written out explicitly so the
 * decision for any MV can be explained ("bracket content, right after the
 * artist, no metadata markers").
 *
 * @module scoring
 */

/**
 * Linear weights over {@link module:features.FEATURE_NAMES}.
 *
 * Positive weights make a candidate title-like; negative weights push it
 * towards metadata, staff credits or narrative prose.
 *
 * The starting values were written by hand from the structure of the data; the
 * numbers below were then adjusted by greedy coordinate ascent on title
 * accuracy (`tools/tune-rules.js`).  That tuning used the whole dataset, so
 * accuracy measured with these weights is *in-sample* — see the README for the
 * held-out comparison against the learned rankers.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const RULE_WEIGHTS = Object.freeze({
  bias: 0,

  // Length buckets: one character is almost always a fragment of a longer
  // word, while very long spans are usually prose.
  len1: -0.1,
  len2: 0.4,
  len3_5: 0.05,
  len6_10: 0.05,
  len11_20: 0.4,
  len21plus: -0.6,

  // Layout: a free-text span right after the artist tag is the canonical title
  // slot; `《》`/`「」` brackets are title brackets; nested brackets are usually
  // credits inside credits.
  outside: 1.45,
  br_fang: -0.85,
  br_book: 2.3,
  br_corner: 0.6,
  br_paren: -0.5,
  br_square: -0.7,
  depth2: -1.45,

  firstBlock: -0.7,
  lastBlock: -0.4,
  blockRelPos: 0.2,
  mvRelPos: -0.9,
  mvCoverage: -0.3,

  charCjk: 0.7,
  charKana: 0.2,
  charDigit: -0.2,
  charSpace: -0.3,
  charSymbol: -1.3,
  symbolRatioHi: -0.1,
  punctEnd: 0.6,
  punctStart: -0.3,
  hasDigit: -0.05,
  digitRatioHi: 0.3,
  latinOnly: 0.15,
  mixedScript: -0.95,

  hasArtist: -1.6,
  isArtist: -2.4,
  artistCoverageHi: -0.8,
  prevArtist: 0.25,
  prevMeta: 0.1,
  nextAllMeta: 0.15,
  nearArtist: 0.35,
  insideArtistBlock: -0.6,

  metaStrong: -2.6,
  metaSoft: -0.6,
  hasPV: -0.9,
  hasCover: -0.9,
  hasVer: -0.5,
  hasFeat: -0.4,
  creditTail: -0.35,

  equalsBlock: 0.6,
  blockPrefix: 0.2,
  brBookClean: 0.5,
  brCornerClean: 0.9,
  brFangClean: -0.6,
  startsWithDecoration: 0.3,
  endsWithDecoration: -0.3,

  variantRaw: 0.1,
  variantEdge: 0.1,
  variantTrimmed: -0.05,
  variantFeat: 0.05,
  variantNarrative: -0.25,
  variantSplit: -0.05,
  variantSpace: -0.25,
  variantCjk: -0.7,
});

/**
 * Score one candidate with the hand-tuned weights.
 *
 * @param {Record<string, number>} features Named features from
 *   {@link module:features.FeatureExtractor#features}.
 * @param {Record<string, number>} [weights=RULE_WEIGHTS] Weight table.
 * @returns {number} Score; higher is more title-like.
 */
export function ruleScore(features, weights = RULE_WEIGHTS) {
  let score = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const value = features[name];
    if (value) score += weight * value;
  }
  return score;
}

/**
 * Express the rule weights as a vector aligned with the model feature order.
 *
 * This lets the rule scorer run on the same cached feature matrix as the
 * learned rankers (and makes weight tuning a pure vector operation).
 *
 * @param {readonly string[]} featureNames Feature order (see {@link module:features.FEATURE_NAMES}).
 * @param {Record<string, number>} [weights=RULE_WEIGHTS] Weight table.
 * @returns {Float64Array} Weight vector in `featureNames` order.
 */
export function ruleWeightVector(featureNames, weights = RULE_WEIGHTS) {
  const vector = new Float64Array(featureNames.length);
  featureNames.forEach((name, i) => {
    vector[i] = weights[name] ?? 0;
  });
  return vector;
}

/**
 * Dot product of the rule weights and a feature vector.
 *
 * @param {Float64Array|number[]} featureVector Feature vector in model order.
 * @param {Float64Array} weightVector Rule weights in the same order.
 * @returns {number} Rule score.
 */
export function ruleVectorScore(featureVector, weightVector) {
  let total = 0;
  for (let i = 0; i < weightVector.length; i += 1) total += weightVector[i] * featureVector[i];
  return total;
}

/**
 * Pick the highest scoring candidate.
 *
 * Ties are broken by candidate order (earlier generation wins), which keeps the
 * result deterministic and favours the first plausible title slot.
 *
 * @template {{text: string}} T
 * @param {T[]} candidates Candidate spans.
 * @param {number[]} scores Score per candidate (same order).
 * @returns {{candidate: T|null, index: number, score: number}} Best candidate.
 */
export function argmax(candidates, scores) {
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestIndex = i;
    }
  }
  return {
    candidate: bestIndex >= 0 ? candidates[bestIndex] : null,
    index: bestIndex,
    score: bestScore,
  };
}
