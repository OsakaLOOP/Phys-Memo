import { deterministicStringify } from './src/attrstrand/utils.ts';
import { performance } from 'perf_hooks';
import assert from 'assert';

const obj1 = { a: 1, c: 3, b: 2 };
const obj2 = { c: 3, b: 2, a: 1 };
assert.strictEqual(deterministicStringify(obj1), deterministicStringify(obj2));
console.log("Output is deterministic and correct!");
