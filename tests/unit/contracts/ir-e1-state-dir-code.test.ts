/**
 * IR-E1 (review E, PM decision): the code a linked or not plain state directory is refused with.
 * Exit 2, category state, not retryable: beside invalid_run_record. Read through string keys so
 * the test is the same before and after the code exists.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CLI_ERROR_CATEGORY, CLI_ERROR_EXIT_CODES, CLI_ERROR_RETRYABLE } from "../../../src/contracts/index.js";
import * as store from "../../../src/store/index.js";

const CODE = "state_dir_not_plain";
const STATE_DIR_NOT_PLAIN_MESSAGE = (store as Readonly<Record<string, unknown>>)["STATE_DIR_NOT_PLAIN_MESSAGE"] as string;

test("IR-E1: state_dir_not_plain is exit 2, category state, not retryable (as invalid_run_record)", () => {
  const exits = CLI_ERROR_EXIT_CODES as Readonly<Record<string, number>>;
  const categories = CLI_ERROR_CATEGORY as Readonly<Record<string, string>>;
  const retryable = CLI_ERROR_RETRYABLE as Readonly<Record<string, boolean>>;
  assert.deepEqual([exits[CODE], categories[CODE], retryable[CODE]], [2, "state", false]);
  assert.deepEqual([exits[CODE], categories[CODE], retryable[CODE]], [exits["invalid_run_record"], categories["invalid_run_record"], retryable["invalid_run_record"]]);
});

test("IR-E1: the one message every refusing entry gives says what is wrong and that nothing was written", () => {
  assert.equal(typeof STATE_DIR_NOT_PLAIN_MESSAGE, "string");
  assert.match(STATE_DIR_NOT_PLAIN_MESSAGE, /\.codaryn/);
  assert.match(STATE_DIR_NOT_PLAIN_MESSAGE, /link/);
  assert.match(STATE_DIR_NOT_PLAIN_MESSAGE, /nothing was written/);
});
