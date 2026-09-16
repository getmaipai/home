"""The cross-field rules spec/records/ts/validate.ts already proves for
the hub, mirrored here so a robot validating by the Python binding alone
cannot write what the hub would refuse - the no-data-debt rule's own
failure mode (item 1b, 'SPEC-01's second reading', 2026-09-14) otherwise.
"""

import json
from datetime import datetime
from pathlib import Path

from gen.py.entity_schema import Entity
from gen.py.grant_schema import Grant
from gen.py.list_schema import List
from gen.py.memory_record_schema import MemoryRecord
from gen.py.open_question_schema import OpenQuestion
from gen.py.relationship_schema import Relationship
from gen.py.reply_constraint_schema import ReplyConstraint
from gen.py.turn_signal_schema import TurnSignal

Problems = list[str]

VOCAB_DIR = Path(__file__).resolve().parents[2] / "vocab"


def _load_vocab(name: str):
    return json.loads((VOCAB_DIR / name).read_text())


def relationship_types() -> list[dict]:
    return _load_vocab("relationship-types.json")["types"]


def relationship_type(type_id: str) -> dict | None:
    return next((t for t in relationship_types() if t["id"] == type_id), None)


def entity_kind_nouns() -> list[dict]:
    return _load_vocab("entity-kind-nouns.json")["kinds"]


def kind_for_noun(noun: str) -> str | None:
    lowered = noun.lower()
    for kind in entity_kind_nouns():
        if lowered in kind["nouns"]:
            return kind["kind"]
    return None


def grant_actions() -> list[dict]:
    return _load_vocab("grant-actions.json")["actions"]


def inverse_relationship(
    rel: Relationship,
    fields: dict,
) -> Relationship | None:
    """Builds the reciprocal edge a writer must store alongside this one.
    Returns None for a symmetric type whose reciprocal is the same edge
    read the other way (sibling_of, partner_of, friend_of), or for a type
    not in the vocabulary. The caller supplies the new row's id and
    timestamps, because minting ids is the hub's job, not the spec's."""
    type = relationship_type(rel.type)
    if type is None or type.get("symmetric"):
        return None
    data = {
        "id": rel.id,
        "type": type["inverse"],
        "from_id": rel.to_id,
        "to_id": rel.from_id,
        "status": rel.status,
        "valid_from": rel.valid_from,
        "valid_to": rel.valid_to,
        "expired_at": rel.expired_at,
        "source": rel.source,
        "stated_by_person_id": rel.stated_by_person_id,
        "confidence": rel.confidence,
        "confirmed_by_person_id": rel.confirmed_by_person_id,
        "confirmed_at": rel.confirmed_at,
        "evidence": rel.evidence,
        "scope": rel.scope,
        "person": rel.person,
        "sensitive": rel.sensitive,
        "note": rel.note,
        "created_at": rel.created_at,
        "updated_at": rel.updated_at,
        "deleted_at": rel.deleted_at,
        "hlc": rel.hlc,
        **fields,
    }
    return Relationship.model_validate(data)


def match_grant_action(action: str) -> dict | None:
    """Matches a grant's concrete action against the vocabulary, the same
    way a manifest's `net:api.open-meteo.com` matches permissions.json's
    `net:<host>`: a literal entry matches exactly, a parameterized one
    matches on its prefix and requires a non-empty target after the
    colon. An un-substituted template is not an action."""
    if "<" in action or ">" in action:
        return None
    for a in grant_actions():
        if not a["parameterized"] and a["id"] == action:
            return a
    colon = action.find(":")
    if colon <= 0 or colon == len(action) - 1:
        return None
    prefix = action[: colon + 1]
    for a in grant_actions():
        if a["parameterized"] and a["id"].startswith(prefix):
            return a
    return None


def _ends_before_it_starts(from_: datetime | None, to: datetime | None) -> bool:
    """True when `to` is genuinely before `from` as instants. Not a
    string comparison: `format: date-time` permits a non-Z offset, and a
    code review (2026-09-05) verified both failure directions on the
    lexicographic version this replaces."""
    if from_ is None or to is None:
        return False
    return to < from_


def _scope_problems(scope: str | None, person: str | None) -> Problems:
    effective_scope = scope or "household"
    if effective_scope == "person" and not person:
        return ["a person-scoped record must name its person"]
    if effective_scope != "person" and person:
        return [f"a {effective_scope}-scoped record must not name a person"]
    return []


def validate_entity(entity: Entity) -> Problems:
    problems: Problems = []

    if entity.kind == "place":
        if not entity.place_kind:
            problems.append(
                "a place must say whether it is a `map` place or an `area` inside one"
            )
    elif entity.place_kind:
        problems.append(f"place_kind is only meaningful on a place, not on a {entity.kind}")

    if entity.kind != "person" and entity.account_person_id:
        problems.append(f"only a person can hold an account; this is a {entity.kind}")

    if entity.parent_id and entity.kind != "place":
        problems.append("parent_id is physical containment and only applies to places")
    if entity.parent_id and entity.parent_id == entity.id:
        problems.append("an entity cannot contain itself")

    problems.extend(_scope_problems(entity.scope, entity.person))

    if (
        entity.source == "inferred"
        and entity.confirmed_by_person_id is None
        and entity.scope == "household"
    ):
        problems.append(
            "an unconfirmed inferred entity cannot be household-scoped; it belongs to the person it came from"
        )

    return problems


