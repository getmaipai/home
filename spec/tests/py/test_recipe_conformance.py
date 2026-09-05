"""The recipe conformance suite (platform plan 3.2): every fixture in
spec/fixtures/recipes/ must produce the same result from this interpreter
as from the TS one (tests/ts/recipe-conformance.test.ts). This is the
Python half of that proof.
"""

import json
from pathlib import Path

import pytest

from emulators.py.host_emulator import HostEmulator, MemoryRecordLike
from gen.py.recipe_schema import Recipe
from interpreters.py.recipe_interpreter import run_recipe

SPEC_DIR = Path(__file__).resolve().parents[2]
FIXTURES_DIR = SPEC_DIR / "fixtures" / "recipes"

fixture_files = sorted(FIXTURES_DIR.glob("*.json"))


@pytest.mark.asyncio
@pytest.mark.parametrize("fixture_path", fixture_files, ids=lambda p: p.name)
async def test_recipe_conformance(fixture_path: Path):
    fixture = json.loads(fixture_path.read_text())
    recipe = Recipe.model_validate(fixture["recipe"])

    host = HostEmulator()
    for url, body in fixture["host_setup"].get("fetch", {}).items():
        host.set_fetch_response(url, body)
    for key, value in fixture["host_setup"].get("config", {}).items():
        host.seed_config(key, value)
    for record in fixture["host_setup"].get("memory", []):
        host.seed_memory([MemoryRecordLike(**record)])

    result = await run_recipe(recipe, fixture["inputs"], host)

    assert result.get("reply") == fixture["expected"]["reply"]
    assert result["actions"] == fixture["expected"]["actions"]
    assert [
        {"when": j["when"], "job": j["job"]} for j in host.scheduled_jobs
    ] == fixture["expected"]["scheduled_jobs"]
    assert host.home_calls_log == fixture["expected"]["home_calls"]
    assert [
        {"text": m["text"], "category": m["category"], "scope": m["scope"]}
        for m in host.memory_store
    ] == fixture["expected"]["memory_added"]
