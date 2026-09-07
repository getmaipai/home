"""Interprets a Tier 0 Recipe (spec/schemas/recipe.schema.json) natively,
executing each step against a host (platform plan 5.2). No process, no
eval: every step is one of the sixteen declared primitives. This must stay
behaviorally identical to spec/interpreters/ts/recipe-interpreter.ts; the
conformance fixtures in spec/fixtures/recipes/ prove that.
"""

from __future__ import annotations

import html
import re
from typing import Any

from .compute import evaluate_expression

INTERP_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

# No conditional step exists in this declarative language to branch a
# reply on "did recall find anything" - a `format` step only ever
# interpolates a scalar. So the recall step itself resolves that here,
# binding one ready-to-speak string either way, the same "resolve it at
# the interpreter, not by asking the recipe author for a branch that
# doesn't exist" call `remember`'s own fixed confirmation text already
# makes. Must stay byte-identical to recipe-interpreter.ts's own
# NOTHING_RECALLED - the conformance fixtures prove that.
NOTHING_RECALLED = "I don't remember anything about that."


# Decodes HTML entities in the SUBSTITUTED VALUE, never the template
# itself - see recipe-interpreter.ts's own interpolate() for why
# (2026-09-05, found building the `trivia` plugin: opentdb.com HTML-entity-
# encodes every response unconditionally). `html.unescape` is the standard
# library's own complete HTML5 entity decoder - no dependency needed, must
# stay behaviorally equivalent to the TS side's `he` usage.
def interpolate(template: str, scope: dict[str, Any]) -> str:
    def repl(m: re.Match) -> str:
        name = m.group(1)
        if name not in scope:
            return m.group(0)
        value = scope[name]
        # Python's str(None) is "None"; JS's String(null) is "null" - a
        # real cross-language divergence code review found (2026-09-06,
        # step 8's own schedule_step.inputs is the first templated field
        # a caller might plausibly pass a null value through): matched to
        # the TS interpreter's own literal exactly rather than picking a
        # third string neither side used before.
        return html.unescape("null" if value is None else str(value))

    return INTERP_RE.sub(repl, template)


def interpolate_deep(value: Any, scope: dict[str, Any]) -> Any:
    """Recurses through an object/array interpolating every string -
    integration.call's own `args` needs this (recipe-interpreter.ts's own
    interpolateDeep() docstring has the full reasoning); must stay
    behaviorally identical to that one."""
    if isinstance(value, str):
        return interpolate(value, scope)
    if isinstance(value, list):
        return [interpolate_deep(v, scope) for v in value]
    if isinstance(value, dict):
        return {k: interpolate_deep(v, scope) for k, v in value.items()}
    return value


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


async def run_recipe(recipe: Any, inputs: dict[str, Any], host: Any) -> dict[str, Any]:
    """recipe is a gen.py.recipe_schema.Recipe (or any object with a .steps
    list of step models sharing their shape); host is a HostEmulator.

    async (2026-09-05): the steps that need real network I/O (`fetch`, and
    as of the same day `home.call_service`) can no longer stay synchronous
    once they're backed by a real HTTP call instead of a canned emulator
    response - must stay behaviorally identical to recipe-interpreter.ts's
    own async conversion. Every other step stays exactly as synchronous as
    it always was.
    """
    scope: dict[str, Any] = dict(inputs)
    actions: list[dict[str, Any]] = []
    reply: dict[str, str] | None = None
    ask: dict[str, Any] | None = None

    for step in recipe.steps:
        op = step.op
        if op == "fetch":
            url = interpolate(step.url, scope)
            scope[step.as_] = await host.fetch(
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
            # target/data interpolation (session-d-packages-and-store.md
            # step 9). Must stay behaviorally identical to
            # recipe-interpreter.ts's own twin case.
            target = interpolate_deep(step.target, scope)
            data = interpolate_deep(step.data, scope) if step.data else step.data
            await host.home.call_service(step.domain, step.service, target, data)
        elif op == "action":
            host.action.emit(step.kind, step.payload)
            actions.append({"kind": step.kind, "payload": step.payload})
        elif op == "remember":
            text = interpolate(step.text, scope)
            host.memory.remember(text, step.category, step.scope)
        elif op == "recall":
            query = interpolate(step.query, scope)
            matches = host.memory.recall(query, scope=step.scope)
            top = matches[: step.limit or 3]
            scope[step.as_] = (
                "; ".join(m["text"] for m in top) if top else NOTHING_RECALLED
            )
        elif op == "schedule":
            # inputs (session-d-packages-and-store.md step 8) closes a
            # real, previously-documented gap: this used to always pass
            # nothing, so a job scheduled from within a recipe re-fired
            # the package with an empty input scope. Must stay
            # behaviorally identical to recipe-interpreter.ts's own
            # twin case.
            when = interpolate(step.when, scope)
            inputs = interpolate_deep(step.inputs, scope) if step.inputs else {}
            host.schedule(when, step.job or recipe.id, inputs)
        elif op == "integration.call":
            args = interpolate_deep(step.args, scope) if step.args else None
            scope[step.as_] = await host.integration.call(step.id, step.method, args)
        elif op == "compute":
            # evaluate_expression() already raises ComputeError for a
            # household member's own bad input - a real, expected,
            # recoverable case now that `math`/`convert` (step 7) hand
            # it free-typed text. Let it propagate as-is: wrapping it in
            # ValueError (the previous shape here) erased the type a
            # caller needs to tell "bad input" apart from a real bug,
            # the identical fix made on the TS interpreter's own
            # twin case (found while building those two packages).
            expression = interpolate(step.expression, scope)
            scope[step.as_] = evaluate_expression(expression)
        elif op == "llm_complete":
            # Raw-object binding, same style as `fetch`'s own `as_` - a
            # `pick` step reads "text" out before a `format` step
            # interpolates it. host.llm.complete's own wire shape is a
            # `messages` array (the real host passes it straight to
            # lib/llm.ts's own complete()); this step's `prompt` field is
            # wrapped into one user-role message here. Must stay
            # behaviorally identical to recipe-interpreter.ts's own twin
            # case.
            prompt = interpolate(step.prompt, scope)
            scope[step.as_] = await host.llm.complete(
                {"messages": [{"role": "user", "content": prompt}]}
            )
        elif op == "list_add":
            # Fire-and-forget, same shape `remember` already takes.
            # Must stay behaviorally identical to recipe-interpreter.ts's
            # own twin case.
            text = interpolate(step.text, scope)
            host.lists.add(text)
        elif op == "list_view":
            scope[step.as_] = host.lists.view()
        elif op == "remind":
            # Raw-object binding, same style as `llm_complete`'s own
            # `as_`. Must stay behaviorally identical to
            # recipe-interpreter.ts's own twin case.
            text = interpolate(step.text, scope)
            scope[step.as_] = host.reminders.set(text)
        elif op == "timer":
            text = interpolate(step.text, scope)
            scope[step.as_] = host.timers.set(text)
        elif op == "ask":
            # Always the recipe's last meaningful step (the schema's own
            # description): nothing after it can depend on an answer that
            # hasn't arrived yet.
            ask = {"prompt": interpolate(step.prompt, scope), "expects": step.expects}
        else:
            raise ValueError(f"unhandled recipe step: {step!r}")

    result: dict[str, Any] = {"actions": actions}
    if reply is not None:
        result["reply"] = reply
    if ask is not None:
        result["ask"] = ask
    return result
