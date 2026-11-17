# Portable apps and the Catalog: design, how far off we are, and the plan (2026-11-16)

Design review and plan. Read only: nothing is committed and no code was changed. Files and lines are from `origin/main` of `home`, `catalog`, `commons` and `.github`, read on 2026-11-16. Facts about outside standards come from a web search the same day and are marked where the source was secondary. Companion report: [stack-vs-home-model-data-review-2026-11-16.md](stack-vs-home-model-data-review-2026-11-16.md).

## 1. Bottom line

The goal: a friend builds an astronomy app with Claude, has no interest in MaiPai, and it still works in MaiPai with almost no work from him.

1. **The standard already exists and we already speak it.** The open standard for "a capability any AI app can use" is the Model Context Protocol (MCP). A friend who builds a tool with Claude today most likely produces an MCP server. Home's code packages are already MCP servers (`home/backend/src/lib/denoHost.ts:1-12`), and Home already has a general MCP client (`backend/src/lib/mcp/connector.ts`).
2. **So he conforms to MCP, not to MaiPai.** His app works in his own product, in Claude, in ChatGPT and in other MCP hosts. MaiPai adopts it with a small entry that **we** write and sign. He does nothing, or at most runs one check command.
3. **We are about two thirds there, with four real gaps:** our own packages use a private dialect of MCP, the general client is not wired to anything, the Catalog can only take code that is assigned to us, and there is no safe way to run code we did not write.
4. **Size:** about 12 briefs. Your one decision is recorded in section 7.

## 2. What exists today

| Piece | State | Where |
|---|---|---|
| One manifest for every package kind | Built. About 45 fields, 15 required, MaiPai-specific (`min_app`, `tier`, `incognito`, a fixed list of nine categories) | `commons/spec/schemas/manifest.schema.json` |
| Declarative packages (Tier 0) | Built: a recipe run by our interpreters. 59 of Home's 72 bundled packages | `home/backend/packages/` |
| Code packages (Tier 1) | Built: an MCP server over stdio under Deno with no network. 12 packages. Private dialect: one tool that must be named `handle`, and a `host/fetch` request back to Home for every network call | `home/backend/src/lib/denoHost.ts:1-12,119`; `catalog/plugins/info/book-lookup/handler.ts` |
| Apps | Built: pages written as data in our own UI schema (43 element types), drawn by kit Elements. Web pages are refused; a package never ships React | `.github/docs/PACKAGES.md`, "Writing an app package"; `commons/spec/ui/schema.json` |
| Answer blocks | Built: 35 kinds, many generic (`table`, `data_table`, `spec_sheet`, `chart`, `list`, `image_gallery`, `media_card`, `timeline`, `figure`) | `commons/spec/schemas/answer-block.schema.json` |
| General MCP client | Written, with a tool allowlist, a hash pin on each tool's definition, timeouts and result caps. **Nothing imports it** | `home/backend/src/lib/mcp/connector.ts` (116 lines) |
| Two MCP libraries | `@modelcontextprotocol/sdk` for packages and `@modelcontextprotocol/client` for connectors | `home/backend/package.json:25-26` |
| Catalog | Signed index and tooling built; 13 packages. README still says "pre-code". Every merge needs a signed copyright assignment | `catalog/README.md`, `catalog/docs/dev.md:46-53` |
| Where packages live | 72 bundled inside Home, 13 in the Catalog, 10 in both (tracked by `bundled-provenance.json`) | `home/backend/packages/` |
| Store | Verify, unpack, smoke test, permission diff and rollback work. No pinned store address or root key yet ("once one exists") | `home/backend/src/lib/storeIndex.ts:136,156` |
| Third-party rules | Decided: a tool result is untrusted, size capped and cleaned; no connector tool for a child or teen by default | `home/docs/plans/agentic-build-plan-2026-11-06.md:77,94` |

## 3. The design

