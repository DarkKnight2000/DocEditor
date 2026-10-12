// Runs delta operations with the real quill-delta (what the browser uses) for
// tests/test_delta_vs_quill.py.  Usage: node quill_delta_runner.mjs <quill-delta dir> <cases.json>
// Each case: {op: "compose" | "transform", a, b, priority?}. Prints one result (ops array) per case as JSON.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [quillDeltaDir, casesFile] = process.argv.slice(2);
const require = createRequire(path.join(path.resolve(quillDeltaDir), 'package.json'));
const Delta = require(path.resolve(quillDeltaDir));

const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const results = cases.map(({ op, a, b, priority }) => {
    const A = new Delta(a), B = new Delta(b);
    if (op === 'compose') return A.compose(B).ops;
    if (op === 'transform') return A.transform(B, priority).ops;
    throw new Error(`unknown op ${op}`);
});
process.stdout.write(JSON.stringify(results));
