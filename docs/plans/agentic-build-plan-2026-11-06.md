# Agentic build plan: connectors, brakes and chat cards (2026-11-06, revision 2)

Extends [agentic-actions-design-2026-10-29](agentic-actions-design-2026-10-29.md) (architect APPROVED, AGENTIC-DESIGN-01) and
[smart-home-2026-10-17](../design/smart-home-2026-10-17.md) (HOUSE-01 to 05). Revision 2 answers the architect's rejection of
revision 1: it folds the work into existing ids, drops the keyword resolver, adds reuse checks, and adds a `## Supersedes`.

Owner direction (2026-11-06): research and plan the full agentic build, then build it; use the household's existing services as
the first real connectors; use Home Assistant's open source integration code and the archived Loki Doki code as references;
build the chat tools and cards as part of it. Test limits: read-only, plus one reversible write on Home Assistant. Tokens come
from the owner and go only into Home's credentials center.

## 1. What exists and what does not (read from main, 2026-11-06)

| Need | State |
|---|---|
| MCP client | None on `main`. `origin/cloud/mcp-client` (`faf72b276`) is BRANCH-MCP-01: connector, name map, schema sanitiser, tests, SDK 1.32.0. |
| Home Assistant client | Exists: `backend/src/lib/integrations/homeAssistant.ts` (HA-EVENTS-01, one LAN websocket, state_changed only, raises Repairs issues). Smart home design HOUSE-01..05 specifies the rest (integration record, exposure list, Rooms page, `host.integration.call`, real-instance verify). |
| Brakes, audit, Undo | Built for `remind`, `timer`, `lists` (`toolBrake.ts`, `toolAudit.ts`, `toolUndo.ts`). BRAKES-01 is narrowed to those; `approvals.ts` has no `tool_action` kind. |
| Effect classes | Design section 3.3 defines them; manifests carry only `consequential` and `min_role` (T1 not built). |
| Taint | Narrow flag passed to the brake for three tools; no per-run Rule of Two. |
| Secrets | Settings keys with `secret: true`; `home.base_url` and `home.access_token` are the model. |
| Chat parts | `confirmation` block with Undo; kit `tool-call` Element is `wire-now` in `frontend/src/dev/elements-adoption.json`; step disclosure per ACTIVITY-01e. |

## 2. Decisions

1. **Home Assistant is HOUSE-01..05, not a new slice.** The agentic work adds nothing parallel: the existing client, the
   `integration` record and the exposure list are the single definition. This plan only (a) supplies the generic connector and
   brake layer HOUSE-04 needs, (b) runs HOUSE-05 against the owner's real instance, and (c) adds the chat cards.
2. **Code is the boundary, not the SDK and not the server.** Allowlist, hash pins, effect class, approval and caps live in Home.
   A server's annotations can only make a tool stricter.
3. **Resolution runs only on tool arguments (rule 1).** The model names the area and device in its own tool call; the tool
   matches those arguments against the exposure list and registry. Nothing parses the person's wording. The Loki Doki word-list
   cue detector and the keyword domain matcher are not ported. What is ported: area from entity else device, `friendly_name`
   preference, attribute-diff merge with removals, one connect attempt at a time, pending commands settled on close,
   last-known store served non-blocking.
4. **Reuse check per connector (principle 6).** Order: maintained MCP server, then maintained TypeScript client, then our own.

| Service | Candidate reused | Verdict |
|---|---|---|
| Home Assistant | `home-assistant-js-websocket` (Apache-2.0: auth, `subscribeEntities`, reconnect); our `homeAssistant.ts` | Extend ours; adopt the library only if it removes code from `homeAssistant.ts` (SPIKE-01 measures). No second client. |
| Immich | official `@immich/sdk` (OpenAPI generated) | Take the SDK for typed calls; pin the version; read-only endpoints only. |
| Uptime Kuma | community MCP servers (small, read-oriented) | Decline: tiny surface (status list); native fetch of the `/metrics` and status page, with the push path from the Loki Doki design. |
| Gitea | official `gitea-mcp` (stdio, token env) | Take as the first MCP connector (exercises MCP-01), pinned by commit, read-only tool allowlist in our config. |
| UniFi | `sirkirby/unifi-mcp` (MIT, 170+ tools) | Decline as shipped: far too many tools and write-capable. Native read-only connector over the controller API, informed by `aiounifi`. |
| Plex | community MCP servers (uneven) | Native connector to the household's own server only; never plex.tv or online endpoints (V1). |
| Frigate | none worth taking | Event text only through Notifications, never images; verdict "dropped" in the smart-home record stands for a Home page. |