### 3a. What he builds: a plain MCP server
No MaiPai library, no MaiPai manifest, no account. A normal MCP server with:
- Tools with a name, a description and a JSON Schema for the input.
- A JSON Schema for the output and structured results, so a host can draw them without guessing.
- The standard hints that say whether a tool only reads or also changes something.

He can publish it the way MCP servers are already published: a package on npm or PyPI, a single-file bundle (the MCP bundle format, `.mcpb`, a zip with one manifest), or a listing in the official MCP registry, which stores metadata and points at the package. The registry was still described as a preview in August 2026 by one guide, so treat it as optional.

### 3b. What we add: an adoption entry in the Catalog
Everything MaiPai needs that the standard does not carry lives in one small file that we write, review and sign. It points at his release; it does not copy his code.

```ts
interface AdoptionEntry {              // catalog/portable/<id>/adoption.json, schema in commons/spec
  id: string;                          // our id for it
  display: string; description: string; category: string;
  source: {                            // where his release lives, pinned
    type: "npm" | "pypi" | "mcpb" | "remote";
    name: string; version: string; sha256: string | null;   // null only for "remote"
    licence: string; homepage: string;
  };
  tools: {                             // only the tools we allow; anything else is not offered
    name: string;
    definition_sha256: string;         // the tool's own definition; a change disables it until reviewed
    reads_only: boolean;               // false means it asks before it acts
    min_role: "adult" | "teen" | "child";
    show_as?: { block: string; map: Record<string, string> };   // structured result fields to an answer block
    examples: string[];                // what a person might say
  }[];
  network: { host: string; what: string; when: string }[];   // every host it may reach, shown as privacy rows
  incognito: "blocked" | "ephemeral" | "unaffected";
  pages?: string[];                    // optional pages in our UI schema, bound to tool calls
  community: true;                     // the store card says "community-made"
}
```

Why this shape works for him: he never sees it. Why it works for us: the age floor, the privacy rows, the network list and the tool pins are ours to decide, and they are the parts that must not depend on an outsider.

No copyright assignment is needed, because the Catalog holds only our entry. Assignment stays for code that is hosted in the Catalog. His licence is recorded and shown.

### 3c. How it shows up in MaiPai
- **In chat:** his allowed tools are offered to the model like any package tool. Results pass the same output floor and age band as every reply.
- **Drawn natively, on every screen:** a structured result is mapped to an answer block by `show_as`. A tool with no mapping still shows as a generic table or fact sheet built from its output schema. Because blocks and pages are data, this works on Home, on the robot and later on Go with no web view.
- **As an app, if we want one:** optional pages in our existing UI schema, written by us in the adoption entry, bound to his tool calls. An astronomy app could have "Tonight's sky" and "Planets" pages without him writing any UI.
- **His own HTML interface:** the standard has an extension for this (MCP Apps: a server returns an HTML view that the host shows in a sandboxed frame; secondary sources say it was made official in January 2026 and name Claude, ChatGPT and VS Code as hosts). MaiPai refuses web pages from packages today, and the TV app cannot show them. Decided 2026-11-16: native blocks only (section 7).

### 3d. How it runs safely
His code is code we did not write, so it runs with nothing by default:
- **Files:** only its own data folder.
- **Network:** only the hosts listed in the adoption entry, through a hub-side filter, and each host is a privacy row a person can read.
- **Runtime, in order of trust:** a JavaScript or TypeScript server runs under Deno with network allowed for the listed hosts only (Deno can run npm packages). A Python server needs an operating-system sandbox, which is a spike before it is promised. A remote server, one that runs on his machine or in a cloud, is an outbound connection: off by default, adults only, an admin turns it on, and the card says data leaves the home.
- **Changes:** a tool that changes something asks first. A tool whose definition changes is switched off until we review it (the pin check that `connector.ts` already has).
- **Children and teens:** not offered, as today, unless an admin allows a read-only tool for a teen. Never for a child.
- **Failures:** a crash or a timeout tells the model the failure kind; the answer still arrives.

