"""Round-trips every fixture in spec/fixtures/records/ through its generated
Pydantic model. This is the Python half of the proof required by platform
plan 3: "home's check.sh round-trips every fixture in spec/fixtures/ through
both generated model sets." The TS half is spec/tests/ts/fixtures.test.ts.
"""

import json
from pathlib import Path

import pytest
from _standards import load_standards_module
from pydantic import ValidationError

from gen.py.attachment_schema import Attachment
from gen.py.content_ceiling_schema import ContentCeiling
from gen.py.conversation_schema import Conversation
from gen.py.conversation_turn_schema import ConversationTurn
from gen.py.device_schema import Device
from gen.py.entity_schema import Entity
from gen.py.grant_schema import Grant
from gen.py.issue_schema import Issue
from gen.py.list_schema import List
from gen.py.manifest_schema import PackageManifest
from gen.py.memory_record_schema import MemoryRecord
from gen.py.model_capabilities_schema import ModelCapabilities
from gen.py.open_question_schema import OpenQuestion
from gen.py.person_schema import Person
from gen.py.relationship_schema import Relationship
from gen.py.reply_constraint_schema import ReplyConstraint
from gen.py.reply_feedback_schema import ReplyFeedback
from gen.py.reply_plan_schema import ReplyPlan
from gen.py.safety_result_schema import SafetyResult
from gen.py.setting_value_schema import SettingValue
from gen.py.settings_key_schema import SettingsKey
from gen.py.source_schema import Source
from gen.py.subject_ref_schema import Household, Unresolved, World
from gen.py.turn_artifact_schema import TurnArtifact
from gen.py.turn_signal_schema import TurnSignal

# ErrorEntry is standards-owned (std-v0.2.0), not generated here; loaded
# from the sibling .github checkout the same way spec/schemas/manifest
# .schema.json imports PrivacyRow by $ref. See tests/py/_standards.py for
# why this isn't a plain "from gen.py..." import.
ErrorEntry = load_standards_module("error_entry_schema").ErrorEntry

SPEC_DIR = Path(__file__).resolve().parents[2]
FIXTURES_DIR = SPEC_DIR / "fixtures" / "records"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text())


def test_person_fixture():
    Person.model_validate(load_fixture("person.example.json"))


def test_setting_value_fixture():
    SettingValue.model_validate(load_fixture("setting-value.example.json"))


def test_settings_key_fixture():
    SettingsKey.model_validate(load_fixture("settings-key.example.json"))


@pytest.mark.parametrize("kind", ["person", "pet", "place"])
def test_entity_fixtures(kind: str):
    Entity.model_validate(load_fixture(f"entity.{kind}.example.json"))


@pytest.mark.parametrize("kind", ["shopping", "todo", "custom"])
def test_list_fixtures(kind: str):
    List.model_validate(load_fixture(f"list.{kind}.example.json"))


# Three relationship fixtures, one per case the two-axis design exists
# for: a former job (valid_to set), an estranged daughter (valid_to null,
# status estranged), and an unconfirmed inference.
@pytest.mark.parametrize("kind", ["stated", "estranged", "inferred"])
def test_relationship_fixtures(kind: str):
    Relationship.model_validate(load_fixture(f"relationship.{kind}.example.json"))


def test_grant_fixture():
    Grant.model_validate(load_fixture("grant.example.json"))


def test_issue_fixture():
    Issue.model_validate(load_fixture("issue.example.json"))


def test_device_fixture():
    Device.model_validate(load_fixture("device.example.json"))


def test_conversation_fixture():
    Conversation.model_validate(load_fixture("conversation.example.json"))


def test_temporary_conversation_fixture():
    Conversation.model_validate(load_fixture("conversation.temporary.example.json"))


def test_source_fixture():
    Source.model_validate(load_fixture("source.example.json"))


