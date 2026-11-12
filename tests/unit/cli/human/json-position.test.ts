/**
 * N-6, N-15: line and column of the first JSON syntax error, without any file text.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jsonSyntaxErrorOffset, jsonSyntaxErrorPosition, positionOf } from "../../../../src/cli/human/json-position.js";

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

describe("jsonSyntaxErrorPosition", () => {
  test("valid JSON has no position", () => {
    for (const text of ['{"a":[1,-2.5e+3,true,false,null,"x\\u00e9\\n"]}', " [ ] ", "0", '"\\/"', "{}\r\n", '{"한글":"값"}']) {
      assert.equal(jsonSyntaxErrorPosition(text), null, text);
    }
  });

  test("points at the first character that cannot continue valid JSON", () => {
    const cases: [string, number, number][] = [
      ['{"a":1,}', 1, 8], // trailing comma: the closing brace
      ['{"a" 1}', 1, 6], // missing colon
      ["{\n  \"a\": 01\n}", 2, 9], // leading zero: the second digit
      ["[1, 2", 1, 6], // cut off: one past the end
      ['{"a": tru}', 1, 10],
      ["[1] x", 1, 5], // text after the value
      ['{"a":"x\ty"}', 1, 8], // a raw tab inside a string
      ['"\\q"', 1, 3], // unknown escape
      ['"\\u12G4"', 1, 6], // bad hex digit
      ["// c\n{}", 1, 1], // comments are not JSON
      ["{\r\n\"a\":\r\n}", 3, 1], // CR LF ends one line
      ["{\r\"a\":\r}", 3, 1], // a lone CR ends a line too
      ['["한글", x]', 1, 8], // columns count characters, not bytes or UTF-16 units
      ['["😀", x]', 1, 7],
      ["", 1, 1],
      ["-", 1, 2],
      ["1.", 1, 3],
      ["1e+", 1, 4],
    ];
    for (const [text, line, column] of cases) {
      const position = jsonSyntaxErrorPosition(text);
      assert.ok(position !== null, JSON.stringify(text));
      assert.deepEqual([position.line, position.column], [line, column], JSON.stringify(text));
    }
  });

  test("agrees with JSON.parse on what is valid, over many generated texts", () => {
    const pieces = ["{", "}", "[", "]", ",", ":", '"a"', '"b\\n"', "1", "-0", "2.5", "1e9", "true", "null", " ", "\n", "x", '"', "\\", "01", "."];
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let round = 0; round < 5000; round += 1) {
      let text = "";
      const length = 1 + (next() % 9);
      for (let index = 0; index < length; index += 1) text += pieces[next() % pieces.length];
      assert.equal(jsonSyntaxErrorOffset(text) === null, parses(text), JSON.stringify(text));
    }
  });

  test("deep nesting is scanned without recursion", () => {
    const depth = 200_000;
    assert.equal(jsonSyntaxErrorOffset(`${"[".repeat(depth)}${"]".repeat(depth)}`), null);
    assert.equal(jsonSyntaxErrorOffset(`${"[".repeat(depth)}${"]".repeat(depth - 1)}`), 2 * depth - 1);
  });

  test("the answer holds numbers only, so no file text can reach a message", () => {
    const secret = "fake-secret-N6-VALUE-0001";
    const position = jsonSyntaxErrorPosition(`{"token": "${secret}" "x"}`);
    assert.ok(position !== null);
    assert.deepEqual(Object.keys(position).sort(), ["column", "line", "offset"]);
    assert.ok(Object.values(position).every((value) => typeof value === "number"));
    assert.equal(JSON.stringify(position).includes(secret), false);
  });

  test("positionOf clamps the offset to the text", () => {
    assert.deepEqual(positionOf("ab\ncd", 99), { offset: 5, line: 2, column: 3 });
    assert.deepEqual(positionOf("ab", -3), { offset: 0, line: 1, column: 1 });
  });
});