### 3e. One MCP layer, and our own packages become portable too
Today there are two paths: the private `handle` dialect for our packages and the unused general client. Make them one: every code package is a plain MCP server with real tool names, run by one host layer with one library. Then the door opens both ways: his app runs in MaiPai, and a MaiPai package can be used in Claude or in his app. The `host/fetch` request stays as an optional extra for packages that want Home's cache and rate limits; a plain server uses the filtered network instead.

### 3f. What stays MaiPai-only
Companions, skills in our format, settings areas, tours, wake words and voices are household features with no outside standard. They stay in the manifest. Skills already follow Claude's skill file shape, which is portable as it is.

## 4. His experience, step by step

1. He builds his astronomy tools as an MCP server with Claude. This is what he would do anyway.
2. Optional, about ten minutes: he runs one command, `npx @maipai/app-check <his package>`, which needs no MaiPai install. It lists what is missing in plain words, for example "tool `planet_position` has no output schema, so hosts cannot draw it".
3. He publishes it wherever he likes and tells us the name.
4. We write the adoption entry, run it in the sandbox against test questions, sign it and publish it.
5. A household admin sees "Astronomy (community-made)" in the store with its privacy rows, and installs it.
6. He ships a new version. Our pin notices the change, we review the difference, and households get an update button.

If he ever wants to do step 4 himself, he can put the same entry in his own repo. He never has to.

## 5. How far off we are

| Need | Today | Gap |
|---|---|---|
| A standard he already uses | MCP inside our code packages | Private dialect: the single `handle` tool and required `host/fetch` (`denoHost.ts:1-12`) |
| A client for any MCP server | `mcp/connector.ts`, complete with pins | Not wired: no importer in `backend/src` |
| A Catalog entry that points outside | None. Every package is a directory of code under our licence and assignment | New entry type and schema |
| Running code we did not write | Deno with no network at all (`denoHost.ts:119`) | Network limited to listed hosts; Python and remote not handled |
| Drawing a result we never saw before | 35 answer blocks, several generic | Mapping from an output schema to a block; a default for unmapped tools |
| A store people can browse and trust | Verify and rollback work | No pinned store address or root key (`storeIndex.ts:136,156`) |
| A check he can run alone | `catalog/tools` has a `check` command for our manifests | A mode that takes any MCP server |
| One home for packages | 72 in Home, 13 in the Catalog | Move the bundled set to the Catalog; Home pins a default set |
| Honest docs | Catalog README says "pre-code" | Rewrite |

## 6. The plan

Spec first, then Catalog, then Home. Each brief is small and has an exit check that can fail. Decided, testable briefs go to Codex first.

### Phase 1. Decide and specify
- **PA-01 (home docs; S).** Design note from this report; architect verdict. It builds on `packages-apps-and-integrations-2026-10-17.md` and `agentic-build-plan-2026-11-06.md` and re-decides nothing they settled. Exit: verdict recorded.
- **PA-02 (commons; M).** The `adoption` record and the output-to-block mapping in `spec`, with fixtures, including a bad pin and a tool not on the list. Exit: schema tests; tag cut.

### Phase 2. One MCP layer in Home
- **PA-03 (home; M).** One host layer on one MCP library; wire `mcp/connector.ts`; delete the second library. Exit: an outside sample server lists and calls a tool in a test; one MCP dependency in `package.json`.
- **PA-04 (home and catalog; L, split by package).** The 12 code packages become plain MCP servers with real tool names; the `handle` convention is deleted, not kept beside the new one. Exit: each package also answers a stock MCP test client; package tests pass.
- **PA-05 (home; M, risky surface).** Network for outside servers limited to listed hosts; filesystem limited to its folder. Exit: a test server that tries an unlisted host, a file outside its folder and a child process is refused three times, with a plain line each.

