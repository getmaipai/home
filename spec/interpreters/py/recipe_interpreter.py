"""Interprets a Tier 0 Recipe (spec/schemas/recipe.schema.json) natively,
executing each step against a host (platform plan 5.2). No process, no
eval: every step is one of the seven declared primitives. This must stay
behaviorally identical to spec/interpreters/ts/recipe-interpreter.ts; the
conformance fixtures in spec/fixtures/recipes/ prove that.
"""

from __future__ import annotations

import re
from typing import Any

INTERP_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def interpolate(template: str, scope: dict[str, Any]) -> str:
    def repl(m: re.Match) -> str:
        name = m.group(1)
        if name not in scope:
            return m.group(0)
        return str(scope[name])

    return INTERP_RE.sub(repl, template)


def pick_path(value: Any, path: str | None) -> Any:
    if not path:
        return value
    current = value
    for segment in path.split("."):
        if current is None:
            return None
        if isinstance(current, list):
            current = (
                current[int(segment)]
                if segment.isdigit() and int(segment) < len(current)
                else None
            )
        elif isinstance(current, dict):
            current = current.get(segment)
        else:
            return None
    return current


def run_recipe(recipe: Any, inputs: dict[str, Any], host: Any) -> dict[str, Any]:
    """recipe is a gen.py.recipe_schema.Recipe (or any object with a .steps
    list of step models sharing their shape); host is a HostEmulator."""
    scope: dict[str, Any] = dict(inputs)
    actions: list[dict[str, Any]] = []
    reply: dict[str, str] | None = None

    for step in recipe.steps:
        op = step.op
        if op == "fetch":
            url = interpolate(step.url, scope)
            scope[step.as_] = host.fetch(
                url, method=step.method, headers=step.headers, body=step.body
            )
        elif op == "pick":
            scope[step.as_] = pick_path(scope.get(step.from_), step.path)
        elif op == "format":
            text = interpolate(step.text, scope)
            speech = interpolate(step.speech, scope) if step.speech else text
            scope[step.as_] = {"text": text, "speech": speech}
            reply = {"text": text, "speech": speech}
        elif op == "home.call_service":
            host.home.call_service(step.domain, step.service, step.target, step.data)
        elif op == "action":
            host.action.emit(step.kind, step.payload)
            actions.append({"kind": step.kind, "payload": step.payload})
        elif op == "remember":
            text = interpolate(step.text, scope)
            host.memory.remember(text, step.category, step.scope)
        elif op == "schedule":
            when = interpolate(step.when, scope)
            host.schedule(when, step.job or recipe.id)
        else:
            raise ValueError(f"unhandled recipe step: {step!r}")

    result: dict[str, Any] = {"actions": actions}
    if reply is not None:
        result["reply"] = reply
    return result
