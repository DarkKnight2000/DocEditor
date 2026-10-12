"""app.delta: the Python port of quill-delta's compose/transform used by the server."""
import copy
import random

import pytest

import app.delta as D
from tests.fakes import normalize, random_edit


# --- compose ----------------------------------------------------------------

def test_compose_insert_into_document():
    assert D.compose([{'insert': 'Hello'}], [{'retain': 5}, {'insert': '!'}]) == [{'insert': 'Hello!'}]


def test_compose_delete_from_document():
    assert D.compose([{'insert': 'Hello'}], [{'retain': 1}, {'delete': 3}]) == [{'insert': 'Ho'}]


def test_compose_formats_part_of_document():
    result = D.compose([{'insert': 'Hello'}], [{'retain': 2, 'attributes': {'bold': True}}])
    assert result == [{'insert': 'He', 'attributes': {'bold': True}}, {'insert': 'llo'}]


def test_compose_removing_format_drops_null_from_document():
    doc = [{'insert': 'Hi', 'attributes': {'bold': True}}]
    assert D.compose(doc, [{'retain': 2, 'attributes': {'bold': None}}]) == [{'insert': 'Hi'}]


def test_compose_of_two_changes_keeps_null_format():
    # composing onto a retain must keep "remove bold", like Quill (it still has to be applied later)
    a = [{'retain': 2, 'attributes': {'italic': True}}]
    b = [{'retain': 2, 'attributes': {'bold': None}}]
    assert D.compose(a, b) == [{'retain': 2, 'attributes': {'italic': True, 'bold': None}}]


def test_compose_with_empty_change_is_identity():
    doc = [{'insert': 'abc', 'attributes': {'bold': True}}]
    assert D.compose(doc, []) == doc


# --- transform --------------------------------------------------------------

def test_transform_concurrent_inserts_at_same_spot_follow_priority():
    a, b = [{'insert': 'a'}], [{'insert': 'b'}]
    # a has priority: b goes after a's text
    assert D.transform(a, b, True) == [{'retain': 1}, {'insert': 'b'}]
    # a doesn't have priority: b goes first
    assert D.transform(a, b, False) == [{'insert': 'b'}]


def test_transform_insert_shifts_later_position():
    a = [{'insert': 'XX'}]                      # insert at start
    b = [{'retain': 3}, {'insert': '!'}]        # insert at 3
    assert D.transform(a, b, True) == [{'retain': 5}, {'insert': '!'}]


def test_transform_overlapping_deletes_dont_delete_twice():
    a = [{'retain': 1}, {'delete': 3}]          # delete chars 1-3
    b = [{'retain': 2}, {'delete': 3}]          # delete chars 2-4
    # chars 2-3 are already gone, only char 4 is left for b to delete (now at index 1)
    assert D.transform(a, b, True) == [{'retain': 1}, {'delete': 1}]


def test_transform_format_conflict_with_priority_keeps_first_writer():
    a = [{'retain': 3, 'attributes': {'bold': True}}]
    b = [{'retain': 3, 'attributes': {'bold': None, 'italic': True}}]
    # a set bold first, so b's bold change is dropped; its italic still applies
    assert D.transform(a, b, True) == [{'retain': 3, 'attributes': {'italic': True}}]
    assert D.transform(a, b, False) == [{'retain': 3, 'attributes': {'bold': None, 'italic': True}}]


def test_transform_does_not_modify_its_inputs():
    a = [{'retain': 1}, {'insert': 'a'}]
    b = [{'retain': 1}, {'insert': 'b'}, {'delete': 1}]
    a_copy, b_copy = copy.deepcopy(a), copy.deepcopy(b)
    D.transform(a, b, True)
    assert (a, b) == (a_copy, b_copy)


# --- convergence (TP1) ------------------------------------------------------

@pytest.mark.parametrize('seed', range(300))
def test_concurrent_changes_converge(seed):
    """Applying a then b', or b then a', must give the same document"""
    rand = random.Random(seed)
    doc = [{'insert': ''.join(rand.choice('abcdef') for _ in range(rand.randint(1, 12)))}]
    length = D.length(doc)
    a, b = random_edit(rand, length, 'A'), random_edit(rand, length, 'B')

    via_a = D.compose(D.compose(doc, a), D.transform(a, b, True))
    via_b = D.compose(D.compose(doc, b), D.transform(b, a, False))
    assert normalize(via_a) == normalize(via_b)
