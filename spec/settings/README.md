# The settings registry

`keys.json` is the generated-from-declarations settings index (platform
plan 3.2 and docs/SETTINGS.md rule 5): every entry conforms to
[`../schemas/settings-key.schema.json`](../schemas/settings-key.schema.json).

It is empty right now because no core feature or package has been built
yet to declare a key. This is not a placeholder to fill in by hand: core
and packages declare their own settings, and this file is regenerated
from those declarations (plus whatever a robot sends on `hello` for its
own robot-only keys, which the hub stores no copy of). The first entries
land alongside whichever core feature needs them first, per the Hub v0.1
roadmap.

A worked example of a valid entry lives in
[`../fixtures/records/settings-key.example.json`](../fixtures/records/settings-key.example.json).
