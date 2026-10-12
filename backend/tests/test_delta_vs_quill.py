"""The server (app.delta) and the browser (quill-delta) must compute identical deltas,
otherwise clients and the saved document drift apart. Runs both on the same random cases.

Needs node and frontend/node_modules (npm install in frontend/); skipped otherwise."""
import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

import app.delta as D
from tests.fakes import ATTRS

QUILL_DELTA_DIR = Path(__file__).resolve().parents[2] / 'frontend' / 'node_modules' / 'quill-delta'
RUNNER = Path(__file__).with_name('quill_delta_runner.mjs')
NODE = shutil.which('node')

pytestmark = pytest.mark.skipif(
    not NODE or not QUILL_DELTA_DIR.exists(),
    reason='needs node and frontend/node_modules/quill-delta (run npm install in frontend/)',
)


def random_document(rand):
    """Document of 0-4 runs of text, some formatted"""
    doc = []
    for _ in range(rand.randint(0, 4)):
        op = {'insert': ''.join(rand.choice('abcxyz') for _ in range(rand.randint(1, 6)))}
        if rand.random() < 0.3:
            op['attributes'] = {k: v for k, v in rand.choice(ATTRS).items() if v is not None}
        doc.append(op)
    return D.compose([], doc)


def random_change(rand, doc_len):
    """Change of several ops: retains (some formatting), deletes and inserts"""
    ops, pos = [], 0
    while pos < doc_len and rand.random() < 0.8:
        kind = rand.choice(['retain', 'retain', 'format', 'delete', 'insert'])
        n = rand.randint(1, doc_len - pos)
        if kind == 'retain':
            ops.append({'retain': n}); pos += n
        elif kind == 'format':
            ops.append({'retain': n, 'attributes': dict(rand.choice(ATTRS))}); pos += n
        elif kind == 'delete':
            ops.append({'delete': n}); pos += n
        else:
            op = {'insert': rand.choice(['q', 'rs', 'tuv'])}
            if rand.random() < 0.3:
                op['attributes'] = {'bold': True}
            ops.append(op)
    if rand.random() < 0.5:
        ops.append({'insert': 'END'})
    return ops


def make_cases(count=1500, seed=20261013):
    rand = random.Random(seed)
    cases = []
    for _ in range(count):
        doc = random_document(rand)
        length = D.length(doc)
        a, b = random_change(rand, length), random_change(rand, length)
        cases += [
            {'op': 'compose', 'a': doc, 'b': a},                        # document + change (server head)
            {'op': 'compose', 'a': a, 'b': b},                          # change + change (client buffers)
            {'op': 'transform', 'a': a, 'b': b, 'priority': True},      # server: earlier revision wins
            {'op': 'transform', 'a': a, 'b': b, 'priority': False},
        ]
    return cases


def python_result(case):
    a, b = json.loads(json.dumps(case['a'])), json.loads(json.dumps(case['b']))
    if case['op'] == 'compose':
        return D.compose(a, b)
    return D.transform(a, b, case['priority'])


def canonical(ops):
    # quill-delta and Python may order attribute keys differently; that's not a difference
    return json.dumps(ops, sort_keys=True)


def test_python_delta_matches_quill_delta(tmp_path):
    cases = make_cases()
    cases_file = tmp_path / 'cases.json'
    cases_file.write_text(json.dumps(cases))
    run = subprocess.run([NODE, str(RUNNER), str(QUILL_DELTA_DIR), str(cases_file)],
                         capture_output=True, text=True, check=True)
    quill_results = json.loads(run.stdout)
    assert len(quill_results) == len(cases)

    mismatches = []
    for case, expected in zip(cases, quill_results):
        actual = python_result(case)
        if canonical(actual) != canonical(expected):
            mismatches.append({**case, 'python': actual, 'quill': expected})
    assert not mismatches, (f'{len(mismatches)} of {len(cases)} cases differ; first: '
                            + json.dumps(mismatches[0]))