@pytest.mark.parametrize("kind", ["memory", "memory-legacy", "entity", "episode"])
def test_memory_record_fixtures(kind):
    MemoryRecord.model_validate(load_fixture(f"memory-record.{kind}.example.json"))


def test_manifest_fixture():
    PackageManifest.model_validate(load_fixture("manifest.example.json"))


def test_safety_result_fixture():
    SafetyResult.model_validate(load_fixture("safety-result.example.json"))


@pytest.mark.parametrize("band", ["child", "teen", "adult"])
def test_content_ceiling_fixtures(band: str):
    ContentCeiling.model_validate(load_fixture(f"content-ceiling.{band}.example.json"))


def test_content_ceiling_floor_is_identical_across_every_band():
    floors = [
        load_fixture(f"content-ceiling.{band}.example.json")["floor"]
        for band in ("child", "teen", "adult")
    ]
    assert floors[0] == floors[1] == floors[2]


def test_error_catalogue_entries():
    entries = json.loads((SPEC_DIR / "errors" / "errors.json").read_text())
    assert len(entries) > 0
    for entry in entries:
        ErrorEntry.model_validate(entry)


@pytest.mark.parametrize("kind", ["chat", "image"])
def test_model_capabilities_fixtures(kind):
    ModelCapabilities.model_validate(
        load_fixture(f"model-capabilities.{kind}.example.json")
    )


def test_turn_signal_fixture():
    TurnSignal.model_validate(load_fixture("turn-signal.example.json"))


def test_attachment_fixture():
    Attachment.model_validate(load_fixture("attachment.example.json"))


def test_reply_plan_fixture():
    ReplyPlan.model_validate(load_fixture("reply-plan.example.json"))


# SubjectRef's root is a bare oneOf (no wrapping object), which
# datamodel-codegen collapses away rather than emitting a combined union
# type on the Python side (json-schema-to-zod does emit one for TS - see
# spec/tests/ts/fixtures.test.ts's own SubjectRef.parse() calls). Each
# variant's own generated class round-trips its fixture just as well; this
# is a documented generator asymmetry, not a schema bug (README, "Why two
# generated model sets").
def test_subject_ref_household_fixture():
    Household.model_validate(load_fixture("subject-ref.household.example.json"))


def test_subject_ref_world_fixture():
    World.model_validate(load_fixture("subject-ref.world.example.json"))


def test_subject_ref_world_with_entity_id_is_rejected():
    bad = {**load_fixture("subject-ref.world.example.json"), "entity_id": "ent-p7q8r9"}
    with pytest.raises(ValidationError):
        World.model_validate(bad)


def test_subject_ref_unresolved_fixture():
    Unresolved.model_validate(load_fixture("subject-ref.unresolved.example.json"))


@pytest.mark.parametrize("kind", ["conversation-turn", "conversation-turn.branch"])
def test_conversation_turn_fixtures(kind):
    ConversationTurn.model_validate(load_fixture(f"{kind}.example.json"))


def test_open_question_fixture():
    OpenQuestion.model_validate(load_fixture("open-question.example.json"))


@pytest.mark.parametrize(
    "kind", ["lookup", "card", "procedure", "comparison", "document"]
)
def test_turn_artifact_fixtures(kind: str):
    TurnArtifact.model_validate(load_fixture(f"turn-artifact.{kind}.example.json"))


def test_reply_constraint_fixture():
    ReplyConstraint.model_validate(load_fixture("reply-constraint.example.json"))


def test_reply_feedback_fixture():
    ReplyFeedback.model_validate(load_fixture("reply-feedback.example.json"))


def test_person_missing_required_field_is_rejected():
    bad = load_fixture("person.example.json")
    del bad["role"]
    with pytest.raises(ValidationError):
        Person.model_validate(bad)


def test_person_with_unknown_field_is_rejected():
    bad = {**load_fixture("person.example.json"), "extra": "nope"}
    with pytest.raises(ValidationError):
        Person.model_validate(bad)
