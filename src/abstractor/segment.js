/**
 * Bracket-aware segmentation of an MV title string.
 *
 * MV titles are semi-structured: metadata is usually wrapped in `【】`, the
 * song name may sit between brackets or inside `《》`/`「」`/`（ ）`, and the
 * brackets nest (`「…（…）…」`).  This module turns such a string into a flat,
 * reading-ordered list of blocks where every block is either bracketed content
 * or the free text between brackets.
 *
 * @module segment
 */

/**
 * Opening bracket → closing bracket.
 * @type {ReadonlyMap<string, string>}
 */
export const BRACKETS = new Map([
  ['【', '】'],
  ['《', '》'],
  ['「', '」'],
  ['『', '』'],
  ['（', '）'],
  ['(', ')'],
  ['[', ']'],
  ['［', '］'],
  ['〔', '〕'],
  ['〈', '〉'],
  ['｢', '｣'],
  ['｛', '｝'],
]);

/**
 * A contiguous piece of an MV string.
 *
 * @typedef {object} Block
 * @property {string} text     Raw block text (without the surrounding brackets).
 * @property {number} start    Index of the first character in the source string.
 * @property {number} end      Index one past the last character.
 * @property {number} depth    Nesting depth (`0` = top level).
 * @property {string|null} open Opening bracket character, or `null` for free text.
 * @property {number|null} parent Index of the enclosing bracket block, or `null` at top level.
 * @property {number} index    Reading-order index assigned by {@link parseBlocks}.
 */

/**
 * Split an MV string into reading-ordered blocks.
 *
 * Text inside a bracket becomes a block whose `open` is that bracket, and the
 * bracket's own content is recursively scanned so nested groups surface as
 * separate (deeper) blocks.  Free text between brackets yields blocks with
 * `open === null`.  Unbalanced brackets are treated as plain characters.
 *
 * @param {string} mv MV title string.
 * @returns {Block[]} Blocks sorted by position.
 * @example
 * parseBlocks('【洛天依】心空【PV付】').map((b) => b.text); // ['洛天依', '心空', 'PV付']
 */
export function parseBlocks(mv) {
  /** @type {Array<Omit<Block, 'parent'> & {parentBlock: object|null}>} */
  const draft = [];

  /**
   * Emit a free-text block when it contains anything but whitespace.
   * @param {number} from Start offset.
   * @param {number} to End offset.
   * @param {number} depth Nesting depth.
   * @param {object|null} parentBlock Enclosing bracket block.
   * @returns {void}
   */
  const emitText = (from, to, depth, parentBlock) => {
    if (to <= from) return;
    const text = mv.slice(from, to);
    if (!text.trim()) return;
    draft.push({ text, start: from, end: to, depth, open: null, parent: null, index: 0, parentBlock });
  };

  /**
   * Recursively scan a range of the source string.
   *
   * Free text is only emitted at the top level: the content of a bracket is
   * already represented by its own block, so emitting it again as a child text
   * block would duplicate every bracketed fragment.
   *
   * @param {number} from Range start (inclusive).
   * @param {number} to Range end (exclusive).
   * @param {number} depth Current nesting depth.
   * @param {object|null} parentBlock Enclosing bracket block.
   * @param {boolean} emitFreeText Whether free text in this range becomes a block.
   * @returns {void}
   */
  const scan = (from, to, depth, parentBlock, emitFreeText) => {
    let cursor = from;
    let textStart = from;
    while (cursor < to) {
      const ch = mv[cursor];
      const close = BRACKETS.get(ch);
      if (!close) {
        cursor += 1;
        continue;
      }
      const closeAt = mv.indexOf(close, cursor + 1);
      if (closeAt === -1 || closeAt >= to) {
        // Unbalanced brackets (truncated MV strings) must not swallow the text
        // before them: close the current free-text run and let the bracket
        // character start a new one.
        if (emitFreeText) {
          emitText(textStart, cursor, depth, parentBlock);
          textStart = cursor;
        }
        cursor += 1;
        continue;
      }
      if (emitFreeText) emitText(textStart, cursor, depth, parentBlock);
      /** @type {object} */
      const block = {
        text: mv.slice(cursor + 1, closeAt),
        start: cursor + 1,
        end: closeAt,
        depth: depth + 1,
        open: ch,
        parent: null,
        index: 0,
        parentBlock,
      };
      draft.push(block);
      scan(cursor + 1, closeAt, depth + 1, block, false);
      cursor = closeAt + 1;
      textStart = cursor;
    }
    if (emitFreeText) emitText(textStart, to, depth, parentBlock);
  };

  scan(0, mv.length, 0, null, true);

  // Reading order: by start offset, outermost bracket first on ties.
  draft.sort((a, b) => a.start - b.start || a.depth - b.depth);

  /** @type {Map<object, number>} */
  const objectIndex = new Map();
  draft.forEach((block, i) => objectIndex.set(block, i));

  /** @type {Block[]} */
  const blocks = draft.map((block, i) => ({
    text: block.text,
    start: block.start,
    end: block.end,
    depth: block.depth,
    open: block.open,
    parent: block.parentBlock === null ? null : objectIndex.get(block.parentBlock) ?? null,
    index: i,
  }));

  return blocks;
}

/**
 * Group blocks by their parent so sibling relations are cheap to query.
 *
 * @param {Block[]} blocks Blocks produced by {@link parseBlocks}.
 * @returns {Map<number|null, Block[]>} Children per parent index (`null` = top level).
 */
export function groupByParent(blocks) {
  /** @type {Map<number|null, Block[]>} */
  const groups = new Map();
  for (const block of blocks) {
    const key = block.parent;
    const list = groups.get(key);
    if (list) list.push(block);
    else groups.set(key, [block]);
  }
  return groups;
}