5. **Both connector kinds share one registry**: MCP connectors (stdio or Streamable HTTP, pinned by version and digest) and
   native connectors present the same tool shape to the turn engine. The registry extends the smart-home spec-first
   `integration` record additively in `commons` (spec first, then a pin bump), not a Home-only table. One Gitea credential
   definition is shared with CODE-GIT-01: whichever lands first defines it and the other reuses it. The Uptime Kuma push
   route is an inbound credentials surface: full check and a medium code review.
6. **Spec drift.** MCP spec 2026-07-28 drops the handshake and sessions; most servers still speak 2025-11-25. SPIKE-01 tests
   the SDK (v2 client and v1.x) on Bun; the exact version is pinned.
7. **Porting rules.** Home Assistant core is Apache-2.0, one-way compatible with our AGPL-3.0. We re-implement from reading;
   a verbatim port keeps a header naming the source file and licence plus a third-party notices line. Library licences are
   checked before any port.

## 3. Slices (mapped to existing ids)

Each is one to three files per task with a failing test first; Codex first, then the local lane, then Claude. Risky surfaces
(approvals, credentials, egress) get the full check and a medium code review.

| Id | Slice | Maps to |
|---|---|---|
| AGENT-SPIKE-01 | Bun spike: SDK v2 client and v1.x, stdio and HTTP, both spec versions, size; whether `home-assistant-js-websocket` shrinks `homeAssistant.ts`. Report only. | new, report |
| BRANCH-MCP-01 | Revive `faf72b276` on the spiked SDK: connector manager, timeouts, cancel, result caps, schema sanitiser, name map, definition hash pins (disable on mismatch, recheck every `tools/list`). | existing row |
| AGENT-NET-01 | Per-connector LAN allowance: an admin-only setting holds the exact host and port; the guarded fetch allows only that pair and never follows a redirect off it; a row in `backend/src/lib/privacy.ts` in the same commit. | new |
| BRAKES-01 (remainder) | `tool_action` approval kind with an arguments hash; per-run taint and the Rule of Two in `policy.ts`; connector tools join `toolBrake`, `toolAudit`, Undo; effect classes per design 3.3 from Home's own per-tool config. | existing row |
| HOUSE-01..04 | As specified in the smart-home record (rows cut from its Slices section in this commit, no new scope), using the extended client and the generic layer above. | smart-home record |
| AGENT-CARDS-01 | Chat parts: the kit `tool-call` Element with step disclosure for status; the existing `approval-card` for locks and the connector confirm; the `confirmation` block for receipts and Undo; the existing `rows`, `list` and `data_table` answer blocks for entity and service lists. A genuinely missing card goes spec block, then `commons` Element, then tag, then a `TOOL_BINDINGS` entry that only maps props. | new |
| AGENT-SVC-01 | Read-only connectors in order: Gitea (MCP), Immich, Uptime Kuma, UniFi, Plex; each with a config check, a fixture-server test and a bench row. | new |
| AGENT-SELECT-01 | Offered set and `find_tools`; bench with at least 3 repeats and paired 95% intervals per connector family before anything turns on. | design T2, T3 |
| HOUSE-05 and AGENT-LIVE-01 | Verify against the owner's real instance: read-only questions per connector, one reversible Home Assistant write that asks first, shows a receipt and Undo, then is undone. Screenshots opened and judged. | smart-home record plus new |

Not in this plan (each its own owner decision): Frigate (no slice; it would need its own `privacy.ts` row and design), ledger writes, logged-in browsing, standing approvals, email send, spend, the
built-in Home Assistant MCP server, iCloud calendar and mail, any connector tool for a child or teen.

