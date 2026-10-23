/**
 * Minimal, dependency-free RFC 4180 CSV reader/writer.
 *
 * The project datasets are UTF-8 CSVs whose fields are mostly quoted and whose
 * rows are terminated by CRLF.  Quoted fields may contain commas, quotes
 * (`""` escapes) and line breaks, so a hand written state machine is used
 * instead of `String.prototype.split`.
 *
 * @module csv
 */

/**
 * A parsed CSV table; the first index selects the row, the second the column.
 *
 * @typedef {string[][]} CsvTable
 */

/**
 * Parse CSV text into a table.
 *
 * Empty trailing rows are dropped and the byte-order mark (BOM) is stripped.
 * No header handling is performed: the caller decides what each column means.
 *
 * @param {string} text Raw CSV file contents.
 * @param {object} [options] Parser options.
 * @param {string} [options.delimiter=','] Field delimiter.
 * @returns {CsvTable} Rows of raw (unparsed) string cells.
 * @throws {TypeError} If `text` is not a string.
 * @example
 * parseCsv('"a","b"\r\n"1","x,y"\r\n'); // [['a','b'], ['1','x,y']]
 */
export function parseCsv(text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('parseCsv expected a string');
  }
  const delimiter = options.delimiter ?? ',';
  /** @type {CsvTable} */
  const table = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  const body = text.codePointAt(0) === 0xfeff ? text.slice(1) : text;

  /**
   * Commits the field currently being accumulated.
   * @returns {void}
   */
  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };

  /**
   * Commits the row currently being accumulated.
   * @returns {void}
   */
  const endRow = () => {
    endField();
    // Ignore completely empty rows (trailing newline, blank lines).
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
      table.push(row);
    }
    row = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];

    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
      fieldStarted = true;
      continue;
    }

    if (ch === delimiter) {
      endField();
      continue;
    }

    if (ch === '\r') {
      // CRLF or a lone CR both terminate the record.
      if (body[i + 1] === '\n') i += 1;
      endRow();
      continue;
    }

    if (ch === '\n') {
      endRow();
      continue;
    }

    field += ch;
    fieldStarted = true;
  }

  if (fieldStarted || field.length > 0 || row.length > 0) {
    endRow();
  }

  return table;
}

/**
 * Serialise a table back into CSV text (CRLF line endings, all fields quoted).
 *
 * Quoting every field keeps the output byte-compatible with the checked-in
 * dataset files and avoids delimiter/quote edge cases.
 *
 * @param {CsvTable} table Rows of cells.
 * @param {object} [options] Writer options.
 * @param {string} [options.eol='\r\n'] Line terminator.
 * @returns {string} CSV document.
 * @example
 * toCsv([['av1', 'title']]); // "\"av1\",\"title\"\r\n"
 */
export function toCsv(table, options = {}) {
  const eol = options.eol ?? '\r\n';
  return table
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join(eol) + eol;
}
