/**
 * N-15 (N-6): where a JSON text first breaks the grammar (RFC 8259, as JSON.parse reads it), as a
 * 1-based line and column. The parser's own message is never used: it can quote the text.
 * The scan is iterative, so deep nesting cannot overflow the stack.
 */

const WS = new Set([" ", "\t", "\n", "\r"]);
const DIGIT = /^[0-9]$/;
const HEX = /^[0-9A-Fa-f]$/;

/** UTF-16 offset of the first grammar error, or null when the text is valid JSON. */
export function jsonErrorOffset(text: string): number | null {
  const n = text.length;
  const stack: ("{" | "[")[] = [];
  let i = 0;
  const skipWs = (): void => {
    while (i < n && WS.has(text.charAt(i))) i += 1;
  };
  const isDigit = (at: number): boolean => DIGIT.test(text.charAt(at));

  const readString = (): boolean => {
    i += 1; // opening quote
    while (i < n) {
      const code = text.charCodeAt(i);
      if (code === 0x22) {
        i += 1;
        return true;
      }
      if (code < 0x20) return false;
      if (code === 0x5c) {
        const escape = text.charAt(i + 1);
        if ('"\\/bfnrt'.includes(escape) && escape !== "") {
          i += 2;
          continue;
        }
        if (escape === "u") {
          for (let k = 2; k < 6; k += 1) {
            if (!HEX.test(text.charAt(i + k))) {
              i += k;
              return false;
            }
          }
          i += 6;
          continue;
        }
        i += 1;
        return false;
      }
      i += 1;
    }
    return false;
  };

  const readNumber = (): boolean => {
    if (text.charAt(i) === "-") i += 1;
    if (text.charAt(i) === "0") i += 1;
    else if (isDigit(i)) while (isDigit(i)) i += 1;
    else return false;
    if (text.charAt(i) === ".") {
      i += 1;
      if (!isDigit(i)) return false;
      while (isDigit(i)) i += 1;
    }
    if (text.charAt(i) === "e" || text.charAt(i) === "E") {
      i += 1;
      if (text.charAt(i) === "+" || text.charAt(i) === "-") i += 1;
      if (!isDigit(i)) return false;
      while (isDigit(i)) i += 1;
    }
    return true;
  };

  const readWord = (word: string): boolean => {
    for (let k = 0; k < word.length; k += 1) {
      if (text.charAt(i + k) !== word.charAt(k)) {
        i += k;
        return false;
      }
    }
    i += word.length;
    return true;
  };

  /** A scalar ("done"), an opened container ("open"), or an error (false, `i` at the error). */
  const readValue = (): "done" | "open" | false => {
    const c = text.charAt(i);
    if (c === "{" || c === "[") {
      stack.push(c);
      i += 1;
      return "open";
    }
    if (c === '"') return readString() ? "done" : false;
    if (c === "t") return readWord("true") ? "done" : false;
    if (c === "f") return readWord("false") ? "done" : false;
    if (c === "n") return readWord("null") ? "done" : false;
    if (c === "-" || isDigit(i)) return readNumber() ? "done" : false;
    return false;
  };

  let state: "value" | "key" | "after" = "value";
  for (;;) {
    skipWs();
    if (state === "value") {
      const read = readValue();
      if (read === false) return i;
      if (read === "done") {
        state = "after";
        continue;
      }
      skipWs();
      const open = stack[stack.length - 1];
      if (text.charAt(i) === (open === "{" ? "}" : "]")) {
        stack.pop();
        i += 1;
        state = "after";
      } else {
        state = open === "{" ? "key" : "value";
      }
    } else if (state === "key") {
      if (text.charAt(i) !== '"' || !readString()) return i;
      skipWs();
      if (text.charAt(i) !== ":") return i;
      i += 1;
      state = "value";
    } else {
      const open = stack[stack.length - 1];
      if (open === undefined) return i === n ? null : i;
      const c = text.charAt(i);
      if (c === ",") {
        i += 1;
        state = open === "{" ? "key" : "value";
      } else if (c === (open === "{" ? "}" : "]")) {
        stack.pop();
        i += 1;
        state = "after";
      } else {
        return i;
      }
    }
  }
}

/**
 * The 1-based line and column of a UTF-16 offset. CR LF, LF and a lone CR each end a line; the
 * column counts Unicode code points, so a surrogate pair is one column.
 */
export function lineAndColumn(text: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let i = 0; i < end; i += 1) {
    const c = text.charAt(i);
    if (c === "\n" || (c === "\r" && text.charAt(i + 1) !== "\n")) {
      line += 1;
      lineStart = i + 1;
    }
  }
  const column = Array.from(text.slice(lineStart, end)).length + 1;
  return { line, column };
}

/** Where a text that JSON.parse rejected breaks, or null when the scan finds no error. */
export function jsonSyntaxPosition(text: string): { readonly line: number; readonly column: number } | null {
  const offset = jsonErrorOffset(text);
  return offset === null ? null : lineAndColumn(text, offset);
}
