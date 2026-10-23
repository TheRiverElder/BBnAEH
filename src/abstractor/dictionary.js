/**
 * Alias and band dictionary used by the artist extractor.
 *
 * `alias_list.csv` maps a canonical artist name (first column) to its aliases
 * (remaining columns).  `band_list.csv` maps a band name (first column) to the
 * artists that make up the band (remaining columns).
 *
 * @module dictionary
 */

import { foldMatch } from './text.js';

/**
 * A literal name hit inside a string.
 *
 * @typedef {object} NameMatch
 * @property {string} surface  Matched text as it appears in the source.
 * @property {string} canonical Canonical artist name the surface maps to.
 * @property {'artist'|'band'} kind Whether the surface denotes an artist or a band.
 * @property {number} start    Start offset in the source string.
 * @property {number} end      End offset in the source string.
 */

/**
 * Lookup table for artists and bands.
 *
 * All internal lookups are case/full-width folded, so `Ｋａｉｔｏ` and `KAITO`
 * hit the same canonical name.  Offsets reported by {@link findMatches} refer
 * to the *original* string: folding is a 1:1 character transformation.
 */
export class EntityDictionary {
  /**
   * @param {object} input
   * @param {string[][]} input.aliasRows Rows of `[canonical, ...aliases]`.
   * @param {string[][]} input.bandRows Rows of `[band, ...members]`.
   */
  constructor({ aliasRows = [], bandRows = [] } = {}) {
    /** @type {Map<string, string>} Folded surface → canonical name. */
    this.aliasToCanonical = new Map();
    /** @type {Map<string, string[]>} Folded band name → canonical members. */
    this.bands = new Map();
    /** @type {string[]} Canonical artist names, in dictionary order. */
    this.canonicalNames = [];
    /** @type {Map<string, string[]>} Canonical name → folded surfaces. */
    this.surfacesOf = new Map();

    for (const row of aliasRows) {
      const canonical = (row[0] ?? '').trim();
      if (!canonical) continue;
      if (!this.surfacesOf.has(canonical)) {
        this.canonicalNames.push(canonical);
        this.surfacesOf.set(canonical, []);
      }
      for (const cell of row) {
        const surface = (cell ?? '').trim();
        if (!surface) continue;
        const folded = foldMatch(surface);
        if (!this.aliasToCanonical.has(folded)) {
          this.aliasToCanonical.set(folded, canonical);
          this.surfacesOf.get(canonical).push(folded);
        }
      }
    }

    for (const row of bandRows) {
      const band = (row[0] ?? '').trim();
      if (!band) continue;
      const members = row.slice(1).map((m) => (m ?? '').trim()).filter(Boolean);
      // Members are given as canonical names; keep them canonical even if the
      // band file happens to use an alias.
      const canonicalMembers = members.map((m) => this.aliasToCanonical.get(foldMatch(m)) ?? m);
      this.bands.set(foldMatch(band), canonicalMembers);
    }

    /** @type {Array<{folded: string, kind: 'artist'|'band'}>} */
    this.surfaces = [
      ...[...this.aliasToCanonical.keys()].map((folded) => ({ folded, kind: /** @type {'artist'} */ ('artist') })),
      ...[...this.bands.keys()].map((folded) => ({ folded, kind: /** @type {'band'} */ ('band') })),
    ].sort((a, b) => b.folded.length - a.folded.length || a.folded.localeCompare(b.folded));
  }

  /**
   * Build a dictionary from parsed CSV rows.
   *
   * @param {string[][]} aliasRows Rows of `alias_list.csv`.
   * @param {string[][]} bandRows Rows of `band_list.csv`.
   * @returns {EntityDictionary} Populated dictionary.
   */
  static fromRows(aliasRows, bandRows) {
    return new EntityDictionary({ aliasRows, bandRows });
  }

  /**
   * Resolve one surface to its canonical artist name.
   *
   * @param {string} surface Artist alias or canonical name.
   * @returns {string|null} Canonical name, or `null` when unknown.
   */
  canonicalOf(surface) {
    return this.aliasToCanonical.get(foldMatch(surface)) ?? null;
  }

  /**
   * Whether a canonical name belongs to the dictionary.
   *
   * @param {string} name Canonical artist name.
   * @returns {boolean} `true` when known.
   */
  isKnownArtist(name) {
    return this.canonicalNames.includes(name);
  }

  /**
   * Whether a surface or canonical name denotes a band.
   *
   * @param {string} name Band name, canonical artist name or alias.
   * @returns {boolean} `true` when the name is listed in `band_list.csv`.
   */
  bandExists(name) {
    return this.bands.has(foldMatch(name));
  }

  /**
   * Members of a band, in dictionary order.
   *
   * @param {string} band Band name (folded match, canonical or alias).
   * @returns {string[]} Canonical member names; empty when the name is unknown.
   */
  membersOf(band) {
    return this.bands.get(foldMatch(band)) ?? [];
  }

  /**
   * Find every dictionary name occurring in a string, longest match first and
   * without overlapping hits.
   *
   * @param {string} text Source string.
   * @returns {NameMatch[]} Matches sorted by start offset.
   * @example
   * dict.findMatches('【洛天依天依】'); // one hit for 洛天依, not for 天依
   */
  findMatches(text) {
    const folded = foldMatch(text);
    /** @type {Array<{folded: string, kind: 'artist'|'band', start: number}>} */
    const raw = [];

    /**
     * Whether a match is delimited on both sides.  Latin names must not be part
     * of a longer word (`IA` inside `ARCADIA`), CJK names are allowed to touch
     * other CJK text (`洛天依乐正绫`).
     *
     * @param {number} start Match start in the folded string.
     * @param {number} end Match end in the folded string.
     * @returns {boolean} `true` when the match is a standalone token.
     */
    const isDelimited = (start, end) => {
      const first = folded[start];
      const last = folded[end - 1];
      const letterBefore = start > 0 && /[a-z]/.test(folded[start - 1]);
      const letterAfter = end < folded.length && /[a-z]/.test(folded[end]);
      if (/[a-z]/.test(first) && letterBefore) return false;
      if (/[a-z]/.test(last) && letterAfter) return false;
      return true;
    };

    for (const surface of this.surfaces) {
      let from = 0;
      while (from <= folded.length - surface.folded.length) {
        const at = folded.indexOf(surface.folded, from);
        if (at === -1) break;
        if (isDelimited(at, at + surface.folded.length)) {
          raw.push({ folded: surface.folded, kind: surface.kind, start: at });
        }
        from = at + 1;
      }
    }

    raw.sort((a, b) => a.start - b.start || b.folded.length - a.folded.length);

    /** @type {NameMatch[]} */
    const matches = [];
    let cursor = -1;
    for (const hit of raw) {
      if (hit.start < cursor) continue; // overlaps an accepted match
      const end = hit.start + hit.folded.length;
      matches.push({
        surface: text.slice(hit.start, end),
        canonical: hit.kind === 'artist'
          ? this.aliasToCanonical.get(hit.folded) ?? hit.folded
          : hit.folded,
        kind: hit.kind,
        start: hit.start,
        end,
      });
      cursor = end;
    }
    return matches;
  }
}
