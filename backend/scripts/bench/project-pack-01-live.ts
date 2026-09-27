// PROJECT-PACK-01's own live acceptance line (docs/BACKLOG.md): "the
// book made end to end on the dev machine, the result opened and
// judged." Drives the REAL bedtime-storybook package (backend/packages/
// bedtime-storybook/, a real "project"-kind manifest + plan.json, not a
// fixture) through the real start_project mechanism: offer
// (startProjectToolSpec() lists it once registered), classify (policyNode's
// consequential confirm-then-allow gate), run (the real XState runner,
// four real chat calls against a live engine, the fan-out/fan-in shape
// proven for real), and completion (the assembled "book" artifact read
// straight off disk).
//
// CHAT-22 (setup.ts): never touches the household's own live-serving
// ports. MAIPAI_LLAMA_SERVER_URL/MAIPAI_EMBED_URL must name a side
// engine started on a SPARE port for this run alone - never 127.0.0.1:8787
// (the hub) or 127.0.0.1:8788/8794 (the household's own chat/embed
// engines). This script never spawns one itself (setup.ts's own rule);
// start one by hand first, e.g.:
//
//   /path/to/llama-server --model qwen3-4b-q4-k-m.gguf --port 28788 --host 127.0.0.1 -fa on -ngl all --jinja
//   /path/to/llama-server --model nomic-embed-text-v1.5.Q4_K_M.gguf --embedding --port 28794 --host 127.0.0.1
//
//   MAIPAI_DATA_DIR=$(mktemp -d) \
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:28788 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:28794 \
//   bun run backend/scripts/bench/project-pack-01-live.ts
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "project-pack-01-live-"));

const setup = await import("./setup");
await setup.startBench();

const { nextHlc } = await import("@/lib/hlc");
const { newPersonId, newConversationTurnId } = await import("@/lib/id");
const { resolveOrCreateConversation } = await import("@/lib/conversationHistory");
const { db } = await import("@/db");
const { people, conversationTurns } = await import("@/db/schema");
const { registerAllPackageProjectTypes } = await import("@/lib/plugins");
const { getProjectType, __resetProjectTypesForTests } = await import("@/lib/projects/projectTypes");
const { runStartProjectTool, START_PROJECT_TOOL_ID, startProjectToolSpec } = await import("@/lib/projects/tool");
const { policyNode } = await import("@/lib/turnMachine/nodes/policy");
const { waitForSettled } = await import("@/lib/projects/runner");

// A roster-safe person and topic (PII rules) - never a real household
// name or fact.
const ACTOR_NAME = "Sage";
const TOPIC = "a shy dragon who is scared of the dark";
const READER_AGE = 6;

function person(displayName: string) {
  return db
    .insert(people)
    .values({ id: newPersonId(), displayName, role: "adult", avatarSeed: "bench", source: "bench", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: nextHlc() })
    .returning()
    .get()!;
}