### Phase 3. Catalog can adopt
- **PA-06 (catalog; M).** `portable/<id>/adoption.json`, lint, sign and index support; the store card text "community-made"; the licence scan reads `source.licence`; no assignment check for adoption entries. Exit: a tampered pin and an unknown signer are refused on install.
- **PA-07 (catalog; S).** `app-check` as a stand-alone command for any MCP server. Exit: run against three public servers, it reports missing output schemas and unsafe hints in plain words.
- **PA-08 (home; M).** Draw structured results: `show_as` mapping, and a default table or fact sheet from the output schema. Exit: an unmapped tool still shows a readable card at desktop and phone width.

### Phase 4. Prove it with a real one
- **PA-09 (all; M).** Adopt one real outside server end to end; the friend's astronomy app if it exists, otherwise a public read-only one. Exit: installed from the store on the dev hub, asked three questions, results drawn, a child sees nothing, a changed tool definition switches it off.

### Phase 5. Clean up the Catalog
- **PA-10 (catalog and home; L, split).** Move the bundled packages to the Catalog; Home ships a pinned default set and no package source. Exit: `backend/packages` holds no package code; a fresh install has the same default set.
- **PA-11 (home; S, needs a key decision already on the backlog).** Pin the store address and the root key. Exit: an install from any other address is refused.
- **PA-12 (catalog; S).** Rewrite the README and `docs/dev.md` to the real state. Exit: `check.sh --docs` green.

### Later, each behind its own decision
- Python servers in an operating-system sandbox (a spike first).
- Remote servers for adults with an admin's approval.

## 7. Your decision (answered 2026-11-16)

**Outside apps showing their own HTML screens: no.** Results are drawn with our own cards, tables and charts on every screen. The "his own HTML views" line under "Later" in section 6 is dropped.

Already decided elsewhere and unchanged here: outside tools are off for children and teens by default; nothing leaves the home unless an adult turns on a listed connection.

## 8. Risks, plainly

1. **Running other people's code is the hard part.** PA-05 is the guard. Until it passes, adopt only read-only servers we have read line by line.
2. **A pinned release can still be wrong.** The pin stops silent changes; it does not make the code good. Review at adoption is real work each time.
3. **The standard moves.** The agentic build plan notes a spec revision in mid 2026 that changes the handshake. One host layer (PA-03) keeps that cost in one place.
4. **Not verified:** the official status and host list of the HTML extension and the registry came from secondary sources. Confirm against the official pages before either is relied on.

## 9. Sharing a running component: the fast voice loop example (added 2026-11-16)

Question: a friend builds a fast speech loop (about 1.3 s from the end of a sentence to the first sound in his diagram). Can he build it, share it, we include it, and take his updates?

**Yes, as a third kind of shared thing.** It is not a tool, so MCP is the wrong fit.

| Shared thing | Example | How it is shared | Where it runs |
|---|---|---|---|
| Tool or app | astronomy lookups | plain MCP server plus our adoption entry (sections 3 to 6) | Home's package host |
| Part | a voice, a "has the person finished" model | an entry in the Catalog parts index (the companion report) | the Stack |
| **Component** | the voice loop itself | a versioned process behind a role contract, listed as an engine part | the Stack |

### 9a. The cut that makes it shareable
His loop does five jobs: hear when you stop, turn speech to text, decide what to answer, speak, and handle talking over. Four of those are the same in his app and ours. One is not: **deciding what to answer.** In his app that is his model. In MaiPai it must be Home's turn, where the age gates, memory, tools and the sentence-by-sentence check for a child run.

So the component is the loop with one hole in it:

```ts
// The component owns: audio in, end-of-speech, speech to text, speaking, talk-over, timing.
// The host supplies one thing:
respond(input: { text: string; session: string }): AsyncIterable<{ sentence: string }>
// His app: his model. MaiPai: Home's turn route, which releases only sentences that passed the gate.
```

