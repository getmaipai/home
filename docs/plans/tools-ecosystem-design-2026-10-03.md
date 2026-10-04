# Tools ecosystem design (2026-10-03)

Status: ACCEPTED by the architect (APPROVED on round 2, 2026-10-03; round 1 rejected it for missing reuse checks and an
incomplete Supersedes, both fixed in section 10 and Supersedes). The Fable review is applied. The owner decisions in
section 8 are open; nothing here is built. The catalog and marketplace half (section 7) waits on one research document that has not
arrived. Inputs, all in `docs/plans/` on their cloud branches until landed: `tools-audit-2026-10-03.md` (what we
have), `tool-selection-research-2026-10-03.md` (selection and recovery), `mcp-connectors-survey-2026-10-03.md`
(existing tools). Authority for every rule cited is `docs/design/RULES.md`.

## Supersedes

- Backlog items THIN-2F (offered tools from installed packages) and THIN-2G (one retry round): rewritten by sections
  2 and 4 below; their text stays as history until the items are rewritten.
- The hand-written `tools_offered` list in `backend/src/lib/modelCatalog.ts` (line 101) as the source of the tool
  set. It remains only as an optional per-model ceiling.
- Backlog items this note overlaps and absorbs, with their ids kept as the item owners: `docs/BACKLOG.md:7510` "Speak
  MCP for local tools" (becomes H1 to H4 and the first connector), STORE-01 (K1 to K3 and K7.1 to 3 are its design: the
  pinned index address, browse route, update check), PKG-UNINSTALL-01 (K7.3 builds on it, it is not duplicated), CAP-GATE-01
  (owns the `requires` and `optional` enforcement in R1), and THIN-1E (owns the admin error detail in R2).
- The `Connector` and `Tier 1 (Deno sandbox, MCP)` lines in `docs/dev.md`, which described a deferred design; section
  5 replaces them with a sliced plan.

## 1. What we have, in six facts (from the audit)

1. The model's tool list is code. Installing a package never adds a model tool; only an edit to `modelCatalog.ts`
   does. 9 of 35 bundled packages are offered; 18 answer only on an exact phrase, so a missed phrasing reaches a model
   that cannot call them.
2. Nothing between manifest and request filters by person. Role, temporary mode and crisis are checked after the model
   chose; an age band is never consulted for a package.
3. The supply chain is built (signed index, verify, install, smoke, rollback, uninstall) with no live source: no
   pinned catalog URL, no browse, no update check.
4. Seven manifest fields are decorative: `incognito`, `offline`, `requires`, `optional`, `platforms`, `min_app`,
   `data_sources` (displayed, never enforced).
5. There is no MCP client and no Connector package kind. The Deno host speaks MCP over stdio to its own handler only.
6. A raw error string still travels as `userMessage` on a tool outcome; the model is protected only by the
   failure-kind mapping, not by construction.

## 2. Tool selection (decisions T1 to T5)

Evidence: the selection research (section 3 of it), the audit (section 4).

- **T1. A tool is declared by the package.** One additive manifest block in `commons` `spec/`:
  `model_tool: { offered, consequence: read|write|physical, min_band, surfaces, priority, summary }`. Default off, so
  nothing changes until a package opts in. The two virtual tools (`start_project`, `answer_from_this_conversation`)
  declare the same shape in code. Reuse check: no maintained library declares tools for us; the block is the smallest
  addition to a manifest we already validate. It mirrors MCP tool annotations (MCP 2026-07-28):
  `read` is `readOnlyHint: true`, `write` is `destructiveHint: false` and not read only, `physical` is
  `destructiveHint: true` or `openWorldHint: true` on a tool that acts on the home. An annotation from a connector
  is untrusted and only proposes a class; the manifest's own `consequence`, set at install review, is the trusted
  one. `min_band`, `surfaces` and `priority` have no MCP equivalent and stay ours.
