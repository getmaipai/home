"""The Python half of record-validate.test.ts's own proof: SPEC-01's
cross-field rules, mirrored in records/py/validate.py (item 1b, 'SPEC-01's
second reading', 2026-09-14), have to reject the same things on both
sides or a robot validating by the Python binding alone can write what
the hub refuses.
"""

import json
from pathlib import Path

from pydantic import ValidationError

from gen.py.memory_record_schema import MemoryRecord, RetrievalFeedback
from gen.py.open_question_schema import OpenQuestion
from gen.py.reply_constraint_schema import ReplyConstraint
from gen.py.subject_ref_schema import Household, Unresolved, World
from gen.py.turn_signal_schema import TurnSignal
from records.py.validate import (
    validate_memory_record,
    validate_open_question,
    validate_reply_constraint,
    validate_subject_ref,
    validate_turn_signal,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "records"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def memory_record(**overrides) -> MemoryRecord:
    return MemoryRecord.model_validate(
        {**load("memory-record.memory.example.json"), **overrides}
    )


def legacy_memory_record() -> MemoryRecord:
    return MemoryRecord.model_validate(load("memory-record.memory-legacy.example.json"))


def turn_signal(**overrides) -> TurnSignal:
    return TurnSignal.model_validate({**load("turn-signal.example.json"), **overrides})


def open_question(**overrides) -> OpenQuestion:
    return OpenQuestion.model_validate(
        {**load("open-question.example.json"), **overrides}
    )


def reply_constraint(**overrides) -> ReplyConstraint:
    return ReplyConstraint.model_validate(
        {**load("reply-constraint.example.json"), **overrides}
    )


def world_subject_ref(**overrides) -> World:
    return World.model_validate({**load("subject-ref.world.example.json"), **overrides})


def test_memory_record_fixture_is_valid():
    assert validate_memory_record(memory_record()) == []


def test_legacy_memory_record_is_valid():
    assert validate_memory_record(legacy_memory_record()) == []


def test_companion_scope_needs_companion_id():
    bad = memory_record(scope="companion", person=None, companion_id=None)
    assert any("must name its companion_id" in p for p in validate_memory_record(bad))


def test_companion_id_only_on_companion_scope():
    bad = memory_record(scope="person", companion_id="comp-marlow")
    assert any(
        "only meaningful on companion scope" in p for p in validate_memory_record(bad)
    )


def test_child_disclosure_null_on_person_and_self_scope():
    person_scoped = memory_record(scope="person", child_disclosure="adult_only")
    assert any(
        "meaningless on person scope" in p
        for p in validate_memory_record(person_scoped)
    )
    self_scoped = memory_record(scope="self", person=None, child_disclosure="child_ok")
    assert any(
        "meaningless on self scope" in p for p in validate_memory_record(self_scoped)
    )


def test_child_disclosure_set_by_and_set_at_move_together():
    one_only = memory_record(
        scope="household",
        person=None,
        child_disclosure_set_by="person-a1b2c3",
        child_disclosure_set_at=None,
    )
    assert any("must be set together" in p for p in validate_memory_record(one_only))
    other_only = memory_record(
        scope="household",
        person=None,
        child_disclosure_set_by=None,
        child_disclosure_set_at="2026-09-14T00:00:00Z",
    )
    assert any("must be set together" in p for p in validate_memory_record(other_only))


# A third code review on item 1b caught this: the pairing test above only
# proves the two fields move together, not that either is meaningless on
# a scope where child_disclosure itself must stay null.
def test_child_disclosure_set_by_and_set_at_also_meaningless_on_person_and_self_scope():
    person_scoped = memory_record(
        scope="person",
        child_disclosure_set_by="person-a1b2c3",
        child_disclosure_set_at="2026-09-14T00:00:00Z",
    )
    assert any(
        "meaningless on person scope" in p
        for p in validate_memory_record(person_scoped)
    )
    self_scoped = memory_record(
        scope="self",
        person=None,
        child_disclosure_set_by="person-a1b2c3",
        child_disclosure_set_at="2026-09-14T00:00:00Z",
    )
    assert any(
        "meaningless on self scope" in p for p in validate_memory_record(self_scoped)
    )


def test_fact_confidence_required_for_memory_kind():
    bad = memory_record(fact_confidence=None)
    assert any("must carry a fact_confidence" in p for p in validate_memory_record(bad))


def test_fact_confidence_forbidden_outside_memory_kind():
    bad = memory_record(record_kind="entity", fact_confidence=0.9)
    assert any(
        "only meaningful on a memory record" in p for p in validate_memory_record(bad)
    )


def test_retrieval_feedback_moves_together():
    zero_with_date = memory_record()
    zero_with_date.retrieval_feedback = RetrievalFeedback(
        corrections=0, last_corrected_at="2026-09-14T00:00:00Z"
    )
    assert any(
        "must be null while corrections is 0" in p
        for p in validate_memory_record(zero_with_date)
    )

    positive_no_date = memory_record()
    positive_no_date.retrieval_feedback = RetrievalFeedback(
        corrections=2, last_corrected_at=None
    )
    assert any(
        "must be set once corrections is above 0" in p
        for p in validate_memory_record(positive_no_date)
    )


def test_turn_signal_fixture_is_valid():
    assert validate_turn_signal(turn_signal()) == []


def test_source_head_needs_classifier_id():
    bad = turn_signal(source="head", classifier_id=None)
    assert any("must carry a classifier_id" in p for p in validate_turn_signal(bad))


def test_classifier_id_only_meaningful_for_head():
    bad = turn_signal(source="rule", classifier_id="act-head-v1")
    assert any(
        "only meaningful when source is head" in p for p in validate_turn_signal(bad)
    )


def test_clause_range_unordered_within_itself():
    signal = turn_signal()
    signal.clauses[0].range.start = 10
    signal.clauses[0].range.end = 2
    assert any("unordered" in p for p in validate_turn_signal(signal))


def test_clause_range_past_utterance_length_when_supplied():
    signal = turn_signal()
    signal.clauses[0].range.start = 0
    signal.clauses[0].range.end = 500
    assert any(
        "runs past the utterance's own length" in p
        for p in validate_turn_signal(signal, "short utterance")
    )
    assert validate_turn_signal(signal) == []


# A third code review on item 1b caught the gap: the TS suite's own
# "overlapping clause ranges are rejected" test had no Python twin.
def test_overlapping_clause_ranges_are_rejected():
    base = turn_signal().clauses[0].model_dump()
    signal = turn_signal(
        clauses=[
            {**base, "range": {"start": 0, "end": 10}},
            {**base, "range": {"start": 5, "end": 15}},
        ]
    )
    assert any("overlap" in p for p in validate_turn_signal(signal))


def test_open_question_fixture_is_valid():
    assert validate_open_question(open_question()) == []


def test_pending_must_not_carry_asked_at():
    bad = open_question(
        status="pending", asked_at="2026-09-14T00:00:00Z", resolved_at=None
    )
    assert any("must not carry asked_at" in p for p in validate_open_question(bad))


# A third code review on item 1b caught the gap: the TS suite loops over
# asked/answered/declined for "must carry asked_at" and over pending/
# asked/expired for "must not carry resolved_at"; Python only exercised
# answered for the first and pending for the second.
def test_asked_and_declined_also_need_asked_at():
    for status in ("asked", "declined"):
        bad = open_question(status=status, asked_at=None, resolved_at=None)
        assert any("must carry asked_at" in p for p in validate_open_question(bad))


def test_declined_needs_resolved_at_too():
    bad = open_question(
        status="declined", asked_at="2026-09-14T00:00:00Z", resolved_at=None
    )
    assert any("must carry resolved_at" in p for p in validate_open_question(bad))


def test_asked_and_expired_must_not_carry_resolved_at():
    asked = open_question(
        status="asked",
        asked_at="2026-09-14T00:00:00Z",
        resolved_at="2026-09-14T01:00:00Z",
    )
    assert any("must not carry resolved_at" in p for p in validate_open_question(asked))
    expired = open_question(
        status="expired", asked_at=None, resolved_at="2026-09-14T01:00:00Z"
    )
    assert any(
        "must not carry resolved_at" in p for p in validate_open_question(expired)
    )


def test_answered_needs_both_timestamps():
    bad = open_question(status="answered", asked_at=None, resolved_at=None)
    problems = validate_open_question(bad)
    assert any("must carry asked_at" in p for p in problems)
    assert any("must carry resolved_at" in p for p in problems)
    good = open_question(
        status="answered",
        asked_at="2026-09-14T00:00:00Z",
        resolved_at="2026-09-14T01:00:00Z",
    )
    assert validate_open_question(good) == []


def test_reply_constraint_fixture_is_valid():
    assert validate_reply_constraint(reply_constraint()) == []


def test_shape_constraint_must_name_a_reply_shape():
    bad = reply_constraint(kind="shape", value="table")
    assert any("must name a reply shape" in p for p in validate_reply_constraint(bad))


def test_length_constraint_must_carry_positive_integer_budget():
    not_a_number = reply_constraint(kind="length", value="short")
    assert any(
        "positive integer character budget" in p
        for p in validate_reply_constraint(not_a_number)
    )
    zero = reply_constraint(kind="length", value="0")
    assert any(
        "positive integer character budget" in p
        for p in validate_reply_constraint(zero)
    )


def test_valid_length_constraint_passes():
    good = reply_constraint(kind="length", value="40")
    assert validate_reply_constraint(good) == []


def test_world_subject_ref_fixture_is_valid():
    assert validate_subject_ref(world_subject_ref()) == []


def test_household_and_unresolved_refs_have_nothing_to_check():
    household = Household.model_validate(
        {"type": "household", "entity_id": "ent-a1b2c3", "carried_question": None}
    )
    assert validate_subject_ref(household) == []
    unresolved = Unresolved.model_validate(
        {
            "type": "unresolved",
            "surface_form": "Quill",
            "candidate_kinds": [],
            "provenance": "turn-1",
            "confidence": 0.4,
            "carried_question": None,
        }
    )
    assert validate_subject_ref(unresolved) == []


def test_world_ref_source_kind_and_stable_key_move_together():
    missing_kind = world_subject_ref(source_kind=None, stable_key="Q123456789")
    assert any("must be set together" in p for p in validate_subject_ref(missing_kind))
    missing_key = world_subject_ref(source_kind="wikidata", stable_key=None)
    assert any("must be set together" in p for p in validate_subject_ref(missing_key))
    assert (
        validate_subject_ref(world_subject_ref(source_kind=None, stable_key=None)) == []
    )


def test_shared_cross_language_validation_conformance():
    validation_file = FIXTURES.parent / "validation" / "cross-field.json"
    cases = json.loads(validation_file.read_text())["cases"]
    for case in cases:
        raw = load(case["base"])
        raw.update(case.get("overrides", {}))
        utterance = raw.pop("utterance_text", None)
        problems: list[str] = []
        schema_refused = False
        try:
            if case["kind"] == "memory":
                problems = validate_memory_record(MemoryRecord.model_validate(raw))
            elif case["kind"] == "turn":
                problems = validate_turn_signal(
                    TurnSignal.model_validate(raw), utterance
                )
            elif case["kind"] == "question":
                problems = validate_open_question(OpenQuestion.model_validate(raw))
            elif case["kind"] == "constraint":
                problems = validate_reply_constraint(
                    ReplyConstraint.model_validate(raw)
                )
            elif case["kind"] == "subject":
                problems = validate_subject_ref(World.model_validate(raw))
        except ValidationError:
            schema_refused = True
        if case["expected"] == "accept":
            assert not schema_refused and problems == [], case["name"]
        else:
            assert schema_refused or any(
                case["rule"] in problem for problem in problems
            ), case["name"]
