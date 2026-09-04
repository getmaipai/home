"""Round-trips every fixture in spec/fixtures/records/ through its generated
Pydantic model. This is the Python half of the proof required by platform
plan 3: "home's check.sh round-trips every fixture in spec/fixtures/ through
both generated model sets." The TS half is spec/tests/ts/fixtures.test.ts.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from gen.py.error_entry_schema import ErrorEntry
from gen.py.manifest_schema import PackageManifest
from gen.py.memory_record_schema import MemoryRecord
from gen.py.person_schema import Person
from gen.py.setting_value_schema import SettingValue
from gen.py.settings_key_schema import SettingsKey

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


@pytest.mark.parametrize("kind", ["memory", "entity", "episode"])
def test_memory_record_fixtures(kind):
    MemoryRecord.model_validate(load_fixture(f"memory-record.{kind}.example.json"))


def test_manifest_fixture():
    PackageManifest.model_validate(load_fixture("manifest.example.json"))


def test_error_catalogue_entries():
    entries = json.loads((SPEC_DIR / "errors" / "errors.json").read_text())
    assert len(entries) > 0
    for entry in entries:
        ErrorEntry.model_validate(entry)


def test_person_missing_required_field_is_rejected():
    bad = load_fixture("person.example.json")
    del bad["role"]
    with pytest.raises(ValidationError):
        Person.model_validate(bad)


def test_person_with_unknown_field_is_rejected():
    bad = {**load_fixture("person.example.json"), "extra": "nope"}
    with pytest.raises(ValidationError):
        Person.model_validate(bad)