async function main(): Promise<void> {
  console.log(`[project-pack-01-live] MAIPAI_DATA_DIR=${process.env.MAIPAI_DATA_DIR}`);

  // __resetProjectTypesForTests() clears the registry back to just the
  // built-in bedtime-story type, then registerAllPackageProjectTypes()
  // is the SAME loader index.ts calls at real boot - this proves the
  // real bundled package registers through the real production path,
  // not a hand-built ProjectType.
  __resetProjectTypesForTests();
  registerAllPackageProjectTypes();
  const projectType = getProjectType("bedtime-storybook");
  if (!projectType) {
    console.error("[project-pack-01-live] REFUSED: bedtime-storybook did not register - check the manifest/plan.json refusal warnings above.");
    process.exit(1);
  }
  console.log(`[project-pack-01-live] registered: ${projectType.title} (minRole=${projectType.minRole}, consequential=${projectType.consequential})`);

  // "Offer": the real tool spec the model would actually see this turn,
  // built fresh from the registry (startProjectToolSpec(), the same
  // function nodes/model.ts's toolSpecFor() calls).
  const toolSpec = startProjectToolSpec();
  if (!toolSpec.description.includes("bedtime-storybook")) {
    console.error("[project-pack-01-live] REFUSED: startProjectToolSpec()'s own description doesn't name bedtime-storybook - the model would never be told it exists.");
    process.exit(1);
  }
  console.log(`[project-pack-01-live] offered tool description: ${toolSpec.description}`);

  const actor = person(ACTOR_NAME);
  const conversationResult = resolveOrCreateConversation(actor, "chat");
  if (!conversationResult.ok) throw new Error(conversationResult.error);
  const conversationId = conversationResult.value.id;
  const turnId = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id: turnId,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText: `write a longer bedtime story about ${TOPIC}, with real chapters`,
      replyText: "starting now",
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();

  const call = { tool: START_PROJECT_TOOL_ID, args: { type: "bedtime-storybook", params: { topic: TOPIC, reader_age: READER_AGE } }, id: "call-1" };

  // "Classify": a consequential type asks for confirmation the first
  // time, exactly the way policyNode already does for every other
  // consequential tool - this is PROJECT-START-01's own real policy
  // path, not a stand-in.
  const turnState = { turnId, conversationId, utterance: call.args.params.topic, context: [], temporary: false, actor } as never;
  const firstPass = await policyNode(turnState, { calls: [call as never] }, new AbortController().signal);
  const firstDecision = firstPass.output.entries[0]!.decision;
  if (firstDecision.allow) {
    console.error("[project-pack-01-live] REFUSED: expected confirm_needed on the first pass (consequential=true), got an immediate allow.");
    process.exit(1);
  }
  console.log(`[project-pack-01-live] first pass classification: reason=${firstDecision.reason}, prompt="${firstDecision.ask?.prompt}"`);

  // The household's own confirm: policyNode allows the identical call
  // once it carries a matching preConfirmed ActionProposal.
  const preConfirmed = { kind: "side_effecting" as const, request: { tool: START_PROJECT_TOOL_ID, args: call.args as Record<string, unknown>, callId: call.id } };
  const secondPass = await policyNode(turnState, { calls: [call as never], preConfirmed }, new AbortController().signal);
  const secondDecision = secondPass.output.entries[0]!.decision;
  if (!secondDecision.allow) {
    console.error(`[project-pack-01-live] REFUSED: the confirmed call was still refused: ${JSON.stringify(secondDecision)}`);
    process.exit(1);
  }
  console.log("[project-pack-01-live] second pass (confirmed): allowed.");

  // "Run": the real runner, against the real side engine.
  const startedAtMs = Date.now();
  const outcome = runStartProjectTool({ actor: actor as never, args: call.args, callId: call.id, conversationId, turnId, temporary: false });
  if (outcome.status !== "succeeded") {
    console.error(`[project-pack-01-live] REFUSED: start failed: ${outcome.errorCode} ${outcome.userMessage}`);
    process.exit(1);
  }
  console.log(`[project-pack-01-live] starting reply: "${outcome.result?.reply?.text}"`);
  const projectId = (outcome.result?.data as { projectId: string }).projectId;

  const finished = await waitForSettled(projectId);
  const elapsedS = ((Date.now() - startedAtMs) / 1000).toFixed(1);
  console.log(`[project-pack-01-live] project ${projectId} settled: state=${finished.state} after ${elapsedS}s`);
  for (const step of finished.steps) {
    console.log(`  step ${step.stepId}: ${step.state}${step.error ? ` (${step.error})` : ""}`);
  }

  if (finished.state !== "done") {
    console.error(`[project-pack-01-live] REFUSED: project did not finish done (state=${finished.state}, error=${finished.error})`);
    process.exit(1);
  }

  const bookStep = finished.steps.find((s) => s.stepId === "book");
  const artifactId = bookStep?.artifactIds[0];
  const artifact = artifactId ? finished.artifacts.find((a) => a.id === artifactId) : undefined;
  if (!artifact) {
    console.error("[project-pack-01-live] REFUSED: the book step produced no artifact.");
    process.exit(1);
  }
  const text = readFileSync(artifact.path, "utf8");
  console.log(`[project-pack-01-live] artifact gate: ${artifact.gate}, path: ${artifact.path}`);
  console.log("=".repeat(72));
  console.log(text);
  console.log("=".repeat(72));
  console.log(`[project-pack-01-live] DONE. Open the text above and judge it: a real title, three real chapters, a comforting ending, no garbage.`);
}

await main();