def validate_relationship(rel: Relationship) -> Problems:
    problems: Problems = []
    type = relationship_type(rel.type)

    if type is None:
        return [f"unknown relationship type: {rel.type}"]

    if rel.status not in type["statuses"]:
        problems.append(
            f'{rel.type} does not admit the status "{rel.status}" (allowed: {", ".join(type["statuses"])})'
        )

    if rel.valid_to and not type["terminable"]:
        problems.append(
            f"{rel.type} cannot end, so valid_to must stay null; if the relationship has gone bad, that is a status"
        )

    if _ends_before_it_starts(rel.valid_from, rel.valid_to):
        problems.append("valid_to is before valid_from")

    if rel.from_id == rel.to_id:
        problems.append("a relationship cannot join an entity to itself")

    if rel.source == "inferred":
        if rel.confidence is None:
            problems.append("an inferred relationship must carry a confidence")
        if len(rel.evidence) == 0:
            problems.append(
                "an inferred relationship must carry the evidence it came from, or it cannot be reviewed"
            )
        if rel.scope == "household" and rel.confirmed_by_person_id is None:
            problems.append(
                "an unconfirmed inferred relationship cannot be household-scoped: it is the person's data until they say otherwise"
            )
        if rel.stated_by_person_id:
            problems.append(
                "an inferred relationship must not name a person as having stated it; nobody did"
            )
    else:
        if rel.confidence is not None:
            problems.append("only an inferred relationship has a confidence; a person said this one")
        if len(rel.evidence) > 0:
            problems.append("evidence belongs to an inferred relationship")
        if rel.source == "stated" and not rel.stated_by_person_id:
            problems.append("a stated relationship must record who stated it")

    problems.extend(_scope_problems(rel.scope, rel.person))
    return problems


def validate_relationship_endpoints(
    rel: Relationship, from_entity: Entity, to_entity: Entity
) -> Problems:
    """Checks the entity kinds an edge joins. Separate from
    validateRelationship because it needs the two entities, which a caller
    holding only the edge does not have."""
    type = relationship_type(rel.type)
    if type is None:
        return [f"unknown relationship type: {rel.type}"]
    problems: Problems = []
    if from_entity.id != rel.from_id:
        problems.append(f'the "from" entity {from_entity.id} is not this relationship\'s from_id')
    if to_entity.id != rel.to_id:
        problems.append(f'the "to" entity {to_entity.id} is not this relationship\'s to_id')
    if problems:
        return problems
    if from_entity.kind not in type["from"]:
        problems.append(f'{rel.type} cannot start at a {from_entity.kind} (allowed: {", ".join(type["from"])})')
    if to_entity.kind not in type["to"]:
        problems.append(f'{rel.type} cannot point at a {to_entity.kind} (allowed: {", ".join(type["to"])})')
    return problems


def validate_grant(grant: Grant) -> Problems:
    problems: Problems = []

    if match_grant_action(grant.action) is None:
        return [f"unknown grant action: {grant.action}"]

    if _ends_before_it_starts(grant.valid_from, grant.valid_to):
        problems.append("valid_to is before valid_from")

    needs_acknowledgment = {"chat.unrestricted", "generate.unrestricted"}
    if grant.action in needs_acknowledgment and grant.effect == "allow":
        if not grant.acknowledged_at or not grant.acknowledged_by_person_id:
            problems.append(
                f"{grant.action} requires the adult's one-time acknowledgment before it can be allowed"
            )
        elif grant.acknowledged_by_person_id != grant.person:
            problems.append(
                f"{grant.action} must be acknowledged by the person it is about, not on their behalf by someone else"
            )

    return problems


def validate_list(lst: List) -> Problems:
    problems: Problems = []
    problems.extend(_scope_problems(lst.scope, lst.person))
    if lst.kind != "todo":
        for item in lst.items:
            if item.due_at:
                problems.append(
                    f'due_at is only meaningful on a todo list item, not a {lst.kind} one ("{item.text}")'
                )
    return problems


