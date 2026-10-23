/**
 * Lightweight linear model used to rank title candidates.
 *
 * The model is a single-layer softmax classifier ("listwise" logistic
 * regression): for every MV string the candidate with the highest dot product
 * wins, and training maximises the likelihood of the gold candidate among the
 * candidates generated for that MV.  It runs in plain JavaScript, trains in a
 * few seconds on the bundled dataset and is fully inspectable (one weight per
 * feature).
 *
 * @module model/linear
 */

/**
 * Serialised model payload.
 *
 * @typedef {object} LinearModelJSON
 * @property {string} version Format version.
 * @property {string[]} features Feature-name order.
 * @property {number[]} weights Weight per feature.
 * @property {object} [meta] Optional training metadata.
 */

/**
 * A trained linear ranker.
 */
export class LinearModel {
  /**
   * @param {LinearModelJSON} payload Serialised model.
   * @throws {Error} When the payload is malformed.
   */
  constructor(payload) {
    if (!payload || !Array.isArray(payload.features) || !Array.isArray(payload.weights)) {
      throw new Error('LinearModel: payload must contain features[] and weights[]');
    }
    if (payload.features.length !== payload.weights.length) {
      throw new Error('LinearModel: features and weights have different lengths');
    }
    /** @type {string} */
    this.version = payload.version ?? 'linear-ranker-v1';
    /** @type {string[]} */
    this.features = payload.features.slice();
    /** @type {number[]} */
    this.weights = payload.weights.slice();
    /** @type {object} */
    this.meta = payload.meta ?? {};
  }

  /**
   * Parse a model from JSON.
   *
   * @param {LinearModelJSON} payload Serialised model.
   * @returns {LinearModel} Model instance.
   */
  static fromJSON(payload) {
    return new LinearModel(payload);
  }

  /**
   * Serialise the model.
   *
   * @returns {LinearModelJSON} Plain JSON payload.
   */
  toJSON() {
    return {
      version: this.version,
      features: this.features.slice(),
      weights: this.weights.slice(),
      meta: this.meta,
    };
  }

  /**
   * Score one feature vector.
   *
   * @param {Float64Array|number[]} vector Feature vector in {@link LinearModel#features} order.
   * @returns {number} Raw score (logit).
   * @throws {Error} When the vector length does not match the model.
   */
  score(vector) {
    if (vector.length !== this.weights.length) {
      throw new Error(`LinearModel: expected ${this.weights.length} features, got ${vector.length}`);
    }
    let total = 0;
    for (let i = 0; i < this.weights.length; i += 1) total += this.weights[i] * vector[i];
    return total;
  }

  /**
   * Score every vector of one candidate pool.
   *
   * @param {Array<Float64Array|number[]>} vectors Candidate feature vectors.
   * @returns {number[]} One score per candidate.
   */
  rank(vectors) {
    return vectors.map((vector) => this.score(vector));
  }

  /**
   * Weights as a `{feature: weight}` record, sorted by absolute weight.
   *
   * @returns {Array<{feature: string, weight: number}>} Weights, most important first.
   */
  rankedWeights() {
    return this.features
      .map((feature, i) => ({ feature, weight: this.weights[i] }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  }
}

/**
 * Deterministic 32-bit PRNG (mulberry32) used for reproducible shuffling.
 *
 * @param {number} seed Initial seed.
 * @returns {() => number} Generator returning floats in `[0, 1)`.
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One training example: the candidate vectors of a single MV string.
 *
 * @typedef {object} TrainingSample
 * @property {Float64Array[]} vectors Candidate feature vectors.
 * @property {number} gold Index of the gold candidate inside `vectors` (`-1` when absent).
 */

/**
 * Train the linear ranker with Adam on the listwise softmax loss.
 *
 * Samples whose gold candidate is missing from the pool are skipped: there is
 * nothing to learn from a candidate set that cannot express the label.
 *
 * @param {TrainingSample[]} samples Training samples.
 * @param {object} options Training options.
 * @param {string[]} options.features Feature-name order (defines vector length).
 * @param {number} [options.epochs=300] Passes over the training set.
 * @param {number} [options.learningRate=0.05] Adam step size.
 * @param {number} [options.l2=1e-4] L2 penalty on weights (bias excluded).
 * @param {number} [options.seed=7] PRNG seed for shuffling.
 * @param {number} [options.batchSize=16] Samples per gradient step.
 * @returns {{model: LinearModel, history: number[]}} Trained model and loss history.
 * @throws {Error} When no usable sample is provided.
 */
export function trainSoftmaxRanker(samples, options) {
  const features = options.features;
  const epochs = options.epochs ?? 300;
  const learningRate = options.learningRate ?? 0.05;
  const l2 = options.l2 ?? 1e-4;
  const seed = options.seed ?? 7;
  const batchSize = options.batchSize ?? 16;
  const dim = features.length;

  const usable = samples.filter((sample) => sample.gold >= 0 && sample.vectors.length > 0);
  if (usable.length === 0) throw new Error('trainSoftmaxRanker: no sample with a gold candidate');

  const random = mulberry32(seed);
  const weights = new Float64Array(dim);
  const m = new Float64Array(dim);
  const v = new Float64Array(dim);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  let step = 0;
  /** @type {number[]} */
  const history = [];

  const order = usable.map((_, i) => i);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    // Fisher–Yates shuffle
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let epochLoss = 0;
    let seen = 0;

    for (let start = 0; start < order.length; start += batchSize) {
      const batch = order.slice(start, start + batchSize);
      const gradient = new Float64Array(dim);

      for (const sampleIndex of batch) {
        const sample = usable[sampleIndex];
        const { vectors, gold } = sample;
        const scores = new Float64Array(vectors.length);
        let max = -Infinity;
        for (let i = 0; i < vectors.length; i += 1) {
          let dot = 0;
          const vector = vectors[i];
          for (let d = 0; d < dim; d += 1) dot += weights[d] * vector[d];
          scores[i] = dot;
          if (dot > max) max = dot;
        }
        let denominator = 0;
        for (let i = 0; i < scores.length; i += 1) {
          scores[i] = Math.exp(scores[i] - max);
          denominator += scores[i];
        }
        for (let i = 0; i < scores.length; i += 1) scores[i] /= denominator;

        epochLoss += -Math.log(Math.max(scores[gold], 1e-12));
        seen += 1;

        for (let i = 0; i < vectors.length; i += 1) {
          const coefficient = scores[i] - (i === gold ? 1 : 0);
          if (coefficient === 0) continue;
          const vector = vectors[i];
          for (let d = 0; d < dim; d += 1) gradient[d] += coefficient * vector[d];
        }
      }

      const scale = 1 / batch.length;
      step += 1;
      for (let d = 0; d < dim; d += 1) {
        let grad = gradient[d] * scale;
        if (features[d] !== 'bias') grad += l2 * weights[d];
        m[d] = beta1 * m[d] + (1 - beta1) * grad;
        v[d] = beta2 * v[d] + (1 - beta2) * grad * grad;
        const mHat = m[d] / (1 - Math.pow(beta1, step));
        const vHat = v[d] / (1 - Math.pow(beta2, step));
        weights[d] -= learningRate * mHat / (Math.sqrt(vHat) + eps);
      }
    }

    history.push(epochLoss / Math.max(1, seen));
  }

  return {
    model: new LinearModel({
      version: 'linear-ranker-v1',
      features: features.slice(),
      weights: Array.from(weights),
      meta: { epochs, learningRate, l2, trainSamples: usable.length },
    }),
    history,
  };
}
