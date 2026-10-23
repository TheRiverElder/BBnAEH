/**
 * Small feed-forward ranker (one tanh hidden layer) for title candidates.
 *
 * This is the "lightweight neural network" variant of the project: ~1.5k
 * parameters, pure JavaScript, trained from scratch in a few seconds on a
 * normal laptop.  It ranks the same candidate pools as the linear model and is
 * trained with the same listwise softmax loss, which makes the comparison
 * between the two fair.
 *
 * @module model/mlp
 */

import { mulberry32 } from './linear.js';

/**
 * Serialised MLP payload.
 *
 * @typedef {object} MLPJSON
 * @property {string} version Format version.
 * @property {string[]} features Feature-name order.
 * @property {number} hidden Hidden layer width.
 * @property {number[][]} w1 Input→hidden weights (`hidden × dim`).
 * @property {number[]} b1 Hidden biases.
 * @property {number[]} w2 Hidden→output weights.
 * @property {number} b2 Output bias.
 * @property {object} [meta] Training metadata.
 */

/**
 * A trained one-hidden-layer ranker.
 */
export class MLPRanker {
  /**
   * @param {MLPJSON} payload Serialised model.
   * @throws {Error} When the payload is malformed.
   */
  constructor(payload) {
    if (!payload || !Array.isArray(payload.features) || !Array.isArray(payload.w1)) {
      throw new Error('MLPRanker: payload must contain features[] and w1[][]');
    }
    /** @type {string} */
    this.version = payload.version ?? 'mlp-ranker-v1';
    /** @type {string[]} */
    this.features = payload.features.slice();
    /** @type {number} */
    this.hidden = payload.hidden;
    /** @type {number[][]} */
    this.w1 = payload.w1.map((row) => row.slice());
    /** @type {number[]} */
    this.b1 = payload.b1.slice();
    /** @type {number[]} */
    this.w2 = payload.w2.slice();
    /** @type {number} */
    this.b2 = payload.b2;
    /** @type {object} */
    this.meta = payload.meta ?? {};
  }

  /**
   * Parse a model from JSON.
   *
   * @param {MLPJSON} payload Serialised model.
   * @returns {MLPRanker} Model instance.
   */
  static fromJSON(payload) {
    return new MLPRanker(payload);
  }

  /**
   * Serialise the model.
   *
   * @returns {MLPJSON} Plain JSON payload.
   */
  toJSON() {
    return {
      version: this.version,
      features: this.features.slice(),
      hidden: this.hidden,
      w1: this.w1.map((row) => row.slice()),
      b1: this.b1.slice(),
      w2: this.w2.slice(),
      b2: this.b2,
      meta: this.meta,
    };
  }

  /**
   * Hidden activations for one feature vector.
   *
   * @param {Float64Array|number[]} vector Feature vector.
   * @returns {Float64Array} tanh activations.
   * @throws {Error} When the vector length does not match the model.
   */
  activate(vector) {
    if (vector.length !== this.features.length) {
      throw new Error(`MLPRanker: expected ${this.features.length} features, got ${vector.length}`);
    }
    const activations = new Float64Array(this.hidden);
    for (let h = 0; h < this.hidden; h += 1) {
      let sum = this.b1[h];
      const row = this.w1[h];
      for (let d = 0; d < vector.length; d += 1) sum += row[d] * vector[d];
      activations[h] = Math.tanh(sum);
    }
    return activations;
  }

