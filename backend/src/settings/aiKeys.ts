// `chat.model_id` remains declared for compatibility with stored settings.
// Home no longer writes it. The Stack owns chat model selection and process
// state. The three `_override` keys remain declared for legacy supervisor
// cleanup and do not control Stack chat.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// Kept as a stable key name while old stored values remain readable.
export const CHAT_MODEL_SETTING_KEY = "chat.model_id" as const;

// One setting points Home at its required local Stack. An empty value
// means the Stack is not configured and chat is unavailable.
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
  // THIN-5C (docs/design/RULES.md rule 10, SAFETY.md): the only admin choice
  // that moves a minor's output gate, and it chooses between two checked
  // modes; nothing turns the gate off. Household scope: it gives no admin
  // path into a teen's own settings (the 2026-09-30 ruling stands). A child
  // and every spoken turn are per sentence whatever this says.
  SettingsKey.parse({
    key: "chat.teen_gate_grain",
    scope: "household",
    selector: "select",
    range: { options: ["sentence", "arrival"] },
    default: "sentence",
    label: "How a teen's replies are checked",
    help: "\"Sentence\" checks every sentence before a teen sees it (the default). \"Arrival\" shows a teen's reply as it is written and checks it as it comes, so part of a sentence can show before its check finishes and the reply stops there if the check fails. Children and anything spoken always check every sentence first.",
    level: "advanced",
    lives_in: "household.ai",
    honoured_by: ["home"],
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
  SettingsKey.parse({
    key: "engines.stack.use_chat",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for chat",
    help: "Off, Home\'s own engine does this. Turn on only after the Stack has been proven for it. The memory judge and background worker follow this switch because they share chat\'s model.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_embeddings",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for search (embeddings)",
    help: "Off, Home\'s own engine does this. Turn on only after the Stack has been proven for it.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_stt",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for listening (speech to text)",
    help: "Off, Home\'s own engine does this. Turn on only after the Stack has been proven for it.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "engines.stack.use_tts",
    // Deprecated and ignored. A configured Stack serves every role.
    scope: "household",
    selector: "boolean",
    default: false,
    label: "Use the MaiPai Stack for speaking (text to speech)",
    help: "Off, Home\'s own engine does this. Turn on only after the Stack has been proven for it.",
    level: "expert",
    lives_in: "household.ai",
    honoured_by: ["home"],
  }),
];
