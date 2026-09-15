"""The cross-field rules spec/records/ts/validate.ts already proves for
the hub, mirrored here so a robot validating by the Python binding alone
cannot write what the hub would refuse - the no-data-debt rule's own
failure mode (item 1b, 'SPEC-01's second reading', 2026-09-14) otherwise.

Only SPEC-01's own new record types get a twin here (MemoryRecord's new
fields, TurnSignal, OpenQuestion, SubjectRef); the older Entity/
Relationship/Grant/List rules stay TS-only for now, unchanged from
validate.ts's own header note - the hub is still the only thing writing
those.
"""

from gen.py.memory_record_schema import MemoryRecord
from gen.py.open_question_schema import OpenQuestion
from gen.py.reply_constraint_schema import ReplyConstraint
from gen.py.turn_signal_schema import TurnSignal

Problems = list[str]


def _scope_problems(scope: str, person: str | None) -> Problems:
    if scope == "person" and not person:
        return ["a person-scoped record must name its person"]
    if scope != "person" and person:
        return [f"a {scope}-scoped record must not name a person"]
    return []


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
