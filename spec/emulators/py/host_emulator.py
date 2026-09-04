"""A deterministic, offline stand-in for the host.* RPC surface (platform
plan 4.9), for testing Tier 0 recipes and Tier 1 packages without a real
hub or robot. Nothing here does real network I/O, real scheduling, or real
persistence: every method is backed by in-memory state a test seeds and
inspects. Mirrors spec/emulators/ts/host-emulator.ts method for method.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class HostError(Exception):
    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


@dataclass
class MemoryRecordLike:
    text: str
    id: str | None = None
    category: str | None = None
    scope: str | None = None
    person: str | None = None


@dataclass
class LogEntry:
    level: str
    message: str
    fields: dict[str, Any]


_REDACTED = "[redacted]"


class _MemoryNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def recall(
        self, query: str, scope: str | None = None, person: str | None = None
    ) -> list[dict[str, Any]]:
        q = query.lower()
        out = []
        for r in self._host._memory_store:
            if scope and r["scope"] != scope:
                continue
            if person and r["person"] != person:
                continue
            if q in r["text"].lower():
                out.append(r)
        return out

    def remember(
        self,
        text: str,
        category: str | None = None,
        scope: str | None = None,
        person: str | None = None,
    ) -> str:
        record_id = self._host._gen_id("mem")
        self._host._memory_store.append(
            {
                "id": record_id,
                "text": text,
                "category": category,
                "scope": scope,
                "person": person,
            }
        )
        return record_id


class _ActionNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def emit(self, kind: str, payload: Any = None) -> None:
        self._host.actions_log.append({"kind": kind, "payload": payload})


class _HomeNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def call_service(
        self, domain: str, service: str, target: Any, data: Any = None
    ) -> None:
        self._host.home_calls_log.append(
            {"domain": domain, "service": service, "target": target, "data": data}
        )


class _IntegrationNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def call(self, integration_id: str, method: str, args: Any = None) -> Any:
        key = f"{integration_id}:{method}"
        if key not in self._host._fetch_responses:
            raise HostError("not_found", f"no canned integration response for {key}")
        return self._host._fetch_responses[key]


class _SpeakNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def sentence(self, text: str) -> None:
        self._host.spoken_log.append(text)


class _LlmNamespace:
    def complete(self, opts: Any = None) -> dict[str, Any]:
        return {"text": "[emulator: no model loaded, this is a canned reply]"}


class _CameraNamespace:
    def still(self) -> Any:
        raise HostError("capability_missing", "no camera in the emulator")


class _OcrNamespace:
    def read(self, image: Any) -> str:
        raise HostError("capability_missing", "no ocr in the emulator")


class _ConfigNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def get(self, key: str) -> Any:
        return self._host._config_values.get(key)


class _FilesNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def read(self, path: str) -> Any:
        if path not in self._host._files_store:
            raise HostError("not_found", f"no file at {path}")
        return self._host._files_store[path]

    def write(self, path: str, data: Any) -> None:
        self._host._files_store[path] = data

    def list(self, prefix: str) -> list[str]:
        return [k for k in self._host._files_store if k.startswith(prefix)]


class _DataNamespace:
    def __init__(self, host: HostEmulator):
        self._host = host

    def forget(self, person: str) -> int:
        before = len(self._host._memory_store)
        self._host._memory_store = [
            r for r in self._host._memory_store if r["person"] != person
        ]
        forgotten_files = [
            k for k in self._host._files_store if k.startswith(f"person:{person}/")
        ]
        for k in forgotten_files:
            del self._host._files_store[k]
        return (before - len(self._host._memory_store)) + len(forgotten_files)


class HostEmulator:
    def __init__(self) -> None:
        self._fetch_responses: dict[str, Any] = {}
        self._config_values: dict[str, Any] = {}
        self._secrets: list[str] = []
        self._memory_store: list[dict[str, Any]] = []
        self._files_store: dict[str, Any] = {}
        self._next_id = 1

        self.actions_log: list[dict[str, Any]] = []
        self.home_calls_log: list[dict[str, Any]] = []
        self.spoken_log: list[str] = []
        self.scheduled_jobs: list[dict[str, Any]] = []
        self.logs: list[LogEntry] = []

        self.memory = _MemoryNamespace(self)
        self.action = _ActionNamespace(self)
        self.home = _HomeNamespace(self)
        self.integration = _IntegrationNamespace(self)
        self.speak = _SpeakNamespace(self)
        self.llm = _LlmNamespace()
        self.camera = _CameraNamespace()
        self.ocr = _OcrNamespace()
        self.config = _ConfigNamespace(self)
        self.files = _FilesNamespace(self)
        self.data = _DataNamespace(self)

    # --- test setup -----------------------------------------------------

    def set_fetch_response(self, url: str, body: Any) -> None:
        self._fetch_responses[url] = body

    def seed_memory(self, records: list[MemoryRecordLike]) -> None:
        for r in records:
            record_id = r.id or self._gen_id("mem")
            self._memory_store.append(
                {
                    "id": record_id,
                    "text": r.text,
                    "category": r.category,
                    "scope": r.scope,
                    "person": r.person,
                }
            )

    def seed_config(self, key: str, value: Any) -> None:
        self._config_values[key] = value

    def register_secret(self, value: str) -> None:
        """A value registered here is replaced with [redacted] anywhere log() would emit it."""
        self._secrets.append(value)

    @property
    def memory_store(self) -> list[dict[str, Any]]:
        return self._memory_store

    # --- host.* surface ---------------------------------------------------

    def fetch(
        self,
        url: str,
        method: str = "GET",
        headers: dict | None = None,
        body: Any = None,
    ) -> Any:
        if url not in self._fetch_responses:
            raise HostError("not_found", f"no canned response for {url}")
        return self._fetch_responses[url]

    def _redact(self, value: Any) -> Any:
        if isinstance(value, str):
            out = value
            for secret in self._secrets:
                out = out.replace(secret, _REDACTED)
            return out
        if isinstance(value, dict):
            return {k: self._redact(v) for k, v in value.items()}
        return value

    def log(
        self, level: str, message: str, fields: dict[str, Any] | None = None
    ) -> None:
        fields = fields or {}
        self.logs.append(
            LogEntry(
                level=level, message=self._redact(message), fields=self._redact(fields)
            )
        )

    def schedule(self, when: str, job: str) -> str:
        job_id = self._gen_id("job")
        self.scheduled_jobs.append({"when": when, "job": job, "id": job_id})
        return job_id

    def diagnostics(self) -> dict[str, Any]:
        return {
            "ok": True,
            "memory_records": len(self._memory_store),
            "scheduled_jobs": len(self.scheduled_jobs),
        }

    def _gen_id(self, prefix: str) -> str:
        job_id = f"{prefix}-emu{self._next_id:04d}"
        self._next_id += 1
        return job_id