- **T2. The offered set is computed from installed, enabled, flagged packages, filtered by the person.** Filter by
  `min_band`, role, surface, temporary mode (no `write` or `physical`), the adult's per-person toggles and the
  package's permissions. Order by admin pin, then `priority`, then the person's 30-day use count, then id. Cut at a cap,
  16 until our own bench says otherwise. Computed when a conversation starts and frozen for it (cache prefix stays
  byte-identical; for a connector, read the server's `tools/list` `ttlMs` and `cacheScope` instead of inventing a
  freshness rule); a new install appears in the next conversation. No message text enters any step (rule 1). A model with no measured record gets no tools for a minor (rule 8).
- **T3. Above the cap, a `find_tools` tool the model itself calls.** Built only when the bench shows the eligible set
  exceeds the cap for a real adult household. Embedding retrieval over the user's message is rejected: it is a
  classifier deciding what the model may call.
- **T4. Consequence and confirmation.** `physical` tools (locks, doors, lights) always need a person's confirmation
  (consent words are a permitted deterministic element in rule 1). `write` tools confirm for a minor and after any
  untrusted tool result in the turn. A connector's server-initiated request for input (`input_required`, formerly elicitation) is answered with
  `cancel` for any minor; the server never gets a form in front of a child. Every tool result is data, never instructions, and passes the same floor for a
  minor as search pages (rule 7).
- **T5. Recovery is THIN-2G with three changes.** One bounded retry round, the model decides, identical tools block,
  a plain line naming the tool and the failure kind (never the raw error). Changes: a malformed call
  (`bad_arguments`) counts as a failure; a `write` or `physical` tool is never retried without confirmation; the same
  tool may be called again with changed arguments, only the byte-identical call is forbidden. Parallel hedging and
  declared fallback chains stay rejected.

Result for today's household: weather and websearch behave as now; the 18 pattern-only tools that read well (define,
knowledge, currency, news, sports, music, media-lookup, trivia, translate) opt in with `offered: true`, so a phrasing
that misses an exact pattern still reaches a tool. About 15 to 25 tools are callable for an adult, which is near the
starting cap; the bench decides the cap.

## 3. Existing community tools (decisions C1 to C3)

Evidence: the MCP survey. The owner's standing preference is prebuilt community parts first and building only where
nothing fits.

- **C1. New capabilities come from maintained community servers by default.** Home Assistant's own MCP server
  (Streamable HTTP at `/api/mcp/assist`, long-lived token, LAN only) is the first connector and YouTube transcripts
  the second (its terms are unresolved, O2); a read-only calendar and an offline encyclopedia follow
  if they add reach over what we have.
- **C2. Replace a working bundled tool only when the maintained one is better, not just present.** The survey
  found the maintained alternatives for weather, sports, music and news to be single-call wrappers of 0 to 69 stars
  that add a Node runtime. Our bundled versions have `data_sources`, permissions and tests. Recommendation: keep them
  for now and revisit when a maintained server has releases and an owner. This is an owner decision (O1). One carve-out the review supports: `lights-on`, `lights-off` and `lock-doors` are
  replaced by Home Assistant's own MCP server (first party, Apache-2.0, LAN only, limited to the entities Assist
  exposes) for a household that runs Home Assistant.
- **C3. A connector is a package kind, not a special case.** Its manifest names the pinned server, checksum, `net:`
  hosts, `data_sources` and a tool-level allow list; its tools enter the same offered-set computation as any package;
  its failures are rule 6 failures.

## 4. How a connector is hosted (decisions H1 to H4)

- **H1. Child processes of Home, not the Stack.** They are tools, not engines (rule 11), and per-person permission
  lives in Home. Supervised by the existing sidecar machinery, started on first use, stopped after idle.
- **H2. One MCP client manager** generalising `denoHost.ts`, on the official TypeScript SDK (v1.32 speaks stdio and
  Streamable HTTP, so no move to v2 until a Bun test passes there), with a schema sanitiser (small JSON-Schema subset for llama-server) and a name map (64-character
  tool-name limit, namespaced ids like `youtube__get_transcript`).
