// AI settings (docs/SETTINGS.md Rule 3: "One card per role... Advanced
// and expert details fold"). `chat.model_id` is the household's real
// selection (llmSupervisor.ts's tier 3 reads it to know what to spawn);
// the three `_override` keys are engineAutotune.ts's advanced escape
// hatch ("auto-tune launch flags... with an advanced override," this
// pass's own brief) for context size, flash attention, and the quantized
// KV cache, each defaulting to "let auto-tune decide."
//
// `chat.model_id` is `level: "expert"` on purpose, not "basic": it isn't
// meant to be edited through the generic settings renderer at all (Rule 1
// - ModelsSection.tsx's "choose this" flow is the real, declared `setup`-
// style escape hatch that owns changing it, since a plain value write
// here has no download/spawn side effects the generic PUT /api/settings
// route would run). Expert level just keeps it out of the Advanced fold a
// person browsing AI settings would otherwise see and could edit into a
// broken state (a stale or mistyped catalog id) with no download behind
// it.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// The chat picker and the engine supervisor both refer to the same real
// household selection. Keeping the key name beside its declaration makes a
// dedicated chat surface less likely to drift into a second setting.
export const CHAT_MODEL_SETTING_KEY = "chat.model_id" as const;

// HOME-STACK-02b: one setting decides whether Home's model calls go
// through a MaiPai Stack instead of its own built-in supervisors. Empty
// (the default) means no Stack is configured: Home keeps today's own
// spawned engines exactly as before. HOME-STACK-01's installer is the
// real, planned writer once it lands; until then this is a manual escape
// hatch for a hand-run Stack, same household scope and same
// not-for-the-generic-renderer posture as `chat.model_id` above (no
// download or spawn side effect here either, but pointing Home at the
// wrong URL silently breaks every model call, so it stays out of the
// Advanced fold a person could stumble into).
export const STACK_URL_SETTING_KEY = "engines.stack.url" as const;

export const AI_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "chat.model_id",
    scope: "household",
    selector: "text",
    default: "",
    label: "Selected chat model",
    help: "The catalog model id currently downloaded and running for chat. Changed through the AI models page, not here.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.context_size_override",
    scope: "household",
    selector: "number",
    range: { min: 0, max: 131072 },
    default: 0,
    label: "Chat context size override",
    help: "0 lets the hub pick the largest context that fits this computer's memory. A higher number can run out of memory; a lower one leaves headroom but remembers less of the conversation.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.flash_attention_override",
    scope: "household",
    selector: "select",
    range: { options: ["auto", "on", "off"] },
    default: "auto",
    label: "Flash attention override",
    help: "\"Auto\" lets the hub decide based on the model and the quantized-KV-cache setting. Flash attention speeds up longer conversations; a very old GPU may not support it.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "chat.kv_cache_override",
    scope: "household",
    selector: "select",
    range: { options: ["auto", "quantized", "full"] },
    default: "auto",
    label: "KV cache precision override",
    help: "\"Auto\" quantizes the conversation cache to fit more context in the same memory, with a small quality tradeoff. \"Full\" uses full precision: more accurate, uses roughly twice the memory for the same context size.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  // U2 (docs/plans/turn-machine-state-record-2026-09-22.md, "The
  // setting"): off keeps runTurnStream() (turnEngine.ts); on runs the
  // new turnNext.ts machine instead. The route reads it per turn.
  // honoured_by carries "bot" too (the design record's own words)
  // since the robot runs the identical machine, just with
  // model_transitions off in its budget record.
  // U6: the flip, decided (dev.md, 2026-09-24) - default true. Rerun
  // 3's own numbers are the acceptance: five named rows 15/15, three
  // controls 9/9, no engine-classed row, no empty reply, no refusal;
  // forced search 3,495ms median under the 10s bar. Two accepted
  // exceptions, named in docs/BACKLOG.md's own U6 row: the cache bar
  // (PHRASE-02's own mechanism, five rows, plus one scorer defect this
  // session's own fix corrected) and the retired plain-turn ratio
  // (never a real regression - the reply floor makes a longer reply
  // the design, replaced by the idle-gap bar above). The old path
  // (`buildSystemPrompt`, `runTurnStream`) stays reachable until the
  // plan's own section 2 deletions.
  SettingsKey.parse({
    key: "turn.pipeline.next",
    scope: "household",
    selector: "boolean",
    default: true,
    label: "Use the new reply engine",
    help: "On uses the rebuilt engine (the default since U6). Off falls back to the old one.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home", "bot"],
  }),
  SettingsKey.parse({
    key: "engines.stack.url",
    scope: "household",
    selector: "text",
    default: "",
    label: "MaiPai Stack address",
    help: "Empty uses Home's own built-in engines. Set once a MaiPai Stack is installed on this machine to route chat, embeddings and voice through it instead.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
];
