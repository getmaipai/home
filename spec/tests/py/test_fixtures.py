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

from gen.py.entity_schema import Entity
from gen.py.grant_schema import Grant
from gen.py.manifest_schema import PackageManifest
from gen.py.memory_record_schema import MemoryRecord
from gen.py.model_capabilities_schema import ModelCapabilities
from gen.py.person_schema import Person
from gen.py.relationship_schema import Relationship
from gen.py.safety_result_schema import SafetyResult
from gen.py.setting_value_schema import SettingValue
from gen.py.settings_key_schema import SettingsKey

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


# Three relationship fixtures, one per case the two-axis design exists
# for: a former job (valid_to set), an estranged daughter (valid_to null,
# status estranged), and an unconfirmed inference.
@pytest.mark.parametrize("kind", ["stated", "estranged", "inferred"])
def test_relationship_fixtures(kind: str):
    Relationship.model_validate(load_fixture(f"relationship.{kind}.example.json"))


def test_grant_fixture():
    Grant.model_validate(load_fixture("grant.example.json"))


@pytest.mark.parametrize("kind", ["memory", "entity", "episode"])
def test_memory_record_fixtures(kind):
    MemoryRecord.model_validate(load_fixture(f"memory-record.{kind}.example.json"))


def test_manifest_fixture():
    PackageManifest.model_validate(load_fixture("manifest.example.json"))


def test_safety_result_fixture():
    SafetyResult.model_validate(load_fixture("safety-result.example.json"))


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


def test_person_missing_required_field_is_rejected():
    bad = load_fixture("person.example.json")
    del bad["role"]
    with pytest.raises(ValidationError):
        Person.model_validate(bad)


def test_person_with_unknown_field_is_rejected():
    bad = {**load_fixture("person.example.json"), "extra": "nope"}
    with pytest.raises(ValidationError):
        Person.model_validate(bad)