## 4. Rules every slice obeys

1. **Rule 0.** Unknown speaker evidence gets no connector tools. Minors get none in this plan (the approved design adds no agent
   surface for minors); the existing smart-home gates for lights stay as they are.
2. **Rule 1 and 13.** On a turn that carries connector tools, the tools offered total at most 12, counting the base ten and anything `find_tools`
   returns (stricter than rule 1's 16; it does not cap the existing conditional sets for pictures, media or the link reader). Selection is by the model's own call, never a wording parser. Each connector family has its own bench row.
3. **Rule 6.** On failure the model is told only the kind (unreachable, refused, timed out), never the raw error, and says in
   its own words that the service did not answer. A connector failure never fails the answer.
4. **Rule 6a.** `toolAudit` and receipts record no entity names, arguments, monitor or album names, and no Frigate
   `sub_label` next to an event.
5. **Rule 9.** No `className` that changes an Element's look, no wrapper around an Element, no new card in Home.
6. **S6.** Kuma and Frigate alerts use Notifications (`lib/notifications.ts`, a declared type in `lib/notificationTypes.ts`); a
   connector that is down or disabled by a hash mismatch raises a Repairs issue (`lib/issues.ts` `raiseIssue`), as the Home
   Assistant client already does. No banner, dot, panel or polling loop of its own.
7. **Secrets.** Server URLs, tokens and allowlists come from admin settings only. Tokens are read in host code and never reach a
   prompt, log, card or transcript. Tool results are untrusted: size capped, control characters stripped, out of the system
   prompt and memory, and after an open-world result write tools are restricted for that run.
8. **No auto install.** Pinned versions and digests only; no `npx` or `uvx` at latest.
9. **Privacy.** Each new connection gets one row in `backend/src/lib/privacy.ts` in the commit that adds it (Home Assistant
   already has `platform:home-assistant-events`).
10. **V1.** Tests use fixtures only; no test calls a real service except AGENT-LIVE-01 with the owner's consent.

## 5. Supersedes

| Replaced | By |
|---|---|
| Design 2026-10-29 section 3.8 and section 11 Q4: outside providers are phase B behind the owner's word | The owner's 2026-11-06 direction starts read-only connectors now; ledger, email, calendar and writes beyond one reversible test stay behind his word. |
| Design section 3.8 and section 5: "reuse maintained servers, build none" | Reuse first per the table in section 2.4; a native connector is written only where the table gives the reason. |
| Design section 3.4 item 5: private hosts stay blocked | Blocked by default; one admin-set host and port per connector may be reached, nothing else (AGENT-NET-01). |
| Design section 3.3 effect class names | Unchanged: this plan adopts them as written. (Revision 1's five-name list is withdrawn.) |
| Smart-home record "one record per household, id `home_assistant`" | The `integration` record gains additive fields so it can also list other connectors; spec first in `commons`, no existing field changes. |
| Smart-home record: per-person grants, "no new block kind", Frigate dropped | Unchanged: this plan adopts them as written. (Revision 1's grants, device cards and Frigate page are withdrawn.) |

## 6. Open and unverified

- Whether the SDK v2 client runs cleanly under Bun, and whether `home-assistant-js-websocket` reduces our client (SPIKE-01).
- Whether a long-lived token works as a bearer on Home Assistant's MCP endpoints (not enabled on the owner's instance; not needed).
- Wire-library licences (`aioimmich`, `pythonkuma`, `aiounifi`, `PlexAPI`) before any verbatim port.
- Read-only modes of the community Gitea, UniFi and Plex servers; the allowlist in our config does not depend on them.
- Tool-count limits for the local chat model are judgment until SELECT-01 measures them.

## 7. Sources

MCP spec changelog 2026-07-28 and the TypeScript SDK repository; the Home Assistant MCP server page, core `LICENSE.md` and
component manifests; community server repositories for UniFi, Gitea and Uptime Kuma; the 2026-10-29 design; the smart-home
record; `origin/cloud/mcp-client`; the archived Loki Doki code.
