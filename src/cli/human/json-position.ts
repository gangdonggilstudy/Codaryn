/**
 * N-6 (R-7): where a JSON file stops being valid JSON, as line and column, so the message can say
 * "line 3, column 14" without showing any of the file. The engine's own `JSON.parse` error text is
 * never used: it can quote a piece of the file.
 *
 * The scanner accepts exactly what `JSON.parse` accepts (RFC 8259: whitespace is space, tab, LF
 * and CR; no comments, no trailing commas, no leading zeros, no control characters in strings).
 * It runs without recursion, so deep nesting cannot overflow the stack. The caller passes the same
 * text it gave to `JSON.parse` (after removing a byte order mark, as run.ts does).
 */

export interface JsonPosition {
  /** UTF-16 index of the first character that cannot continue valid JSON (the length at a cut-off end). */
  readonly offset: number;
  /** 1-based. CR LF, LF and a lone CR each end a line. */
  readonly line: number;
  /** 1-based, in characters (code points), as editors count them. */
  readonly column: number;
}

const OBJECT = 1;
const ARRAY = 2;

const enum State {
  Value,
  ValueOrEndArray,
  KeyOrEndObject,
  Key,
  Colon,
  AfterValue,
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isHex(c: number): boolean {
  return isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

/** End index of the string starting at `start` (a quote), or the error offset as `-(offset + 1)`. */
function scanString(text: string, start: number): number {
  let j = start + 1;
  for (;;) {
    if (j >= text.length) return -(text.length + 1);
    const c = text.charCodeAt(j);
    if (c === 0x22) return j + 1;
    if (c < 0x20) return -(j + 1);
    if (c !== 0x5c) {
      j += 1;
      continue;
    }
    const k = j + 1;
    if (k >= text.length) return -(text.length + 1);
    const e = text.charCodeAt(k);
    // " \ / b f n r t
    if (e === 0x22 || e === 0x5c || e === 0x2f || e === 0x62 || e === 0x66 || e === 0x6e || e === 0x72 || e === 0x74) {
      j = k + 1;
      continue;
    }
    if (e !== 0x75) return -(k + 1);
    for (let h = k + 1; h <= k + 4; h += 1) {
      if (h >= text.length) return -(text.length + 1);
      if (!isHex(text.charCodeAt(h))) return -(h + 1);
    }
    j = k + 5;
  }
}

/** End index of the number starting at `start`, or the error offset as `-(offset + 1)`. */
function scanNumber(text: string, start: number): number {
  let j = start;
  const at = (index: number): number => (index < text.length ? text.charCodeAt(index) : -1);
  if (at(j) === 0x2d) j += 1;
  if (at(j) === 0x30) {
    j += 1;
  } else if (isDigit(at(j))) {
    while (isDigit(at(j))) j += 1;
  } else {
    return -(Math.min(j, text.length) + 1);
  }
  if (at(j) === 0x2e) {
    j += 1;
    if (!isDigit(at(j))) return -(Math.min(j, text.length) + 1);
    while (isDigit(at(j))) j += 1;
  }
  if (at(j) === 0x65 || at(j) === 0x45) {
    j += 1;
    if (at(j) === 0x2b || at(j) === 0x2d) j += 1;
    if (!isDigit(at(j))) return -(Math.min(j, text.length) + 1);
    while (isDigit(at(j))) j += 1;
  }
  return j;
}

/** End index of `word` at `start`, or the offset of the first character that differs as `-(offset + 1)`. */
function scanLiteral(text: string, start: number, word: string): number {
  for (let index = 0; index < word.length; index += 1) {
    if (start + index >= text.length) return -(text.length + 1);
    if (text.charCodeAt(start + index) !== word.charCodeAt(index)) return -(start + index + 1);
  }
  return start + word.length;
}

/** The offset of the first syntax error, or null when the text is valid JSON. */
export function jsonSyntaxErrorOffset(text: string): number | null {
  const stack: number[] = [];
  let state: State = State.Value;
  let i = 0;
  const n = text.length;

  for (;;) {
    while (i < n && isWhitespace(text.charCodeAt(i))) i += 1;
    if (i >= n) return state === State.AfterValue && stack.length === 0 ? null : n;
    const c = text.charCodeAt(i);

    switch (state) {
      case State.Value:
      case State.ValueOrEndArray: {
        if (state === State.ValueOrEndArray && c === 0x5d) {
          stack.pop();
          i += 1;
          state = State.AfterValue;
          break;
        }
        if (c === 0x7b) {
          stack.push(OBJECT);
          i += 1;
          state = State.KeyOrEndObject;
          break;
        }
        if (c === 0x5b) {
          stack.push(ARRAY);
          i += 1;
          state = State.ValueOrEndArray;
          break;
        }
        let end: number;
        if (c === 0x22) end = scanString(text, i);
        else if (c === 0x2d || isDigit(c)) end = scanNumber(text, i);
        else if (c === 0x74) end = scanLiteral(text, i, "true");
        else if (c === 0x66) end = scanLiteral(text, i, "false");
        else if (c === 0x6e) end = scanLiteral(text, i, "null");
        else return i;
        if (end < 0) return -end - 1;
        i = end;
        state = State.AfterValue;
        break;
      }
      case State.KeyOrEndObject:
      case State.Key: {
        if (state === State.KeyOrEndObject && c === 0x7d) {
          stack.pop();
          i += 1;
          state = State.AfterValue;
          break;
        }
        if (c !== 0x22) return i;
        const end = scanString(text, i);
        if (end < 0) return -end - 1;
        i = end;
        state = State.Colon;
        break;
      }
      case State.Colon:
        if (c !== 0x3a) return i;
        i += 1;
        state = State.Value;
        break;
      case State.AfterValue: {
        const top = stack[stack.length - 1];
        if (top === undefined) return i;
        if (c === 0x2c) {
          i += 1;
          state = top === OBJECT ? State.Key : State.Value;
        } else if ((top === ARRAY && c === 0x5d) || (top === OBJECT && c === 0x7d)) {
          stack.pop();
          i += 1;
        } else {
          return i;
        }
        break;
      }
    }
  }
}

/** Line and column of `offset` in `text`. */
export function positionOf(text: string, offset: number): JsonPosition {
  let line = 1;
  let column = 1;
  let index = 0;
  const end = Math.max(0, Math.min(offset, text.length));
  while (index < end) {
    const c = text.charCodeAt(index);
    if (c === 0x0d) {
      line += 1;
      column = 1;
      index += index + 1 < end && text.charCodeAt(index + 1) === 0x0a ? 2 : 1;
      continue;
    }
    if (c === 0x0a) {
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    const isPair = c >= 0xd800 && c <= 0xdbff && index + 1 < end && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00;
    index += isPair ? 2 : 1;
    column += 1;
  }
  return { offset: end, line, column };
}

/** Where `text` stops being valid JSON, or null when it is valid. */
export function jsonSyntaxErrorPosition(text: string): JsonPosition | null {
  const offset = jsonSyntaxErrorOffset(text);
  return offset === null ? null : positionOf(text, offset);
}
