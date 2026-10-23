/**
 * Score-level ensemble of the linear and MLP rankers.
 *
 * Each member turns its logits into a probability distribution over the
 * candidate pool; the ensemble averages those distributions.  Averaging
 * probabilities (instead of raw logits) keeps members with different score
 * scales comparable.
 *
 * @module model/ensemble
 */

import { LinearModel } from './linear.js';
import { MLPRanker } from './mlp.js';

/**
 * Serialised ensemble payload.
 *
 * @typedef {object} EnsembleJSON
 * @property {string} version Format version.
 * @property {number[]} [weights] Member weights (defaults to uniform).
 * @property {Array<import('./linear.js').LinearModelJSON|import('./mlp.js').MLPJSON>} members Member payloads.
 * @property {object} [meta] Training metadata.
 */

/**
 * Rebuild a ranker instance from its serialised payload.
 *
 * @param {object} payload Member payload.
 * @returns {LinearModel|MLPRanker} Ranker instance.
 * @throws {Error} When the member version is unknown.
 */
export function reviveRanker(payload) {
  if (payload.version === 'mlp-ranker-v1') return new MLPRanker(payload);
  if (payload.version === 'linear-ranker-v1') return new LinearModel(payload);
  throw new Error(`reviveRanker: unknown member version ${String(payload.version)}`);
}

/**
 * Turn logits into probabilities (numerically stable softmax).
 *
 * @param {number[]} logits Raw scores.
 * @returns {number[]} Probability distribution summing to 1.
 */
export function softmax(logits) {
  let max = -Infinity;
  for (const logit of logits) if (logit > max) max = logit;
  const exps = logits.map((logit) => Math.exp(logit - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((value) => value / (sum || 1));
}

/**
 * An ensemble of rankers sharing one candidate pool.
 */
export class EnsembleModel {
  /**
   * @param {object} input
   * @param {Array<LinearModel|MLPRanker>} input.members Member rankers.
   * @param {number[]} [input.weights] Member weights (uniform when omitted).
   * @param {object} [input.meta] Training metadata.
   * @throws {Error} When no member is provided.
   */
  constructor({ members, weights, meta = {} }) {
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error('EnsembleModel: at least one member is required');
    }
    this.version = 'ensemble-ranker-v1';
    this.members = members;
    this.weights = weights ?? members.map(() => 1 / members.length);
    this.meta = meta;
  }

  /**
   * Parse an ensemble from JSON.
   *
   * @param {EnsembleJSON} payload Serialised ensemble.
   * @returns {EnsembleModel} Ensemble instance.
   */
  static fromJSON(payload) {
    return new EnsembleModel({
      members: payload.members.map(reviveRanker),
      weights: payload.weights,
      meta: payload.meta,
    });
  }

  /**
   * Serialise the ensemble (member weights are embedded).
   *
   * @returns {EnsembleJSON} Plain JSON payload.
   */
  toJSON() {
    return {
      version: this.version,
      weights: this.weights,
      members: this.members.map((member) => member.toJSON()),
      meta: this.meta,
    };
  }

  /**
   * Rank a candidate pool by averaged probability.
   *
   * @param {Array<Float64Array|number[]>} vectors Candidate feature vectors.
   * @returns {number[]} One score per candidate (higher is more title-like).
   */
  rank(vectors) {
    if (vectors.length === 0) return [];
    const combined = new Array(vectors.length).fill(0);
    this.members.forEach((member, memberIndex) => {
      const weight = this.weights[memberIndex] ?? 0;
      if (weight === 0) return;
      const probabilities = softmax(member.rank(vectors));
      for (let i = 0; i < combined.length; i += 1) combined[i] += weight * probabilities[i];
    });
    return combined;
  }
}