  /**
   * Score one feature vector.
   *
   * @param {Float64Array|number[]} vector Feature vector.
   * @returns {number} Raw score (logit).
   */
  score(vector) {
    const activations = this.activate(vector);
    let total = this.b2;
    for (let h = 0; h < this.hidden; h += 1) total += this.w2[h] * activations[h];
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
}

/**
 * Train the MLP ranker with Adam on the listwise softmax loss.
 *
 * @param {import('./linear.js').TrainingSample[]} samples Training samples.
 * @param {object} options Training options.
 * @param {string[]} options.features Feature-name order.
 * @param {number} [options.hidden=24] Hidden layer width.
 * @param {number} [options.epochs=300] Passes over the training set.
 * @param {number} [options.learningRate=0.01] Adam step size.
 * @param {number} [options.l2=1e-4] L2 penalty on weights.
 * @param {number} [options.seed=7] PRNG seed.
 * @param {number} [options.batchSize=16] Samples per gradient step.
 * @returns {{model: MLPRanker, history: number[]}} Trained model and loss history.
 * @throws {Error} When no usable sample is provided.
 */
export function trainMLPRanker(samples, options) {
  const features = options.features;
  const hidden = options.hidden ?? 24;
  const epochs = options.epochs ?? 300;
  const learningRate = options.learningRate ?? 0.01;
  const l2 = options.l2 ?? 0.0001;
  const seed = options.seed ?? 7;
  const batchSize = options.batchSize ?? 16;
  const dim = features.length;

  const usable = samples.filter((sample) => sample.gold >= 0 && sample.vectors.length > 0);
  if (usable.length === 0) throw new Error('trainMLPRanker: no sample with a gold candidate');

  const random = mulberry32(seed);
  /**
   * Initialise a matrix with He-style noise.
   * @param {number} rows Row count.
   * @param {number} cols Column count.
   * @returns {number[][]} Matrix of small random values.
   */
  const initMatrix = (rows, cols) => {
    const scale = Math.sqrt(2 / Math.max(1, cols));
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (random() * 2 - 1) * scale));
  };

  const w1 = initMatrix(hidden, dim);
  const b1 = new Array(hidden).fill(0);
  const w2 = Array.from({ length: hidden }, () => (random() * 2 - 1) * Math.sqrt(1 / hidden));
  let b2 = 0;

  // Adam accumulators.
  const mW1 = initMatrix(hidden, dim).map((row) => row.map(() => 0));
  const vW1 = initMatrix(hidden, dim).map((row) => row.map(() => 0));
  const mB1 = new Array(hidden).fill(0);
  const vB1 = new Array(hidden).fill(0);
  const mW2 = new Array(hidden).fill(0);
  const vW2 = new Array(hidden).fill(0);
  let mB2 = 0;
  let vB2 = 0;

  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  let step = 0;
  /** @type {number[]} */
  const history = [];
  const order = usable.map((_, i) => i);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let epochLoss = 0;
    let seen = 0;

    for (let start = 0; start < order.length; start += batchSize) {
      const batch = order.slice(start, start + batchSize);

      const gW1 = Array.from({ length: hidden }, () => new Float64Array(dim));
      const gB1 = new Float64Array(hidden);
      const gW2 = new Float64Array(hidden);
      let gB2 = 0;

      for (const sampleIndex of batch) {
        const { vectors, gold } = usable[sampleIndex];
        const count = vectors.length;
        const activations = Array.from({ length: count }, () => new Float64Array(hidden));
        const logits = new Float64Array(count);
        let max = -Infinity;

        for (let c = 0; c < count; c += 1) {
          const vector = vectors[c];
          let logit = b2;
          for (let h = 0; h < hidden; h += 1) {
            let sum = b1[h];
            const row = w1[h];
            for (let d = 0; d < dim; d += 1) sum += row[d] * vector[d];
            activations[c][h] = Math.tanh(sum);
            logit += w2[h] * activations[c][h];
          }
          logits[c] = logit;
          if (logit > max) max = logit;
        }

        let denominator = 0;
        for (let c = 0; c < count; c += 1) {
          logits[c] = Math.exp(logits[c] - max);
          denominator += logits[c];
        }
        for (let c = 0; c < count; c += 1) logits[c] /= denominator;

        epochLoss += -Math.log(Math.max(logits[gold], 1e-12));
        seen += 1;

        for (let c = 0; c < count; c += 1) {
          const coefficient = logits[c] - (c === gold ? 1 : 0);
          if (coefficient === 0) continue;
          const vector = vectors[c];
          gB2 += coefficient;
          for (let h = 0; h < hidden; h += 1) {
            const activation = activations[c][h];
            gW2[h] += coefficient * activation;
            const dz = coefficient * w2[h] * (1 - activation * activation);
            if (dz === 0) continue;
            gB1[h] += dz;
            const gradRow = gW1[h];
            for (let d = 0; d < dim; d += 1) gradRow[d] += dz * vector[d];
          }
        }
      }

      const scale = 1 / batch.length;
      step += 1;
      for (let h = 0; h < hidden; h += 1) {
        for (let d = 0; d < dim; d += 1) {
          const grad = gW1[h][d] * scale + l2 * w1[h][d];
          mW1[h][d] = beta1 * mW1[h][d] + (1 - beta1) * grad;
          vW1[h][d] = beta2 * vW1[h][d] + (1 - beta2) * grad * grad;
          const mHat = mW1[h][d] / (1 - Math.pow(beta1, step));
          const vHat = vW1[h][d] / (1 - Math.pow(beta2, step));
          w1[h][d] -= learningRate * mHat / (Math.sqrt(vHat) + eps);
        }
        const gradB1 = gB1[h] * scale;
        mB1[h] = beta1 * mB1[h] + (1 - beta1) * gradB1;
        vB1[h] = beta2 * vB1[h] + (1 - beta2) * gradB1 * gradB1;
        b1[h] -= learningRate * (mB1[h] / (1 - Math.pow(beta1, step))) / (Math.sqrt(vB1[h] / (1 - Math.pow(beta2, step))) + eps);

        const gradW2 = gW2[h] * scale + l2 * w2[h];
        mW2[h] = beta1 * mW2[h] + (1 - beta1) * gradW2;
        vW2[h] = beta2 * vW2[h] + (1 - beta2) * gradW2 * gradW2;
        w2[h] -= learningRate * (mW2[h] / (1 - Math.pow(beta1, step))) / (Math.sqrt(vW2[h] / (1 - Math.pow(beta2, step))) + eps);
      }

      const gradB2 = gB2 * scale;
      mB2 = beta1 * mB2 + (1 - beta1) * gradB2;
      vB2 = beta2 * vB2 + (1 - beta2) * gradB2 * gradB2;
      b2 -= learningRate * (mB2 / (1 - Math.pow(beta1, step))) / (Math.sqrt(vB2 / (1 - Math.pow(beta2, step))) + eps);
    }

    history.push(epochLoss / Math.max(1, seen));
  }

  return {
    model: new MLPRanker({
      version: 'mlp-ranker-v1',
      features: features.slice(),
      hidden,
      w1,
      b1,
      w2,
      b2,
      meta: { epochs, learningRate, l2, hidden, trainSamples: usable.length },
    }),
    history,
  };
}
