"""The Python half of record-validate.test.ts's own proof: SPEC-01's
cross-field rules, mirrored in records/py/validate.py (item 1b, 'SPEC-01's
second reading', 2026-09-14), have to reject the same things on both
sides or a robot validating by the Python binding alone can write what
the hub refuses.
"""

import json
from pathlib import Path

from pydantic import ValidationError

from gen.py.entity_schema import Entity
from gen.py.grant_schema import Grant
from gen.py.list_schema import List
from gen.py.memory_record_schema import MemoryRecord, RetrievalFeedback
from gen.py.open_question_schema import OpenQuestion
from gen.py.reply_constraint_schema import ReplyConstraint
from gen.py.relationship_schema import Relationship
from gen.py.subject_ref_schema import Household, Unresolved, World
from gen.py.turn_signal_schema import TurnSignal
from records.py.validate import (
    inverse_relationship,
    validate_entity,
    validate_grant,
    validate_list,
    validate_memory_record,
    validate_open_question,
    validate_reply_constraint,
    validate_relationship,
    validate_relationship_endpoints,
    validate_subject_ref,
    validate_turn_signal,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "records"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def person() -> Entity:
    return Entity.model_validate(load("entity.person.example.json"))


def pet() -> Entity:
    return Entity.model_validate(load("entity.pet.example.json"))


def place() -> Entity:
    return Entity.model_validate(load("entity.place.example.json"))


def stated_rel() -> Relationship:
    return Relationship.model_validate(load("relationship.stated.example.json"))


def estranged_rel() -> Relationship:
    return Relationship.model_validate(load("relationship.estranged.example.json"))


def inferred_rel() -> Relationship:
    return Relationship.model_validate(load("relationship.inferred.example.json"))


def grant() -> Grant:
    return Grant.model_validate(load("grant.example.json"))


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


def shopping_list() -> List:
    return List.model_validate(load("list.shopping.example.json"))


def todo_list() -> List:
    return List.model_validate(load("list.todo.example.json"))


def custom_list() -> List:
    return List.model_validate(load("list.custom.example.json"))


def test_shipped_entity_fixtures_are_valid():
    for e in [person(), pet(), place()]:
        assert validate_entity(e) == []


def test_shipped_relationship_fixtures_are_valid():
    for r in [stated_rel(), estranged_rel(), inferred_rel()]:
        assert validate_relationship(r) == []


def test_shipped_grant_fixture_is_valid():
    assert validate_grant(grant()) == []


def test_shipped_list_fixtures_are_valid():
    for l in [shopping_list(), todo_list(), custom_list()]:
        assert validate_list(l) == []


def test_shipped_memory_record_fixture_is_valid():
    assert validate_memory_record(memory_record()) == []


def test_legacy_memory_record_fixture_is_valid():
    assert validate_memory_record(legacy_memory_record()) == []


# --- entity rules ---


def test_a_place_must_say_which_kind_of_place_it_is():
    bad = place()
    bad.place_kind = None
    assert any("must say" in p for p in validate_entity(bad))


def test_only_a_place_carries_a_place_kind():
    bad = pet()
    bad.place_kind = "map"
    assert any(
        "only meaningful on a place" in p for p in validate_entity(bad)
    )


def test_only_a_person_can_hold_an_account():
    bad = pet()
    bad.account_person_id = "person-a1b2c3"
    assert any(
        "only a person can hold an account" in p
        for p in validate_entity(bad)
    )


def test_containment_is_physical_so_only_places_contain():
    bad = pet()
    bad.parent_id = "ent-g7h8i9"
    assert any(
        "physical containment" in p for p in validate_entity(bad)
    )


def test_an_entity_cannot_contain_itself():
    p = place()
    bad = place()
    bad.parent_id = p.id
    assert any("contain itself" in p for p in validate_entity(bad))


def test_a_person_scoped_entity_names_its_person():
    bad = person()
    bad.scope = "person"
    bad.person = None
    assert any("must name its person" in p for p in validate_entity(bad))
    bad2 = person()
    bad2.scope = "household"
    bad2.person = "person-a1b2c3"
    assert any("must not name a person" in p for p in validate_entity(bad2))


# --- list rules ---


def test_a_due_at_is_only_meaningful_on_a_todo_list_item():
    shopping = shopping_list()
    bad = shopping_list()
    bad.items[0].due_at = "2026-09-08T17:00:00Z"
    assert any(
        "only meaningful on a todo list item" in p
        for p in validate_list(bad)
    )


def test_a_person_scoped_list_names_its_person():
    bad = todo_list()
    bad.scope = "person"
    bad.person = None
    assert any("must name its person" in p for p in validate_list(bad))
    bad2 = shopping_list()
    bad2.scope = "household"
    bad2.person = "person-a1b2c3"
    assert any("must not name a person" in p for p in validate_list(bad2))


# --- relationship rules ---


def test_an_unknown_type_is_rejected_outright():
    bad = stated_rel()
    bad.type = "frenemy_of"
    assert validate_relationship(bad) == ["unknown relationship type: frenemy_of"]


def test_an_ex_daughter_cannot_be_expressed():
    bad = estranged_rel()
    bad.valid_to = "2026-01-01T00:00:00Z"
    assert any("cannot end" in p for p in validate_relationship(bad))


def test_a_job_can_end_and_saying_so_is_not_an_error():
    assert validate_relationship(stated_rel()) == []
    assert stated_rel().valid_to is not None


def test_a_status_the_type_does_not_admit_is_rejected():
    bad = stated_rel()
    bad.status = "estranged"
    assert any("does not admit" in p for p in validate_relationship(bad))


def test_a_relationship_cannot_join_an_entity_to_itself():
    r = stated_rel()
    bad = stated_rel()
    bad.to_id = r.from_id
    assert any(
        "join an entity to itself" in p for p in validate_relationship(bad)
    )


def test_dates_that_run_backwards_are_rejected():
    bad = stated_rel()
    bad.valid_from = "2024-01-01T00:00:00Z"
    bad.valid_to = "2019-01-01T00:00:00Z"
    assert any("before valid_from" in p for p in validate_relationship(bad))


# --- inference-honesty rules ---


def test_a_guess_must_carry_a_confidence_and_its_evidence():
    bad = inferred_rel()
    bad.confidence = None
    assert any(
        "must carry a confidence" in p for p in validate_relationship(bad)
    )
    bad2 = inferred_rel()
    bad2.evidence = []
    assert any(
        "cannot be reviewed" in p for p in validate_relationship(bad2)
    )


def test_an_unconfirmed_guess_cannot_be_household_scoped():
    bad = inferred_rel()
    bad.scope = "household"
    bad.person = None
    bad.confirmed_by_person_id = None
    assert any(
        "the person's data until they say otherwise" in p
        for p in validate_relationship(bad)
    )


def test_once_a_person_confirms_it_it_may_be_shared():
    good = inferred_rel()
    good.scope = "household"
    good.person = None
    good.confirmed_by_person_id = "person-a1b2c3"
    assert validate_relationship(good) == []


def test_a_stated_relationship_carries_no_confidence_and_must_name_who_said_it():
    bad = stated_rel()
    bad.confidence = 0.9
    assert any(
        "only an inferred relationship has a confidence" in p
        for p in validate_relationship(bad)
    )
    bad2 = stated_rel()
    bad2.stated_by_person_id = None
    assert any("who stated it" in p for p in validate_relationship(bad2))


# --- relationship endpoints ---


def edge_between(type_id: str, from_ent: Entity, to_ent: Entity) -> Relationship:
    r = stated_rel()
    r.type = type_id
    r.from_id = from_ent.id
    r.to_id = to_ent.id
    return r


def test_a_type_refuses_kinds_it_cannot_join():
    assert validate_relationship_endpoints(
        edge_between("lives_at", pet(), place()), pet(), place()
    ) == []
    problems = validate_relationship_endpoints(
        edge_between("lives_at", place(), person()), place(), person()
    )
    assert len(problems) > 0


def test_ownership_reaches_pets_and_things_never_a_person():
    assert validate_relationship_endpoints(
        edge_between("owns", person(), pet()), person(), pet()
    ) == []
    other = person()
    other.id = "ent-z9y8x7"
    assert any(
        "cannot point at a person" in p
        for p in validate_relationship_endpoints(
            edge_between("owns", person(), other), person(), other
        )
    )


def test_entities_that_are_not_this_edges_endpoints_are_refused():
    edge = edge_between("lives_at", pet(), place())
    assert any(
        "is not this relationship's from_id" in p
        for p in validate_relationship_endpoints(edge, place(), pet())
    )


# --- dates compared as instants ---


def test_an_offset_timestamp_that_runs_forward_is_accepted():
    good = stated_rel()
    good.valid_from = "2026-03-01T08:00:00+05:00"
    good.valid_to = "2026-03-01T10:00:00Z"
    assert validate_relationship(good) == []


def test_an_offset_timestamp_that_runs_backward_is_rejected():
    bad = stated_rel()
    bad.valid_from = "2026-03-01T23:00:00Z"
    bad.valid_to = "2026-03-01T00:30:00+02:00"
    assert any("before valid_from" in p for p in validate_relationship(bad))


def test_a_grant_that_expires_before_it_starts_is_rejected():
    bad = grant()
    bad.valid_from = "2026-09-08T00:00:00Z"
    bad.valid_to = "2026-09-05T00:00:00Z"
    assert any("before valid_from" in p for p in validate_grant(bad))


# --- grant rules ---


def test_an_unknown_action_is_rejected_outright():
    bad = grant()
    bad.action = "do.anything"
    assert validate_grant(bad) == ["unknown grant action: do.anything"]


def test_a_parameterized_action_matches_its_template_and_needs_a_real_target():
    assert validate_grant(grant()) == []
    good = grant()
    good.action = "integration:home-assistant"
    assert validate_grant(good) == []
    bare = grant()
    bare.action = "use:"
    assert validate_grant(bare) == ["unknown grant action: use:"]
    literal = grant()
    literal.action = "backups.run"
    assert validate_grant(literal) == []
    literal_with_target = grant()
    literal_with_target.action = "backups.run:videos"
    assert validate_grant(literal_with_target) == [
        "unknown grant action: backups.run:videos"
    ]


def test_the_raw_vocabulary_template_is_not_an_action():
    bad = grant()
    bad.action = "use:<package>"
    assert validate_grant(bad) == ["unknown grant action: use:<package>"]


def test_unrestricted_mode_cannot_be_granted_without_the_adults_acknowledgment():
    g = grant()
    g.action = "chat.unrestricted"
    g.effect = "allow"
    g.acknowledged_at = None
    g.acknowledged_by_person_id = None
    assert any(
        "one-time acknowledgment" in p for p in validate_grant(g)
    )
    g2 = grant()
    g2.action = "chat.unrestricted"
    g2.effect = "allow"
    g2.acknowledged_at = "2026-09-05T12:00:00Z"
    g2.acknowledged_by_person_id = None
    assert any(
        "one-time acknowledgment" in p for p in validate_grant(g2)
    )
    g3 = grant()
    g3.action = "chat.unrestricted"
    g3.effect = "allow"
    g3.acknowledged_at = "2026-09-05T12:00:00Z"
    g3.acknowledged_by_person_id = g3.person
    assert validate_grant(g3) == []


def test_one_adult_cannot_acknowledge_unrestricted_mode_on_another_bealf():
    bad = grant()
    bad.action = "chat.unrestricted"
    bad.effect = "allow"
    bad.acknowledged_at = "2026-09-05T12:00:00Z"
    bad.acknowledged_by_person_id = "person-someoneelse"
    assert any(
        "not on their behalf" in p for p in validate_grant(bad)
    )


def test_denying_unrestricted_mode_needs_no_acknowledgment():
    good = grant()
    good.action = "chat.unrestricted"
    good.effect = "deny"
    good.acknowledged_at = None
    good.acknowledged_by_person_id = None
    assert validate_grant(good) == []


# --- the reciprocal edge ---

STAMPS = {
    "id": "rel-z9y8x7",
    "created_at": "2026-09-05T12:00:00Z",
    "updated_at": "2026-09-05T12:00:00Z",
}


def test_an_asymmetric_edge_produces_its_inverse_pointing_the_other_way():
    daughter = estranged_rel()
    inverse = inverse_relationship(daughter, STAMPS)
    assert inverse is not None
    assert inverse.type == "parent_of"
    assert inverse.from_id == daughter.to_id
    assert inverse.to_id == daughter.from_id
    assert validate_relationship(inverse) == []
    assert inverse.status == "estranged"


def test_a_symmetric_edge_has_no_second_row():
    assert inverse_relationship(inferred_rel(), STAMPS) is None


def test_an_unknown_type_produces_nothing_rather_than_a_broken_row():
    unknown = stated_rel()
    unknown.type = "frenemy_of"
    assert inverse_relationship(unknown, STAMPS) is None


# --- memory record rules ---


def test_companion_scope_needs_companion_id():
    bad = memory_record(scope="companion", person=None, companion_id=None)
    assert any("must name its companion_id" in p for p in validate_memory_record(bad))


def test_companion_id_only_on_companion_scope():
    bad = memory_record(scope="person", companion_id="comp-marlow")
    assert any(
        "only meaningful on companion scope" in p
        for p in validate_memory_record(bad)
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
        "only meaningful on a memory record" in p
        for p in validate_memory_record(bad)
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


# --- turn signal rules ---


def test_turn_signal_fixture_is_valid():
    assert validate_turn_signal(turn_signal()) == []


def test_source_head_needs_classifier_id():
    bad = turn_signal(source="head", classifier_id=None)
    assert any("must carry a classifier_id" in p for p in validate_turn_signal(bad))


def test_classifier_id_only_meaningful_for_head():
    bad = turn_signal(source="rule", classifier_id="act-head-v1")
    assert any(
        "only meaningful when source is head" in p
        for p in validate_turn_signal(bad)
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


def test_overlapping_clause_ranges_are_rejected():
    base = turn_signal().clauses[0].model_dump()
    signal = turn_signal(
        clauses=[
            {**base, "range": {"start": 0, "end": 10}},
            {**base, "range": {"start": 5, "end": 15}},
        ]
    )
    assert any("overlap" in p for p in validate_turn_signal(signal))


# --- open question rules ---


def test_open_question_fixture_is_valid():
    assert validate_open_question(open_question()) == []


def test_pending_must_not_carry_asked_at():
    bad = open_question(
        status="pending", asked_at="2026-09-14T00:00:00Z", resolved_at=None
    )
    assert any("must not carry asked_at" in p for p in validate_open_question(bad))


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


# --- reply constraint rules ---


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
        "positive integer character budget" in p for p in validate_reply_constraint(zero)
    )


def test_valid_length_constraint_passes():
    good = reply_constraint(kind="length", value="40")
    assert validate_reply_constraint(good) == []


# --- subject ref rules ---


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


# --- shared cross-language validation conformance ---


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