def validate_memory_record(record: MemoryRecord) -> Problems:
    problems: Problems = []

    if record.scope == "companion":
        if not record.companion_id:
            problems.append("a companion-scoped record must name its companion_id")
    elif record.companion_id:
        problems.append(
            f"companion_id is only meaningful on companion scope, not on {record.scope}"
        )

    problems.extend(_scope_problems(record.scope, record.person))

    if record.scope in ("person", "self"):
        if record.child_disclosure is not None:
            problems.append(
                f"child_disclosure is meaningless on {record.scope} scope and must stay null"
            )
        # A third code review on item 1b caught the gap: the pairing
        # check just below only proves set_by and set_at move together,
        # not that either is meaningless here too.
        if (
            record.child_disclosure_set_by is not None
            or record.child_disclosure_set_at is not None
        ):
            problems.append(
                f"child_disclosure_set_by and child_disclosure_set_at are meaningless on {record.scope} scope and must stay null"
            )

    if (record.child_disclosure_set_by is None) != (
        record.child_disclosure_set_at is None
    ):
        problems.append(
            "child_disclosure_set_by and child_disclosure_set_at must be set together, or both null"
        )

    if record.record_kind == "memory":
        if record.fact_confidence is None:
            problems.append("a memory record must carry a fact_confidence")
    else:
        if record.fact_confidence is not None:
            problems.append(
                f"fact_confidence is only meaningful on a memory record, not a {record.record_kind}"
            )
        if len(record.confidence_evidence) > 0:
            problems.append(
                f"confidence_evidence is only meaningful on a memory record, not a {record.record_kind}"
            )

    # retrieval_feedback's own generated type is nullable (datamodel-
    # code-generator's convention for any field carrying a default), but
    # the schema itself never allows a real null - always present in a
    # correctly parsed record. Guarded rather than asserted, since a
    # caller could still hand this function a record built by hand.
    feedback = record.retrieval_feedback
    if feedback is not None:
        if feedback.corrections == 0 and feedback.last_corrected_at is not None:
            problems.append(
                "retrieval_feedback.last_corrected_at must be null while corrections is 0"
            )
        if feedback.corrections > 0 and feedback.last_corrected_at is None:
            problems.append(
                "retrieval_feedback.last_corrected_at must be set once corrections is above 0"
            )

    return problems


def validate_turn_signal(
    signal: TurnSignal, utterance_text: str | None = None
) -> Problems:
    problems: Problems = []

    if signal.source == "head":
        if signal.classifier_id is None:
            problems.append("source: head must carry a classifier_id")
    elif signal.classifier_id is not None:
        problems.append(
            f"classifier_id is only meaningful when source is head, not {signal.source}"
        )

    ordered = sorted(signal.clauses, key=lambda c: c.range.start)
    for i, clause in enumerate(ordered):
        start, end = clause.range.start, clause.range.end
        if end < start:
            problems.append(
                f"a clause range is unordered: start {start} is after end {end}"
            )
        if utterance_text is not None and end > len(utterance_text):
            problems.append(
                f"a clause range ({start}-{end}) runs past the utterance's own length ({len(utterance_text)})"
            )
        if i + 1 < len(ordered):
            nxt = ordered[i + 1]
            if nxt.range.start < end:
                problems.append(
                    f"clause ranges overlap: {start}-{end} and {nxt.range.start}-{nxt.range.end}"
                )

    return problems


def validate_open_question(question: OpenQuestion) -> Problems:
    problems: Problems = []

    if question.status == "pending" and question.asked_at is not None:
        problems.append("a pending open question must not carry asked_at yet")
    if (
        question.status in ("asked", "answered", "declined")
        and question.asked_at is None
    ):
        problems.append(f"status {question.status} must carry asked_at")
    if question.status in ("answered", "declined") and question.resolved_at is None:
        problems.append(f"status {question.status} must carry resolved_at")
    if (
        question.status in ("pending", "asked", "expired")
        and question.resolved_at is not None
    ):
        problems.append(f"status {question.status} must not carry resolved_at")

    return problems


def validate_reply_constraint(constraint: ReplyConstraint) -> Problems:
    """CONS-01 (dev.md section 16 part 9 rule 2): a ReplyConstraint's kind
    and value have to agree on what the reply must look like. A shape
    constraint that names no reply shape, or a length constraint that names
    no positive integer, would constrain the hub to nothing at all."""
    problems: Problems = []

    if constraint.kind == "shape" and constraint.value not in (
        "list",
        "number",
        "one_line",
    ):
        problems.append(
            f'a shape constraint must name a reply shape (list, number, one_line), not "{constraint.value}"'
        )
    if constraint.kind == "length" and not (
        constraint.value.isdigit() and int(constraint.value) > 0
    ):
        problems.append(
            f'a length constraint must carry a positive integer character budget, not "{constraint.value}"'
        )

    return problems


def validate_subject_ref(ref) -> Problems:
    """subject_ref_schema.py's own root oneOf is collapsed away by
    datamodel-code-generator (no combined SubjectRef type on the Python
    side - README's own documented generator asymmetry, SPEC-01's commit
    message). Takes whichever of Household/World/Unresolved the caller
    already parsed into; only the world variant has anything to check."""
    if getattr(ref, "type", None) != "world":
        return []
    if (ref.source_kind is None) != (ref.stable_key is None):
        return [
            "a world SubjectRef's source_kind and stable_key must be set together, or both null"
        ]
    return []
