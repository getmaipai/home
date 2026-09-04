import pytest

from emulators.py.host_emulator import HostEmulator, HostError, MemoryRecordLike


def test_fetch_returns_seeded_response():
    host = HostEmulator()
    host.set_fetch_response("https://example.com/weather", {"tempF": 72})
    assert host.fetch("https://example.com/weather") == {"tempF": 72}


def test_fetch_raises_not_found_for_unseeded_url():
    host = HostEmulator()
    with pytest.raises(HostError):
        host.fetch("https://example.com/nope")


def test_memory_remember_then_recall_finds_it_by_substring():
    host = HostEmulator()
    host.memory.remember(
        "Riff prefers oat milk", "preference", "person", "person-a1b2c3"
    )
    found = host.memory.recall("oat milk")
    assert len(found) == 1
    assert "oat milk" in found[0]["text"]


def test_data_forget_removes_only_that_persons_records():
    host = HostEmulator()
    host.memory.remember("about riff", "fact", "person", "person-riff")
    host.memory.remember("about sprout", "fact", "person", "person-sprout")
    removed = host.data.forget("person-riff")
    assert removed == 1
    assert len(host.memory_store) == 1
    assert host.memory_store[0]["person"] == "person-sprout"


def test_secret_fed_through_log_never_appears_verbatim():
    """docs/ENGINEERING.md > Logging's enforcement mechanism, for the emulator."""
    host = HostEmulator()
    secret_token = "sk-super-secret-token-value"
    host.register_secret(secret_token)
    host.log("info", f"authenticated with {secret_token}", {"token": secret_token})
    for entry in host.logs:
        assert secret_token not in entry.message
        assert secret_token not in str(entry.fields)
    assert "[redacted]" in host.logs[0].message


def test_schedule_records_a_job_and_returns_an_id():
    host = HostEmulator()
    job_id = host.schedule("2026-09-04T21:00:00Z", "bedtime-reminder")
    assert len(host.scheduled_jobs) == 1
    assert job_id.startswith("job-emu")


def test_seed_memory_helper():
    host = HostEmulator()
    host.seed_memory(
        [MemoryRecordLike(text="Sprout is a golden retriever", scope="household")]
    )
    assert len(host.memory.recall("golden retriever")) == 1