- **H3. Egress. Not built in the first slice**; built only when a stdio connector with declared `net:` hosts is
  actually adopted (Docker MCP Gateway is the maintained answer but needs a Docker engine a household does not have).
  Prefer running Node servers under Deno with `--allow-net=<declared hosts>` so the manifest's `net:`
  list is the real rule. Unverified that each candidate runs there; fallback is a plain child process with a stripped
  environment and loopback-only listening, where the list is policy and not a wall.
- **H4. Supply chain.** Version plus content hash pinned in the manifest, checked before each launch, offline after
  install, so a server cannot update itself.

First slice (M): the client manager (HTTP transport), the connector kind, the sanitiser and name map, and Home
Assistant's server end to end for an adult on a test household. It exercises handshake, `tools/list`, filtering,
consent on a `physical` tool and a rule 6 failure, with no child process, no Deno and no download. Rule 11: the
server holds no model, so it falls under the same clause that allows SearXNG. Each later connector is S.

## 5. Repairs to what exists (decisions R1 to R3)

- **R1.** Enforce the decorative fields that matter: `incognito` and `offline` honoured from the manifest, `requires`
  and `optional` gating (owned by CAP-GATE-01, not a second item), `data_sources` consent from `opt_in`. Each is S, and each closes a gap between
  a declaration and behaviour.
- **R2.** (Owned by rule 6 and THIN-1E.) The raw error stays off a non-admin, a child and the model by construction: the tool outcome carries a
  failure kind and an admin-only detail, never `userMessage` text (finishes rule 6 and THIN-1E).
- **R3.** Delete stale statements: `docs/BACKLOG.md:683`, `lib/updates.ts:10-16`, `routes/plugins.ts:11-14` and the
  hard-coded `latest_version` and `channel` in `GET /api/plugins`.

## 6. Build order

1. Bench on today's 10 offered tools (a baseline for the cap; needs an engine session, DOC-TOOL-01 showed one tool
   can regress three rows). M.