The models it uses (speech to text, the small "finished?" checker, the voice) are not inside it. It asks for them by role at the Stack's address, in the OpenAI-shaped routes the Stack already serves. So his loop brings no model files, and we choose the models with the same priority list as everything else.

### 9b. Wire and precedents to review before choosing
- Outer wire: audio frames in and out plus events (speech started, speech ended, transcript, first sound, interrupted) over a socket.
- Existing shapes worth copying, not inventing: the OpenAI Realtime event shape, the Wyoming protocol used by Home Assistant's voice stages, and the pipeline frameworks Pipecat and LiveKit Agents. These are from my own knowledge and were not checked today; brief VL-01 confirms them.

### 9c. Update and re-include
He tags a release. We add its url, sha256 and version to the parts index and sign it. The Stack shows "update available"; the Update button stages it, runs the contract test and the timing bench, swaps, and rolls back on a miss. Two loops can be installed at once, his and ours, as priority 1 and 2 of the `voice.loop` role; switching is changing the order. Nothing in Home changes when he ships.

### 9d. What must be true before we sign a version
- **Contract test:** events in the right order, talk-over stops the voice within a set time, a withheld sentence is never spoken.
- **Timing bench on our hardware:** his 1.3 s is his computer and his models. We measure first sound on the Studio and on a small Mac and record the numbers (rule 13: measured, not argued).
- **Isolation:** loopback only, no network, its own folder, audio only from the Stack. It is code we did not write with access to the microphone stream.
- **Child check:** a child's turn through his loop passes the same gate tests as ours.

### 9e. How far off we are
There is no seam to drop it into today. The loop is spread through Home: voice detection runs inside Home (`backend/src/lib/sileroVad.ts`, 151 lines, a model run in Home's own process), end-of-turn rules are in Home (`lib/turnEnd.ts`, 110), the streaming speech socket is in Home (`routes/stt.ts:44`), timing is in Home (`lib/voiceTiming.ts`, 252), and the Stack's speech to text takes one finished file (`stack/backend/src/routes/v1.ts`, `/audio/transcriptions`). Existing design to build on, not replace: `home/docs/design/talk-over-2026-11-12.md` and the Stack's planned Smart Turn (DUPLEX-02).

One honest point: some of what makes his loop fast is technique, not code (checking for the end of speech 30 times a second, transcribing during the pause, starting the answer early and keeping the model warm, speaking the first phrase at once). For each technique the cheaper path may be to port the idea into our loop. Decide per technique: adopt his component, port the idea, or skip.

### 9f. Briefs
- **VL-01 (read only).** Review the four precedents above and our talk-over design; pick the wire. Exit: one page with sources and a per-technique verdict (adopt, port, skip) for his loop.
- **VL-02 (commons; M).** The `voice.loop` role contract, a contract test kit and a timing bench any implementation can run. Exit: the kit fails a fake loop that speaks a withheld sentence.
- **VL-03 (stack then home; L, split, risky surface).** Our own loop moves behind the contract in the Stack; voice detection, end-of-turn and the speech socket leave Home; Home keeps `respond` with its gates. Exit: same child-gate tests, first-sound time no worse than today, measured.
- **VL-04 (catalog, stack; M).** Adopt his loop as a second `voice.loop` part. Exit: both pass the kit; the bench table decides which is priority 1.

## Sources

- [SEP-1865: MCP Apps, interactive user interfaces for MCP](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
- [MCP Apps announcement, 2025-11-21](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
- [MCP Apps extension overview](https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html)
- [MCP bundle format repository](https://github.com/modelcontextprotocol/mcpb)
- [Building MCP bundles](https://claude.com/docs/connectors/building/mcpb)
- [MCP registry quickstart](https://modelcontextprotocol.io/registry/quickstart.md)
- [MCP registry working group](https://modelcontextprotocol.io/community/working-groups/registry)
