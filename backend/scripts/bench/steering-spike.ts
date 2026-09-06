// The activation-steering spike (session-c-brain-and-voice.md step 4,
// docs/BACKLOG.md's "Activation steering spike (M, before any
// nine-slider prose)"): a measurement, not a feature, per the plan's own
// words - its outcome is a recorded decision, not new production code.
// Platform plan 5.4 and org principle 6 both say steering vectors beat
// personality prose; this is the bench that actually checks that claim
// against this platform's real model and real persona voice, rather
// than taking the research literature's word for it.
//
// llama-server (the mandated engine) takes `--control-vector`; the
// llama.cpp release already downloaded for the chat role bundles
// `llama-cvector-generator` alongside it (verified on this dev machine,
// 2026-09-06: engineCatalog.ts's own pinned archive contains it, no
// separate download needed). This script is the CONSTANT half of the
// comparison (send the same 30 scripted exchanges, score the same way
// persona-eval.ts already does); training the vector and pointing two
// different server processes at the two conditions is an operator step
// documented below, not something this script does itself - spawning a
// SECOND llama-server that shares no state with the one `llmSupervisor.ts`
// already manages is exactly the kind of one-off infrastructure a bench
// script has no business doing quietly on the side.
//
// Deliberately bypasses lib/turnEngine.ts and lib/llm.ts entirely,
// calling the LlamaServerClient directly: turnEngine.ts's
// buildSystemPrompt() always composes the FULL stable prefix (identity,
// naturalness policy, plugins list, household/speaker/memory sections),
// which would confound the comparison this spike exists to make - the
// question here is narrowly "does a control vector reproduce a
// persona's REGISTER as well as its own paragraph does," not "does a
// full turn engine prompt work." Two conditions, same 30 utterances,
// same model, same everything except the one variable:
//   - "paragraph": system message = identity + composePersonaPrompt(buddy)
//     (today's real product mechanism), server has NO control vector.
//   - "vector": system message = identity only (no persona prose at
//     all), server points at a chat model launched WITH
//     --control-vector pointed at the trained buddy.gguf.
//
// How to run the full comparison (both conditions need llama-server
// spawned by hand - the model and binary paths below match where
// engineCatalog.ts/modelDownload.ts already put them on this machine):
//
//   LLAMA=<engine dir>/llama-server
//   MODEL=<models dir>/qwen3-8b-instruct-q4-k-m.gguf
//
//   # 1. Train the vector from this bench's own paired prompts (seconds,
//   #    not minutes - verified on this dev machine's Apple Silicon Mac):
//   <engine dir>/llama-cvector-generator -m $MODEL \
//     --positive-file backend/scripts/bench/steering/positive.txt \
//     --negative-file backend/scripts/bench/steering/negative.txt \
//     -o backend/scripts/bench/steering/buddy.gguf
//
//   # 2. Paragraph condition:
//   $LLAMA -m $MODEL --port 8734 --reasoning off &
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8734 \
//     bun run scripts/bench/steering-spike.ts --label paragraph
//
//   # 3. Vector condition (stop the first server first - one model in
//   #    memory at a time on a dev machine):
//   $LLAMA -m $MODEL --port 8734 --reasoning off \
//     --control-vector backend/scripts/bench/steering/buddy.gguf &
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8734 \
//     bun run scripts/bench/steering-spike.ts --label vector
//
// Usage: bun run scripts/bench/steering-spike.ts --label <paragraph|vector>
import { getChatClient, stopChatBackend } from "@/lib/llmSupervisor";
import { composePersonaPrompt } from "@/lib/persona";
import type { LlmMessage } from "@/lib/llm";