2. Spec tag with the `model_tool` block (needs the owner's word to cut), then T1 and T2 in Home. M. Retires
   `tools_offered` as the source; unit tests per band and a byte-identity test across two turns; rebench with the
   widened set. This is the household's first visible gain: the 18 pattern-only tools become model-callable.
3. R2, T4 and T5 together as one item: the failure kind with no raw text, consequence classes with confirmation
   (`confirm_needed` already exists in `policy.ts`), and the rewritten THIN-2G. M.
4. H1, H2 and the first connector, Home Assistant over Streamable HTTP, adult only, a test household. M. Each later
   connector is S.
5. R1 and R3. S each, any time.
6. Section 7 items (catalog source, browse, update check), pending the catalog research.
Deferred until a measurement or an adopted connector asks for it: H3, `find_tools` (T3), MCP SDK v2, YouTube.

## 7. The catalog and marketplace (decisions K1 to K7)

Evidence: the catalog research (six ecosystems compared: Home Assistant, Open WebUI community tools, the MCP Registry,
VS Code and Open VSX, Obsidian, Homebrew). Two lessons carry the design: unreviewed code with full access caused the
attacks in Obsidian and Open WebUI, and popularity is not safety (ratings are deferred).

- **K1. The catalog repo stays the source of truth; CI generates a signed `index.json`.** One entry per package version
  (`id`, `version`, `kind`, `tier`, `manifest_sha256`, artifact URL and `sha256`, `min_home`, `permissions` and
  `data_sources` digests, `license`, `source_commit`, `deprecated`), versions immutable. It extends the existing
  `bundled-provenance.json`. Reuse check: Home already has the signed-index verify, install, rollback and smoke code
  (audit section 5); what is missing is a live source, so K1 builds only the generator and the pinned address.
- **K2. Signing and verification.** One catalog root key held offline by the owner plus a delegated CI release key;
  Home ships both public keys. The index carries `expires` and a monotonic `index_serial` (the two cheap ideas from
  TUF; full TUF is deferred). Home checks the signature, expiry and serial, downloads the artifact, checks `sha256`
  and `manifest_sha256`, runs manifest lint, shows an admin the permission and `data_sources` diff in plain words, then
  installs. A last-good index stays cached; a down catalog never fails a turn (rule 6 spirit).
- **K3. Kill switch.** A signed `revoked.json` (id, versions, reason, severity, disable or warn), checked on every
  index refresh and at every package start. A revoked package is disabled at once and only the admin is told why. A
  stale index disables non-first-party packages for child and teen profiles first.
- **K4. Trust tiers.** Tier 0 first-party (everyone the manifest allows); Tier 1 reviewed community (contributors under
  the signed assignment, CI plus a human review of the permission diff; adults by choice, teens and children only per
  the rules below); Tier 2 unreviewed (a user-added source, user-pinned checksum, admin adults only, off by default,
  recommended not to exist in the first release). Child: Tier 0 only until the owner answers O12 (rule 0 wins until then); if O12 allows it, Tier 0 plus Tier 1 packages an admin approves one by one that
  declare `min_role: child`, are not consequential and hand back no free third-party text without the page floor
  (rule 7). Teen: Tier 0 plus admin-enabled Tier 1. Never Tier 2 for a minor. Filtering happens when the offered set
  is built (T2), once, not per message.
- **K5. Importing third-party tools: the catalog stores our manifest and a pin, never their code.** An MCP server is a
  `connector` package with a new `runtime: mcp` block pinning npm, PyPI, OCI or MCPB artifacts by hash (the pins the MCP
  Registry already verifies), run as a separate supervised process, local stdio or LAN HTTP only, with a snapshot of its
  tool names and schema hash (a changed tool list at runtime is a new version needing review). An OpenAPI tool becomes
  generated recipe packages in the format the 25 bundled packages already use (no new runtime, the cheapest and safest
  import). A plain script needs the Deno sandbox tier and is deferred. Seed metadata from the MCP Registry's
  `server.json` but treat it as untrusted input to our review.
- **K6. Licences.** Separately run programs over a protocol (stdio, HTTP) are separate works; never link a third-party
  library into Home's process for a package, never copy third-party source into the catalog. This needs the owner's or
  counsel's sign-off against the sole-ownership rule before any wrapper ships.
- **K7. Build order for this half** (each step ships alone; sizes relative to one lane):
  1. `index.json` schema and generator over the 25 bundled packages, no signing yet. S.
  2. Signing, pinned keys, Home verification, `expires`, `index_serial`, offline cache. M, spec change in `commons`
     first.
  3. Install, update, uninstall of manifest-only packages with the permission diff and admin consent. M, reuses
     `plugins.ts` and the existing store code.
  4. `revoked.json`, the kill switch, an admin banner and the stale-index rule. S, the highest safety value for its size.
  5. The tier field and per-band filtering, landing with T2 so there is one filter. M.
  6. Submission pipeline in the catalog repo (CLA bot, manifest lint, permission diff, banned-API scan, licence check,
     scorecard). M, after verifying what PACKAGES.md already requires.
  7. OpenAPI importer. M.
  8. Storefront UI (browse, search, scorecard). M, after 1 to 3.
  Deferred: the Deno script tier, the MCP wrapper beyond the first connector (section 4), ratings, paid listings,
  user-hosted catalogs, full TUF, mirrors, automatic updates beyond security fixes.

## 8. Owner decisions

O1. Keep working bundled tools, or replace them with maintained servers as soon as one exists?
O2. May a connector reach a public site from the home IP when a household opts in (YouTube, ESPN)?
O3. May Home run an AGPL or GPL server as a separate process over stdio?
O4. Does Home refuse any server whose tool calls a hosted model? (Sampling, Roots and Logging are deprecated in MCP
2026-07-28, so Home simply never advertises sampling.)
O5. Are hosted MCP servers ever allowed, opt-in and adult-only?
O6. Starting cap (16), and whether recent use may rank tools above the cap.
O7. Minors: deny by default with an adult toggle per package, or an allowlist the platform ships.
O8. Spec tag for the `model_tool` block, and the index and manifest fields in K1 and K5: your word to cut each.
O9. Do we accept that "signed catalog package" means we sign the pin and the permissions, not the third party's code, and that a contributor who refuses the assignment is simply not accepted into Tier 1?
O10. Do commercial or paid packages exist, and may one carry a non-AGPL licence?
O11. Does Tier 2 exist in the first release? (Recommended: no.)
O12. May a child ever use a Tier 1 package with admin per-package approval, or Tier 0 only?
O13. The stale-index window N, and what a child's profile does when the catalog is unreachable longer than that.
O14. Key custody: who holds the offline root key and the CI key, and how rotation works.
O15. Who reviews Tier 1 permission diffs and at what service level? (Obsidian's unstaffed manual queue ran seven months.)
O16. May the Stack install a Node or uv runtime on the household machine for MCP servers, and is a remote MCP server ever allowed (adult, opt-in, privacy row)?
O17. Counsel review of the aggregation line (K6) before any wrapper ships.

## 9. Not verified

Everything the three research documents list as unverified, in particular the upstream terms pages, Home Assistant's
MCP documentation, whether each candidate runs under Deno's npm compatibility, and the real tool-count cap for
Qwen3-8B on our request path, Deno npm compatibility per server, and the existence of a maintained schema-flattening
library for llama.cpp's grammar subset (not found, a negative result).

## 10. Reuse checks (org principle 6: prebuilt first, build only where nothing fits)

| Decision | Prebuilt option looked at | Verdict |
|---|---|---|
| T1 `model_tool` block | MCP tool annotations (read, destructive, open-world hints) | Mirror them; keep our own block only for the trusted restatement, `min_band`, `surfaces`, `priority` which MCP lacks |
| T4 confirmation of a physical or write tool | assistant-ui's shipped tool-call approval element (name to be verified in the installed package at build time); MCP elicitation is server-initiated and unsuitable | Use the shipped element; the consent exchange itself is deterministic (rule 1 permits consent words). If no shipped element fits, name the gap in the design record before any code |
| H2 MCP client | Official TypeScript SDK v1.32 (stdio and Streamable HTTP) | Adopt. Schema sanitiser and name map: a search found no maintained library that flattens JSON Schema to llama.cpp's grammar subset (a negative result, unverified); keep, small |
| K1 index | MCP Registry `server.json` shape, Homebrew's JSON API, the existing `bundled-provenance.json` | Generate our index with a CI script; no library needed beyond JSON |
| K2 signing and freshness | minisign or Sigstore for signatures; tuf-js (npm, maintained, to be verified) for full TUF | Adopt a maintained signature tool; take only two TUF ideas (`expires`, `index_serial`) now, full tuf-js deferred until a measurement or an incident asks for it |
| K3 `revoked.json` | The kill-list patterns of VS Code and Open VSX (malicious extension list), Homebrew (disabled formulae) | Same signed-file machinery as the index, one verify path; nothing to adopt beyond the pattern |
| K4 tier filter | None; it is one more input to the T2 filter | Part of T2, no separate code |
| K5 MCP pin block | The pin types the MCP Registry already verifies (npm integrity, PyPI file hash, OCI digest, MCPB `fileSha256`) | Reuse those exact pin types, no new scheme |
| K5 OpenAPI importer | A maintained OpenAPI parser and validator (to be chosen at build time from candidates such as swagger-parser; verify licence and maintenance first) | Adopt a parser; the recipe emitter is ours, small |
| K7.6 submission pipeline | A maintained CLA bot (CLA Assistant), gitleaks, a licence checker and the existing standards tooling in `getmaipai/.github`; semgrep or the existing banned-API lint for the banned-API scan | Compose these; write only the permission-diff comment and the scorecard glue |
| K7.8 storefront UI | `shadcndashboard` data tables, cards and search, vendored in the kit (principle 6) | Compose shipped parts only; a gap is named in the design record before code |