// A code review (2026-09-06) found this script had no check that
// MAIPAI_LLAMA_SERVER_URL was actually set to the intended condition's
// server before running - without it, llmSupervisor.ts's own tier-3
// fallback (trySpawnFromSelection) would silently spawn a THIRD real
// llama-server process rather than talking to the hand-spawned one this
// spike's own comparison depends on, invalidating whichever half ran
// second and, worse, leaving a real orphaned process running. Both
// conditions require the operator to have already spawned their own
// server by hand (see the header), so failing loudly here beats a
// script that "succeeds" against the wrong backend.
if (!process.env.MAIPAI_LLAMA_SERVER_URL) {
  console.error("MAIPAI_LLAMA_SERVER_URL must point at the hand-spawned server for this condition (see this file's header for the exact commands).");
  process.exit(1);
}

const LABEL = (() => {
  const i = process.argv.indexOf("--label");
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== "paragraph" && v !== "vector") throw new Error("usage: --label paragraph|vector");
  return v;
})();

const IDENTITY_ONLY = "You are Buddy, this household's AI assistant. Speak in the first person.";

const BUDDY = {
  id: "buddy",
  display_name: "Buddy",
  formality: "casual" as const,
  complexity: "simple" as const,
  engagement: "curious" as const,
  filler_density: "light" as const,
};

const SYSTEM_PROMPT = LABEL === "paragraph" ? `${IDENTITY_ONLY} ${composePersonaPrompt(BUDDY)}` : IDENTITY_ONLY;

// Thirty scripted exchanges (the plan's own number), a superset of
// persona-eval.ts's ten repeated across three rounds with light variation
// so the transcript isn't literally three identical loops - register
// drift over a longer conversation is the whole point of "thirty turns,"
// which a genuinely repeating transcript wouldn't test honestly.
const EXCHANGES: readonly string[] = [
  "hi there!",
  "what's the weather like today?",
  "can you help me with something?",
  "I'm not sure what to do about this",
  "thanks for the help",
  "what do you think about that?",
  "tell me something interesting",
  "I had a rough day today",
  "what's 2 plus 2?",
  "goodnight",
  "hey, you around?",
  "is it gonna rain later?",
  "can you give me a hand with this?",
  "I don't really know what to do here",
  "appreciate it",
  "what's your take on that?",
  "say something interesting",
  "today was kind of a rough one",
  "what's 5 plus 5?",
  "alright, goodnight",
  "yo",
  "how's the weather looking?",
  "could you help me out?",
  "still not sure what to do about it",
  "thanks a lot",
  "what do you make of that?",
  "got anything interesting to share?",
  "man, today was rough",
  "what's 10 plus 10?",
  "okay, night",
];

const CONTRACTIONS = ["can't", "won't", "don't", "it's", "you're", "i'm", "that's", "isn't", "didn't"];

async function main(): Promise<void> {
  const client = await getChatClient();
  const messages: LlmMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  let contractionsUsed = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const replies: string[] = [];

  for (const utterance of EXCHANGES) {
    messages.push({ role: "user", content: utterance });
    const response = await client.chatComplete({ model: "chat", messages, chat_template_kwargs: { enable_thinking: false } });
    const reply = response.choices[0]?.message.content ?? "";
    replies.push(reply);
    messages.push({ role: "assistant", content: reply });

    if (CONTRACTIONS.some((c) => reply.toLowerCase().includes(c))) contractionsUsed++;
    if (response.usage) {
      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;
    }
  }

  console.log(`condition=${LABEL}`);
  console.log(`system prompt: ${SYSTEM_PROMPT.length} chars`);
  console.log(`register-holding (casual contraction present): ${contractionsUsed}/${EXCHANGES.length}`);
  console.log(`total prompt tokens across ${EXCHANGES.length} turns: ${totalPromptTokens}`);
  console.log(`total completion tokens: ${totalCompletionTokens}`);
  console.log(`\nreplies:`);
  replies.forEach((r, i) => console.log(`  ${i}. "${EXCHANGES[i]}" -> "${r}"`));
}

try {
  await main();
} finally {
  // persona-eval.ts's own found-live lesson (its comment on this exact
  // call): runTurn()/getChatClient() never stop a spawned backend on
  // their own, so a script that skips this leaves a real process
  // running as a zombie - a code review (2026-09-06) found this script
  // had no cleanup at all.
  stopChatBackend();
}
